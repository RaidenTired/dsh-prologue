/* dsh-prologue client bundle: the "开机动画" settings page in the DSH settings UI.
   Data source: same-origin routes served by the host half (/dsh-prologue/*). */
window.__ModuleLoader__.load({
  id: "dsh-prologue",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const { useState, useEffect, useRef } = React;
    let ReactDOM = null;
    try { ReactDOM = require("react-dom"); } catch (e) {}

    const CSS = `
.drb-page{display:flex;flex-direction:column;gap:17px;font-family:var(--ds-font-family-sans,inherit)}
.drb-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:16px 18px}
.drb-card-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);letter-spacing:.2px;margin-bottom:7px}
.drb-card-sub{font-size:11px;line-height:1.75;color:var(--dsw-alias-label-secondary);margin:0 0 13px}
.drb-row{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:12px;color:var(--dsw-alias-label-primary)}
.drb-row input[type=checkbox]{width:15px;height:15px;flex:none;accent-color:var(--dsw-alias-state-success-primary,#4f8cff)}
.drb-range{flex:1;min-width:0;accent-color:var(--dsw-alias-state-success-primary,#4f8cff)}
.drb-value{flex:none;min-width:48px;text-align:right;font:11px var(--ds-font-family-code,monospace);color:var(--dsw-alias-label-secondary)}
.drb-meta{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary)}
.drb-select{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 8px;font-size:12px}
.drb-input{width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:7px 9px;font:12px var(--ds-font-family-code,monospace)}
.drb-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.drb-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.drb-btn{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:7px 14px;font-size:12px;cursor:pointer}
.drb-btn:hover:not(:disabled){border-color:var(--dsw-alias-state-success-primary)}
.drb-btn:disabled{opacity:.5;cursor:default}
.drb-btn-primary{color:var(--dsw-alias-state-success-primary)}
.drb-feedback{font-size:12px;line-height:1.7;min-height:18px}
.drb-ok{color:var(--dsw-alias-state-success-primary)}
.drb-err{color:var(--dsw-alias-state-error-primary)}
.drb-link{color:var(--dsw-alias-state-success-primary);font-size:12px;word-break:break-all}
.drb-stage{width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;background:#0b1116}
.drb-stage iframe{display:block;width:100%;aspect-ratio:16/9;min-height:340px;border:0;background:#0b1116}
.drb-stage-note{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 12px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.drb-boot{position:fixed;inset:0;z-index:2147483000;background:#05090c;transition:opacity .45s ease}
.drb-boot-closing{opacity:0;pointer-events:none}
.drb-boot iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:var(--dsw-alias-bg-base,#0b1116);animation:drbFadeIn .55s ease both}
@keyframes drbFadeIn{from{opacity:0}to{opacity:1}}
.drb-boot-skip{position:absolute;top:18px;right:22px;z-index:1;color:#cfd8dc;background:rgba(10,15,19,.6);border:1px solid rgba(130,151,161,.35);border-radius:9px;padding:7px 14px;font-size:12px;cursor:pointer}
.drb-boot-skip:hover{color:#82bfd2;border-color:#82bfd2}
.drb-boot{position:fixed;inset:0;z-index:2147483000;background:#0b1116;display:flex;align-items:center;justify-content:center}
.drb-boot-emblem{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;transition:opacity .55s ease,transform .55s ease}
.drb-boot-emblem::after{content:'';position:absolute;left:50%;top:50%;width:170px;height:1px;margin:-0.5px 0 0 -85px;background:linear-gradient(90deg,transparent,var(--dsw-alias-label-secondary,#8b979d),transparent);animation:drbSweep 6.2s ease-in-out infinite}
.drb-boot-emblem svg{position:relative;z-index:1;width:104px;height:96px;overflow:visible;opacity:.92;animation:drbFloat 38s ease-in-out infinite}
@keyframes drbFloat{0%,100%{transform:rotate(-1.1deg)}50%{transform:rotate(1.1deg)}}
.drb-boot-emblem::before{content:'';position:absolute;left:50%;top:50%;width:154px;height:154px;margin:-77px 0 0 -77px;border-radius:50%;border:1px dashed var(--dsw-alias-label-secondary,#8b979d);opacity:.18;animation:drbSpin 28s linear infinite;pointer-events:none}
@keyframes drbSpin{to{transform:rotate(360deg)}}
.drb-boot-emblem::after{content:'';position:absolute;left:50%;top:50%;width:118px;height:118px;margin:-59px 0 0 -59px;border-radius:50%;border:1px solid var(--dsw-alias-label-secondary,#8b979d);border-top-color:transparent;border-bottom-color:transparent;opacity:.22;animation:drbSpinBack 17s linear infinite;pointer-events:none}
@keyframes drbSpinBack{to{transform:rotate(-360deg)}}
.drb-boot-progress{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:15px;pointer-events:none}
.drb-progress-label{font:10px/1 var(--ds-font-family-code,Consolas,monospace);letter-spacing:.26em;color:var(--dsw-alias-label-secondary,#8b979d);opacity:.85}
.drb-progress-track{position:relative;width:min(46vw,340px);height:4px;overflow:hidden;background:var(--dsw-alias-border-l1,#2a3439)}
.drb-progress-fill{position:absolute;left:0;top:0;bottom:0;width:2%;background:var(--dsw-alias-state-success-primary,#4f8cff);animation:drbFill 2.8s cubic-bezier(.22,.68,.2,1) forwards}
.drb-progress-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.5),rgba(255,255,255,0));animation:drbSheen 1.5s linear infinite}
.drb-progress-meta{font:9px/1 var(--ds-font-family-code,Consolas,monospace);letter-spacing:.2em;color:var(--dsw-alias-label-secondary,#8b979d);opacity:.55}
@keyframes drbFill{0%{width:2%}55%{width:64%}100%{width:96%}}
@keyframes drbSheen{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.drb-boot-frame{position:absolute;inset:30px;pointer-events:none}
.drb-boot-frame i{position:absolute;width:26px;height:26px;border:0 solid var(--dsw-alias-label-secondary,#8b979d);opacity:.34}
.drb-boot-frame i:nth-child(1){left:0;top:0;border-left-width:1.5px;border-top-width:1.5px}
.drb-boot-frame i:nth-child(2){right:0;top:0;border-right-width:1.5px;border-top-width:1.5px}
.drb-boot-frame i:nth-child(3){left:0;bottom:0;border-left-width:1.5px;border-bottom-width:1.5px}
.drb-boot-frame i:nth-child(4){right:0;bottom:0;border-right-width:1.5px;border-bottom-width:1.5px}
.drb-boot-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 34%,rgba(0,0,0,.42) 100%)}
.drb-boot-grid{position:absolute;inset:0;pointer-events:none;opacity:.055;background-image:linear-gradient(to right,var(--dsw-alias-label-secondary,#8b979d) 1px,transparent 1px),linear-gradient(to bottom,var(--dsw-alias-label-secondary,#8b979d) 1px,transparent 1px);background-size:26px 26px;-webkit-mask-image:radial-gradient(ellipse at 50% 46%,#000 26%,transparent 72%);mask-image:radial-gradient(ellipse at 50% 46%,#000 26%,transparent 72%)}
.drb-boot-frame i{animation:drbTick 2.4s ease-in-out infinite}
.drb-boot-frame i:nth-child(2){animation-delay:.6s}
.drb-boot-frame i:nth-child(3){animation-delay:1.2s}
.drb-boot-frame i:nth-child(4){animation-delay:1.8s}
@keyframes drbTick{0%,72%,100%{opacity:.18}36%{opacity:.62}}
@keyframes drbSweep{0%,100%{transform:translateY(-48px) scaleX(.45);opacity:.08}50%{transform:translateY(48px) scaleX(1);opacity:.38}}
.drb-boot-emblem .drb-shard{fill:none;stroke:var(--dsw-alias-label-primary,#e6edf0);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.drb-boot-emblem .drb-shard-in{fill:none;stroke:var(--dsw-alias-label-secondary,#8b979d);stroke-width:1.5;stroke-linejoin:round}
.drb-boot-emblem .drb-shard-a{animation:drbDriftA 21s ease-in-out infinite}
.drb-boot-emblem .drb-shard-b{animation:drbDriftB 24s ease-in-out infinite}
.drb-boot-emblem .drb-shard-c{animation:drbDriftC 27s ease-in-out infinite}
.drb-boot-emblem .drb-shard-d{animation:drbDriftD 19s ease-in-out infinite}
@keyframes drbDriftA{0%,100%{transform:translate(0,0) rotate(0deg);opacity:.86}50%{transform:translate(-1.2px,1px) rotate(-.5deg);opacity:.66}}
@keyframes drbDriftB{0%,100%{transform:translate(0,0) rotate(0deg);opacity:.82}50%{transform:translate(1.1px,.7px) rotate(.45deg);opacity:.98}}
@keyframes drbDriftC{0%,100%{transform:translate(0,0) rotate(0deg);opacity:.9}50%{transform:translate(.8px,-1.1px) rotate(-.4deg);opacity:.64}}
@keyframes drbDriftD{0%,100%{transform:translate(0,0) scale(1);opacity:.62}50%{transform:translate(-.7px,-.6px) scale(1.02);opacity:.95}}

`;

    const API = "/dsh-prologue";

    function StartupSettingsPage() {
      const [state, setState] = useState(null);
      const [form, setForm] = useState(null);
      const [busy, setBusy] = useState(false);
      const [feedback, setFeedback] = useState(null);
      const [previewEpoch, setPreviewEpoch] = useState(1);

      const load = function () {
        fetch(API + "/startup", { headers: { "cache-control": "no-cache" } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok) throw new Error(data.error || "加载失败");
            setState(data);
            setForm({
              settings: Object.assign({}, data.settings),
              ui: Object.assign({}, data.ui || {}),
              profile: Object.assign({}, data.profile || {})
            });
            setFeedback(null);
            setPreviewEpoch(function (n) { return n + 1; });
            if (!data.preview || !data.preview.running) {
              fetch(API + "/preview", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
                .then(function (r) { return r.json(); })
                .then(function (p) {
                  if (p && p.ok) {
                    setState(function (s) { return Object.assign({}, s, { preview: { running: true, url: p.url, port: p.port, embedUrl: p.embedUrl } }); });
                  }
                })
                .catch(function () {});
            }
          })
          .catch(function (e) { setFeedback({ msg: "加载失败：" + String((e && e.message) || e), ok: false }); });
      };

      useEffect(function () { load(); }, []);

      const flash = function (msg, ok) {
        setFeedback({ msg: String(msg), ok: ok !== false });
        setTimeout(function () { setFeedback(null); }, 5000);
      };

      const post = function (path, body, onOk, onFail) {
        setBusy(true);
        fetch(API + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body || {})
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.ok) onOk(data);
            else onFail(data && (data.error || data.message) ? (data.error || data.message) : "请求失败");
          })
          .catch(function (e) { onFail(String((e && e.message) || e)); })
          .finally(function () { setBusy(false); });
      };

      const saveSettings = function () {
        post("/startup", { settings: form ? form.settings : undefined, ui: form ? form.ui : undefined }, function (data) {
          setState(data);
          flash("设置已保存；推进方式/特效等改动请点“重启预览”后生效", true);
        }, function (msg) { flash("保存失败：" + msg, false); });
      };

      const saveProfile = function () {
        post("/startup", { profile: form ? form.profile : undefined, ui: form ? { identityLevel: form.ui ? form.ui.identityLevel : undefined } : undefined }, function (data) {
          setState(data);
          flash("身份资料已保存", true);
        }, function (msg) { flash("保存失败：" + msg, false); });
      };

      const startPreview = function () {
        post("/preview", {}, function (data) {
          setState(function (s) { return Object.assign({}, s, { preview: { running: true, url: data.url, port: data.port, embedUrl: data.embedUrl } }); });
          setPreviewEpoch(function (n) { return n + 1; });
          flash("预览已重启，动画就在上方面板里（点“开始”即可解锁声音）", true);
        }, function (msg) { flash("预览启动失败：" + msg, false); });
      };

      if (!form) {
        return React.createElement("div", { className: "drb-page" },
          React.createElement("div", { className: "drb-feedback " + (feedback && feedback.ok === false ? "drb-err" : "drb-ok") },
            feedback ? feedback.msg : "正在读取开机动画设置…"));
      }

      const s = form.settings;
      const setField = function (key, value) {
        setForm(function (f) {
          const next = Object.assign({}, f, { settings: Object.assign({}, f.settings, { [key]: value }) });
          return next;
        });
      };
      const setProfileField = function (key, value) {
        setForm(function (f) {
          return Object.assign({}, f, { profile: Object.assign({}, f.profile, { [key]: value }) });
        });
      };
      const setUiField = function (key, value) {
        setForm(function (f) {
          return Object.assign({}, f, { ui: Object.assign({}, f.ui, { [key]: value }) });
        });
      };
      const levelTier = function (value) {        const text = String(value || "").trim();
        const digits = /(\d+)/.exec(text);
        if (digits) return Math.max(1, Math.min(6, Number(digits[1])));
        if (/root|sys/i.test(text)) return 6;
        if (/admin|owner|super/i.test(text)) return 4;
        return 1;
      };
      const chooseLevel = function (value) {
        setUiField("identityLevel", value);
        post("/startup", { ui: { identityLevel: value } }, function () {
          flash("权限等级已设为 " + value + "，第 2 阶段确认动画会按该等级呈现", true);
        }, function (msg) { flash("保存失败：" + msg, false); });
      };

      const checkboxRow = function (key, label, meta) {
        return React.createElement("label", { className: "drb-row" },
          React.createElement("input", {
            type: "checkbox",
            checked: !!s[key],
            onChange: function (e) { setField(key, e.target.checked); }
          }),
          React.createElement("span", null, label),
          meta ? React.createElement("span", { className: "drb-meta" }, meta) : null);
      };

      return React.createElement("div", { className: "drb-page" },
        state && state.preview && state.preview.running
          ? React.createElement("div", { className: "drb-stage" },
            React.createElement("iframe", {
              src: (state.preview.embedUrl || state.preview.url) + "?v=" + (state.assetStamp || "0") + "-" + previewEpoch,
              title: "DSH 开机动画预览",
              allow: "fullscreen; autoplay",
              referrerPolicy: "no-referrer"
            }),
            React.createElement("div", { className: "drb-stage-note" },
              React.createElement("span", null, "动画内点“开始”播放并解锁声音；右上角「···」可切换主题/速度/声音"),
              React.createElement("a", { className: "drb-link", href: state.preview.url, target: "_blank", rel: "noreferrer" }, "新窗口打开 ↗")))
          : null,
        React.createElement("div", { className: "drb-card" },
          React.createElement("div", { className: "drb-card-title" }, "开机动画 · 播放设置"),
          React.createElement("p", { className: "drb-card-sub" }, "设置保存在插件的 config.toml，保存后立即生效于下次播放。"),
          checkboxRow("enabled", "启动时播放", "dsh-rust TUI 开机自动播放"),
          checkboxRow("sound", "语音播报与音效", "英文旁白 + 合成音效"),
          React.createElement("label", { className: "drb-row" },
            React.createElement("span", null, "音量"),
            React.createElement("input", {
              className: "drb-range", type: "range", min: 0, max: 1, step: 0.05,
              value: s.volume,
              onChange: function (e) { setField("volume", Number(e.target.value)); }
            }),
            React.createElement("span", { className: "drb-value" }, Math.round(s.volume * 100) + "%")),
          React.createElement("label", { className: "drb-row" },
            React.createElement("span", null, "速度"),
            React.createElement("input", {
              className: "drb-range", type: "range", min: 0.25, max: 3, step: 0.25,
              value: s.speed,
              onChange: function (e) { setField("speed", Number(e.target.value)); }
            }),
            React.createElement("span", { className: "drb-value" }, s.speed + "×")),
          React.createElement("label", { className: "drb-row" },
            React.createElement("span", null, "主题"),
            React.createElement("select", {
              className: "drb-select", value: s.theme,
              onChange: function (e) { setField("theme", e.target.value); }
            },
              React.createElement("option", { value: "dark" }, "深色"),
              React.createElement("option", { value: "light" }, "浅色"))),
          checkboxRow("interactive", "三段交互", "播放中点击 / Enter / 空格确认"),
          checkboxRow("reducedMotion", "减动效", "显示静态帧代替完整演出"),
          React.createElement("label", { className: "drb-row" },
            React.createElement("span", null, "推进方式"),
            React.createElement("select", {
              className: "drb-select", value: (form.ui && form.ui.advanceMode) || "click",
              onChange: function (e) { setUiField("advanceMode", e.target.value); }
            },
              React.createElement("option", { value: "click" }, "逐段点击推进"),
              React.createElement("option", { value: "checkpoints" }, "三段点击确认"),
              React.createElement("option", { value: "auto" }, "自动连播")),
            React.createElement("span", { className: "drb-meta" }, "点一次前进一阶段")),
          React.createElement("label", { className: "drb-row" },
            React.createElement("span", null, "节奏"),
            React.createElement("input", {
              className: "drb-range", type: "range", min: 1, max: 4, step: 0.25,
              value: (form.ui && form.ui.pace) || 1.5,
              onChange: function (e) { setUiField("pace", Number(e.target.value)); }
            }),
            React.createElement("span", { className: "drb-value" }, ((form.ui && form.ui.pace) || 1.5) + "×"),
            React.createElement("span", { className: "drb-meta" }, "越大越慢")),
          React.createElement("label", { className: "drb-row" },
            React.createElement("input", {
              type: "checkbox",
              checked: !!(form.ui && form.ui.overlay),
              onChange: function (e) { setUiField("overlay", e.target.checked); }
            }),
            React.createElement("span", null, "DSH Desktop 启动遮罩"),
            React.createElement("span", { className: "drb-meta" }, "启动时全屏播放，Esc 可跳过")),
          React.createElement("label", { className: "drb-row" },
            React.createElement("input", {
              type: "checkbox",
              checked: !!(form.ui && form.ui.richEffects),
              onChange: function (e) { setUiField("richEffects", e.target.checked); }
            }),
            React.createElement("span", null, "特效增强"),
            React.createElement("span", { className: "drb-meta" }, "提高粒子/光环密度")),
          React.createElement("label", { className: "drb-row" },
            React.createElement("input", {
              type: "checkbox",
              checked: !!(form.ui && form.ui.livePlugins),
              onChange: function (e) { setUiField("livePlugins", e.target.checked); }
            }),
            React.createElement("span", null, "实时插件清单"),
            React.createElement("span", { className: "drb-meta" }, "把 DSH 实际安装的插件注入动画第四/五阶段")),
          React.createElement("label", { className: "drb-row" },
            React.createElement("input", {
              type: "checkbox",
              checked: !!(form.ui && form.ui.sourceAssets),
              onChange: function (e) { setUiField("sourceAssets", e.target.checked); }
            }),
            React.createElement("span", null, "源码版演出资源"),
            React.createElement("span", { className: "drb-meta" }, "特效完整版（关闭则用 dsh.exe 内置精简版）")),
          React.createElement("label", { className: "drb-row" },
            React.createElement("span", null, "渲染清晰度"),
            React.createElement("input", {
              className: "drb-range", type: "range", min: 1, max: 3, step: 0.5,
              value: (form.ui && form.ui.renderScale) || 2,
              onChange: function (e) { setUiField("renderScale", Number(e.target.value)); }
            }),
            React.createElement("span", { className: "drb-value" }, ((form.ui && form.ui.renderScale) || 2) + "×"),
            React.createElement("span", { className: "drb-meta" }, "超采样倍数，越大越锐利（1=原生）")),
          React.createElement("div", { className: "drb-actions" },
            React.createElement("button", { type: "button", className: "drb-btn drb-btn-primary", disabled: busy, onClick: saveSettings }, "保存设置"),
            React.createElement("button", { type: "button", className: "drb-btn", disabled: busy, onClick: startPreview }, "重启预览"))
        ),
        React.createElement("div", { className: "drb-card" },
          React.createElement("div", { className: "drb-card-title" }, "身份资料"),
          React.createElement("p", { className: "drb-card-sub" }, "显示在动画档案卡里的访问身份、档案编号与权限等级。"),
          React.createElement("div", { className: "drb-grid" },
            React.createElement("label", { className: "drb-row" },
              React.createElement("span", null, "用户名"),
              React.createElement("input", {
                className: "drb-input", maxLength: 24, value: form.profile.username || "",
                onChange: function (e) { setProfileField("username", e.target.value); }
              })),
            React.createElement("label", { className: "drb-row" },
              React.createElement("span", null, "档案编号"),
              React.createElement("input", {
                className: "drb-input", maxLength: 16, value: form.profile.badge_id || "",
                onChange: function (e) { setProfileField("badge_id", e.target.value); }
              })),
            React.createElement("label", { className: "drb-row" },
              React.createElement("span", null, "权限等级"),
              React.createElement("select", {
                className: "drb-select",
                value: "L" + levelTier(form.ui && form.ui.identityLevel),
                onChange: function (e) { chooseLevel(e.target.value); }
              },
                [1, 2, 3, 4, 5, 6].map(function (tier) {
                  const value = "L" + tier;
                  return React.createElement("option", { key: value, value: value }, value);
                }))),
            React.createElement("label", { className: "drb-row" },
              React.createElement("span", null, "访问密码"),
              React.createElement("input", {
                className: "drb-input", maxLength: 16, type: "text", spellCheck: false,
                value: form.ui && typeof form.ui.accessPassword === "string" ? form.ui.accessPassword : "",
                onChange: function (e) { setUiField("accessPassword", e.target.value.slice(0, 16)); }
              }))),
          React.createElement("p", { className: "drb-card-sub" }, "访问密码共 16 位，用于动画里档案卡 03 行的逐位就位演出；留空则使用默认值。"),
          React.createElement("div", { className: "drb-actions" },
            React.createElement("button", { type: "button", className: "drb-btn", disabled: busy, onClick: saveProfile }, "保存资料"))
        ),
        feedback
          ? React.createElement("div", { className: "drb-feedback " + (feedback.ok === false ? "drb-err" : "drb-ok") }, feedback.msg)
          : null);
    }

    function BootOverlay() {
      const [phase, setPhase] = useState("loading");
      const [src, setSrc] = useState(null);
      const channelRef = useRef(null);

      useEffect(function () {
        let alive = true;
        let shown = false;
        try { shown = sessionStorage.getItem("dsh-prologue.boot-shown") === "1"; } catch (e) {}
        if (shown) { setPhase("hidden"); return; }
        const channel = "drb-boot-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-6);
        channelRef.current = channel;

        fetch(API + "/startup", { headers: { "cache-control": "no-cache" } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!alive) return null;
            if (!data || !data.ok) { setPhase("hidden"); return null; }
            if (data.ui && data.ui.overlay === false) { setPhase("hidden"); return null; }
            if (data.preview && data.preview.running && data.preview.embedUrl) return data.preview;
            return fetch(API + "/preview", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
              .then(function (r) { return r.json(); });
          })
          .then(function (p) {
            if (!alive || !p || !p.embedUrl) return;
            setSrc(p.embedUrl + "?embed=1&parentOrigin=" + encodeURIComponent(location.origin) + "&channel=" + channel + "&v=" + Date.now().toString(36));
            setPhase("ready");
          })
          .catch(function () { if (alive) setPhase("hidden"); });

        const dismiss = function () {
          setPhase("closing");
          setTimeout(function () {
            try { sessionStorage.setItem("dsh-prologue.boot-shown", "1"); } catch (e) {}
            setPhase("hidden");
          }, 450);
        };
        const onMessage = function (event) {
          if (event.origin !== location.origin) return;
          const data = event.data;
          if (!data || data.source !== "dsh-startup" || data.channel !== channel) return;
          if (data.type === "complete" || data.type === "skip") dismiss();
        };
        // No visible skip button: Esc closes the mask (the animation page keeps
        // its own skip control inside the "···" settings panel).
        const onKey = function (event) {
          if (event.key === "Escape") dismiss();
        };
        window.addEventListener("message", onMessage);
        window.addEventListener("keydown", onKey, true);
        return function () {
          alive = false;
          window.removeEventListener("message", onMessage);
          window.removeEventListener("keydown", onKey, true);
        };
      }, []);

      if (phase === "hidden") return null;
      // Loading transition: a breathing full triangle emblem instead of a blank
      // mask, then the animation page mounts over it.
      return React.createElement("div", { className: "drb-boot" + (phase === "closing" ? " drb-boot-closing" : "") },
        React.createElement("div", { className: "drb-boot-vignette" }),
        React.createElement("div", { className: "drb-boot-grid", "aria-hidden": "true" }),
        React.createElement("div", { className: "drb-boot-frame", "aria-hidden": "true" },
          React.createElement("i"), React.createElement("i"), React.createElement("i"), React.createElement("i")),
        src
          ? React.createElement("iframe", { src: src, title: "DSH 开机动画", allow: "autoplay; fullscreen" })
          : React.createElement("div", { className: "drb-boot-progress" },
              React.createElement("span", { className: "drb-progress-label" }, "LOADING STARTUP SEQUENCE"),
                React.createElement("span", { className: "drb-progress-track" },
                React.createElement("i", { className: "drb-progress-fill" })),
                React.createElement("span", { className: "drb-progress-meta" }, "LOCAL HOST / BOOT")));
    }

    const plugin = {
      inject: ["slots"],
      apply(ctx) {
        const slots = ctx.get("slots");
        if (slots === undefined) return;

        try {
          window.__dshPrologueApplied = Date.now();
        } catch (e) {}

        let styleEl = null;
        try {
          styleEl = document.createElement("style");
          styleEl.setAttribute("data-plugin-css", "dsh-prologue");
          styleEl.textContent = CSS;
          document.head.appendChild(styleEl);
        } catch (e) {
          console.error("[dsh-prologue] 注入样式失败: " + String((e && e.message) || e));
        }
        ctx.effect(() => () => {
          if (styleEl && styleEl.parentNode) {
            try { styleEl.parentNode.removeChild(styleEl); } catch (e) {}
          }
        });

        slots.inject("settings.section", function () {
          return slots.register(
            { name: "settings.section", id: "dsh-prologue.settings", order: 65, label: "开机动画" },
            function (props) { return React.createElement(StartupSettingsPage, { slotsProps: props }); },
          );
        });

        // DSH Desktop boot overlay: play the startup animation once per GUI
        // session when "启动时播放" is enabled. The iframe runs in embed mode
        // (same-origin proxy) and posts complete/skip back to this window.
        let bootHost = null;
        let bootRoot = null;
        try {
          bootHost = document.createElement("div");
          document.body.appendChild(bootHost);
          bootRoot = ReactDOM.createRoot(bootHost);
          bootRoot.render(React.createElement(BootOverlay));
        } catch (e) {
          console.error("[dsh-prologue] 启动遮罩挂载失败: " + String((e && e.message) || e));
        }
        ctx.effect(() => () => {
          try { bootRoot && bootRoot.unmount(); } catch (e) {}
          try { if (bootHost && bootHost.parentNode) bootHost.parentNode.removeChild(bootHost); } catch (e) {}
        });
      },
    };

    exports.apply = plugin.apply;
    exports.inject = plugin.inject;
    exports.name = "dsh-prologue";
    exports.default = plugin;
    return module.exports;
  },
});
