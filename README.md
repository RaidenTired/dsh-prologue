# dsh-prologue

> **DSH Desktop 的开机序幕** —— 一个把 **dsh-rust**（`deepseek-harness-rust-optimize`）引擎接进 DSH 的 Cordis 插件，同时提供一套完整的 **7 阶段开机演出动画**：可调参数、内嵌预览、语音旁白、身份档案与访问等级。

![license](https://img.shields.io/badge/license-MIT-blue)
![plugin](https://img.shields.io/badge/DSH-Desktop%20Plugin-111)
![platform](https://img.shields.io/badge/platform-Windows-0078d4)

---

## 目录

- [它是什么](#它是什么)
- [功能总览](#功能总览)
- [安装](#安装)
- [使用](#使用)
- [设置项详解](#设置项详解)
- [目录结构](#目录结构)
- [二次开发](#二次开发)
- [常见问题](#常见问题)
- [兼容性与已知限制](#兼容性与已知限制)
- [许可与致谢](#许可与致谢)
- [English](#english)

---

## 它是什么

DSH Desktop 支持 **Cordis 插件**。本插件由两半组成：

| 半边 | 文件 | 职责 |
|---|---|---|
| **宿主侧** | `lib/index.js` | 向 DSH 注册工具、注册 HTTP 路由、下发并对演出资源"打补丁" |
| **客户端侧** | `lib/client.js` | 在 DSH 设置页渲染配置 UI、渲染加载层、承载内嵌预览 |

装上之后你会得到两样东西：

1. **三个引擎工具** —— 在 DSH 对话里直接调用 dsh-rust 引擎；
2. **一套开机演出** —— DSH Desktop 启动时播放的七幕动画，可在设置里调参、预览、改身份。

> 之所以叫 "prologue"（序幕）：它就是主界面出现之前的那一段。

---

## 功能总览

### 1. 引擎工具

| 工具 | 说明 | 备注 |
|---|---|---|
| `dsh_rust_exec` | 用 dsh-rust 引擎执行一次性编码任务，返回最终输出 | 需要 DeepSeek API Key（插件配置 `apiKey` 或环境变量 `DEEPSEEK_API_KEY`）|
| `dsh_rust_doctor` | 运行 dsh-rust 本地诊断（`dsh doctor`） | 排查环境时先跑它 |
| `dsh_rust_help` | 打印 dsh-rust CLI 帮助（命令与全局参数） | — |

> 三个工具**都需要本机可用的 `dsh-rust` 可执行文件**。本仓库不附带编译产物 —— 见 [安装](#安装)。

### 2. 开机演出动画

七幕结构（`startup-sequence.js` 定义时长与检查点）：

```
黑场 → 权限 → 身份验证 → 请求读取 → 读取完成 → 欢迎 → 收尾
 0      1        2           3           4         5      6
```

#### 加载层（演出开始前）

- 主题色深底 + **四角 L 角标**依次脉冲（2.4s 周期）+ 径向暗角
- 中央**进度条**：轨道 `min(46vw, 340px)` × 4px，填充 2.8s 缓动至 96%，内部光泽 1.5s 循环扫过
- 上下两行等宽小字：`LOADING STARTUP SEQUENCE` / `LOCAL HOST / BOOT`

#### 阶段过渡（每次切幕）

- **5 层错峰擦除** + 前导 1px 亮线（领先约 0.1s）
- **三段故障切片**闪（0.17s）
- **径向绽放**闪光（0.5s，中心 50%/44%）
- **四角角标内收再弹回**（0.85s）

#### 各幕看点

| 幕 | 画面 |
|---|---|
| **01** | 破碎的 DSH 三角徽：4 片碎片各自缓慢漂移（±19~58px）|
| **02** | 权限封印 + 缓慢**正转**刻度环（32 刻度 / 约 35s 一圈）|
| **03** | 身份档案卡 + **等级徽标（L1–L6）** + 16 位访问密码**逐位就位**（乱码跳动中逐个锁定，定格后**永久高亮**）|
| **04** | 封印居中 + **反转**刻度环（40 刻度 / 约 63s 一圈）+ L6 读数（横线高光游走）+ **六格等级轨道**高光巡游 |
| **05 / 06** | 能力面板（skills / plugins 实时读取）+ 底部三段信息带（93.8% / 95.8% / 97.2%）+ **就绪冲击波** |
| **07** | 收尾：地平线扫掠 + 强调线**四段逐段描出** |

#### 其他

- **音频**：每幕英文旁白（`assets/voice/phase-*.wav`）+ 每次切幕的短促音效（`drb-transition.wav`）
- **清晰度**：画布渲染倍率 **下限 3×、上限 4×**（细线/弧线/小字更锐利）
- **减动效**：尊重系统"减少动态效果"设置，自动降级为静态构图

### 3. 设置页

DSH 设置 → **dsh-prologue**：

- **演出设置** —— 推进方式 / 叠加层 / 富效果 / 实时插件 / 源资源 / 节奏 / 渲染倍率
- **身份资料** —— 用户名 / 档案编号 / 权限等级（L1–L6）/ 访问密码（最多 16 位）
- **内嵌预览** —— 不重启即可在设置页内直接播放演出

---

## 安装

### 前置条件

- **DSH Desktop**（Windows）
- 若要使用 `dsh_rust_*` 三个工具：本机可用的 **`dsh-rust` 可执行文件**
- 推荐使用 Web 端 profile（本插件按 `profiles/web` 的插件目录约定编写）

### 步骤

1. 下载本仓库，把整个目录放到 DSH 的插件目录，**目录名必须是 `dsh-prologue`**：

   ```
   %APPDATA%\dsh-desktop\harness\plugins\dsh-prologue\
   ```

   完整路径形如：

   ```
   C:\Users\<你>\AppData\Roaming\dsh-desktop\harness\plugins\dsh-prologue
   ```

2. **完全重启 DSH Desktop**（不是刷新窗口 —— 宿主侧代码只在启动时加载）。

3. 打开 **设置 → dsh-prologue**：能看到"演出设置"和"身份资料"两张卡片即安装成功。

4. 打开 **设置 → 插件**：确认列表里出现 `dsh-prologue`。

### 关于 `dsh-rust` 可执行文件

本仓库**不包含** `bin/dsh.exe`（编译产物，约 14 MB，已在 `.gitignore` 中排除）。两种做法：

- **不使用引擎工具**：只想要开机演出 —— 什么都不用做，插件其余部分照常工作；
- **使用引擎工具**：把你自己的 `dsh-rust` 放到：

  ```
  <插件目录>\bin\dsh.exe
  ```

---

## 使用

### 引擎工具

在 DSH 对话里直接说需求即可：

```
用 dsh_rust_exec 帮我把这个脚本改成异步版本
跑一下 dsh_rust_doctor 看看环境是否正常
dsh_rust_help 里有哪些全局参数？
```

### 演出动画

- **推进**：默认点击任意处推进（可在设置里改为自动播放）
- **预览页快捷键**（独立预览 `dsh startup web` 时可用）：

  | 键 | 作用 |
  |---|---|
  | `Enter` / `Space` / 点击 | 推进到下一幕 |
  | `C` | 打开 / 关闭设置面板 |
  | `P` | 暂停 / 继续 |
  | `R` | 重播 |
  | `M` | 静音 |
  | `Esc` | 跳过整段演出 |

- **内嵌演出**（随 DSH 启动播放）会自动隐藏调试控件（右上 `···` 与控制面板），保持画面干净

---

## 设置项详解

| 设置 | 取值 | 默认 | 说明 |
|---|---|---|---|
| **推进方式** | 点击 / 自动 | 点击 | 点击推进更适合"看"；自动播放适合无人值守启动 |
| **叠加层** | 开 / 关 | 开 | 是否绘制演出叠加层（过渡、徽标、读数、进度条等）|
| **富效果** | 开 / 关 | 关 | 更重的粒子/扫掠效果；低配机器建议关 |
| **实时插件** | 开 / 关 | 开 | 05/06 幕是否实时读取当前工作区的 plugins |
| **源资源** | 开 / 关 | 开 | 是否使用插件自带演出素材（关闭则用引擎内置素材）|
| **节奏** | 0.5 ~ 3.0 | 1.5 | 整段演出的播放倍率 |
| **渲染倍率** | 1 ~ 4 | 2 | 画布渲染倍率上限（清晰度与性能取舍）|
| **用户名** | 文本 | `OPERATOR` | 显示在 01 幕抬头与 03 幕档案卡 |
| **档案编号** | 文本 | `DSH-0001` | 形如 `DSH-0001` 的编号 |
| **权限等级** | L1 ~ L6 | L2 | 决定 03 幕徽标颜色/边框/人字/泛光，以及 04 幕六格轨道亮起格数 |
| **访问密码** | 最多 16 位字符 | `Dsh7Rk29Wq41Mn8T` | 03 幕逐位就位的密码；留空则显示"未设置密码" |

> 设置保存在插件目录下的 `ui-settings.json`。**密钥等敏感信息不会写入该文件。**

### 权限等级一览

| 等级 | 徽标名称 | 视觉 |
|---|---|---|
| L1 / L2 | ACCESS LEVEL | 冷灰 / 青灰，单层边框 |
| L3 / L4 | ACCESS LEVEL | 青蓝 / 蓝，双层边框 + 环 |
| L5 | CLEARANCE LEVEL | 紫，人字 + 闪烁 |
| L6 | EXECUTIVE LEVEL | 金，双层边框 + 双眼人字 + 最强泛光 |

---

## 目录结构

```
dsh-prologue/
├─ README.md                    本文件
├─ LICENSE                      MIT（含第三方资源声明）
├─ .gitignore                   排除本机状态与二进制
├─ package.json                 插件清单（name / version / main / exports / dsh）
├─ cordis.patch.yml             Cordis 入口：把本插件插入 DSH 插件链
├─ config.toml                  插件默认配置
├─ runtime-config.toml          运行时配置
│
├─ lib/
│  ├─ index.js                  【宿主】注册工具、注册路由、下发并打补丁演出资源
│  └─ client.js                 【客户端】设置页 UI、加载层、内嵌预览
│
├─ startup-assets/              演出资源（宿主下发给页面）
│  ├─ startup-preview.html      页面骨架 + 全部 CSS
│  ├─ startup-preview.js        演出控制：阶段推进、音频、本机数据、密码动效
│  ├─ startup-visuals.js        全部画面绘制（canvas：徽标、封印、面板…）
│  ├─ startup-sequence.js       七幕时长与检查点
│  ├─ startup-voice.js          旁白播放（按阶段选择 wav）
│  ├─ startup-identity.js       身份与等级定义
│  ├─ startup-local.js          本机数据桥：skills / plugins / 连接状态
│  ├─ startup-embed.js          嵌入模式适配
│  ├─ startup-emblem.js         三角徽几何
│  ├─ startup-text.js           文案
│  └─ assets/
│     ├─ fonts/                 dsh-industrial-sc.woff2（+ OFL 许可）
│     ├─ licenses/              RhineLabUI-MIT.txt
│     ├─ voice/                 旁白 wav × 8 + drb-transition.wav + manifest
│     ├─ dsh-emblem.svg
│     └─ dsh-desktop.ico
│
└─ share/dsh/web/               Web 侧资源
```

---

## 二次开发

### 想改时长 / 节奏

- **单幕时长、检查点**：`startup-assets/startup-sequence.js`
- **整体倍率**：设置页 → 节奏，或 `lib/index.js` 里的 `UI_DEFAULTS.pace`

### 想改画面

- **所有绘制**：`startup-assets/startup-visuals.js`
  - 坐标系是**归一化**的：`unit = min(width, height) / 1000`，`wx(x) = (x - 0.5) * W`、`wy(y) = (y - 0.5) * H`
  - 常用绘制原语：`line / rect / text / emblem`
  - 场景分发顺序：`[blackIntro, permission, verification, requestRead, readComplete, welcome]`
- **宿主侧"打补丁"**：`lib/index.js` 中的 `patchStartupVisuals()` —— 不改原素材，而是用 `out.replace(...)` 在**下发时**覆盖画面参数（改颜色、位置、透明度最方便的地方）

### 想改设置页 / 加载层

- `lib/client.js`
  - 设置卡片：`slots.register({ name: "settings.section" })`
  - 加载层：`BootOverlay`（进度条 + 四角角标 + 暗角）

### 改完记得

1. **客户端改动**（`lib/client.js`）→ 通常热重载即可生效；
2. **宿主改动**（`lib/index.js`、`startup-assets/*`）→ **必须重启 DSH Desktop**；
3. 改完先校验语法，再重启：

   ```powershell
   node --check lib/index.js     # 宿主（ESM）
   node --check lib/client.js    # 客户端
   ```

---

## 常见问题

**Q：重启后没有演出 / 设置页里没有本插件**

1. 确认目录名**严格**是 `dsh-prologue`（大小写、连字符都要一致）；
2. 确认 `%APPDATA%\dsh-desktop\harness\plugins\dsh-prologue\lib\index.js` 存在；
3. 查看日志 `%APPDATA%\dsh-desktop\logs\harness.log`，搜 `dsh-prologue` 或 `loader`；
4. 若日志出现 `still waiting for … plugin entries`，多半是**别的插件**加载失败拖住了 `cordis:include` —— 逐个禁用排查。

**Q：画面模糊**

设置页把**渲染倍率**调到 3~4；并确认显示器缩放为 100%（非 100% 时系统会额外重采样一次）。

**Q：没有声音**

1. 演出开始后需要**一次点击**才能解锁浏览器音频策略；
2. 检查 `startup-assets/assets/voice/*.wav` 是否齐全；
3. 独立预览时可确认面板里的"声音"开关。

**Q：05 / 06 幕的 skills / plugins 是空的**

说明当前工作区没有可读的 skills/plugins，或"实时插件"开关被关掉了。

**Q：密码显示为"未设置"**

说明 `ui-settings.json` 里的 `accessPassword` 为空 —— 在设置页填 1~16 位字符即可。

**Q：改了设置没生效**

- 客户端类设置：刷新设置页；
- 演出类设置（时长、画面）：**重启 DSH Desktop**。

**Q：想彻底卸载**

删掉 `%APPDATA%\dsh-desktop\harness\plugins\dsh-prologue` 整个目录，重启 DSH Desktop。

---

## 兼容性与已知限制

- **平台**：主要在 **Windows + DSH Desktop** 上开发与验证；
- **引擎工具**依赖本机 `dsh-rust` 二进制，仓库默认不附带；
- 演出按 **16:9 横屏**设计；极窄窗口下部分元素按 `@media (max-width: 600px)` 重排，但不保证全部布局；
- 音频是**预生成**的 wav 旁白，不支持替换为系统 TTS；
- 语言：界面与旁白以**英文**为主，注释与文档为中文。

---

## 许可与致谢

- 本插件：**MIT**（见 [LICENSE](LICENSE)）
- **Noto Sans SC** 字体 —— SIL Open Font License 1.1
  （`startup-assets/assets/fonts/OFL-NotoSansSC.txt`）
- **RhineLabUI** 视觉参考 —— MIT
  （`startup-assets/assets/licenses/RhineLabUI-MIT.txt`）
- 演出语音：随仓库提供的 `wav` 旁白文件

---

## English

**dsh-prologue** is a DSH Desktop Cordis plugin with two halves:

- **Host** (`lib/index.js`) — registers three tools that drive the **dsh-rust** engine
  (`dsh_rust_exec`, `dsh_rust_doctor`, `dsh_rust_help`) and serves the startup-animation assets.
- **Client** (`lib/client.js`) — renders the settings page, the boot loader (a slim progress bar),
  and an in-app preview.

On top of that it ships a **7-stage startup animation**
(`black → permission → verification → request → read → welcome → closing`) featuring:

- a progress-bar loader with a sheen sweep and pulsing corner brackets;
- layered stage transitions (5-band wipe, lead hairline, glitch slices, radial bloom);
- synthesized English narration per stage plus a transition cue;
- an identity card with access levels **L1–L6** and a 16-character password that types itself out
  character by character (locked characters stay highlighted);
- **3× supersampled canvas** rendering for crisp hairlines and small type.

**Install** — drop the folder into `%APPDATA%\dsh-desktop\harness\plugins\dsh-prologue` and fully
restart DSH Desktop. The `dsh_rust_*` tools additionally need a local `dsh-rust` binary at
`<plugin>\bin\dsh.exe` (not bundled).

**License** — MIT. Third-party assets: Noto Sans SC (OFL-1.1), RhineLabUI (MIT).
