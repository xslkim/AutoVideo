# HTML 视觉模式 PRD（@visual: html）

> **状态**：草案 v0.2，已按代码评审结论修订（修订记录见文末附录）
> **作者**：调研 + 起草（基于三路 agent 调研结论）
> **范围**：在 AutoVideo 现有 `animation` / `image` / `video` 三种视觉模式之外，新增第四种 `@visual: html` 模式
>
> 注：输入格式已重构为 `visuals.md` + `narration.md`，文中「`--- visual ---` 区段」即 `visuals.md` 对应块的块体；详见 ../AUTHORING.md

---

## 1. 背景与目标

### 1.1 现状

AutoVideo 当前支持三种 `@visual` 模式（[directives.ts:53](../../src/parser/directives.ts)）：

| 模式 | 画面来源 | 动画能力 |
|------|---------|---------|
| `animation` | Claude AI 把自然语言描述转成 React/Remotion 组件 | ✅ 帧驱动（useCurrentFrame） |
| `image` | 文生图 API 或本地图片 | ❌ 静态 |
| `video` | 本地 mp4 文件 | ✅ 但素材是预录制的，不可编程 |

用户在 `visuals.md` 写 `@visual: html` 时被解析器降级为 `animation`（[directives.ts:137-140](../../src/parser/directives.ts)），因为 `html` 不在合法值表里。

### 1.2 用户诉求

> "我应该有一种视觉元素是，通过构建 html 然后渲染截图的模式。用 html 不只是截图，还可以做动画。"

即：**用户希望在 `--- visual ---` 区段直接写 HTML/CSS/JS 源码，由框架渲染成视频画面，既支持静态截图，也支持 CSS/JS 动画。**

### 1.3 为什么现有模式满足不了

- `animation` 模式：用户不能直接写代码，只能写自然语言描述交给 AI 自由发挥，无法精确控制布局/样式/动效。
- `image` / `video` 模式：静态或预录制，无法做"数字滚动""打字机""卡片依次淡入"这类编程动画。
- 用户已有的 HTML/CSS 技能无法复用。

### 1.4 目标

新增 `@visual: html` 模式，满足：

1. **G1 — 直接写代码**：`--- visual ---` 区段内容即 HTML 源码（可内联 CSS/JS），框架原样渲染，不经 AI。
2. **G2 — 支持动画**：CSS `@keyframes` / `transition` / JS `requestAnimationFrame` / `setTimeout` 均可，且帧时序精确、可复现。
3. **G3 — 复用管线**：html 块产出 partial mp4，与现有 Remotion 块一起 ffmpeg concat，缓存按块复用。
4. **G4 — 零额外下载**：复用 Remotion 已安装的 Chrome Headless Shell，不引入大体积浏览器依赖。
5. **G5 — 可引用本地资产**：HTML 中 `<img src="./pic.png">`、`<link href="./style.css">` 等相对路径可解析。
6. **G6 — 产出物与 Remotion 块等价**：partial mp4 必须带**音频轨**（旁白按 enterSec 偏移混入）和**烧入字幕**（样式与 `SubtitleOverlay` 一致），否则 concat 流复制会失败或成片丢旁白（评审发现，详见 §4.5 / §10 / §11.4）。

### 1.5 非目标

- 不做"HTML 转 React 组件"的转换（那是 animation 模式的事）。
- 不支持 HTML 内嵌 `<video>` / `<canvas>` / WebGL 的录屏（v1 限制，见 §13）。
- 不替换 animation 模式，四者并存。

---

## 2. 用户故事

### US-1：静态布局块（最简）

```markdown
>>> 部署方式全景图 #B07
@enter: slide-right
@exit: fade
@visual: html

--- visual ---
<!DOCTYPE html>
<html><head><style>
  body { margin:0; background:#0d1117; font-family:sans-serif; }
  .grid { display:flex; gap:40px; padding:80px; }
  .card { flex:1; background:#161b22; border:1px solid #30363d; border-radius:16px; padding:32px; }
  .card.hl { border-color:#58a6ff; }
  h2 { color:#e6edf3; font-size:38px; }
  p { color:#8b949e; font-size:30px; }
</style></head><body>
  <div class="grid">
    <div class="card"><h2>PyTorch</h2><p>研究验证</p></div>
    <div class="card hl"><h2>vLLM</h2><p>生产高并发</p></div>
    <div class="card"><h2>llama.cpp</h2><p>个人单机</p></div>
  </div>
</body></html>

--- narration ---
部署大模型 主流有三条路线
...
```

**期望**：三张卡片横向布局，按块时长（由旁白决定）静态显示，`@enter`/`@exit` 动画作用于整块画面；旁白与字幕与 Remotion 块一致。

### US-2：带 CSS 动画的块

```markdown
>>> 实战：编译与启动 #B09
@visual: html

--- visual ---
<!DOCTYPE html>
<html><head><style>
  @keyframes type { from { width:0 } to { width:100% } }
  .line { overflow:hidden; white-space:nowrap; animation: type 2s steps(40) forwards; }
  .line:nth-child(2) { animation-delay: 2s; }
  ...
</style></head><body>
  <div class="terminal">
    <div class="line">$ git clone https://github.com/ggml-org/llama.cpp</div>
    <div class="line">$ cmake -B build -DGGML_CUDA=ON</div>
    ...
  </div>
  <script>
    // 框架约定的 seek 钩子（§5）：把 CSS 动画 seek 到第 t 秒
    window.__seek = function(t) {
      document.getAnimations().forEach(a => { a.pause(); a.currentTime = t * 1000; });
    };
  </script>
</body></html>

--- narration ---
接下来 我们在一张 3090 上实战
...
```

**期望**：终端命令逐行打字机效果，时序与旁白节奏对齐。

### US-3：带 JS 动画的块（数字滚动）

```markdown
>>> 实战：接口验证与性能 #B10
@visual: html

--- visual ---
<!DOCTYPE html>
<html><head><style>...</style></head>
<body>
  <div id="speed">9.5</div>
  <script>
    // 框架约定的 seek 钩子：把画面 seek 到第 t 秒
    window.__seek = function(t) {
      // t 从 0 到块时长（秒）
      const v = t < 4.5 ? 9.5 : 9.5 + (35.0 - 9.5) * Math.min(1, (t - 4.5) / 1.0);
      document.getElementById('speed').textContent = v.toFixed(1);
    };
  </script>
</body></html>

--- narration ---
用 curl 发一个聊天请求
...
```

**期望**：`speed` 数字在 t=4.5s 后从 9.5 滚动到 35.0，帧精确。

### US-4：引用外部 HTML 文件

```markdown
>>> 架构图 #B05
@visual: html(./architecture.html)

--- visual ---
（此描述仅作文档参考，实际使用 ./architecture.html）

--- narration ---
...
```

**期望**：从项目目录加载 `architecture.html`，效果同 US-1。

---

## 3. 语法设计

### 3.1 指令语法

| 写法 | 含义 |
|------|------|
| `@visual: html` | 内联模式：`--- visual ---` 区段内容即 HTML 源码 |
| `@visual: html(./path.html)` | 外部文件模式：加载指定 `.html` 文件，`--- visual ---` 描述仅作文档 |

与现有 `image(./path)` / `video(./path)` 语法对齐（[directives.ts:122-143](../../src/parser/directives.ts)）。

### 3.2 `--- visual ---` 内容语义

| 模式 | `--- visual ---` 内容 |
|------|----------------------|
| `animation` | 自然语言描述（送 Claude AI） |
| `image` | 文生图 prompt |
| `video` | 文档说明（不参与生成） |
| **`html`（新增）** | **HTML 源码原文**（`<!DOCTYPE html>...` 或片段） |
| **`html(./path)`（新增）** | 文档说明（不参与生成，实际用外部文件） |

### 3.3 HTML 源码约定

**v1 采用 seek-hook 双轨约定**（详见 §5）：

- **静态档**（无动画）：HTML 任意写，框架渲染首帧截图并保持整块时长。无需任何约定。
- **动画档**（推荐）：HTML 暴露 `window.__seek(seconds: number): void` 全局函数。框架按 fps 逐帧调用 `__seek(i/fps)`，HTML 内部把画面（含 CSS 动画 via Web Animations API、JS 状态）seek 到 t 时刻。框架提供模板。
- **兼容档**（v2，可选）：HTML 不暴露 `__seek` 但含 CSS 动画时，框架注入虚拟时钟脚本 seek CSS 动画。v1 不实现，遇到此情况降级为静态档并打 warning（warning 文案明确告知"CSS 动画将只在首帧定格"）。

### 3.4 内联模式的解析约束（重要）

`--- visual ---` 区段由行级标记切分（[blocks.ts:126-137](../../src/parser/blocks.ts)），遇到以下两种**独立成行**的内容即结束：

- 裸 `---` 行
- `--- <word> ---` 形式的行（如 `--- narration ---`）

因此**内联 HTML 中禁止出现上述独立行**。HTML 注释 `<!-- ... -->`、`<hr>`、行内的 `---` 均不受影响。另外 `>>>` 开头的行会被当作新块起点，同样禁止出现在行首。

违反时不是报错而是**静默截断**，因此：

- compile 阶段对内联 HTML 做标记行扫描，发现即报错并提示改用 `@visual: html(./path.html)` 外部文件模式；
- 文档建议：含复杂内容（尤其是 Markdown 风格分隔线、YAML 示例）的 HTML 一律用外部文件模式。

---

## 4. 架构决策（技术选型）

### 4.1 选定方案：路线 A — Headless Chrome 逐帧截图 + ffmpeg 合 partial mp4

**为什么不是 Remotion 内嵌（路线 B）**：Remotion 官方明确禁止 CSS 动画与 JS 定时器（多 tab 并行 + 墙上时钟 → 帧时序不保证，[Flickering 文档](https://www.remotion.dev/docs/flickering)）。用户要"html 做动画"，B 直接撞墙。

**为什么不是 html2canvas（路线 C）**：保真度差（flexbox/grid 不全）、不支持 JS 动画、太慢。

### 4.2 渲染流程（html 块）

```
HTML 文件 (compile 阶段统一落盘为 build/<slug>/public/html/{blockId}.html)
   │
   ▼
[html 渲染器] puppeteer-core + Remotion Chrome Headless Shell
   │  1. 启动 headless Chrome（§4.3 解析链，headless: 'shell'）
   │  2. page.setViewport({ width, height, deviceScaleFactor: 1 })   ← 截图尺寸 = viewport
   │  3. page.goto(file://.../{blockId}.html)
   │  4. 注入框架层：#__av-wrapper 包裹 + 字幕层 + window.__av（§5.4 / §11）
   │  5. 探测 window.__seek（waitForFunction 容忍 defer 脚本，§5.1）
   │  6a. 动画档：for i in [0..frames) {
   │        evaluate(t => window.__seek(t), i/fps)
   │        更新框架层（enter/exit 变换 + 当前字幕行）
   │        等 2×rAF → screenshot PNG → 写 ffmpeg stdin（注意 drain 背压）
   │      }
   │  6b. 静态档：screenshot 一次，ffmpeg -loop 1 重复到块时长
   │  7. 音频：块 WAV 按 enterSec 偏移混入（§10.2）——不可省略
   ▼
ffmpeg -f image2pipe -i -  -i {block}.wav  →  partial mp4（视频 h264 + 音频 aac）
   │  （编码参数严格对齐 Remotion renderMedia 输出，见 §10）
   ▼
output/partials/{blockId}.mp4  ← 与 Remotion 块的 partial 同目录同格式
```

### 4.3 Chrome 复用策略

- 依赖：`puppeteer-core`（~28MB JS，**不下载浏览器**），pin `^24`（实测驱动 Chrome for Testing 134，见 §15.2 Q4）。
- **浏览器解析链**（优先级从高到低）：
  1. `config.render.browser`（用户已配置的浏览器路径，与 Remotion 渲染共用同一配置项）
  2. `@remotion/renderer` 的 `ensureBrowser()` —— 返回 `BrowserStatus`，`type === 'local-puppeteer-browser' | 'user-defined-path'` 时取 `.path`（指向 `node_modules/.remotion/chrome-headless-shell/...`，本仓库当前为 **Chrome for Testing 134.0.6998.35**，Remotion 4.0.380）
  3. 环境变量 `PUPPETEER_EXECUTABLE_PATH`
  4. 系统 `google-chrome` / `chromium`，打 warning 提示确定性可能下降
- 启动参数用 `headless: 'shell'`（puppeteer 22+ 驱动 chrome-headless-shell 的专用模式），**不是** `headless: 'new'`。
- 不用 `puppeteer`（含 Chromium 下载，~300MB）。

### 4.4 为什么不用 `HeadlessExperimental.beginFrame`

`puppeteer-capture` 等库用 CDP `beginFrame` 做确定性按需取帧，但 chrome-headless-shell 自 147 起移除相关支持（[hyperframes#296](https://github.com/heygen-com/hyperframes/pull/296)），且在 134 上该路径亦不稳定（headless shell 的 BeginFrame 调度语义与完整 Chrome 不同）。逐帧 `screenshot()` + seek 是最稳方案；性能损失（估算 ~1-3 分钟/20 秒块，取决于帧率与页面复杂度）可接受，且有块级缓存兜底。

### 4.5 与现有管线的关系

```
                     ┌── animation/image/video 块 → Remotion renderMedia → partial mp4 ─┐
script.json blocks ──┤        （画面 + 字幕 + 音频，全部烧进/混进 partial）               ├─→ ffmpeg concat (-c copy) → final.mp4
                     └── html 块 → puppeteer 渲染器 → partial mp4 ──────────────────────┘
                              （同样必须含：画面 + 字幕层 + 音频轨）
```

html 块**不走 Remotion**，在 render 阶段按 visualMode 分流，独立产出 partial mp4 后并入同一套 concat。

**关键事实（评审确认）**：现有 partial 不是纯视频——`BlockComposition` 内 `SubtitleOverlay` 烧字幕、`<Sequence from={enterFrames}><Audio/></Sequence>` 混音频（[VideoComposition.tsx:237-254](../../remotion/VideoComposition.tsx)），concat 用 `-c copy` 流复制（[concat.ts:206-217](../../src/render/concat.ts)）。concat demuxer 要求所有输入的流结构一致，因此 html partial **必须同样携带 AAC 音频轨**，且字幕必须自行烧入。这两条是正确性前提，不是增强项。

---

## 5. seek-hook 约定（动画档）

### 5.1 框架侧行为

渲染器加载 HTML 后探测 `__seek`：

```typescript
// 容忍 defer/async 脚本：最多等 2s
const hasSeek = await page
  .waitForFunction(() => typeof (window as any).__seek === 'function', { timeout: 2000 })
  .then(() => true)
  .catch(() => false);
```

- **`true`** → 动画档：逐帧 `page.evaluate((t) => (window as any).__seek(t), i / fps)`，随后更新框架层（enter/exit + 字幕，§11），等 2 个 `requestAnimationFrame`（确保样式落定），`page.screenshot({ type: 'png' })`。
- **`false`** → 静态档：screenshot 一次，`-loop 1` 重复到块时长。若 HTML 含 CSS 动画/transition（`document.getAnimations().length > 0` 探测），打 warning（§3.3 兼容档降级）。

等 rAF 的实现：

```typescript
await page.evaluate(() => new Promise(r =>
  requestAnimationFrame(() => requestAnimationFrame(r))
));
```

### 5.2 用户侧约定

用户在 `<script>` 里定义：

```javascript
window.__seek = function(t) {
  // t: 当前时间（秒），范围 [0, 块时长]
  // 在此把画面状态设到第 t 秒
};
```

**硬性要求**：

- **幂等**：同一 `t` 调用任意多次，画面必须一致（重试、静态探测都可能重复调用）。
- **同步完成**：`__seek` 返回时画面状态必须已设定（样式重算由随后的 2×rAF 保证）。不允许在 `__seek` 里 `setTimeout`/`fetch`。
- **纯函数化**：`__seek(t)` 的效果只取决于 `t`，不取决于调用历史（即"seek"而非"step"）。

**处理 CSS 动画的标准范式**（框架在文档/模板里提供）：

```javascript
window.__seek = function(t) {
  const ms = t * 1000;
  document.getAnimations().forEach(a => {
    a.pause();
    a.currentTime = ms;  // seek 所有 @keyframes / transition 到 t 时刻
  });
  // 用户自定义 JS 状态同步
  document.getElementById('speed').textContent = computeSpeed(t).toFixed(1);
};
```

`document.getAnimations()` 自 Chrome 84 起可用，覆盖 CSS Animations + Transitions + Web Animations API。

### 5.3 `window.__av` 上下文对象

渲染器在首次 `__seek` 前注入只读上下文（对齐 animation 模式的 `AnimationProps` 契约）：

```javascript
window.__av = {
  width, height, fps,        // 画布参数
  durationSec,               // 块总时长（秒）
  subtitleSafeBottom,        // 底部字幕安全区高度（px）——内容不要伸进这个区域
  theme,                     // 主题名（如 'dark-code'）
  lineTimings,               // [{ startSec, endSec }] 每行旁白的块内相对秒——
                             // 对齐 animation 模式 AnimationProps.lineTimings 契约
};
```

用户 HTML 可据此自适应布局（例如把底部留白设为 `subtitleSafeBottom`）。

`lineTimings` 是旁白同步契约（与 animation 模式同源）：`__seek(t)` 内取最后一个 `startSec <= t` 的行（行间静音间隙保持上一行状态），即可让高亮/推进跟随旁白逐行切换，且旁白重新合成后自动对齐。HTML 块的视觉描述同样适用 `docs/AUTHORING.md`「与旁白同步的节拍」的写法约束；Phase 2 落地时，compile 阶段的 `absolute-beat` / `missing-mapping` 告警（`src/compile/sync-lint.ts`）应扩展覆盖 html 块。

### 5.4 模板支持

框架提供 `templates/html-block/` 两个模板：
- `static.html` — 静态布局模板（无 `__seek`）
- `animated.html` — 动画模板（含 `__seek` 骨架 + CSS 动画 seek 范式 + `__av` 用法示例）

`autovideo init` 生成的项目模板里可含 html 块示例。

---

## 6. 管线集成（逐文件改动）

### 6.1 类型层 — [src/types/script.ts](../../src/types/script.ts)

```typescript
// L26
export type VisualMode = 'animation' | 'image' | 'video' | 'html';

// Block.visual 新增
visual: {
  description: string;
  componentPath?: string;
  imagePath?: string;
  videoPath?: string;
  htmlPath?: string;       // 新增：html 文件在 build 目录的相对路径
};

// Block 新增可选字段（对齐 imageSource/videoSource）
htmlSource?: string;       // html(./path) 模式下的源文件路径
```

`isVisualReady`（[script.ts:313-324](../../src/types/script.ts)）新增分支：

```typescript
if (b.visualMode === 'html') {
  // html 模式：需要 htmlPath（compile 阶段写入），不需要 componentPath
  return b.visual.htmlPath !== undefined && typeof b.visual.htmlPath === 'string';
}
```

`assertVisualsReady`（[script.ts:331+](../../src/types/script.ts)）的报错文案同步加 html 分支。

**关键决策**：html 块**不生成 Component.tsx**，因此 `componentPath` 可空。这要求 `render-blocks.ts` 放宽校验（见 §6.5）。

### 6.2 解析层 — [src/parser/directives.ts](../../src/parser/directives.ts)

```typescript
// L53
const VALID_VISUAL_MODES = ["animation", "image", "video", "html"];

// L122 case "visual" 内，照葫芦画瓢加 html(./path) 匹配
const htmlMatch = value.match(/^html\((.+?)\)$/);
if (htmlMatch) {
  visualMode = "html";
  htmlSource = htmlMatch[1].trim();
} else if (imgMatch) { ... }
```

`ParsedDirectives` 增加 `htmlSource?: string`，`RawBlock`（blocks.ts）同步透传。

### 6.3 compile 层 — [src/cli/compile.ts](../../src/cli/compile.ts)

照 [compile.ts:302-395](../../src/cli/compile.ts) 的 image/video 套路，新增 html 处理，但有三处**必须注意的差异**：

1. **跳过文本类后处理**：`scaleFontMentions`（其 `FONT_MENTION` 正则会匹配 `font-size: 24px`，会擅自改写用户 CSS）和 `processAssets` 的通用描述重写对 html 块**一律跳过**——description 是代码不是散文，资产由专用的 `processHtmlAssets` 处理（§7.1）。
2. **htmlSource 走 processAssets 收集**：`html(./path)` 的源文件路径要像 `imageSource`/`videoSource` 一样加入 `BlockForAssets` 并被重写为 `assets/{hash}.html`（[assets.ts:253-260](../../src/parser/assets.ts) 的收集逻辑），compile 再从 `public/assets/` 读出。直接 `join(outDir, 'public', 原始路径)` 会找不到文件。
3. **标记行校验**：内联 HTML 扫描裸 `---` / `--- word ---` / 行首 `>>>`，命中即报错（§3.4）。

```typescript
// Step 7.7: Set up local html blocks
for (const block of scriptBlocks) {
  if (block.visualMode !== 'html') continue;

  const htmlDir = join(outDir, 'public', 'html');
  mkdirSync(htmlDir, { recursive: true });

  let htmlContent: string;
  if (block.htmlSource) {
    // html(./path) 模式：htmlSource 已被 processAssets 重写为 assets/{hash}.html
    htmlContent = readFileSync(join(outDir, 'public', block.htmlSource), 'utf-8');
  } else {
    // 内联模式：visual.description 即 HTML 源码（未经 scaleFontMentions/processAssets）
    htmlContent = block.visual.description;
    assertNoMarkerLines(htmlContent, block.id);   // §3.4 校验
  }

  // 提取并复制 HTML 内引用的本地资产，重写引用路径（§7.1）
  const rewritten = processHtmlAssets(htmlContent, { block, outDir, sourceDir });

  const destPath = join(htmlDir, `${block.id}.html`);
  writeFileSync(destPath, rewritten, 'utf-8');
  block.visual.htmlPath = `public/html/${block.id}.html`;
}
```

**不写 Component.tsx，不设 componentPath**。html 块在 visuals 阶段也跳过。

### 6.4 visuals 层 — [src/cli/visuals.ts](../../src/cli/visuals.ts)

[visuals.ts:375-379](../../src/cli/visuals.ts) 的 video 跳过分支旁加 html 跳过：

```typescript
// ── Html mode: already set up by compile, skip ──────────────────
if (block.visualMode === 'html') {
  console.log(`  Block ${blockLabel}: local html already set up by compile`);
  return;
}
```

### 6.5 render 层 — [src/render/render-blocks.ts](../../src/render/render-blocks.ts)

**核心改动**：[render-blocks.ts:149-300](../../src/render/render-blocks.ts) 的 per-block 渲染循环里，按 visualMode 分流。**分流点必须在 componentPath 校验（L160-163）之前**，且 html 块走完整的缓存路径（不是跳过缓存）：

```typescript
const renderTasks = script.blocks.map((block: Block) => {
    return limiter(async () => {
    // ... aborted 检查、partialPath 计算、isForce 判定、CacheStore 构建 ...

    if (block.visualMode === 'html') {
      // ── html 块：puppeteer 渲染器，独立缓存 key（§9.1）──
      const partialKey = buildHtmlPartialKey(block, script, config);  // html 内容哈希 + 音频哈希 + ...
      if (!isForce) {
        const cached = await cache.get('partial', partialKey);
        if (cached) { copyFile(cached, fullPartialPath); /* push cacheHit:true */ return; }
      }
      await renderHtmlBlock(block, {
        buildDir, meta: script.meta, theme: resolveTheme(script.meta.theme),
        quality, outputMp4Path: fullPartialPath, config, signal: cancelSignal,
      });
      await cache.put('partial', partialKey, fullPartialPath, partialKey);
      results.push({ id: blockId, partialPath, cacheHit: false });
      return;
    }

    // ── Remotion 块：原有逻辑，componentPath 校验只到这里才执行 ──
    if (!block.visual.componentPath) {
      throw new Error(`Block ${blockId} has no componentPath`);
    }
    // ... 原有 selectComposition + renderMedia ...
  });
});
```

**注意**：Remotion 的 `bundle()`（[render-blocks.ts:126](../../src/render/render-blocks.ts)）每次运行执行一次（不是每块）；若整脚本全是 html 块，应跳过 bundle 以省时间（优化项）。

### 6.6 新增 html 渲染器 — `src/render/html-render.ts`（新文件）

```typescript
export interface RenderHtmlBlockOptions {
  buildDir: string;
  meta: Script["meta"];        // width/height/fps/theme/subtitleSafeBottom
  theme: Theme;                // 字幕层样式 + 背景色的单一来源（§11.4）
  quality: QualityConfig;      // 编码参数（§10）
  outputMp4Path: string;       // 绝对路径
  config: AutoVideoConfig;     // htmlRender 段（§12.1）
  signal?: AbortSignal;
}

export async function renderHtmlBlock(
  block: Block,                // 含 visual.htmlPath / audio / timing / narration.lines
  opts: RenderHtmlBlockOptions
): Promise<void> {
  // 1. 解析 htmlPath → 绝对路径；读 block.audio.wavPath / block.timing
  // 2. 按 §4.3 解析链启动 puppeteer-core（headless: 'shell'）
  // 3. setViewport({ width: meta.width, height: meta.height, deviceScaleFactor: 1 })
  // 4. goto(file://htmlPath)；注入框架层（wrapper + 字幕层 + window.__av）
  // 5. 探测 __seek → 动画档逐帧截图 / 静态档单帧 -loop 1
  // 6. ffmpeg：image2pipe 视频流 + 块 WAV（adelay=enterSec, apad, -t totalSec）→ mp4（§10.2）
  // 7. 关闭 browser；失败时关闭并抛错（由 render-blocks 的重试/中止逻辑接管）
}
```

实现要点：

- **stdin 背压**：PNG 写 ffmpeg stdin 时检查 `write()` 返回值，为 `false` 则等 `drain`。
- **每块一个 browser 实例**：块间隔离，崩溃不传染；块内单 page。
- **并发**：v1 复用 `render.blockConcurrency` 的 limiter（与 Remotion 块同一队列），不单设 html 并发（见 §12.1）。
- **取消**：`signal` 触发时 kill ffmpeg 子进程 + 关闭 browser。

### 6.7 改动文件清单

| 文件 | 改动 | 难度 |
|------|------|------|
| `src/types/script.ts` | `VisualMode` 加 `'html'`；`Block.visual.htmlPath?`；`Block.htmlSource?`；`isVisualReady` / `assertVisualsReady` 加 html 分支 | 低 |
| `src/parser/directives.ts` | `VALID_VISUAL_MODES` 加 `"html"`；`html(./path)` 正则匹配；`ParsedDirectives.htmlSource` | 低 |
| `src/parser/blocks.ts` | `RawBlock.htmlSource` 透传 | 低 |
| `src/parser/assets.ts` | `BlockForAssets.htmlSource` 收集+重写（对齐 imageSource）；新增 `processHtmlAssets`（src=/href=/url() 提取，§7.1） | 中 |
| `src/cli/compile.ts` | 新增 Step 7.7；**html 块跳过 scaleFontMentions 与 processAssets 描述重写**；标记行校验 | 中 |
| `src/cli/visuals.ts` | html 模式跳过分支 | 低 |
| `src/render/render-blocks.ts` | per-block 分流（在 componentPath 校验之前）；html 缓存路径；全 html 脚本跳过 bundle | 中 |
| `src/render/html-render.ts` | **新文件**：puppeteer 逐帧渲染器 + 框架层注入 + ffmpeg 合 mp4（含音频） | 高 |
| `src/render/html-frame-layer.ts` | **新文件**：enter/exit 映射 + 字幕层 DOM/样式生成（从 theme tokens） | 中 |
| `src/cache/store.ts` | partial 缓存 key 支持 html（html 内容哈希代替 componentHash，§9.1） | 低 |
| `src/config/defaults.ts` | `AutoVideoConfig.htmlRender` 配置段 + 默认值（§12.1） | 低 |
| `schemas/script.schema.json` | `visualMode` enum 加 `"html"`（L82-87）；`Block.visual.htmlPath`、`Block.htmlSource` 属性 | 低 |
| `server/types/api.ts` | `VisualMode`（L33）加 `'html'` | 低 |
| `server/routes/blocks.ts` | visual-mode 接口（L189-270）的 mode 枚举同步 | 低 |
| `package.json` | 加 `puppeteer-core` ^24 依赖 | 低 |
| `docs/AUTHORING.md` | 新增 `@visual: html` 章节 + seek-hook 约定 + §3.4 解析约束 | 中 |
| `templates/html-block/` | 新增 html 块模板（static.html / animated.html） | 低 |
| `web/` 前端 | 块详情视觉模式下拉加 `html`；v1 用纯文本编辑器即可 | 低 |
| `tests/` | directives/compile/processHtmlAssets/缓存 key/enter-exit 映射的单测 | 中 |

**已知限制（v1）**：Remotion Studio 预览（`src/preview/`）中 html 块无 Component.tsx，显示 placeholder；后续可用 Phase 1 的静态截图做预览缩略图。

---

## 7. 资产处理

### 7.1 HTML 引用本地资产

HTML 中可能写：

```html
<img src="./assets/logo.png">
<link rel="stylesheet" href="./style.css">
<script src="./logic.js"></script>
<style> .hero { background: url('./bg.png') } </style>
```

**路径基准**：相对于 `visuals.md` 所在目录（与 image/video 模式一致）。

**分工**（评审修订，避免与通用流程重复/冲突）：

- 通用 `processAssets` 的 `LOCAL_PATH_REGEX`（[assets.ts:64](../../src/parser/assets.ts)）要求路径前是空白或 `(`，**不会**匹配 HTML 属性里带引号的 `./x.png`，但**会**匹配无引号的 `url(./x.png)`——行为不一致，因此 html 块整体跳过通用重写（§6.3）。
- 专用 `processHtmlAssets` 处理 html 块的全部资产：

1. 扫描 HTML 文本，提取三类本地引用（`./` 或 `../` 开头，非 `http`/`data`/`blob`）：
   - `src="..."` / `src='...'`（img/script/source 等）
   - `href="..."` / `href='...'`（link）
   - CSS `url(...)`（引号可有可无，含内联 `<style>` 与 `style=` 属性）
2. 对每个资产：哈希复制到 `build/<slug>/public/html-assets/<hash>.<ext>`（与现有图片哈希复制逻辑一致，全局去重）。
3. **重写为绝对 `file://` 路径**（`file://{buildDir}/public/html-assets/<hash>.<ext>`）：不依赖 `<base>` 标签的解析时机，最不容易错。
4. 渲染时 `file://` 加载 + `--allow-file-access-from-files`（§8.2），绝对路径无相对解析问题。

### 7.2 字体

- 系统字体（如 `Noto Sans SC`）：要求渲染环境已安装（与 Remotion 一致）。
- `@font-face` 引用本地 `.woff2`：走 §7.1 资产复制流程（`url()` 提取覆盖）。
- Google Fonts 等 CDN 引用：v1 **禁用**（离线渲染 + 确定性），扫描到 `http(s)://` 引用打 warning（实际请求会被 §8.2 拦截）。

### 7.3 内联 vs 外部资产

鼓励用户内联 CSS/JS（`<style>` / `<script>`），减少资产复制复杂度。模板默认内联。

---

## 8. 安全沙箱

### 8.1 风险

用户 HTML 中的 `<script>` 在 headless Chrome 里执行，风险：
- 网络请求（外泄数据、非确定性）
- **本地文件读取并渲染进成片**（`fetch('file:///etc/passwd')` 后 `textContent = ...`，数据泄进视频）——评审发现，原方案 `--disable-web-security` + 放行 `file://` 直接开了这个洞
- 无限循环 / 高 CPU（DoS）

### 8.2 防护措施

puppeteer 启动参数与页面级隔离：

```typescript
browser = await puppeteer.launch({
  executablePath: resolvedChromePath,      // §4.3 解析链
  headless: 'shell',                        // chrome-headless-shell 专用模式
  args: [
    '--no-sandbox',                         // 容器内必需
    '--allow-file-access-from-files',       // 允许 file:// 子资源（本地资产）；比 --disable-web-security 窄
    '--block-new-web-contents',
    '--disable-features=SitePerProcess',
  ],
});

await page.setRequestInterception(true);
const allowedRoot = path.resolve(buildDir);   // file:// 白名单根
page.on('request', (req) => {
  const url = req.url();
  if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') {
    return req.continue();
  }
  if (url.startsWith('file:')) {
    // 仅放行 build 目录内的文件，防 <img src="file:///etc/passwd"> 式读取
    const p = path.resolve(decodeURIComponent(new URL(url).pathname));
    return p.startsWith(allowedRoot + path.sep)
      ? req.continue()
      : req.abort('blockedbyclient');
  }
  // http/https 全禁：离线 + 确定性
  req.abort('blockedbyclient');
});
```

- **网络全禁**：拦截所有 `http:` / `https:` 请求（保证离线 + 确定性）。
- **file:// 白名单**：仅 build 目录内路径可加载，阻断本地文件泄入成片。
- **超时**：每帧 `page.screenshot` 超时 30s，`__seek` evaluate 超时 5s，超时即报块失败。
- **不依赖现有 tsc/esbuild 沙盒**（[visuals.ts](../../src/cli/visuals.ts) 里 animation 模式的沙盒）：html 不经编译，Chrome 进程 + 请求拦截即隔离边界。

### 8.3 v1 限制（明示给用户）

- 禁止 `<video>` / `<canvas>` / WebGL / iframe 嵌套（检测到打 warning，渲染可能空白）。
- 禁止 `fetch` / `XMLHttpRequest` 到外部（被拦截）。
- 禁止 `localStorage` / `IndexedDB`（headless 每次新会话，不可靠）。

---

## 9. 缓存策略

### 9.1 partial 缓存 key（html 块）

[render-blocks.ts:185-199](../../src/render/render-blocks.ts) 的 `PartialKey` 对 html 块改造：

```typescript
const partialKey: PartialKey = {
  componentHash: md5(rewrittenHtmlContent),   // html 内容哈希（资产重写后版本，资产内容变化 → 哈希变）
  audioHash: md5(blockWav),                   // 同现有——旁白/时序变化 → 重渲染
  theme: script.meta.theme,
  width, height, fps,
  enter, exit,
  remotionVersion: chromeVersion,             // 字段复用：html 块放 browser.version()（Chrome 升级 → 字体度量变 → 失效）
  qualityJson: JSON.stringify({
    ...quality,
    htmlRenderer: HTML_RENDERER_VERSION,      // 代码常量：框架层模板/字幕层/enter-exit 映射改动时 bump
    subtitleSafeBottom: meta.subtitleSafeBottom,  // 字幕层位置输入
  }),
};
```

**key 含义**：HTML 内容 + 音频 + 主题 + 尺寸 + fps + 入退场 + 浏览器版本 + 渲染器版本 + 编码参数 + 字幕安全区。改 HTML、旁白、主题、尺寸任一 → 只重跑该块。

注意：**改旁白必然重渲染**（audioHash 变，且音频与字幕都要进 partial）——与 Remotion 块行为一致。

### 9.2 html 源码缓存

`public/html/{id}.html` 本身是 compile 产物，不单独缓存（每次 compile 重写，幂等）。

---

## 10. 编码一致性（partial mp4 格式对齐）

[concat.ts:85-142](../../src/render/concat.ts) 的 `validatePartials` 会校验所有 partial 的 codec/分辨率/fps/pix_fmt/SAR 一致；concat 用 `-c copy`，**还要求流结构一致（都有音频轨）**。html partial 必须与 Remotion `renderMedia` 输出严格对齐。

### 10.1 Remotion 输出参数（[render-blocks.ts:236-261](../../src/render/render-blocks.ts)）

```typescript
codec: 'h264',
imageFormat: quality.imageFormat,      // 'jpeg' | 'png'
crf: quality.crf,
x264Preset: quality.x264Preset,
pixelFormat: quality.pixelFormat,      // 通常是 'yuv420p'
colorSpace: quality.colorSpace,
// 音频：renderMedia 默认 aac / 48000 Hz（Composition 内 <Audio> 从 enterFrames 起播）
```

### 10.2 html 渲染器 ffmpeg 命令

```bash
ffmpeg -y \
  -f image2pipe -framerate {fps} -i - \
  -i {blockAudio}.wav \
  -map 0:v -map 1:a \
  -af "adelay={enterMs}:all=1,apad" \
  -t {totalSec} \
  -c:v libx264 -preset {x264Preset} -crf {crf} \
  -pix_fmt {pixelFormat} \
  {colorTagArgs} \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  {outputMp4Path}
```

要点（评审修订）：

- **音频不可省略**：`adelay={enterMs}` 对齐 Remotion 的 `<Sequence from={enterFrames}>` 行为；`apad` + `-t {totalSec}` 保证音频长度与视频一致（WAV 短则补静音，长则截断）。采样率必须 48kHz 与 Remotion 输出一致，否则 concat 后音频参数漂移。
- **静态档优化**：单帧截图用 `-loop 1 -i frame.png` 替代 image2pipe，避免重复写 N 次同一 buffer。
- **不加 `-s`**：viewport 已保证截图尺寸 = meta 尺寸，再缩放只会模糊。
- **不加 `-movflags +faststart`**：partial 是中间产物，faststart 无意义。
- **`{colorTagArgs}` 是打标签不是转换**：与 [lipsync.ts](../../src/render/lipsync.ts) 的 `colorSpaceArgs` 对齐——bt709 时为 `-color_primaries bt709 -color_trc bt709 -colorspace bt709`（仅写元数据，不做像素转换）。不要单独用 `-colorspace` 做实际转换。
- PNG 序列通过 stdin image2pipe 喂入（动画档），避免落盘数百个 PNG 文件。

### 10.3 SAR 对齐

Remotion 默认 SAR 1:1。libx264 默认输出 SAR 1:1，一般无需处理；若 `validatePartials` 报 SAR 不匹配，加 `-bsf:v h264_metadata=sample_aspect_ratio=1/1`。

### 10.4 验证

开发验收时，跑一个 html 块 + 一个 animation 块的混合脚本，确认：

1. `concatPartials` 不报 inconsistent parameters；
2. ffprobe 检查 html partial：视频流 h264/yuv420p/正确 fps/SAR 1:1，**音频流 aac/48000Hz 存在**；
3. 成片在 html 块区间旁白可闻、字幕可见。

---

## 11. 入退场动画与字幕层（框架注入层）

### 11.1 现状

[render-blocks.ts](../../src/render/render-blocks.ts) 通过 Remotion 的 `BlockFrame` wrapper 应用 `@enter`/`@exit`（fade / slide-left 等）于整块画面——**包括字幕层**（`SubtitleOverlay` 在 `BlockFrame` 内部）。html 块不走 Remotion，需自行处理，且观感必须与 Remotion 块逐帧一致。

### 11.2 方案：注入 wrapper，CSS 变换

渲染器加载 HTML 后，在 DOM 里注入框架层：

```html
<body>
  <div id="__av-wrapper">   <!-- 用户 body 内容被整体移入此 div -->
    ...用户内容...
  </div>
  <div id="__av-subtitles"> ... </div>   <!-- 字幕层，见 §11.4 -->
</body>
```

- `body` 背景设为 `theme.colors.bg`（与 Remotion 块一致，入退场位移时露出的底色相同）。
- enter/exit 变换作用于 `#__av-wrapper`（`transform`/`opacity`）。`transform` 会创建新的 containing block，用户内容里 `position: fixed` 的元素随 wrapper 一起动——这正是"整块移动"的期望行为。
- 字幕层放 wrapper **之内**（作为其最后一个子元素，`position: absolute` 全幅覆盖）：Remotion 里 `SubtitleOverlay` 在 `BlockFrame` 内、随块一起做入退场，html 块必须保持一致。

### 11.3 enter/exit 预设映射（必须与 block-frame.tsx 逐帧一致）

复用 `AnimationPreset` 枚举。逐帧进度与缓动（[block-frame.tsx:26-119](../../remotion/engine/block-frame.tsx)）：

- 入场：`progress = frame / enterFrames`（frame < enterFrames），缓动 `easeOutCubic(p) = 1 - (1-p)³`
- 出场：`progress = (frame - (totalFrames - exitFrames)) / exitFrames`，缓动 `easeInCubic(p) = p³`

| preset | 入场（e = easeOutCubic(progress)） | 出场（e = easeInCubic(progress)） |
|--------|----------------------------------|----------------------------------|
| `fade` | `opacity: e` | `opacity: 1-e` |
| `fade-up` | `opacity: e; translateY(${(1-e)*40}px)` | `opacity: 1-e; translateY(${-e*40}px)` |
| `fade-down` | `opacity: e; translateY(${-(1-e)*40}px)` | `opacity: 1-e; translateY(${e*40}px)` |
| `slide-left` | `translateX(${-(1-e)*100}%)` | `translateX(${e*100}%)` |
| `slide-right` | `translateX(${(1-e)*100}%)` | `translateX(${-e*100}%)` |
| `zoom-in` | `opacity: e; scale(${0.5 + e*0.5})` | `opacity: 1-e; scale(${1 + e*0.5})` |
| `zoom-out` | `opacity: e; scale(${1.5 - e*0.5})` | `opacity: 1-e; scale(${1 - e*0.5})` |
| `none` | 无变换 | 无变换 |

每帧在 `__seek` 之后、screenshot 之前，由渲染器 `page.evaluate` 设置 wrapper 的 `style.opacity` / `style.transform`。enter/exit 帧数取 `block.timing.enterSec/exitSec`（与 Remotion 块同源）。

### 11.4 字幕层（评审新增，替代原 Q3 的待定方案）

**事实**：字幕在 Remotion 块内由 `SubtitleOverlay` 烧入 partial（不是 concat 后叠加）。html 块必须自行烧字幕，否则成片在 html 块区间无字幕。

**方案**：渲染器在注入层里生成字幕 DOM，样式参数**单一来源**于 Node 侧的 theme tokens（`remotion/engine/theme.ts` 的 `Theme.subtitle`：fontSize/lineHeight/backgroundColor/paddingPx/fontWeight/strokeColor/strokeWidthPx/borderRadiusPx/bottomMarginPx/maxLines），渲染器把计算好的样式值注入页面，避免两处 token 拷贝漂移。

逐帧逻辑（与 `__seek` 同一次 evaluate 完成）：

1. 当前时刻 `tSec = frame / fps`，减去 `audioStartSec = enterSec` 得到音频时间；
2. 按 `block.audio.lineTimings` 找当前行（无行 → 字幕层隐藏）；
3. 渲染行文本，`highlights` 区间用 accent 色 `<span>` 包裹；
4. 胶囊样式（背景/圆角/描边/字重）与 `SubtitleOverlay` 一致，定位在底部安全区内（`bottom: bottomMarginPx`），超长行按 maxLines 收缩字号（复刻 `fitFontSize` 逻辑）。

**防漂移措施**：`html-frame-layer.ts` 的 enter/exit 映射表与字幕布局参数写单测，对照 `block-frame.tsx` / `SubtitleOverlay.tsx` 的关键数值；`HTML_RENDERER_VERSION` 常量随注入层模板改动 bump（§9.1）。

---

## 12. Web UI 与配置

### 12.1 配置 — `autovideo.config.json`

新增可选段（`src/config/defaults.ts` 的 `AutoVideoConfig` 同步加 `htmlRender` 字段与默认值）：

```json
{
  "htmlRender": {
    "enabled": true,
    "browserExecutable": null,        // null = 走 §4.3 解析链；非 null 时优先于 config.render.browser
    "frameTimeoutMs": 30000,
    "seekTimeoutMs": 5000
  }
}
```

v1 **不单设 html 块并发数**：html 块与 Remotion 块共用 `render.blockConcurrency` 的 limiter（实现简单；Chrome 实例每块一个，内存压力由并发上限自然约束）。如实测需要再补 `blockConcurrency`。

### 12.2 Web 后端

[server/routes/blocks.ts:189-270](../../server/routes/blocks.ts) 的 `PUT /api/projects/:name/blocks/:id/visual-mode` 接口，mode 枚举加 `"html"`；枚举定义在 [server/types/api.ts:33](../../server/types/api.ts) 的 `VisualMode`，同步更新。

### 12.3 Web 前端

块详情切换视觉模式的下拉框加 `html` 选项。html 模式下 `--- visual ---` 编辑器 v1 用纯文本即可；后续可换代码编辑器（Monaco / CodeMirror）提升体验（可选优化，非 v1 必须）。

### 12.4 doctor 检查

`autovideo doctor` 新增检查项：
- `puppeteer-core` 是否已装
- Chrome 解析链（§4.3）能否解析出可执行文件，输出版本号
- 跑一个最小 HTML 块的冒烟渲染（静态档，1 秒）

---

## 13. 分阶段实施计划

### Phase 1：MVP — 静态 HTML 块（最小可用）

**范围**：`@visual: html` 内联模式，无动画，无外部资产，无 enter/exit 变换。

- 类型 / 解析 / compile / visuals 跳过（§6.1-6.4，含跳过 scaleFontMentions 与标记行校验）
- `html-render.ts`：puppeteer 加载 HTML（含 setViewport），单帧截图 `-loop 1`，**音频混入（§10.2，正确性必备，不可推迟）**，ffmpeg 合 mp4
- 编码对齐（§10）
- 不做：资产引用、enter/exit、seek、**字幕（已知限制，P2 补齐——P1 的 html 块区间无字幕，验收时明示）**

**验收**：US-1 跑通；html 块与 animation 块混合 concat 成功；html 块区间旁白可闻。

### Phase 2：动画档 + 字幕层 + 入退场

- `__seek` 探测与逐帧调用（§5）
- 框架注入层：enter/exit wrapper 变换（§11.3）+ 字幕层（§11.4）
- 缓存 key 含 html 内容哈希（§9.1）
- 模板 `static.html` / `animated.html`

**验收**：US-2、US-3 跑通，CSS 动画 + JS 动画帧精确；html 块字幕样式与 Remotion 块一致；enter/exit 观感一致。

### Phase 3：外部文件与资产

- `html(./path)` 解析（§3.1，htmlSource 走 processAssets 重写）
- `processHtmlAssets`：src=/href=/url() 提取与哈希复制（§7.1）
- `@font-face` 本地字体

**验收**：US-4 跑通，引用本地图片/CSS/字体的 HTML 块正确渲染。

### Phase 4：Web UI 与文档

- config 段、doctor 检查（§12）
- Web 后端/前端枚举适配
- `docs/AUTHORING.md` 新增 html 章节（含 §3.4 解析约束）
- 模板项目含 html 块示例

### Phase 5（可选，v2）：兼容档

- 无 `__seek` 时的虚拟时钟注入 + CSS 动画自动 seek（§3.3 兼容档）
- 性能优化（多 page 并发、screencast 实验回退）
- Studio 预览用静态截图做 html 块缩略图

---

## 14. 验收标准

| ID | 标准 | 阶段 |
|----|------|------|
| AC-1 | `@visual: html` 不再触发降级 warning | P1 |
| AC-2 | 静态 HTML 块产出 partial mp4，与 animation 块 concat 无 inconsistent parameters 错误；ffprobe 确认 html partial **含 aac/48kHz 音频轨** | P1 |
| AC-3 | 含 `__seek` 的 HTML 块，CSS `@keyframes` 动画帧时序精确（同输入两次渲染帧一致） | P2 |
| AC-4 | enter/exit 动画作用于 html 块整块画面，且与 Remotion 块同参数（抽帧对比 fade-up 位移曲线） | P2 |
| AC-5 | `html(./path)` 引用外部 HTML 文件正确加载 | P3 |
| AC-6 | HTML 中 `<img src="./x.png">`、`url('./x.png')`（含引号）本地资产正确显示 | P3 |
| AC-7 | 缓存语义正确：无任何输入变化时命中缓存；改 HTML 或改旁白（audioHash 变）都重渲染该块，其他块不受影响 | P2 |
| AC-8 | HTML 中 `fetch('http://...')` 被拦截，渲染不失败；`fetch('file:///etc/passwd')` 等 build 目录外 file:// 请求被拦截 | P2 |
| AC-9 | `autovideo doctor` 报告 Chrome 可用性与版本 | P4 |
| AC-10 | `docs/AUTHORING.md` 含 html 模式完整说明（含 §3.4 约束） | P4 |
| AC-11 | html 块字幕正确显示：行切换与 lineTimings 对齐、高亮词着色、胶囊样式与 Remotion 块目测一致 | P2 |
| AC-12 | 无 `__seek` 但含 CSS 动画的 HTML 块降级为静态档并打出 warning | P2 |
| AC-13 | 内联 HTML 含裸 `---` 行时 compile 报错（而非静默截断） | P1 |

---

## 15. 风险与未决问题

### 15.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Chrome 路径在不同安装方式下不一致 | 渲染器找不到浏览器 | §4.3 四级解析链；doctor 检查 |
| `validatePartials` 因 pix_fmt/SAR 微妙差异报错 | concat 失败 | §10.2 参数对齐 + §10.3 SAR 兜底；AC-2 把关 |
| html partial 缺音频轨或采样率漂移 | concat 失败 / 成片丢旁白 | §10.2 音频混入为强制步骤；AC-2 ffprobe 校验 |
| 字幕层/enter-exit 与 Remotion 实现漂移 | 混合视频观感不一致 | 样式 token 单一来源注入；映射表单测；HTML_RENDERER_VERSION bump |
| 逐帧截图慢（估算 ~1-3 分钟/20 秒块） | 全流程变慢 | 块级缓存；静态档 `-loop 1`；未来探索 screencast |
| 用户 HTML 写 `__seek` 错误（无限循环/抛异常） | 块渲染挂死 | evaluate 超时 5s；超时即报块失败 |
| Chrome 版本升级改变渲染（字体度量等） | 缓存失效/画面变 | partial key 含 chrome 版本 |
| 用户 HTML 读取本地文件泄入成片 | 安全事故 | §8.2 file:// 白名单（仅 build 目录） |

### 15.2 未决问题（评审已拍板）

1. **Q1：`--- visual ---` 内联 HTML 是否要求完整 `<!DOCTYPE html>`？**
   - 决定：不强求，`page.goto(file://...)` 对片段也能渲染。文档推荐写完整。注意 §3.4 的标记行约束。

2. **Q2：html 块的时长由谁决定？**
   - 决定：与现有模式一致，由旁白时长决定（`block.timing`）。`@duration` 可强制覆盖。静态档无 `__seek` 时，截图 `-loop 1` 重复到块时长。

3. **Q3：html 块是否支持字幕？** ~~待确认~~ → **已确认，必须支持**。
   - 评审结论：字幕不是 concat 后叠加，而是 `SubtitleOverlay` 烧在每个 partial 内（[VideoComposition.tsx:237-247](../../remotion/VideoComposition.tsx)）。html 块不走 Remotion，必须自行烧字幕——方案见 §11.4（注入字幕层，token 单一来源）。

4. **Q4：puppeteer-core 版本与 Chrome 的兼容性？**
   - 决定：pin `puppeteer-core` ^24，`headless: 'shell'` 驱动 chrome-headless-shell（本仓库当前 Chrome for Testing 134.0.6998.35）。开发第一步做冒烟验证；若 Remotion 升级 Chrome 大版本，回归 AC-3。

5. **Q5：html 块是否计入 `visuals` 阶段的并发限制？**
   - 决定：不计入（html 跳过 visuals）。render 阶段 v1 复用 `render.blockConcurrency`（§12.1）。

---

## 16. 参考资料

- 技术选型调研报告（本 PRD §4 基础）
- [Remotion `<IFrame>` 文档](https://www.remotion.dev/docs/iframe)（路线 B 否决依据）
- [Remotion Flickering 文档](https://www.remotion.dev/docs/flickering)（帧驱动模型）
- [Puppeteer chrome-headless-shell（headless: 'shell'）](https://pptr.dev/guides/chrome-headless-shell)（驱动模式依据）
- [dunnkers render-html-to-mp4 gist](https://gist.github.com/dunnkers/be42722853b84fde68ee8bc29a8d3d22)（seek-hook 范式）
- [Replit 虚拟时钟引擎](https://replit.com/blog/browsers-dont-want-to-be-cameras)（确定性渲染）
- [Web Animations API - getAnimations()](https://developer.mozilla.org/zh-CN/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API)（CSS 动画 seek）
- [HeyGen hyperframes beginFrame 废弃](https://github.com/heygen-com/hyperframes/pull/296)（规避 beginFrame 依据）
- 现有管线接入点：[directives.ts](../../src/parser/directives.ts)、[compile.ts](../../src/cli/compile.ts)、[visuals.ts](../../src/cli/visuals.ts)、[render-blocks.ts](../../src/render/render-blocks.ts)、[concat.ts](../../src/render/concat.ts)、[VideoComposition.tsx](../../remotion/VideoComposition.tsx)、[block-frame.tsx](../../remotion/engine/block-frame.tsx)

---

## 附录：v0.2 修订记录（代码评审）

对照实际代码核实后修订，关键变更：

1. **新增 G6 与 §4.5/§10.2 音频要求**：评审发现 partial 含音频轨（`VideoComposition.tsx` 的 `<Audio>`）且 concat 用 `-c copy`，html partial 必须混音频（AAC/48kHz，adelay=enterSec），否则 concat 失败或丢旁白。原稿完全未提音频。
2. **Q3 拍板 + 新增 §11.4 字幕层**：原稿假设"字幕在 concat 后叠加"错误，实际烧在 partial 内。html 渲染器注入字幕层，token 单一来源。
3. **Chrome 版本修正**：原稿"Remotion 用 Chrome 149"→ 实际 Chrome for Testing 134.0.6998.35（Remotion 4.0.380）。
4. **puppeteer 模式修正**：`headless: 'new'` → `headless: 'shell'`（chrome-headless-shell 专用）。
5. **浏览器解析链修正**：复用 `config.render.browser` → `ensureBrowser()`（返回 `BrowserStatus.path`）→ `PUPPETEER_EXECUTABLE_PATH` → 系统浏览器。
6. **compile 污染防护**：html 块跳过 `scaleFontMentions`（会改写 CSS font-size）与 `processAssets` 通用重写；htmlSource 走 processAssets 收集重写（原稿 `join(outDir,'public',原始路径)` 找不到文件）。
7. **安全模型收紧**：`--disable-web-security` → `--allow-file-access-from-files`；file:// 请求白名单（仅 build 目录），阻断本地文件泄入成片。
8. **ffmpeg 命令修正**：补音频参数；`-colorspace` 转换 → 打标签（对齐 lipsync.ts colorSpaceArgs）；去 `-s`（viewport 保证尺寸）；去 `+faststart`（中间产物）；静态档 `-loop 1`。
9. **补充 viewport 设置**：原稿通篇未提 `setViewport({width, height, deviceScaleFactor: 1})`——截图尺寸 = viewport，为必须步骤。
10. **enter/exit 参数对齐**：§11.3 给出与 `block-frame.tsx` 逐帧一致的映射表（cubic ease-out/in，±40px / ±100% / scale 0.5↔1.5）。
11. **新增 §3.4 解析约束**：内联 HTML 禁止裸 `---` 行 / `--- word ---` 行 / 行首 `>>>`（`blocks.ts:132` 静默截断风险），compile 加校验报错。
12. **接口/文件引用修正**：visual-mode 接口在 `server/routes/blocks.ts`（非 projects.ts）；§6.7 补 `schemas/script.schema.json`、`src/config/defaults.ts`、`server/types/api.ts`、`tests/` 等漏项。
13. **AC-7 语义修正**：改旁白 → audioHash 变 → 必须重渲染（音频+字幕进 partial），原稿"改旁白不重渲染"说反了。
14. **新增 AC**：音频轨校验（AC-2 扩展）、字幕一致性（AC-11）、CSS 动画降级 warning（AC-12）、标记行报错（AC-13）、file:// 越权拦截（AC-8 扩展）。
15. **其他**：`__seek` 幂等/同步/纯函数约定；`window.__av` 上下文（§5.3）；`waitForFunction` 容忍 defer 脚本；stdin 背压；preview placeholder 说明；`assertVisualsReady` 文案同步。
