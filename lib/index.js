import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import net from "node:net";

const libDir = dirname(fileURLToPath(import.meta.url));
// The plugin root holds bin/, config.toml and runtime-config.toml; index.js
// lives in lib/, but keep working if a loader serves it from the root.
const pluginRoot = join(libDir, "..");
const pluginDir = existsSync(join(pluginRoot, "config.toml")) ? pluginRoot : libDir;
const BIN = join(pluginDir, "bin", "dsh.exe");
const TEMPLATE_CONFIG = join(pluginDir, "config.toml");

export const name = "dsh-prologue";

/** Debug-only export used by the offline bundle builder (tools/build-custom.cjs). */
export const __patchPipeline = () => ({ patchStartupAsset, patchStartupPreview, patchStartupSequence, patchStartupHtml, patchStartupVisuals, UI_DEFAULTS });

/** Services this plugin depends on; cordis injects them into apply(ctx). */
export const inject = ["tools", "subprocess", "webServer"];

export const Config = z.object({
  apiKey: z.string().description("DeepSeek API key for the dsh-rust engine. Falls back to the DEEPSEEK_API_KEY / DSH_LLM_API_KEY / OPENAI_API_KEY environment variables, then to dsh-rust's own credentials.env.").default(""),
  model: z.string().description("Model override passed to dsh-rust; leave empty to use the bundled config.toml default (deepseek-v4-pro).").default(""),
  maxOutputBytes: z.number().description("Per-run stdout/stderr capture limit.").default(65536),
  execTimeoutMs: z.number().description("Time budget for one dsh_rust_exec run.").default(300000),
  startup: z.object({
    enabled: z.boolean().description("Play the startup (boot) animation when the dsh-rust interactive TUI boots."),
    sound: z.boolean().description("Enable the synthesized startup sound effects and English narration."),
    volume: z.number().description("Startup sound volume from 0.0 (mute) to 1.0 (max)."),
    speed: z.number().description("Playback speed multiplier from 0.25 to 3.0 (the six phases take about 13.8 s at 1.0)."),
    theme: z.string().description('Startup color theme: "dark" or "light".'),
    interactive: z.boolean().description("Confirm three checkpoints with a click, Enter, or Space during playback."),
    reducedMotion: z.boolean().description("Show a static startup frame instead of the full motion sequence.")
  }).description("Startup (boot) animation settings. Only the fields you explicitly set here are persisted into the bundled dsh-rust config.toml; everything else keeps the value stored by dsh_rust_startup_settings.")
});

function readField(field, fallback) {
  if (field === undefined || field === null) return fallback;
  const value = typeof field.get === "function" ? field.get() : field;
  return value === undefined ? fallback : value;
}

function readAll(value) {
  if (value === undefined || value === null) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "string") return String(value);
  if (typeof value.readFrom === "function") {
    // Harness collected readers return { text, nextOffset, lossy, spillPath? }.
    const chunk = value.readFrom(0);
    if (chunk === undefined || chunk === null) return "";
    if (typeof chunk === "string") return chunk;
    if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
    if (typeof chunk.text === "string") return chunk.text;
    if (typeof value.snapshot === "function") {
      const snap = value.snapshot();
      if (snap && Buffer.isBuffer(snap.bytes)) return snap.bytes.toString("utf8");
    }
    return "";
  }
  if (typeof value.text === "string") return value.text;
  return String(value);
}

async function readBody(req) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function readRawBody(req) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch {
    return Buffer.alloc(0);
  }
}

// Same-origin proxy prefix for the settings-page iframe: the Rust startup host
// refuses cross-origin requests ("Local same-origin request required"), so the
// page must be served from the DSH web origin. Absolute paths inside the page
// (/api/profile, /api/load, /assets/voice/...) are rewritten onto this prefix.
const PREVIEW_PROXY_PREFIX = "/dsh-prologue/startup-preview";

// UI-only preferences the compiled dsh.exe knows nothing about. Kept in a
// separate file so the bundled config.toml stays exactly what the binary parses.
const UI_SETTINGS_PATH = join(pluginDir, "ui-settings.json");
const UI_DEFAULTS = { advanceMode: "click", overlay: true, richEffects: false, livePlugins: true, sourceAssets: true, pace: 1.5, identityLevel: "L2", accessPassword: "Dsh7Rk29Wq41Mn8T", renderScale: 2};

// Full-fidelity startup assets taken from the deepseek-harness-rust-optimize
// source tree (docs/). The dsh.exe currently deployed embeds an older, trimmed
// generation of the same演出, so these are served in preference to the binary's.
const STARTUP_ASSETS_DIR = join(pluginDir, "startup-assets");

function readUiSettings() {
  try {
    const parsed = JSON.parse(readFileSync(UI_SETTINGS_PATH, "utf8"));
    return { ...UI_DEFAULTS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...UI_DEFAULTS };
  }
}

function writeUiSettings(patch) {
  const next = { ...readUiSettings(), ...patch };
  writeFileSync(UI_SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

const PLUGIN_SCAN_CACHE = { t: 0, rows: [] };

/** Live inventory of the DSH Desktop plugins this machine actually runs. */
function collectLivePlugins(dshHome) {
  if (Date.now() - PLUGIN_SCAN_CACHE.t < 2000) return PLUGIN_SCAN_CACHE.rows;
  const rows = [];
  const seen = new Set();
  const add = (name, source, status) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    rows.push({ name: String(name), source: String(source), status: status || "loaded" });
  };
  const listDirs = (dir) => {
    try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  };
  const isPluginPackage = (dir) => {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return Boolean(pkg && (pkg.dsh || String(pkg.name || "").startsWith("dsh")));
    } catch {
      return false;
    }
  };

  const pluginsDir = join(dshHome, "plugins");
  for (const entry of listDirs(pluginsDir)) {
    if (entry.isDirectory()) add(entry.name, "DSH 插件目录", "loaded");
  }

  const webModules = join(dshHome, "profiles", "web", "node_modules");
  for (const entry of listDirs(webModules)) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      for (const scoped of listDirs(join(webModules, entry.name))) {
        if (!scoped.isDirectory()) continue;
        const dir = join(webModules, entry.name, scoped.name);
        if (isPluginPackage(dir)) add(`${entry.name}/${scoped.name}`, "DSH Web 插件", "loaded");
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    const dir = join(webModules, entry.name);
    if (isPluginPackage(dir)) add(entry.name, "DSH Web 插件", "loaded");
  }

  PLUGIN_SCAN_CACHE.t = Date.now();
  PLUGIN_SCAN_CACHE.rows = rows;
  return rows;
}

/** Narration length per phase, read from the shipped WAV headers (cached). */
let NARRATION_CACHE = null;
function narrationDurations() {
  if (NARRATION_CACHE) return NARRATION_CACHE;
  const names = ["phase-0", "phase-1", "phase-2", "phase-3", "phase-4", "phase-5"];
  const out = [];
  for (const name of names) {
    try {
      const buf = readFileSync(join(STARTUP_ASSETS_DIR, "assets", "voice", name + ".wav"));
      const rate = buf.readInt32LE(24);
      const channels = buf.readInt16LE(22);
      const bits = buf.readInt16LE(34);
      const dataSize = buf.readInt32LE(40);
      const bytesPerSecond = rate * channels * (bits / 8);
      const seconds = bytesPerSecond > 0 ? dataSize / bytesPerSecond : 0;
      if (!Number.isFinite(seconds) || seconds <= 0) { NARRATION_CACHE = null; return null; }
      out.push(seconds);
    } catch {
      NARRATION_CACHE = null;
      return null;
    }
  }
  NARRATION_CACHE = out;
  return out;
}

function patchStartupSequence(text, advanceMode, narration, pace) {
  let out = text;
  const rate = Number.isFinite(pace) && pace >= 1 && pace <= 4 ? pace : 1;
  const original = [2.1, 1.8, 2.2, 3.4, 1.8, 2.5];
  // The permission stage needs room for its own four-beat choreography (rings,
  // roll-up readout, rule, tier marks) before the archive stage takes over.
  const NEW_PHASE_SECONDS = 4.2;
  const fitted = original.map((base, index) => {
    const voiced = narration && narration[index] ? narration[index] + 0.35 : base;
    return Math.max(base, voiced);
  });
  // The permission-level confirmation is its own phase, inserted before the
  // archive read, so every later stage shifts by one.
  const durations = [fitted[0], fitted[1], fitted[2], NEW_PHASE_SECONDS, fitted[3], fitted[4], fitted[5]]
    .map((value) => Math.round(value * rate * 100) / 100);
  const marker = "const durations = Object.freeze([2.1, 1.8, 2.2, 3.4, 1.8, 2.5]);";
  if (out.includes(marker)) out = out.replace(marker, "const durations = Object.freeze([" + durations.join(", ") + "]);");

  const checkpoints = "const checkpoints = Object.freeze([0, 2, 4]);";
  if (out.includes(checkpoints)) {
    if (advanceMode === "click") out = out.replace(checkpoints, "const checkpoints = Object.freeze([0, 1, 2, 3, 4, 5]);");
    else if (advanceMode === "auto") out = out.replace(checkpoints, "const checkpoints = Object.freeze([]);");
  }

  // Seven phases: every "last phase" bound moves from 5 to 6.
  return out
    .replace("if (Number.isInteger(phase) && phase >= 0 && phase <= 5) this.barriers.add(phase);", "if (Number.isInteger(phase) && phase >= 0 && phase <= 6) this.barriers.add(phase);")
    .replace("if (this.phase === 5 || !Number.isInteger(index)", "if (this.phase === 6 || !Number.isInteger(index)")
    .replace("if (!Number.isInteger(phase) || phase < 0 || phase > 5) return;", "if (!Number.isInteger(phase) || phase < 0 || phase > 6) return;")
    .replace("while (this.phase < 5 && time >= durations[this.phase] - 1e-9)", "while (this.phase < 6 && time >= durations[this.phase] - 1e-9)")
    .replace("this.completed = this.phase === 5 && this.elapsed >= durations[5] - 1e-9;", "this.completed = this.phase === 6 && this.elapsed >= durations[6] - 1e-9;")
    .replace("if (this.phase === 5) { this.elapsed = durations[5]; this.completed = true; this.playing = false; break; }", "if (this.phase === 6) { this.elapsed = durations[6]; this.completed = true; this.playing = false; break; }");
}

/** Apply the seven-phase layout to the host script. */
function patchStartupPreview(text) {
  let out = text;
  const oldReadPhase = " ['展开能力档案','READING LOCAL CAPABILITIES','直接读取本地 skills 与 plugins。','REQUEST / RECEIVED'],";
  if (!out.includes("'权限等级确认'") && out.includes(oldReadPhase)) {
    out = out.replace(oldReadPhase, " ['权限等级确认','ACCESS LEVEL CONFIRMATION','确认访问权限等级，展开对应等级的能力轮廓。','ACCESS / LEVEL'],\n" + oldReadPhase);
  }
  out = out.replace("const scoreDurations=[2.8,2.8,3.4,3.2,2.8,3];", "const scoreDurations=[2.8,2.8,3.4,3.0,3.2,2.8,3];");
  out = out.replace(
    "function barriers(){for(let i=0;i<6;i++){if((i===2&&local.locked)||(i===3&&!loadFinished())",
    "function barriers(){for(let i=0;i<7;i++){if((i===2&&local.locked)||(i===4&&!loadFinished())"
  );
  out = out.replace("function beginLocalLoad(){if(!local.locked&&sequence.phase===3&&", "function beginLocalLoad(){if(!local.locked&&sequence.phase===4&&");
  out = out.replace("if(connected&&sequence.phase===3&&!sequence.completed)", "if(connected&&sequence.phase===4&&!sequence.completed)");
  out = out.replace("if(sequence.phase===3||sequence.phase===4){", "if(sequence.phase===4||sequence.phase===5){");
  out = out.replace("if(sequence.phase===0||sequence.phase===5)return;", "if(sequence.phase===0||sequence.phase===6)return;");
  out = out.replace("document.body.classList.toggle('finale',sequence.phase===5);", "document.body.classList.toggle('finale',sequence.phase===6);");
  out = out.replace(
    "document.body.classList.toggle('inventory-phase',sequence.phase===3||sequence.phase===4);",
    "document.body.classList.toggle('inventory-phase',sequence.phase===4||sequence.phase===5);document.body.classList.toggle('access-phase',sequence.phase===3);document.body.classList.toggle('waiting',sequence.waiting);"
  );
  out = out.replace(
    "ui.identityCard.hidden=sequence.phase!==2;ui.inventoryPanel.hidden=sequence.phase!==3&&sequence.phase!==4;",
    // The archive card belongs to the identity stage only: the permission stage
    // shows the triangle emblem itself, with the level readout beneath it.
    "ui.identityCard.hidden=sequence.phase!==2;ui.inventoryPanel.hidden=sequence.phase!==4&&sequence.phase!==5;"
  );
  out = out.replace(
    "sequence.phase===3||sequence.phase===4?local.inventory.message:sequence.phase===5?",
    "sequence.phase===4||sequence.phase===5?local.inventory.message:sequence.phase===6?"
  );
  out = out.replace("sequence.phase===3&&local.inventory.status==='loading'", "sequence.phase===4&&local.inventory.status==='loading'");
  out = out.replace("sequence.phase===5?'READY TO DIVE'", "sequence.phase===6?'READY TO DIVE'");
  out = out.replace("&&sequence.phase<5){e.preventDefault();", "&&sequence.phase<6){e.preventDefault();");
  // Narration, score and canvas visuals stay keyed to the original six stages.
  out = out.replace(
    "voice()?.phase?.(sequence.phase,{",
    "voice()?.phase?.(sequence.phase===3?-1:(sequence.phase>=4?sequence.phase-1:sequence.phase),{"
  );
  out = out.replace("switch(sequence.phase){", "switch(sequence.phase>=4?sequence.phase-1:sequence.phase){");
  out = out.replace(
    "DSHVisuals.draw(ctx,width,height,{phase:sequence.phase,",
    // The new permission stage reuses the chapter-02 seal scene: the same seal at
    // 60% height, small, assembling in place. Index 0 is not an option because it
    // forces the dark intro palette regardless of the configured theme.
    "DSHVisuals.draw(ctx,width,height,{phase:sequence.phase===3?1:(sequence.phase>=4?sequence.phase-1:sequence.phase),"
  );
  return out;
}

function patchStartupVisuals(text, richEffects) {
  // The shipped chromatic-seal bands jitter ±12px at ~5.6 Hz (Math.sin(time*35)),
  // which reads as a violent shake around the emblem. Keep the chromatic look but
  // turn the jitter into a slow drift.
  let out = text.replace("Math.sin(time*35+i)*12", "Math.sin(time*1.6+i)*3.5");
  // The chapter-02 seal scene parks its seal at 60% height, which crowds the
  // caption block below it; centre the seal so the level readout has room.
  out = out
    .replace("sealMechanism(px,wy(.60)+py,.80*pulse,p,.66);", "sealMechanism(px,wy(.50)+py,.80*pulse,p,.66);")
    .replace("deltaConstruction(px,wy(.60)+py,p,.80*pulse);", "deltaConstruction(px,wy(.50)+py,p,.80*pulse);")
    .replace("emblem(px,wy(.60)+py,.80*pulse,part(p,0,.44),1,C.ink,.95);", "emblem(px,wy(.50)+py,.80*pulse,part(p,0,.44),1,C.ink,.95);");
  // The lower pair of corner rulers (draftingRails) sits at 82% and strikes the
  // capability panel, which spans 36%-92%; drop them to 94% so nothing collides,
  // and pull the whole set inward so it does not hug the outermost L corners.
  // Everything else in the visual system stays exactly as shipped.
  out = out
    .replace("const outer=W/2-42,inner=Math.min(W*.40,570),y1=wy(.18),y2=wy(.82);", "const outer=W/2-74,inner=Math.min(W*.40,570),y1=wy(.18),y2=wy(.94);")
    // Outermost L corners (paper) sit 38 units in; push them out to 20.
    .replace("const inset=38;", "const inset=20;")
    // Bottom rules + their caption: lowered to 88% / 84% (values from the editable build).
    .replace("const y=wy(.76);line(wx(.055),y,wx(.095),y,C.soft,.45,.8);line(wx(.905),y,wx(.945),y,C.soft,.45,.8);", "const y=wy(.88);line(wx(.055),y,wx(.095),y,C.soft,.45,.8);line(wx(.905),y,wx(.945),y,C.soft,.45,.8);")
    // Keep the DEPTH / ACCESS caption but park it clear of the level insignia.
    // The finale's hero group sat off-centre (px*.4 parallax); centre it so the
    // closing composition is symmetric.
    .replace("sealMechanism(px*.4,cy+py*.4,s,p,.9);", "sealMechanism(0,cy,s,p,.9);")
    .replace("deltaConstruction(px*.4,cy+py*.4,p,s);", "deltaConstruction(0,cy,p,s);")
    .replace("emblem(px*.4,cy+py*.4,s,part(p,0,.32),1,C.ink,1);", "emblem(0,cy,s,part(p,0,.32),1,C.ink,1);")
    .replace("chromaticSeal(px*.4,cy+py*.4,s,Math.sin(part(p,.22,.42)*Math.PI)*18);", "chromaticSeal(0,cy,s,Math.sin(part(p,.22,.42)*Math.PI)*18);")
    // The finale's emphasis rule is written in four strokes instead of appearing whole.
    .replace(
      "line(-96,cy+255,96,cy+255,C.soft,.44*stamp,.8);",
      "(()=>{const segN=4;for(let i=0;i<segN;i++){const k=part(stamp,i/segN,(i+1)/segN);if(k<=0)continue;const sx0=-96+192*i/segN;line(sx0,cy+255,sx0+(192/segN)*k,cy+255,C.soft,.44*stamp,.8);}})();"
    )
    // Every fragment gets its own slow drift while it is still out of place, so
    // the held stage-01 badge breathes as a whole instead of one loose shard.
    .replace(
      "ctx.save();ctx.translate(side*(1-t)*(i<2?250:340),(1-t)*(i<2?side*90:(i-3)*110));",
      "ctx.save();const dr=reduced?0:(1-t);ctx.translate(side*(1-t)*(i<2?250:340)+Math.sin(ambient*0.34+i*1.7)*(11+i*4.5)*dr,(1-t)*(i<2?side*90:(i-3)*110)+Math.cos(ambient*0.29+i*2.3)*(10+i*3.8)*dr);"
    )
    .replace("text('DEPTH / ACCESS',wx(.08),wy(.72),10,C.soft,.65,1,'left',400,true);", "text('DEPTH / ACCESS',wx(.055),wy(.90),10,C.soft,.65,1,'left',400,true);")
    // Stage 01 held state: show the emblem already shattered, so advancing plays
    // the assembly instead of snapping back from a complete badge.
    .replace(
      "const q=waiting||reduced?1:p,assembly=part(q,0,.35),stamp=ease(part(q,.18,.44));",
      "const q=waiting||reduced?1:p,assembly=(waiting&&!reduced)?(0.030+0.030*Math.sin(ambient*0.33)):part(q,0,.35),stamp=ease(part(q,.18,.44));"
    )
    // BUFFER column collided with the ENGINEERING DIVISION stamp in stage 03.
    .replace("const columnX=wx(.86),start=wy(.27),rows=10,", "const columnX=wx(.86),start=wy(.36),rows=10,")
    // Row numbers were printed inside the archive card and again beside it.
    .replace("if(W>1200)text(String(i+1).padStart(2,'0'),x+side*23,y,9,C.soft,.6*strength,1,side<0?'right':'left',400,true);", "")
    // The stage-02 shutter blades read as heavy dark covers over the stage and the
    // caption; keep the motion, drop the weight.
    .replace("rect(x-w/2,-H*.55,w,H*1.1,C.ink,(1-t)*(.14-layer*.025));", "rect(x-w/2,-H*.55,w,H*1.1,C.ink,(1-t)*(.085-layer*.018));")
    .replace("rect(x-w/2,-H*.55,layer===0?7:2,H*1.1,layer===1?C.ink:C.accent,(1-t)*.68);", "rect(x-w/2,-H*.55,layer===0?7:2,H*1.1,layer===1?C.ink:C.accent,(1-t)*.42);")
    .replace("line(x-w/2+8,-H*.45+i*H*.13,x-w/2+26,-H*.45+i*H*.13,C.ink,(1-t)*.65,1.2);", "line(x-w/2+8,-H*.45+i*H*.13,x-w/2+26,-H*.45+i*H*.13,C.ink,(1-t)*.30,1.2);");
  if (!richEffects) return out;
  return out
    .replace("for(let i=0;i<300;i++)", "for(let i=0;i<900;i++)")
    .replace("for(let i=0;i<84;i++)", "for(let i=0;i<160;i++)")
    .replace("for(let i=0;i<24;i++)", "for(let i=0;i<48;i++)")
    .replace("for(let i=0;i<12;i++)", "for(let i=0;i<24;i++)");
}

/** Prefix quoted absolute paths so they resolve through our same-origin proxy. */
function prefixQuotedPaths(text, paths) {
  let out = text;
  for (const path of paths) {
    for (const quote of ["'", '"', "`"]) {
      out = out.split(quote + path).join(quote + PREVIEW_PROXY_PREFIX + path);
    }
  }
  return out;
}

// Level-aware confirmation overlay: drawn on its own canvas above the original
// one, reusing the page's accent colour, thin strokes and radial symmetry so the
// added motion reads as part of the same演出. Higher permission tiers get more
// rings, ticks, scanlines and a stronger confirmation pulse.
// Default access password, typed into the archive card's 03 row: twelve slots
// settle in turn while the remaining slots keep cycling through cipher glyphs.

// Stage-transition cue: a short synthesized whoosh on every chapter change.
const AUDIO_CUES_SCRIPT = `
/* drb-audio-cues */
(() => {
  let ctx = null, buf = null, lastPhase = null;
  const ensure = () => {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  };
  fetch('assets/voice/drb-transition.wav')
    .then(r => r.ok ? r.arrayBuffer() : null)
    .then(b => { if (!b) return; const c = ensure(); if (!c) return; c.decodeAudioData(b.slice(0)).then(d => { buf = d; }).catch(() => {}); })
    .catch(() => {});
  const cue = () => {
    const c = ensure();
    if (!c || !buf) return;
    try {
      if (c.state === 'suspended') c.resume();
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf;
      g.gain.value = 0.22;
      src.connect(g); g.connect(c.destination);
      src.start();
    } catch (_) {}
  };
  const phase = () => {
    const el = document.querySelector('.chapter[aria-current="step"]');
    return el ? el.getAttribute('data-phase') : null;
  };
  setInterval(() => {
    const p = phase();
    if (p === null || p === lastPhase) return;
    const first = lastPhase === null;
    lastPhase = p;
    if (!first) cue();
  }, 120);
})();
`;

const PASSWORD_TYPING_SCRIPT = `
/* drb-password-typing */
(() => {
  const PASS = '__DRB_PASS__';
  const GLYPHS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz#/<>[]+*';
  let startedAt = 0;
  const step = () => {
    const node = document.getElementById('accessState');
    if (!node) return;
    const entry = document.getElementById('accessEntry');
    if (!document.body.classList.contains('identity-phase') || (entry && entry.hidden === false)) { startedAt = 0; return; }
    if (!startedAt) startedAt = window.__drbPwDone ? performance.now() - 60000 : performance.now();
    const age = (performance.now() - startedAt) / 1000;
    const esc = (ch) => ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch;
    let html = '';
    for (let i = 0; i < PASS.length; i++) {
      if (age >= 0.72 + i * 0.26) html += '<span style="color:#c5793f;color:var(--accent);opacity:1">' + esc(PASS[i]) + '</span>';
      else html += '<span style="opacity:.5">' + esc(GLYPHS[(Math.random() * GLYPHS.length) | 0]) + '</span>';
    }
    if (node.dataset.drbTyped !== '1') { node.dataset.drbTyped = '1'; }
    if (node.innerHTML !== html) node.innerHTML = html;
    if (age >= 0.72 + PASS.length * 0.26 + 0.2) window.__drbPwDone = true;
  };
  setInterval(step, 75);
})();
`;
const ACCESS_TIER_OVERLAY = `
/* drb-access-tier-overlay */
(() => {
  const pane = document.getElementById('canvasPane'), stage = document.getElementById('experience');
  if (!pane || !stage) return;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
  pane.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let width = 1, height = 1, dpr = 1;
  const resize = () => {
    const box = pane.getBoundingClientRect();
    width = Math.max(1, box.width); height = Math.max(1, box.height);
    dpr = Math.min(Math.max(window.devicePixelRatio || 1, 3), 4);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  };
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(pane); else window.addEventListener('resize', resize);

  const TAU = Math.PI * 2;
  const el = id => document.getElementById(id);
  const text = id => (((el(id) || {}).textContent) || '').trim();
  const levelText = () => (text('cardLevel') || 'L1');
  const tier = () => {
    const value = levelText();
    const digits = /(\\d+)/.exec(value);
    if (digits) return Math.max(1, Math.min(6, Number(digits[1])));
    if (/root|sys/i.test(value)) return 6;
    if (/admin|owner|super/i.test(value)) return 4;
    return 1;
  };
  const rgba = (rgb, alpha) => 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
  const parse = (raw, fallback) => {
    const hex = /^#?([0-9a-f]{6})$/i.exec(String(raw).trim());
    if (hex) { const n = parseInt(hex[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    const m = /rgba?\\(([^)]+)\\)/.exec(String(raw));
    if (m) { const p = m[1].split(',').map(Number); return [p[0] | 0, p[1] | 0, p[2] | 0]; }
    return fallback;
  };
  const palette = () => {
    const cs = getComputedStyle(document.documentElement);
    return {
      accent: parse(cs.getPropertyValue('--accent'), [130, 191, 210]),
      ink: parse(cs.getPropertyValue('--ink'), [30, 34, 38]),
      soft: parse(cs.getPropertyValue('--soft'), [133, 147, 151]),
      bg: parse(cs.getPropertyValue('--bg'), [238, 234, 226])
    };
  };
  const mono = px => Math.round(px) + 'px "Cascadia Code", Consolas, monospace';
  // Per-tier visual language for the level insignia: colour, plate treatment and
  // motion signature. L1 is austere, L6 is ceremonial 閳?the differences are meant
  // to be obvious at a glance.
  const TIER_STYLE = [
    { label: 'ACCESS LEVEL', rgb: [138, 147, 153], hatch: 0.000, frames: 0, sheen: 1, ring: 0, chevrons: 0, glow: 0.055, bloom: 0.00, blink: false, flash: 0.0, bracketInk: true,  motion: 'fade'  },
    { label: 'ACCESS LEVEL', rgb: [ 93, 143, 156], hatch: 0.035, frames: 0, sheen: 1, ring: 0, chevrons: 0, glow: 0.070, bloom: 0.00, blink: false, flash: 0.0, bracketInk: true,  motion: 'fade'  },
    { label: 'ACCESS LEVEL', rgb: [ 47, 151, 166], hatch: 0.048, frames: 1, sheen: 2, ring: 1, chevrons: 0, glow: 0.090, bloom: 0.08, blink: false, flash: 0.0, bracketInk: false, motion: 'fade'  },
    { label: 'ACCESS LEVEL', rgb: [ 63, 127, 193], hatch: 0.058, frames: 1, sheen: 2, ring: 1, chevrons: 0, glow: 0.105, bloom: 0.12, blink: false, flash: 0.3, bracketInk: false, motion: 'fade'  },
    { label: 'CLEARANCE LEVEL', rgb: [123,  98, 196], hatch: 0.070, frames: 2, sheen: 3, ring: 2, chevrons: 1, glow: 0.125, bloom: 0.16, blink: true,  flash: 0.5, bracketInk: false, motion: 'slide' },
    { label: 'EXECUTIVE LEVEL', rgb: [198, 138,  52], hatch: 0.085, frames: 2, sheen: 3, ring: 2, chevrons: 2, glow: 0.155, bloom: 0.22, blink: true,  flash: 0.8, bracketInk: false, motion: 'stamp' }
  ];
  const snap = n => Math.round(n);
  const ease = n => 1 - Math.pow(1 - Math.max(0, Math.min(1, n)), 3);

  const motes = [];
  for (let i = 0; i < 48; i++) {
    const s1 = (i * 2654435761 % 4294967296) / 4294967296, s2 = (i * 40503 + 7919) % 65536 / 65536;
    motes.push({ a: s1 * TAU, r: 0.075 + s2 * 0.045, w: 0.03 + s2 * 0.045, s: 1.5 + s1 * 1.4, o: 0.10 + s2 * 0.14 });
  }

  let enterAlpha = 0, grow = 0, impulse = 0, pulse = 0, last = 0, wasDecoding = false;
  let entryAt = -9, confirmAt = -9, releaseAt = -9, wasWaiting = false, wasAccess = false;
  let loadAlpha = 0, loadFill = 0, loaded = false, wasLoaded = false, loadAt = -9;
  let activeIdx = -1, stageAt = -9, phaseKey = '', phaseAt = -9;
  let darkLiftAt = -9, idAt = -9;
  stage.addEventListener('pointerdown', () => { impulse = 1; }, true);

  const drawFrame = (now) => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    const t = now / 1000;

    const titleEl = el('phaseTitle'), englishEl = el('phaseEnglish');
    const key = ((titleEl && titleEl.textContent) || '') + '|' + ((englishEl && englishEl.textContent) || '');
    if (key.length > 1 && key !== phaseKey) {
      phaseKey = key;
      phaseAt = t;
      const active = document.querySelector('.chapter[aria-current="step"]');
      const idx = active ? Number(active.getAttribute('data-phase')) : NaN;
      if (Number.isFinite(idx) && idx !== activeIdx) {
        if (idx === 1 && activeIdx === 0) darkLiftAt = t;   // 01 dark intro -> 02: lift, do not cut
        if (idx === 2 && activeIdx !== 2) idAt = t;         // entering identity verification
        activeIdx = idx; stageAt = t;
      }
    }

    const accessActive = document.body.classList.contains('access-phase');
    const waiting = document.body.classList.contains('waiting');
    const visual = el('cardLevelVisual');
    const decoding = !!visual && visual.getAttribute('data-decoding') === 'true';
    if (wasDecoding && !decoding) pulse = 1;
    wasDecoding = decoding;
    if (accessActive && !wasAccess) { entryAt = t; grow = 0; }
    if (!accessActive && wasAccess) releaseAt = t;
    wasAccess = accessActive;
    if (wasWaiting && !waiting && accessActive) confirmAt = t;
    wasWaiting = waiting;

    const loadStage = activeIdx === 4 || activeIdx === 5;
    loadAlpha = Math.min(1, Math.max(0, loadAlpha + (loadStage ? dt / 0.45 : -dt / 0.4)));
    loaded = /鐏忚京鍗巪鐎瑰本鍨殀complete|瀹告彃濮瀨available/i.test(text('skillsState') + ' ' + text('pluginsState'));
    if (loaded && !wasLoaded) loadAt = t;
    wasLoaded = loaded;
    if (loadStage && stageAt === t) loadFill = 0;
    loadFill = Math.min(1, loadFill + dt * (loaded ? 1.1 : 0.22));

    enterAlpha = Math.min(1, Math.max(0, enterAlpha + (accessActive ? dt / 0.5 : -dt / 0.35)));
    grow = accessActive ? Math.min(1, grow + dt / 1.15) : grow;
    impulse = Math.max(0, impulse - dt * 1.6);
    pulse = Math.max(0, pulse - dt * 0.7);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const C = palette();
    const base = Math.min(width, height);

    // Hand-off: veil the scene swap, then a layered wipe carries the eye across.
    const tt = t - phaseAt;
    if (tt >= 0 && tt < 1.15) {
      const k = tt / 1.15, fade = Math.sin(Math.PI * Math.min(1, k));
      const veil = Math.max(0, 1 - tt / 0.42);
      if (veil > 0) { ctx.fillStyle = rgba(C.bg, 0.46 * veil); ctx.fillRect(0, 0, width, height); }
      for (let layer = 0; layer < 5; layer++) {
        const kk = Math.min(1, Math.max(0, (tt - layer * 0.055) / 1.0));
        if (kk <= 0 || kk >= 1) continue;
        const y = -base * 0.06 + ease(kk) * (height + base * 0.12);
        const bandH = base * (0.055 - layer * 0.008);
        const g = ctx.createLinearGradient(0, y - bandH, 0, y + bandH);
        g.addColorStop(0, rgba(C.accent, 0));
        g.addColorStop(0.5, rgba(C.accent, (0.16 - layer * 0.045) * fade));
        g.addColorStop(1, rgba(C.accent, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, y - bandH, width, bandH * 2);
        ctx.strokeStyle = rgba(layer === 0 ? C.soft : C.accent, (0.30 - layer * 0.045) * fade);
        ctx.lineWidth = layer === 0 ? 1.6 : 1.2;
        ctx.beginPath(); ctx.moveTo(0, snap(y)); ctx.lineTo(width, snap(y)); ctx.stroke();
      }
      // Corner brackets pull inward and release with every stage change.
      if (tt < 0.85) {
        const ck = tt / 0.85, cw2 = Math.sin(Math.PI * ck);
        const insetC = base * 0.030 + cw2 * base * 0.036, armC = base * 0.048;
        ctx.strokeStyle = rgba(C.accent, 0.52 * cw2);
        ctx.lineWidth = 1.6;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          const x = sx < 0 ? insetC : width - insetC, y = sy < 0 ? insetC : height - insetC;
          ctx.beginPath();
          ctx.moveTo(x + sx * armC, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * armC);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x + sx * armC * 0.92, y + sy * armC * 0.42);
          ctx.lineTo(x + sx * armC * 0.42, y + sy * armC * 0.42);
          ctx.lineTo(x + sx * armC * 0.42, y + sy * armC * 0.92);
          ctx.stroke();
        }
      }
      // A leading hairline rides just ahead of the wipe for a sharper edge.
      const leadY = -base * 0.06 + ease(Math.min(1, tt / 1.05)) * (height + base * 0.12);
      ctx.strokeStyle = rgba(C.accent, 0.40 * Math.max(0, 1 - tt / 1.15));
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, snap(leadY)); ctx.lineTo(width, snap(leadY)); ctx.stroke();
    }

    // ---- default access password: twelve slots settle out of a scramble ------
    // The overlay owns the 03 row's text: one slot locks in after another while
    // the remaining slots keep cycling through cipher glyphs.
    if (activeIdx === 2) {
      const pwNode = el('accessState'), pwEntry = el('accessEntry');
      if (pwNode && !(pwEntry && pwEntry.hidden === false)) {
        const PASS = 'Dsh7Rk29Wq41';
        const GLYPHS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz#/<>[]+*';
        const age = t - ((idAt > -9 ? idAt : stageAt) + 0.35);
        let typed = '';
        for (let i = 0; i < PASS.length; i++) {
          typed += age >= 0.42 + i * 0.14 ? PASS[i] : GLYPHS[(Math.floor(t * 15) * 41 + i * 17) % GLYPHS.length];
        }
        if (age < 0) typed = GLYPHS[(Math.floor(t * 15) * 41) % GLYPHS.length].repeat(PASS.length);
        if (pwNode.textContent !== typed) pwNode.textContent = typed;
      }
    }
    // ---- 01 -> 02: the dark intro lifts away instead of cutting to light ----
    const dl = t - darkLiftAt;
    if (dl >= 0 && dl < 0.62) {
      const k = Math.min(1, dl / 0.62);
      ctx.fillStyle = rgba('#030506', Math.max(0, 0.94 * (1 - ease(k))));
      ctx.fillRect(0, 0, width, height);
      const ly = ease(k) * (height + base * 0.12) - base * 0.06;
      const lg = ctx.createLinearGradient(0, ly - base * 0.10, 0, ly + base * 0.10);
      lg.addColorStop(0, rgba(C.accent, 0));
      lg.addColorStop(0.55, rgba(C.accent, 0.22 * (1 - k)));
      lg.addColorStop(1, rgba(C.accent, 0));
      ctx.fillStyle = lg;
      ctx.fillRect(0, ly - base * 0.10, width, base * 0.20);
      ctx.strokeStyle = rgba(C.soft, 0.30 * (1 - k));
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, snap(ly)); ctx.lineTo(width, snap(ly)); ctx.stroke();
    }

    // ---- stage 02: permission seal, echoed by a faster tick ring --------------
    if (activeIdx === 1) {
      const k2a = Math.min(1, Math.max(0, (t - stageAt) / 0.7));
      const aa = ease(k2a);
      const scy = height * 0.50;
      const tickR = base * 0.128, tickN = 32, rot2 = t * 0.18;
      for (let i = 0; i < tickN; i++) {
        const ang = rot2 + (i / tickN) * TAU, long = i % 4 === 0;
        const r1 = tickR, r2 = tickR + (long ? base * 0.013 : base * 0.006);
        ctx.strokeStyle = rgba(long ? C.accent : C.ink, (long ? 0.28 : 0.12) * aa);
        ctx.lineWidth = long ? 1.5 : 1;
        ctx.beginPath();
        if (i === 0) { ctx.strokeStyle = rgba(C.ink, 0.10 * aa); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(width / 2, scy, base * 0.112, 0, TAU); ctx.stroke(); }
        ctx.moveTo(width / 2 + Math.cos(ang) * r1, scy + Math.sin(ang) * r1);
        ctx.lineTo(width / 2 + Math.cos(ang) * r2, scy + Math.sin(ang) * r2);
        ctx.stroke();
      }
    }

    // ---- stage 03: identity verification motion + permission level badge ----
    if (activeIdx === 2) {
      const ik = Math.min(1, Math.max(0, (idAt > -9 ? t - idAt : t - stageAt) / 0.9));
      const ia = ease(ik);
      const icx = width / 2, icy = height * 0.50;
      const rot = t * 0.17;
      // Keystone accents: the ticks nearest the bottom read a touch brighter.
      // Lower-half aperture arcs (the upper sector stays clear of the caption).
      for (let ring = 0; ring < 3; ring++) {
        const r = base * (0.155 + ring * 0.030);
        const count = 26 + ring * 8;
        ctx.lineWidth = 1.1 + ring * 0.25;
        for (let s = 0; s < count; s++) {
          const ang = rot * (1 + ring * 0.3) + (s / count) * TAU + ring * 0.4;
          const n = ((ang % TAU) + TAU) % TAU;
          if (n < Math.PI * 0.14 || n > Math.PI * 0.86) continue;
          const long = s % 4 === 0;
          const key = n > Math.PI * 0.36 && n < Math.PI * 0.64;
          ctx.strokeStyle = rgba(s % 12 === 0 ? C.accent : key ? C.accent : C.ink, (s % 12 === 0 ? 0.34 : key ? 0.22 : 0.15) * ia);
          ctx.beginPath();
          ctx.arc(icx, icy, r, n, n + (TAU / count) * (long ? 0.72 : 0.34));
          ctx.stroke();
        }
      }
      // Credential read: two accent bands sweep the free strips above/below the card.
      const sweep = Math.min(1, Math.max(0, (t - idAt - 0.2) / 1.5));
      if (sweep > 0 && sweep < 1) {
        const sx = width * (0.26 + 0.48 * ease(sweep));
        for (const bandY of [height * 0.415, height * 0.765]) {
          const bg2 = ctx.createLinearGradient(sx - base * 0.09, 0, sx + base * 0.03, 0);
          bg2.addColorStop(0, rgba(C.accent, 0));
          bg2.addColorStop(0.7, rgba(C.accent, 0.30 * ia));
          bg2.addColorStop(1, rgba(C.accent, 0));
          ctx.fillStyle = bg2;
          ctx.fillRect(sx - base * 0.09, bandY - base * 0.012, base * 0.12, base * 0.024);
          ctx.strokeStyle = rgba(C.accent, 0.42 * ia);
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(snap(sx), snap(bandY - base * 0.014)); ctx.lineTo(snap(sx), snap(bandY + base * 0.014)); ctx.stroke();
        }
      }
      // Level insignia (v3): each tier owns a colour, plate treatment and motion
      // signature, so L1..L6 read as clearly different ranks.
      const appear = Math.min(1, Math.max(0, (t - idAt - 0.28) / 0.6));
      if (appear > 0.01) {
        const lv = tier();
        const S = TIER_STYLE[lv - 1];
        const TR = S.rgb;
        const by = height * 0.772;
        const bh = base * 0.034;
        const numFont = mono(snap(bh * 0.66));
        const labFont = mono(snap(bh * 0.46));
        ctx.font = numFont;
        const numW = ctx.measureText('L' + lv).width;
        ctx.font = labFont;
        const labW = ctx.measureText(S.label).width;
        const padL = bh * 0.62, gapX = bh * 0.40, padR = bh * 0.58;
        const bw = Math.max(base * 0.058 + lv * base * 0.011, padL + numW + gapX + labW + padR);
        const numX = -bw / 2 + padL, labX = numX + numW + gapX;
        const hw = bw / 2, hh = bh / 2;
        const reveal = ease(appear);
        const breathe = 0.5 + 0.5 * Math.sin(t * (0.9 + lv * 0.16));
        const since = t - idAt;
        ctx.save();
        if (S.motion === "slide") ctx.translate(-(1 - reveal) * base * 0.07, 0);
        const sc = S.motion === "stamp" ? 1 + (1 - reveal) * 0.34 : 1 + (1 - reveal) * 0.10;
        ctx.translate(icx, by);
        ctx.scale(sc, sc);
        // --- glow: bloom confined to the nameplate itself; it never spills onto
        // the archive card, so the plate reads as lighting up from within.
        ctx.save();
        ctx.beginPath();
        ctx.rect(-bw / 2, -bh / 2, bw, bh);
        ctx.clip();
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, bw * 0.62);
        glow.addColorStop(0, rgba(TR, S.glow * reveal * (1.45 + 0.65 * breathe)));
        glow.addColorStop(0.55, rgba(TR, S.glow * 0.85 * reveal));
        glow.addColorStop(1, rgba(TR, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
        ctx.restore();
        // --- entry flash / shockwave for the top tiers
        if (S.flash && since < 0.9) {
          const fk = Math.max(0, since - 0.28) / 0.62;
          if (fk > 0 && fk < 1) {
            const fw = bw * (1 + ease(fk) * 0.5), fh2 = bh * (1 + ease(fk) * 1.4);
            ctx.strokeStyle = rgba(TR, (1 - fk) * 0.5 * S.flash);
            ctx.lineWidth = 2 * (1 - fk) + 0.6;
            ctx.strokeRect(snap(-fw / 2), snap(-fh2 / 2), snap(fw), snap(fh2));
          }
        }
        // --- plate + hatch
        ctx.fillStyle = rgba(C.ink, 0.05 * reveal);
        ctx.fillRect(-hw, -hh, bw, bh);
        ctx.save();
        ctx.beginPath(); ctx.rect(-hw, -hh, bw, bh); ctx.clip();
        if (S.hatch > 0) {
          for (let i = -bh; i < bw; i += 6) {
            ctx.strokeStyle = rgba(TR, S.hatch * reveal);
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(-hw + i, hh); ctx.lineTo(-hw + i + bh, -hh); ctx.stroke();
          }
        }
        // --- sheen train: number of passes per cycle grows with the tier
        const cyc = (since * (0.30 + lv * 0.05)) % 1;
        for (let p = 0; p < S.sheen; p++) {
          const ph = (cyc + p / S.sheen) % 1;
          const sx2 = -hw + bw * ph;
          const g2 = ctx.createLinearGradient(sx2 - bh * 1.2, 0, sx2 + bh * 0.5, 0);
          g2.addColorStop(0, rgba(TR, 0));
          g2.addColorStop(0.7, rgba(TR, 0.30 * reveal * (0.5 + 0.5 * breathe)));
          g2.addColorStop(1, rgba(TR, 0));
          ctx.fillStyle = g2;
          ctx.fillRect(-hw, -hh, bw, bh);
        }
        ctx.restore();
        // --- inner frames
        for (let f = 0; f < S.frames; f++) {
          const inset = bh * (0.15 + f * 0.13);
          ctx.strokeStyle = rgba(TR, (0.32 - f * 0.09) * reveal);
          ctx.lineWidth = 1;
          ctx.strokeRect(snap(-hw + inset), snap(-hh + inset), snap(bw - inset * 2), snap(bh - inset * 2));
        }
        // --- corner brackets (all tiers) + cap sparkles for high tiers
        const arm2 = Math.min(bh * 0.52, bw * 0.15);
        ctx.strokeStyle = rgba(S.bracketInk ? C.ink : TR, (S.bracketInk ? 0.46 : 0.62) * reveal);
        ctx.lineWidth = 1.4;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(sx * hw - sx * arm2, sy * hh);
          ctx.lineTo(sx * hw, sy * hh);
          ctx.lineTo(sx * hw, sy * hh - sy * arm2);
          ctx.stroke();
        }
        // --- top hairline in the tier colour
        ctx.strokeStyle = rgba(TR, 0.55 * reveal);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-hw + arm2, -hh); ctx.lineTo(hw - arm2, -hh); ctx.stroke();
        // --- chevrons above the plate (L5: 1, L6: 2)
        for (let c2 = 0; c2 < S.chevrons; c2++) {
          const cw = bh * (0.5 - c2 * 0.12), cy2 = -hh - bh * (0.40 + c2 * 0.26);
          ctx.strokeStyle = rgba(TR, (0.55 - c2 * 0.16) * reveal);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(-cw, cy2 + cw * 0.5); ctx.lineTo(0, cy2 - cw * 0.3); ctx.lineTo(cw, cy2 + cw * 0.5);
          ctx.stroke();
        }
        // --- orbiting marks around the caps (count follows the tier)
        for (let d2 = 0; d2 < S.ring; d2++) {
          const ang = t * (0.9 + d2 * 0.35) + d2 * 2.1;
          const rx = hw + bh * (0.5 + d2 * 0.22), ry = hh * (1.5 + d2 * 0.3);
          const x2 = Math.cos(ang) * rx, y2 = Math.sin(ang) * ry;
          ctx.fillStyle = rgba(TR, 0.55 * reveal * (0.5 + 0.5 * breathe));
          ctx.beginPath(); ctx.arc(x2, y2, bh * 0.09, 0, TAU); ctx.fill();
        }
        // --- rolling tier number + typed label
        const roll = Math.min(1, Math.max(0, (since - 0.4) / 0.5));
        const shown = Math.max(1, Math.round(1 + (lv - 1) * ease(roll)));
        ctx.font = numFont;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = rgba(TR, 0.96 * reveal);
        ctx.fillText('L' + shown, numX, 0);
        const tr = Math.min(1, Math.max(0, (since - 0.46) / 0.5));
        ctx.font = labFont;
        ctx.fillStyle = rgba(C.ink, 0.80 * reveal);
        ctx.fillText(S.label.slice(0, Math.max(0, Math.round(S.label.length * ease(tr)))), labX, 0);
        ctx.restore();
        // --- six slot rail: lit slots show the rank, blink style follows the tier
        const tw = base * 0.016, gp = base * 0.0075, total = 6 * tw + 5 * gp;
        const segT = Math.min(1, Math.max(0, (since - 0.42) / 0.75));
        for (let i = 0; i < 6; i++) {
          const litT = Math.min(1, Math.max(0, segT * 6 - i));
          const on = i < lv;
          const x0 = icx - total / 2 + i * (tw + gp), y0 = by + hh + base * 0.013;
          const blink = S.blink ? 0.65 + 0.35 * Math.sin(t * (2.2 + i * 0.5)) : 1;
          if (on && litT > 0.55 && S.bloom > 0) {
            ctx.fillStyle = rgba(TR, S.bloom * litT * (0.6 + 0.4 * breathe));
            ctx.fillRect(snap(x0 - 1.5), snap(y0 - 2.5), snap(tw + 3), 8);
          }
          ctx.fillStyle = rgba(on ? TR : C.ink, on ? (0.30 + 0.55 * litT) * blink : 0.12);
          ctx.fillRect(snap(x0), snap(y0), snap(tw * (0.35 + 0.65 * litT)), on ? 3 : 2);
        }
    }

      }
    // ---- stage 04: seal + permission level ----------------------------------
    if (enterAlpha > 0.002) {
      const level = tier(), a = enterAlpha;
      const cx = width / 2, cySeal = height * 0.50;
      const settled = grow >= 1;
      const breathe = settled && waiting ? 0.5 + 0.5 * Math.sin(t * 2.1) : 0;
      const swell = 1 + 0.012 * Math.sin(t * 0.55);
      const outer = base * (0.082 + (level - 1) * 0.0066) * swell;
      const open = t - entryAt, confirm = t - confirmAt;

      const glowR = base * (0.15 + 0.008 * breathe);
      const glow = ctx.createRadialGradient(cx, cySeal, 0, cx, cySeal, glowR);
      glow.addColorStop(0, rgba(C.accent, (0.038 + 0.022 * breathe) * a));
      glow.addColorStop(1, rgba(C.accent, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(cx - glowR, cySeal - glowR, glowR * 2, glowR * 2);

      if (open >= 0 && open < 1.2) {
        const k = open / 1.2;
        for (let i = 0; i < 2; i++) {
          const kk = k - i * 0.18;
          if (kk <= 0 || kk >= 1) continue;
          ctx.beginPath(); ctx.arc(cx, cySeal, base * (0.05 + ease(kk) * 0.16), 0, TAU);
          ctx.strokeStyle = rgba(C.accent, (1 - kk) * 0.26 * a);
          ctx.lineWidth = 2.4 - kk; ctx.stroke();
        }
      }
      if (confirm >= 0 && confirm < 0.9) {
        const k = confirm / 0.9;
        ctx.beginPath(); ctx.arc(cx, cySeal, outer + ease(k) * base * 0.07, 0, TAU);
        ctx.strokeStyle = rgba(C.accent, (1 - k) * 0.30 * a);
        ctx.lineWidth = 2.2; ctx.stroke();
      }

      for (let i = 0; i < level; i++) {
        ctx.beginPath();
        ctx.arc(cx, cySeal, base * (0.082 + i * 0.0066) * (i % 2 ? 2 - swell : swell), 0, TAU);
        ctx.strokeStyle = rgba(C.ink, Math.max(0.05, (0.13 - i * 0.012) * a + (0.02 + 0.01 * i) * breathe * a));
        ctx.lineWidth = 1.5; ctx.stroke();
      }

      const drawArc = (radius, head, span, rgb, weight, gain) => {
        for (let i = 0; i < 16; i++) {
          const from = head - span * (i + 1) / 16, to = head - span * i / 16;
          ctx.beginPath(); ctx.arc(cx, cySeal, radius, from, to);
          ctx.strokeStyle = rgba(rgb, (gain * Math.pow(1 - i / 16, 2.2) + 0.16 * impulse) * a);
          ctx.lineWidth = weight; ctx.stroke();
        }
      };
      drawArc(outer + base * 0.011, t * (0.18 + level * 0.012), 1.6, C.accent, 2.4, 0.36);
      drawArc(outer - base * 0.009, -t * (0.10 + level * 0.008), 0.95, C.ink, 1.8, 0.18);

      const ticks = 12 + level * 6, drift = t * 0.05;
      ctx.strokeStyle = rgba(C.ink, (0.11 + 0.05 * Math.sin(t * 0.4) + 0.16 * impulse) * a);
      ctx.lineWidth = 1.4;
      for (let i = 0; i < ticks; i++) {
        const angle = (i / ticks) * TAU + drift;
        const len = base * (0.009 + 0.002 * Math.sin(t * 0.5 + i * 0.4));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * outer, cySeal + Math.sin(angle) * outer);
        ctx.lineTo(cx + Math.cos(angle) * (outer + len), cySeal + Math.sin(angle) * (outer + len));
        ctx.stroke();
      }

      const count = 8 + level * 3;
      for (let i = 0; i < count; i++) {
        const m = motes[i % motes.length];
        const angle = m.a + t * m.w * (i % 2 ? 1 : -1);
        const radius = base * (m.r + 0.008 * Math.sin(t * 0.3 + i));
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * radius, cySeal + Math.sin(angle) * radius, m.s, 0, TAU);
        ctx.fillStyle = rgba(i % 4 === 0 ? C.accent : C.soft, m.o * a * (0.6 + 0.4 * breathe));
        ctx.fill();
      }

      // A slow counter-rotating tick collar echoes the loading screen's rings.
      // stage02 hairline: a calm inner circle holding the ticking collar.
      {
        const tickR = base * 0.128, tickN = 40, rot2 = -t * 0.10;
        for (let i = 0; i < tickN; i++) {
          const ang = rot2 + (i / tickN) * TAU, long = i % 4 === 0;
          const r1 = tickR, r2 = tickR + (long ? base * 0.013 : base * 0.006);
          ctx.strokeStyle = rgba(long ? C.accent : C.ink, (long ? 0.30 : 0.13) * a);
          ctx.lineWidth = long ? 1.5 : 1;
          ctx.beginPath();
          if (i === 0) { ctx.strokeStyle = rgba(C.ink, 0.12 * a); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cySeal, base * 0.112, 0, TAU); ctx.stroke(); }
          ctx.moveTo(cx + Math.cos(ang) * r1, cySeal + Math.sin(ang) * r1);
          ctx.lineTo(cx + Math.cos(ang) * r2, cySeal + Math.sin(ang) * r2);
          ctx.stroke();
        }
      }

      const roll = ease(Math.min(1, Math.max(0, (grow - 0.22) / 0.5)));
      const rule = Math.min(1, Math.max(0, (grow - 0.5) / 0.5));
      const value = levelText();
      const cyValue = height * 0.625, cyCaption = height * 0.672, cyMarks = height * 0.702;
      let size = snap(base * 0.050 * (1 + 0.035 * breathe));
      ctx.font = mono(size);
      const measured = ctx.measureText(value).width, limit = base * 0.30;
      if (measured > limit) { size = snap(size * limit / measured); ctx.font = mono(size); }
      const valueY = snap(cyValue);
      const valueGlow = ctx.createRadialGradient(cx, valueY, 0, cx, valueY, Math.max(20, measured));
      valueGlow.addColorStop(0, rgba(C.accent, (0.10 + 0.12 * breathe) * a));
      valueGlow.addColorStop(1, rgba(C.accent, 0));
      ctx.fillStyle = valueGlow;
      ctx.fillRect(snap(cx - measured * 1.4), snap(valueY - size * 2), snap(measured * 2.8), snap(size * 4));

      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - limit, valueY - size * 1.4, limit * 2, size * 2.8 * roll);
      ctx.clip();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(C.accent, (0.66 + 0.30 * (settled ? breathe : roll)) * a);
      ctx.fillText(value, snap(cx), snap(valueY + (1 - roll) * size * 0.5));
      ctx.restore();

      const ruleW = snap(Math.min(measured, limit) * 1.05 * rule);
      ctx.fillStyle = rgba(C.accent, (0.38 + 0.24 * breathe) * a);
      ctx.fillRect(snap(cx - ruleW / 2), snap(valueY + size * 0.95), ruleW, 2);

      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = mono(snap(base * 0.0135));
      ctx.fillStyle = rgba(C.ink, 0.62 * a * Math.min(1, rule + 0.2));
      {
        const capT = 'ACCESS LEVEL', capS = snap(base * 0.0135), tr2 = base * 0.0042;
        ctx.font = mono(capS);
        ctx.textAlign = 'left';
        let tw2 = 0;
        for (const c2 of capT) tw2 += ctx.measureText(c2).width + tr2;
        let cx2 = cx - tw2 / 2;
        for (const c2 of capT) { ctx.fillText(c2, snap(cx2), snap(cyCaption)); cx2 += ctx.measureText(c2).width + tr2; }
      }

      const markW = 15, marks = level * markW - 5;
      for (let i = 0; i < level; i++) {
        const k = Math.min(1, Math.max(0, (grow - 0.55 - i * 0.06) / 0.22));
        if (k <= 0) continue;
        ctx.fillStyle = rgba(C.accent, (0.36 + 0.28 * (pulse || breathe)) * a);
        ctx.fillRect(snap(cx - marks / 2 + i * markW), snap(cyMarks), snap((markW - 5) * k), 2);
      }

      if (pulse > 0) {
        ctx.beginPath(); ctx.arc(cx, cySeal, outer + base * 0.03 * (1 - pulse), 0, TAU);
        ctx.strokeStyle = rgba(C.accent, pulse * 0.5 * a);
        ctx.lineWidth = 2.2; ctx.stroke();
      }
    }

    const rel = t - releaseAt;
    if (rel >= 0 && rel < 0.85) {
      const k = rel / 0.85;
      ctx.beginPath();
      ctx.arc(width / 2, height * 0.50, base * (0.10 + ease(k) * 0.30), 0, TAU);
      ctx.strokeStyle = rgba(C.accent, (1 - k) * 0.26);
      ctx.lineWidth = 2.4 - k; ctx.stroke();
    }

    // ---- stage 05 / 06: capability loading -----------------------------------
    // The archive panel measures 36-92% of the stage, so every mark for this layer
    // lives in the free strip under it (93-100%) and along the panel's top edge.
    if (loadAlpha > 0.002) {
      const a = loadAlpha;
      const x0 = width * 0.22, x1 = width * 0.78, span = x1 - x0;
      const boot = Math.min(1, Math.max(0, (t - stageAt) / 0.55));
      const ready = activeIdx === 5 ? Math.min(1, Math.max(0, (t - stageAt) / 0.8)) : 0;

      // Panel power-on sweep along its own top border.
      const edge = Math.min(1, Math.max(0, (t - stageAt) / 0.7));
      ctx.strokeStyle = rgba(C.ink, 0.35 * a);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(snap(width * 0.07), snap(height * 0.36)); ctx.lineTo(snap(width * 0.93), snap(height * 0.36)); ctx.stroke();
      const sweep = width * 0.07 + (width * 0.86) * ease(edge);
      ctx.strokeStyle = rgba(C.accent, 0.55 * a);
      ctx.beginPath(); ctx.moveTo(snap(width * 0.07), snap(height * 0.36)); ctx.lineTo(snap(sweep), snap(height * 0.36)); ctx.stroke();

      // Segmented load hairline, 2px, inside the bottom strip.
      const segs = 30, segW = Math.max(2, span / segs - 3), y = snap(height * 0.947);
      const head = loadFill * segs;
      for (let i = 0; i < segs; i++) {
        const passed = i < head, near = Math.abs(i - head) < 2.2, lit = i / segs <= boot;
        const alpha = (passed ? 0.42 : 0.10) + (near ? 0.34 : 0) + (loaded && lit ? 0.16 : 0);
        ctx.fillStyle = rgba(passed || near ? C.accent : C.ink, alpha * a);
        ctx.fillRect(snap(x0 + i * (segW + 3)), y, snap(segW), 2);
      }
      if (!loaded) {
        for (let c = 0; c < 3; c++) {
          const comet = ((t * 0.32 + c / 3) % 1) * span;
          for (let i = 0; i < 10; i++) {
            const px = x0 + comet - i * 9;
            if (px < x0 || px > x1 - segW) continue;
            ctx.fillStyle = rgba(C.accent, 0.26 * Math.pow(1 - i / 10, 2) * a);
            ctx.fillRect(snap(px), y - 2, snap(segW * 0.8), 6);
          }
        }
      } else if (loadAt > 0) {
        const flash = Math.max(0, 1 - (t - loadAt) / 0.8);
        if (flash > 0) { ctx.fillStyle = rgba(C.accent, flash * 0.20 * a); ctx.fillRect(snap(x0), y - 4, snap(span), 10); }
        // End ticks close the run in once the manifest is sealed.
        const tick = ease(ready) * base * 0.02;
        ctx.strokeStyle = rgba(C.accent, 0.6 * a);
        ctx.lineWidth = 2;
        for (const px of [x0, x1]) {
          ctx.beginPath(); ctx.moveTo(snap(px), snap(y - tick)); ctx.lineTo(snap(px), snap(y + tick)); ctx.stroke();
        }
      }

      // One compact status line, types itself on, right under the panel.
      const manifest = 'SKILLS ' + (text('skillsCount') || '0') + '  璺? PLUGINS ' + (text('pluginsCount') || '0');
      const typed = manifest.slice(0, Math.max(1, Math.ceil(manifest.length * Math.min(1, (t - stageAt) / 0.028 / manifest.length))));
      ctx.textBaseline = 'middle';
      ctx.font = mono(snap(base * 0.0125));
      ctx.textAlign = 'left';
      ctx.fillStyle = rgba(C.ink, 0.58 * a);
      ctx.fillText(loaded ? 'CAPABILITIES MOUNTED' : 'STREAMING MANIFEST', snap(x0), snap(height * 0.975));
      ctx.textAlign = 'right';
      ctx.fillStyle = rgba(loaded ? C.accent : C.ink, (loaded ? 0.8 : 0.58) * a);
      ctx.fillText(typed, snap(x1), snap(height * 0.975));
    }

    // Chapter progress: seven dashes at the bottom centre, one per stage. Hidden
    // in the archive stages (05/06) where the loading bar owns that strip.
    if (activeIdx >= 0 && activeIdx !== 4 && activeIdx !== 5) {
      const dashW = base * 0.014, gapW = base * 0.006, total = 7 * dashW + 6 * gapW;
      const startX = width / 2 - total / 2, py = height * 0.973;
      for (let i = 0; i < 7; i++) {
        const done = i < activeIdx, on = i === activeIdx;
        const x = snap(startX + i * (dashW + gapW)), w = snap(dashW), h = on ? 6 : 5;
        ctx.fillStyle = rgba(C.accent, on ? 0.95 : done ? 0.45 : 0.08);
        ctx.fillRect(x, snap(py), w, h);
        ctx.strokeStyle = rgba(on || done ? C.accent : C.ink, on ? 1 : done ? 0.55 : 0.30);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, snap(py) + 0.5, w - 1, h - 1);
      }
    }

    // ---- stage 07: departure flourish ---------------------------------------
    if (activeIdx === 6) {
      const k = Math.min(1, Math.max(0, (t - stageAt) / 1.4));
      const a = Math.min(1, k * 2.2);
      const cy = height * 0.50, reach = base * (0.10 + ease(k) * 0.46);
      ctx.strokeStyle = rgba(C.accent, (1 - k) * 0.42);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(snap(width / 2 - reach), snap(cy)); ctx.lineTo(snap(width / 2 - base * 0.06), snap(cy));
      ctx.moveTo(snap(width / 2 + base * 0.06), snap(cy)); ctx.lineTo(snap(width / 2 + reach), snap(cy));
      ctx.stroke();
      for (let i = 0; i < 26; i++) {
        const m = motes[i % motes.length];
        const pull = 1 - ease(Math.min(1, k + i * 0.012));
        const angle = m.a + t * m.w * 0.4;
        const radius = base * (m.r + 0.22 * pull);
        ctx.beginPath();
        ctx.arc(width / 2 + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.6, m.s * (0.6 + pull), 0, TAU);
        ctx.fillStyle = rgba(i % 3 === 0 ? C.accent : C.soft, m.o * a * (0.5 + pull * 0.5));
        ctx.fill();
      }
    }

    window.requestAnimationFrame(drawFrame);
  };
  window.requestAnimationFrame(drawFrame);
})();
`;

// Centred caption blocks are positioned with translate(-50%,-50%), so an odd stage
// width drops every glyph on a half pixel and the text renders soft. Accumulate a
// margin correction until the block sits on whole pixels; it converges and stops.
const PIXEL_SNAP_SCRIPT = `
/* drb-pixel-snap */
(() => {
  const SELECTORS = ['.stage-copy', '.identity-card', '.control-panel', '.inventory-panel'];
  const snap = () => {
    for (const selector of SELECTORS) {
      const node = document.querySelector(selector);
      if (!node || node.hidden) continue;
      const box = node.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      const dx = Math.round(box.left) - box.left, dy = Math.round(box.top) - box.top;
      if (Math.abs(dx) > 0.01) node.style.marginLeft = (((parseFloat(node.style.marginLeft) || 0) + dx).toFixed(2)) + 'px';
      if (Math.abs(dy) > 0.01) node.style.marginTop = (((parseFloat(node.style.marginTop) || 0) + dy).toFixed(2)) + 'px';
    }
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(() => { queued = false; snap(); });
  };
  schedule();
  window.addEventListener('resize', schedule);
  setInterval(snap, 500);
})();
`;

/** Insert a fourth identity row (permission level) into the archive card. */
function patchStartupHtml(text, level) {
  if (text.includes('id="cardLevel"')) return text;
  const anchor = text.indexOf("cardModeVisual");
  if (anchor < 0) return text;

  // Insert directly after the row that owns the anchor.
  const closeP = text.indexOf("</p>", anchor);
  const closeDiv = text.indexOf("</div>", anchor);
  let end = -1;
  if (closeP >= 0 && (closeDiv < 0 || closeP < closeDiv)) end = closeP + 4;
  else if (closeDiv >= 0) end = closeDiv + 6;
  else return text;

  // Clone the first identity row verbatim so classes/layout match exactly.
  const rowStart = text.indexOf('<div class="identity-row">');
  if (rowStart < 0) return text;
  const rowEnd = text.indexOf("</div>", rowStart);
  if (rowEnd < 0) return text;

  const value = String(level || "L2");
  const row = text.slice(rowStart, rowEnd + 6)
    .replace(/cardNameVisual/g, "cardLevelVisual")
    .replace(/cardName/g, "cardLevel")
    .replace(/>01</g, ">04<")
    .replace(/访问身份/g, "权限等级")
    .replace(/OPERATOR/g, value);
  let out = text.slice(0, end) + row + text.slice(end);

  // Lift the caption block so the centred seal never runs underneath it.
  out = out.replace(".stage-copy{position:absolute;left:50%;top:39%;", ".stage-copy{position:absolute;left:50%;top:30%;");
  // The bottom subtitle repeats the phase note verbatim right above the loading
  // bar; the note already carries it, so drop the duplicate row.
    // The 03 row's password line: bigger monospace type and a tighter cell, so the
  // sixteen slots read as a password instead of a caption.
  out = out.replace(
    ".identity-card .access-state{font:9px/1.5 var(--mono);text-align:right;letter-spacing:.08em;color:var(--soft)}",
    ".identity-card .access-state{font:15px/1.2 var(--mono);text-align:right;letter-spacing:.07em;color:var(--ink)}"
  );
  out = out.replace(
    ".identity-card .access-row{position:relative;border-bottom:0;",
    ".identity-card .access-row{min-height:26px;padding:2px 0;position:relative;border-bottom:0;"
  );out = out.replace("</style>", "#subtitleZh,#subtitleEn{display:none}html.drb-embed #settings{display:none}html.drb-embed #controlPanel{display:none}</style>");
  // Tighter row rhythm for the archive card (the compact password cell stays).
  out = out.replace(
    ".identity-card .identity-row{display:grid;grid-template-columns:minmax(98px,1fr) minmax(0,1.4fr);gap:12px;min-height:43px;padding:8px 0;align-items:center}",
    ".identity-card .identity-row{display:grid;grid-template-columns:minmax(98px,1fr) minmax(0,1.4fr);gap:12px;min-height:38px;padding:6px 0;align-items:center}"
  );
  // Close the capability panel by giving its bottom edge the same rule as the top.
  out = out.replace(".inventory-panel{position:absolute;left:12%;right:12%;top:38%;bottom:15%;", ".inventory-panel{position:absolute;left:12%;right:12%;top:38%;bottom:15%;border-bottom:2px solid var(--ink);");

  // Seven chapter chips now that permission confirmation is its own phase.
  const chapters = [
    ["0", "01", "部门序章"],
    ["1", "02", "本地连接"],
    ["2", "03", "身份确认"],
    ["3", "04", "权限等级"],
    ["4", "05", "真实加载"],
    ["5", "06", "加载结果"],
    ["6", "07", "深潜就绪"]
  ].map(([phase, number, label]) =>
    '<button class="chapter" type="button" data-phase="' + phase + '" aria-label="' + number + " " + label + '">' + number + "</button>"
  ).join("");
  if (/<nav class="chapter-nav"[\s\S]*?<\/nav>/.test(out)) {
    out = out.replace(/<nav class="chapter-nav"[\s\S]*?<\/nav>/, '<nav class="chapter-nav" aria-label="启动动画阶段">' + chapters + "</nav>");
  }
  return out;
}

function patchStartupAsset(pathname, text, ui, settings) {
  let out = text;
  if (pathname.endsWith("startup-preview.html")) {
    out = patchStartupHtml(out, ui.identityLevel);
  }  if (pathname.endsWith("startup-local.js") || pathname.endsWith("startup-identity.js")) {
    out = prefixQuotedPaths(out, ["/api/access/unlock", "/api/access", "/api/profile", "/api/load"]);
  }
  if (pathname.endsWith("startup-local.js")) {
    // Carry the plugin-provided permission level through the client profile.
    if (!out.includes("access_level: text(result.access_level)")) {
      out = out.replace(
        "this.profile = { username: result.username,",
        "this.profile = { username: result.username, access_level: text(result.access_level) || text(result.permission_level) || text(result.level) || '', inventory_mode: text(result.inventory_mode) || text(result.inventoryMode) || '',"
      );
    }
    out = out.replace(
      "this.profile = { username: 'OPERATOR', badge_id: 'DSH-0001', workspace: '', sound: true };",
      "this.profile = { username: 'OPERATOR', badge_id: 'DSH-0001', access_level: '', workspace: '', sound: true };"
    );
    // Default access password: when the local host has none configured, report an
    // enabled-but-already-unlocked access so the演出 shows an authorised state and
    // never nudges the viewer into the settings page.
    out = out.replace(
      "this.access = { supported: true, enabled: result.enabled, unlocked: result.unlocked };",
      "this.access = { supported: true, enabled: true, unlocked: result.enabled ? result.unlocked : true };"
    );
  }
  if (pathname.endsWith("startup-local.js") && !out.includes("drb-emit-coalescer")) {
    // The page rebuilds every inventory row on each of the ~340 streamed events
    // (~335 skills), which starves the canvas and makes the演出 stutter. Coalesce
    // those notifications to at most one per animation frame.
    out += "\n/* drb-emit-coalescer */(()=>{const L=globalThis.DSHLocal;if(!L||!L.Client)return;const p=L.Client.prototype,orig=p.emit;let queued=false,last=0;const now=()=>((globalThis.performance||Date).now());p.emit=function(){if(queued)return;const self=this,wait=Math.max(0,50-(now()-last));queued=true;const run=()=>{queued=false;last=now();orig.call(self);};if(wait>0)setTimeout(run,wait);else if(globalThis.requestAnimationFrame)globalThis.requestAnimationFrame(run);else setTimeout(run,16);};})();\n";
  }
  if (pathname.endsWith("startup-voice.js")) {
    out = prefixQuotedPaths(out, ["/assets/voice/"]);
  }
  if (pathname.endsWith("startup-sequence.js")) {
    out = patchStartupSequence(out, ui.advanceMode, narrationDurations(), ui.pace);
  }
  if (pathname.endsWith("startup-visuals.js")) {
    out = patchStartupVisuals(out, ui.richEffects);
  }
  if (pathname.endsWith("startup-preview.js") && settings) {
    out = patchStartupPreview(out);
    const accessPassword = typeof ui.accessPassword === "string" && ui.accessPassword.trim()
      ? ui.accessPassword.trim().slice(0, 16)
      : "Dsh7Rk29Wq41Mn8T";
    out += PASSWORD_TYPING_SCRIPT.replace("__DRB_PASS__", accessPassword);
    // Stage-transition whoosh: one short synthesized cue per chapter change.
    out += AUDIO_CUES_SCRIPT;
    // Sharper rendering: supersample the show canvas at >=3x on low-DPI displays.
    out = out.replace("Math.min(devicePixelRatio||1,2.5)", "Math.min(Math.max(devicePixelRatio||1,3),4)");
    out += "\n/* drb-embed-flag */(()=>{try{if(/[?&]embed=1/.test(location.search))document.documentElement.classList.add('drb-embed');}catch(e){}})();\n";
    // No settings reminder inside the演出: the access row must never tell the
    // viewer to go and configure a password.
    out = out.replace("'可进入设置 → 个人资料，设置访问密码。'", "''");
    // The shipped page hard-codes the light palette; honour the stored theme.
    out = out.replace("let light=true,", "let light=" + (settings.theme === "light" ? "true" : "false") + ",");
    // The page also inherits the OS "animation effects off" preference and would
    // drop to a static frame, stripping every motion effect. Only the plugin's
    // own 减动效 switch may ask for that.
    const motionGetter = "return motionOverride||motionMedia.matches;";
    if (out.includes(motionGetter)) {
      out = out.replace(motionGetter, settings.reduced_motion === true ? "return true;" : "return motionOverride;");
    }
    // Fourth archive field: the plugin-owned permission level.
    if (!out.includes("'cardLevel','cardLevelVisual'")) {
      out = out.replace("'cardModeVisual','accessForm'", "'cardModeVisual','cardLevel','cardLevelVisual','accessForm'");
    }
    out = out.replace("['cardName','cardId','cardMode']", "['cardName','cardId','cardMode','cardLevel']");
    if (!out.includes("const level=(local.profile&&local.profile.access_level)")) {
      out = out.replace(
        "const mode=profileDirty?'UNSAVED / PREVIEW':local.connection==='local'?'LOCAL / SAVED':'OFFLINE / PREVIEW';",
        "const mode=profileDirty?'UNSAVED / PREVIEW':local.connection==='local'?'LOCAL / SAVED':'OFFLINE / PREVIEW';const level=(local.profile&&local.profile.access_level)||'L2';"
      );
    }
    out = out.replace("identityView.set([name,badge,mode]);", "identityView.set([name,badge,mode,level]);");
    // Rendering sharpness: supersample the canvas beyond the CSS pixel grid.
    const scale = Number.isFinite(ui.renderScale) && ui.renderScale >= 1 && ui.renderScale <= 3 ? ui.renderScale : 2;
    if (out.includes("dpr=Math.min(devicePixelRatio||1,2.5);")) {
      out = out.replace("dpr=Math.min(devicePixelRatio||1,2.5);", "dpr=Math.min(Math.max(devicePixelRatio||1," + scale + "),4);");
    }
    if (!out.includes("drb-access-tier-overlay")) out += ACCESS_TIER_OVERLAY;
    // Centred DOM captions land on half pixels whenever the stage width is odd,
    // which is what makes them look soft. Nudge each centred block onto whole
    // pixels with margins so its own transform stays untouched.
    if (!out.includes("drb-pixel-snap")) out += PIXEL_SNAP_SCRIPT;
  }
  return out;
}

function contentTypeOf(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  return {
    html: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    svg: "image/svg+xml",
    woff2: "font/woff2",
    wav: "audio/wav",
    ico: "image/x-icon",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8"
  }[ext] || "application/octet-stream";
}

// --- [tui.startup] section editing (preserves the shipped comments) ---

const STARTUP_SECTION = "[tui.startup]";
const STARTUP_DEFAULTS = {
  enabled: false,
  sound: true,
  volume: 0.35,
  speed: 1.0,
  theme: "dark",
  interactive: true,
  reduced_motion: false
};

const STARTUP_FIELD_MAPPING = [
  ["enabled", "enabled"],
  ["sound", "sound"],
  ["volume", "volume"],
  ["speed", "speed"],
  ["theme", "theme"],
  ["interactive", "interactive"],
  ["reducedMotion", "reduced_motion"]
];

function parseScalar(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) return raw.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return undefined;
}

function readStartupSection(text) {
  const values = {};
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inSection = trimmed === STARTUP_SECTION;
      continue;
    }
    if (!inSection || trimmed === "" || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^(\w+)\s*=\s*(.*)$/);
    if (!m || !(m[1] in STARTUP_DEFAULTS)) continue;
    const value = parseScalar(m[2].split("#")[0].trim());
    if (value !== undefined) values[m[1]] = value;
  }
  return { ...STARTUP_DEFAULTS, ...values };
}

function formatValue(value) {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function patchStartupSection(text, patch) {
  const lines = text.split(/\r?\n/);
  let inSection = false;
  let sectionIndex = -1;
  let applied = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("[")) {
      inSection = trimmed === STARTUP_SECTION;
      if (inSection) sectionIndex = i;
      continue;
    }
    if (!inSection) continue;
    const m = lines[i].match(/^(\s*)(\w+)(\s*=\s*)([^#\r\n]*?)(\s*(?:#.*)?)$/);
    if (!m || !(m[2] in patch)) continue;
    const key = m[2];
    lines[i] = m[1] + key + m[3] + formatValue(patch[key]) + m[5];
    applied++;
  }
  if (sectionIndex < 0) {
    const entries = Object.entries({ ...STARTUP_DEFAULTS, ...patch });
    lines.push("", STARTUP_SECTION, ...entries.map(([k, v]) => `${k} = ${formatValue(v)}`));
  }
  return { text: lines.join("\n"), applied };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(start = 8769, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const port = start + i;
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`no free port in range ${start}..${start + tries - 1}`);
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function apply(ctx, config = {}) {
  const apiKey = readField(config.apiKey, "");
  const model = readField(config.model, "");
  const maxBytes = readField(config.maxOutputBytes, 65536);
  const execTimeout = readField(config.execTimeoutMs, 300000);

  // Keep every dsh-rust runtime artifact inside the DSH home (sandbox allowlist).
  const dshHome = process.env.DSH_HOME || join(dirname(pluginDir), "..");
  const outerHome = join(dshHome, "dsh-rust");
  const tmpDir = join(outerHome, "tmp");
  const cfgPath = join(pluginDir, "runtime-config.toml");
  // Fresh on every plugin load: embedded frames compare it to decide a reload.
  const ASSET_STAMP = Date.now().toString(36);

  const prepareRuntimeConfig = () => {
    mkdirSync(outerHome, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    const template = readFileSync(TEMPLATE_CONFIG, "utf8");
    const content = /outer_home\s*=/.test(template)
      ? template.replace(/outer_home\s*=.*/g, 'outer_home = "' + outerHome.replace(/\\/g, "/") + '"')
      : template.includes("[paths]")
        ? template.replace("[paths]", '[paths]\nouter_home = "' + outerHome.replace(/\\/g, "/") + '"')
        : template + '\n\n[paths]\nouter_home = "' + outerHome.replace(/\\/g, "/") + '"\n';
    writeFileSync(cfgPath, content);
  };

  // Persist explicitly configured plugin-settings startup fields into the
  // bundled config.toml (the durable store the runtime config is generated from).
  const startupUi = readField(config.startup, null);
  if (startupUi && typeof startupUi === "object") {
    const patch = {};
    for (const [uiKey, tomlKey] of STARTUP_FIELD_MAPPING) {
      const value = readField(startupUi[uiKey], undefined);
      if (value !== undefined && value !== null) patch[tomlKey] = value;
    }
    if (Object.keys(patch).length > 0) {
      try {
        const updated = patchStartupSection(readFileSync(TEMPLATE_CONFIG, "utf8"), patch);
        writeFileSync(TEMPLATE_CONFIG, updated.text);
      } catch (error) {
        ctx.logger?.warn?.("dsh-prologue: could not persist startup settings: " + String(error));
      }
    }
  }

  try {
    prepareRuntimeConfig();
  } catch (error) {
    ctx.logger?.warn?.("dsh-prologue: could not prepare runtime config: " + String(error));
  }

  const buildEnv = () => ({
    ...process.env,
    DEEPSEEK_API_KEY: apiKey || process.env.DEEPSEEK_API_KEY || process.env.DSH_LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    TEMP: tmpDir,
    TMP: tmpDir
  });

  const run = (argv, { cwd, timeoutMs }) => {
    const handle = ctx.subprocess.spawn({
      argv: [BIN, "--config", cfgPath, ...argv],
      cwd: cwd || process.cwd(),
      env: buildEnv(),
      stdio: {
        stdin: { data: "" },
        stdout: { maxBytes },
        stderr: { maxBytes }
      },
      graceMs: timeoutMs
    });
    return handle;
  };

  const collect = async (handle) => {
    const outcome = await handle.done;
    const collected = handle.collected ?? {};
    return {
      exitCode: outcome.exitCode,
      stdout: readAll(collected.stdout).slice(0, maxBytes),
      stderr: readAll(collected.stderr).slice(0, maxBytes)
    };
  };

  const commonOutput = {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ok: { type: "boolean", required: true },
        exitCode: { type: "integer" },
        stdout: { type: "string" },
        stderr: { type: "string" }
      }
    },
    render: (_args, value) => [{
      type: "text",
      text: [
        value?.ok ? "exit 0 (ok)" : `exit ${value?.exitCode ?? "unknown"}${value?.ok === false ? " (failed)" : ""}`,
        value?.stdout ? `--- stdout ---\n${value.stdout}` : "",
        value?.stderr ? `--- stderr ---\n${value.stderr}` : ""
      ].filter(Boolean).join("\n") || "(no output)"
    }]
  };

  const disposeExec = ctx.tools.register(defineTool({
    name: "dsh_rust_exec",
    description: "Run a one-shot coding task with the dsh-rust engine (the Rust rewrite of DeepSeek Harness) and return its final output. Use it to delegate an independent implementation/analysis to a second engine, e.g. cross-check a fix or produce an alternative implementation. Needs a DeepSeek API key (plugin config apiKey, or the DEEPSEEK_API_KEY env var).",
    parameters: {
      prompt: { type: "string", required: true, description: "The task for the dsh-rust engine (same style as a coding-agent prompt)." },
      cwd: { type: "string", description: "Working directory for the run; defaults to the host working directory." },
      model: { type: "string", description: "Model override; defaults to the plugin config model." }
    },
    output: commonOutput,
    timeoutMs: execTimeout,
    execute: async (args) => {
      const argv = [];
      const effectiveModel = args.model || model;
      if (effectiveModel) argv.push("-m", effectiveModel);
      if (args.cwd) argv.push("-C", args.cwd);
      argv.push("exec", String(args.prompt ?? ""));
      const handle = run(argv, { cwd: args.cwd, timeoutMs: execTimeout });
      const r = await collect(handle);
      return {
        ok: r.exitCode === 0,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr
      };
    }
  }));

  const disposeDoctor = ctx.tools.register(defineTool({
    name: "dsh_rust_doctor",
    description: "Run dsh-rust's local diagnostics (dsh doctor) and return the report.",
    parameters: {},
    output: commonOutput,
    timeoutMs: 60000,
    execute: async () => {
      const handle = run(["doctor"], { timeoutMs: 60000 });
      const r = await collect(handle);
      return {
        ok: r.exitCode === 0,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr
      };
    }
  }));

  const disposeHelp = ctx.tools.register(defineTool({
    name: "dsh_rust_help",
    description: "Print the dsh-rust CLI help (commands and global flags).",
    parameters: {},
    output: commonOutput,
    timeoutMs: 60000,
    execute: async () => {
      const handle = run(["--help"], { timeoutMs: 60000 });
      const r = await collect(handle);
      return {
        ok: r.exitCode === 0,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr
      };
    }
  }));

  // --- startup (boot) animation settings, mirroring the compiled dsh-rust CLI ---

  const readStoredSettings = () => readStartupSection(readFileSync(TEMPLATE_CONFIG, "utf8"));

  const applyStartupPatch = (patch) => {
    if (patch.volume !== undefined && (typeof patch.volume !== "number" || patch.volume < 0 || patch.volume > 1)) {
      return { ok: false, message: "volume must be between 0.0 and 1.0" };
    }
    if (patch.speed !== undefined && (typeof patch.speed !== "number" || patch.speed < 0.25 || patch.speed > 3)) {
      return { ok: false, message: "speed must be between 0.25 and 3.0" };
    }
    if (patch.theme !== undefined && !["dark", "light"].includes(patch.theme)) {
      return { ok: false, message: 'theme must be "dark" or "light"' };
    }
    let changed = false;
    if (Object.keys(patch).length > 0) {
      const updated = patchStartupSection(readFileSync(TEMPLATE_CONFIG, "utf8"), patch);
      writeFileSync(TEMPLATE_CONFIG, updated.text);
      prepareRuntimeConfig();
      changed = updated.applied > 0;
    }
    return { ok: true, changed };
  };

  const disposeSettings = ctx.tools.register(defineTool({
    name: "dsh_rust_startup_settings",
    description: "Get or update the dsh-rust startup (boot) animation settings (the [tui.startup] block of the bundled config.toml). Pass any subset of the fields to update them; values persist across plugin reloads and take effect the next time the dsh-rust TUI boots or `dsh startup` runs. With no fields, returns the current effective settings. This is the settings function for the dsh-rust boot animation: enabled, sound, volume (0.0..1.0), speed (0.25..3.0), theme (dark|light), interactive, reducedMotion.",
    parameters: {
      enabled: { type: "boolean", description: "Play the startup animation when the dsh-rust interactive TUI boots (per-launch --startup / --no-startup flags still override this)." },
      sound: { type: "boolean", description: "Enable the synthesized startup sound effects and English narration." },
      volume: { type: "number", description: "Startup sound volume from 0.0 (mute) to 1.0 (max)." },
      speed: { type: "number", description: "Playback speed multiplier from 0.25 to 3.0 (the six phases take about 13.8 s at 1.0)." },
      theme: { type: "string", enum: ["dark", "light"], description: "Startup color theme." },
      interactive: { type: "boolean", description: "Confirm three checkpoints with a click, Enter, or Space during playback." },
      reducedMotion: { type: "boolean", description: "Show a static startup frame instead of the full motion sequence." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          settings: { type: "object", additionalProperties: true, description: "Effective [tui.startup] settings (enabled, sound, volume, speed, theme, interactive, reduced_motion)." },
          changed: { type: "boolean", description: "Whether a stored value was updated by this call." },
          message: { type: "string" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: [
          value?.message ?? "",
          value?.settings ? "[tui.startup]\n" + Object.entries(value.settings).map(([k, v]) => `${k} = ${v}`).join("\n") : ""
        ].filter(Boolean).join("\n")
      }]
    },
    timeoutMs: 30000,
    execute: async (args) => {
      const patch = {};
      for (const [apiKey, tomlKey] of STARTUP_FIELD_MAPPING) {
        if (args[apiKey] === undefined) continue;
        const value = args[apiKey];
        if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
          patch[tomlKey] = value;
        } else {
          return { ok: false, changed: false, message: `invalid type for ${apiKey}` };
        }
      }
      const applied = applyStartupPatch(patch);
      if (!applied.ok) return { ok: false, changed: false, message: applied.message };
      return {
        ok: true,
        settings: readStoredSettings(),
        changed: applied.changed,
        message: applied.changed
          ? "startup animation settings updated; they take effect the next time the dsh-rust TUI boots or `dsh startup` runs."
          : "no update requested; returning the current startup animation settings."
      };
    }
  }));

  // --- web preview + terminal playback (shared by tools and the settings UI routes) ---

  let previewHandle = null;
  let previewUrl = null;
  let previewPort = null;

  const stopPreview = async () => {
    const handle = previewHandle;
    previewHandle = null;
    previewUrl = null;
    previewPort = null;
    if (!handle) return;
    try { await handle.terminate(); } catch {}
    try { await handle.waitForExit?.(); } catch {}
  };

  const startWebPreview = async ({ port, silent = false } = {}) => {
    await stopPreview();
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) {
      return { ok: false, message: "port must be an integer between 1024 and 65535" };
    }
    if (port === undefined) {
      try {
        port = await findFreePort();
      } catch (error) {
        return { ok: false, message: String(error) };
      }
    }

    const handle = ctx.subprocess.spawn({
      argv: [BIN, "--config", cfgPath, "startup", "web", "--port", String(port), ...(silent ? ["--silent"] : [])],
      cwd: process.cwd(),
      env: buildEnv(),
      stdio: {
        stdin: "ignore",
        stdout: { maxBytes: 8192 },
        stderr: { maxBytes: 8192 }
      },
      graceMs: 5000
    });
    previewHandle = handle;

    const url = `http://127.0.0.1:${port}/startup-preview.html`;
    let ready = false;
    for (let attempt = 0; attempt < 16; attempt++) {
      const outcome = await Promise.race([
        handle.done.then((o) => o).catch(() => ({ exitCode: -1 })),
        sleep(250).then(() => null)
      ]);
      if (outcome !== null) {
        const stderr = readAll(handle.collected?.stderr);
        await stopPreview();
        return {
          ok: false,
          port,
          message: `startup web server exited early (exit code ${outcome.exitCode}); port ${port} may already be in use.`,
          ...(stderr ? { stderr } : {})
        };
      }
      try {
        const response = await fetchWithTimeout(url, 750);
        if (response.status === 200) {
          ready = true;
          break;
        }
      } catch {}
    }

    if (!ready) {
      await stopPreview();
      return { ok: false, port, message: "startup web server did not become ready in time." };
    }

    previewUrl = url;
    previewPort = port;
    return {
      ok: true,
      url,
      port,
      message: "immersive HTML startup animation is being served in the background; open the URL in a browser. It stops when a new preview starts or the plugin is disposed."
    };
  };

  const disposePreview = ctx.tools.register(defineTool({
    name: "dsh_rust_startup_preview",
    description: "Serve the immersive HTML startup (boot) animation of dsh-rust in the background (`dsh startup web`) and return the local URL to open. Sound (English narration + synthesized effects) is on unless you pass silent, but browsers require one click on the page to unlock audio. Use dsh_rust_startup_settings to change theme/speed first if desired.",
    parameters: {
      port: { type: "integer", description: "Local port for the preview server (default: an automatic free port near 8769)." },
      silent: { type: "boolean", description: "Mute startup sound for the preview server (default false; the page itself also has a mute button)." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          url: { type: "string", description: "URL of the startup preview page, e.g. http://127.0.0.1:8769/startup-preview.html" },
          port: { type: "integer" },
          message: { type: "string" },
          stderr: { type: "string", description: "Diagnostic stderr when the preview server fails to start." }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: [
          value?.message ?? "",
          value?.ok && value?.url ? `Open in browser: ${value.url}` : "",
          value?.stderr ? `stderr:\n${value.stderr}` : ""
        ].filter(Boolean).join("\n")
      }]
    },
    timeoutMs: 30000,
    execute: async (args) => {
      return startWebPreview({ port: args.port, silent: args.silent === true });
    }
  }));

  const disposeNext = ctx.tools.register(defineTool({
    name: "dsh_rust_startup_next",
    description: "Set the one-use choice for the next interactive dsh-rust CLI startup (`dsh startup next on|off`): whether the next terminal launch plays the startup animation or skips it, independent of the stored settings.",
    parameters: {
      mode: { type: "string", enum: ["on", "off"], required: true, description: "Play the startup animation on the next interactive CLI startup (on), or skip it once (off)." }
    },
    output: commonOutput,
    timeoutMs: 30000,
    execute: async (args) => {
      const handle = run(["startup", "next", String(args.mode)], { timeoutMs: 30000 });
      const r = await collect(handle);
      return {
        ok: r.exitCode === 0,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr
      };
    }
  }));

  let profileCache = { t: 0, value: null };

  const getProfile = async () => {
    if (profileCache.value && Date.now() - profileCache.t < 5000) return profileCache.value;
    const handle = run(["startup", "profile"], { timeoutMs: 30000 });
    const r = await collect(handle);
    let profile = { username: "", badge_id: "" };
    try {
      const parsed = JSON.parse(r.stdout);
      if (parsed && typeof parsed === "object") profile = parsed;
    } catch {}
    profileCache = { t: Date.now(), value: profile };
    return profile;
  };

  const setProfile = async (fields) => {
    const argv = ["startup", "profile"];
    if (fields?.name) argv.push("--name", String(fields.name));
    if (fields?.badge) argv.push("--badge", String(fields.badge));
    const handle = run(argv, { timeoutMs: 30000 });
    const r = await collect(handle);
    profileCache = { t: 0, value: null };
    return { ok: r.exitCode === 0, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
  };

  const disposeProfile = ctx.tools.register(defineTool({
    name: "dsh_rust_startup_profile",
    description: "Show or persist the identity (username and badge id) shared by the web and terminal startup animation (`dsh startup profile`). With no arguments, returns the current profile.",
    parameters: {
      name: { type: "string", description: "Username shown in the startup animation." },
      badge: { type: "string", description: "Badge id shown in the startup animation, e.g. DSH-0001." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          exitCode: { type: "integer" },
          profile: { type: "object", additionalProperties: true, description: "Parsed profile (username, badge_id) when the CLI returned JSON." },
          stdout: { type: "string" },
          stderr: { type: "string" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: [
          value?.profile ? `profile: ${value.profile.username ?? ""} / ${value.profile.badge_id ?? ""}` : value?.stdout ?? "",
          value?.stderr ? `stderr:\n${value.stderr}` : ""
        ].filter(Boolean).join("\n")
      }]
    },
    timeoutMs: 30000,
    execute: async (args) => {
      if (!args.name && !args.badge) {
        const profile = await getProfile();
        return { ok: true, exitCode: 0, profile, stdout: JSON.stringify(profile, null, 2), stderr: "" };
      }
      const r = await setProfile(args);
      const profile = await getProfile();
      return {
        ok: r.ok,
        exitCode: r.exitCode,
        profile,
        stdout: r.stdout,
        stderr: r.stderr
      };
    }
  }));

  // --- same-origin routes for the settings UI (the "开机动画" page in DSH settings) ---

  const routeDisposers = [];

  const sendJson = (res, code, obj) => {
    try {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
      res.end(JSON.stringify(obj));
    } catch {}
  };

  if (ctx.webServer && typeof ctx.webServer.register === "function") {
    const previewState = () => previewUrl
      ? { running: true, url: previewUrl, port: previewPort, embedUrl: PREVIEW_PROXY_PREFIX + "/startup-preview.html" }
      : { running: false, url: null, port: null, embedUrl: null };

    // Per-load stamp: changing it makes every embedded frame reload the演出
    // instead of keeping the document it loaded before the plugin reloaded.
    const assetStamp = () => ASSET_STAMP + (readUiSettings().sourceAssets === false ? "-bin" : "-src");
    const statePayload = async () => ({
      ok: true,
      settings: readStoredSettings(),
      ui: readUiSettings(),
      profile: await getProfile(),
      preview: previewState(),
      assetStamp: assetStamp()
    });

    routeDisposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/dsh-prologue/startup",
      handler: async (req, res) => {
        try {
          if (req.method === "GET" || req.method === "HEAD") {
            return sendJson(res, 200, await statePayload());
          }
          if (req.method === "POST") {
            const body = await readBody(req);
            if (body.profile && typeof body.profile === "object") {
              const name = body.profile.name ?? body.profile.username;
              const badge = body.profile.badge ?? body.profile.badge_id;
              if (name || badge) await setProfile({ name, badge });
            }
            if (body.settings && typeof body.settings === "object") {
              const patch = {};
              for (const [apiKey, tomlKey] of STARTUP_FIELD_MAPPING) {
                const value = body.settings[apiKey];
                if (value !== undefined && value !== null) patch[tomlKey] = value;
              }
              const applied = applyStartupPatch(patch);
              if (!applied.ok) return sendJson(res, 400, { ok: false, error: applied.message });
            }
            if (body.ui && typeof body.ui === "object") {
              const uiPatch = {};
              if (["checkpoints", "click", "auto"].includes(body.ui.advanceMode)) uiPatch.advanceMode = body.ui.advanceMode;
              if (typeof body.ui.overlay === "boolean") uiPatch.overlay = body.ui.overlay;
              if (typeof body.ui.richEffects === "boolean") uiPatch.richEffects = body.ui.richEffects;
              if (typeof body.ui.livePlugins === "boolean") uiPatch.livePlugins = body.ui.livePlugins;
              if (typeof body.ui.sourceAssets === "boolean") uiPatch.sourceAssets = body.ui.sourceAssets;
              if (typeof body.ui.pace === "number" && body.ui.pace >= 1 && body.ui.pace <= 4) uiPatch.pace = body.ui.pace;
              if (typeof body.ui.identityLevel === "string") uiPatch.identityLevel = body.ui.identityLevel.slice(0, 24);
              if (typeof body.ui.accessPassword === "string") uiPatch.accessPassword = body.ui.accessPassword.slice(0, 16);
              if (typeof body.ui.renderScale === "number" && body.ui.renderScale >= 1 && body.ui.renderScale <= 3) uiPatch.renderScale = body.ui.renderScale;
              if (Object.keys(uiPatch).length > 0) writeUiSettings(uiPatch);
            }
            return sendJson(res, 200, await statePayload());
          }
          return sendJson(res, 405, { ok: false, error: "method not allowed" });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
        }
      }
    }));

    routeDisposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/dsh-prologue/preview",
      handler: async (req, res) => {
        try {
          if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method not allowed" });
          const body = await readBody(req);
          const result = await startWebPreview({ port: body?.port ?? undefined, silent: body?.silent === true });
          if (result.ok) result.embedUrl = PREVIEW_PROXY_PREFIX + "/startup-preview.html";
          return sendJson(res, result.ok ? 200 : 400, result);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
        }
      }
    }));

    routeDisposers.push(ctx.webServer.register({
      kind: "prefix",
      path: PREVIEW_PROXY_PREFIX,
      handler: async (req, res) => {
        try {
          if (!previewPort) {
            return sendJson(res, 503, { error: "startup preview is not running" });
          }
          const pathname = String(req.url || "/").split("?")[0];
          const upstreamPath = pathname.slice(PREVIEW_PROXY_PREFIX.length) || "/startup-preview.html";
          const ui = readUiSettings();
          const settings = readStoredSettings();

          // Prefer the source-tree assets: the deployed dsh.exe embeds an older,
          // trimmed演出 (half the visual code, two modules missing).
          const rel = upstreamPath.replace(/^\/+/, "");
          if (ui.sourceAssets !== false && rel !== "" && !rel.includes("..") && !rel.includes("\\")) {
            let localBody = null;
            try { localBody = readFileSync(join(STARTUP_ASSETS_DIR, rel)); } catch {}
            if (localBody) {
              const isText = /\.(html|js|css|svg|json|txt|md)$/i.test(rel);
              const out = isText ? patchStartupAsset(rel, localBody.toString("utf8"), ui, settings) : localBody;
              res.writeHead(200, { "content-type": contentTypeOf(rel), "cache-control": "no-store" });
              res.end(out);
              return;
            }
          }

          const upstreamHeaders = {};
          const dropHeaders = [
            "host", "connection", "content-length", "accept-encoding",
            // The compiled host rejects any request that carries a browser
            // Origin/Referer from another port ("Local same-origin request
            // required"), so forward these as a plain server-to-server call.
            "origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"
          ];
          for (const [key, value] of Object.entries(req.headers || {})) {
            if (dropHeaders.includes(String(key).toLowerCase())) continue;
            upstreamHeaders[key] = value;
          }
          // Node's HTTP parser asserts fatally (uncatchable) when an undici response
          // body is left paused while the peer closes the socket, so every upstream
          // request stays cancellable and is aborted the moment the client goes away.
          const upstreamAbort = new AbortController();
          const onClientGone = () => {
            try { if (!res.writableEnded) upstreamAbort.abort(); } catch {}
          };
          try { res.once("close", onClientGone); } catch {}
          try { req.once("aborted", onClientGone); } catch {}
          const requestInit = {
            method: req.method,
            headers: upstreamHeaders,
            redirect: "manual",
            signal: upstreamAbort.signal
          };
          if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
            requestInit.body = await readRawBody(req);
          }
          const upstream = await fetch(`http://127.0.0.1:${previewPort}${upstreamPath}`, requestInit);

          // The compiled host's profile knows only username/badge; add the
          // plugin-owned permission level so the archive card can show it.
          if (upstreamPath === "/api/profile" && upstream.ok && req.method !== "POST") {
            const raw = Buffer.from(await upstream.arrayBuffer()).toString("utf8");
            let payload = null;
            try { payload = JSON.parse(raw); } catch {}
            if (payload && typeof payload === "object") payload.access_level = String(ui.identityLevel || "L2");
            res.writeHead(upstream.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify(payload ?? {}));
            return;
          }

          // The compiled host reports an empty plugin inventory (it only scans
          // the dsh-rust workspace). Splice in the live DSH Desktop plugin list
          // so the animation's phase 4/5 shows what this machine really runs.
          if (upstreamPath === "/api/load" && upstream.ok) {
            const raw = Buffer.from(await upstream.arrayBuffer()).toString("utf8");
            const liveRows = ui.livePlugins === false ? [] : collectLivePlugins(dshHome);
            const outLines = [];
            for (const line of raw.split(/\r?\n/)) {
              if (line.trim() === "") continue;
              let event = null;
              try { event = JSON.parse(line); } catch {}
              if (event && event.type === "complete") {
                for (const row of liveRows) {
                  outLines.push(JSON.stringify({ type: "item", kind: "plugin", name: row.name, source: row.source, status: row.status }));
                }
                event.plugins = liveRows;
                outLines.push(JSON.stringify(event));
                continue;
              }
              outLines.push(line);
            }
            res.writeHead(upstream.status, {
              "content-type": upstream.headers.get("content-type") || "application/x-ndjson",
              "cache-control": "no-store"
            });
            // Stream on line boundaries with yields: one giant write would make
            // the page publish every event inside a single task and stall the
            // canvas for the whole inventory read.
            let chunk = "";
            for (const line of outLines) {
              chunk += line + "\n";
              if (chunk.length >= 16384) {
                res.write(chunk);
                chunk = "";
                await new Promise((resolve) => setImmediate(resolve));
              }
            }
            if (chunk) res.write(chunk);
            res.end();
            return;
          }

          const isTextAsset = /\.(html|js)$/.test(upstreamPath) || upstreamPath === "/";
          let body = upstream.body;
          if (isTextAsset && body) {
            const raw = Buffer.from(await upstream.arrayBuffer()).toString("utf8");
            body = patchStartupAsset(upstreamPath, raw, ui, settings);
          }
          const outHeaders = {
            "content-type": upstream.headers.get("content-type") || "application/octet-stream",
            "cache-control": upstream.headers.get("cache-control") || "no-store"
          };
          res.writeHead(upstream.status, outHeaders);
          if (typeof body === "string") {
            res.end(body);
            return;
          }
          if (body) {
            try {
              for await (const chunk of body) {
                if (res.writableEnded || res.destroyed) break;
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                if (!res.write(buf)) {
                  await new Promise((resolve) => {
                    try { res.once("drain", resolve); } catch { resolve(); }
                  });
                }
              }
            } finally {
              // A half-consumed body must never be left paused: cancel it and drop
              // the upstream socket so Node's parser never sees an unread response.
              if (!res.writableEnded) { try { upstreamAbort.abort(); } catch {} }
              try { if (body.cancel) await body.cancel(); } catch {}
            }
          }
          if (!res.writableEnded) res.end();
        } catch (error) {
          try {
            if (!res.headersSent) sendJson(res, 502, { error: String(error?.message ?? error) });
            else res.end();
          } catch {}
        }
      }
    }));
  }

  ctx.on("dispose", () => {
    disposeExec?.();
    disposeDoctor?.();
    disposeHelp?.();
    disposeSettings?.();
    disposePreview?.();
    disposeNext?.();
    disposeProfile?.();
    for (const disposeRoute of routeDisposers) {
      try { disposeRoute?.(); } catch {}
    }
    const handle = previewHandle;
    previewHandle = null;
    try { handle?.terminate?.(); } catch {}
  });
}
