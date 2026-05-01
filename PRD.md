# AutoVideo — 产品需求文档

> 把 Markdown 教学口播稿编译为 MP4 视频的命令行工具。

---

## 1. 产品定义

### 1.1 一句话

**输入一个项目文件（meta + 若干内容块文件），每个块用文字描述视觉内容交给 LLM 渲染，输出一段带字幕、配音、动画的 MP4 教学视频。**

### 1.2 目标用户

写技术教学视频的个人创作者。具体画像：

- 会写代码、会用命令行
- 不想学视频剪辑软件
- 重视内容（讲清楚一段算法、一段代码），轻视花哨特效
- 通常做中文/中英混读的视频
- 一次输出 5–30 分钟的视频

### 1.3 核心使用流程

```
1. 写一个 project.json（指向 meta.md 和一个或多个内容 .md 文件）
2. 在内容文件里，每个块写：--- visual ---（文字描述视觉效果）+ --- narration ---（口播文字）
3. 运行  autovideo build project.json
4. 等几分钟，得到  output/final.mp4
5. 不满意某一块，  autovideo visuals script.json --block B03 --force  重生成
```

---

## 2. 设计原则

1. **AI 只做必要的事**。本系统只在一个地方用大模型——根据每个块的视觉描述生成 React 组件。其他所有阶段（解析、TTS、字幕对齐、渲染、拼接）都是确定性代码。
2. **单一数据源**。`script.json` 是贯穿全部 stage 的 IR；每个 stage 是 `script.json → script.json` 的纯变换。
3. **每个 stage 独立可重跑**。改一句话不需要重跑全流程；改一个动画不需要重新 TTS。
4. **错误显式不降级**。失败就报错让用户处理，不偷偷切换 provider 或静默丢弃。
5. **本地优先**。除 Claude API 外，所有依赖（VoxCPM TTS、Remotion 渲染、字幕对齐）都在本机；离线可继续渲染已有 artifact。
6. **可预览可迭代**。Remotion Studio 直接预览单块，所见即所得。

---

## 3. 输入格式：Markdown DSL

### 3.1 项目文件（`project.json`）

`autovideo` 的入口是一个 JSON 文件，描述项目的全局设置文件路径和内容文件列表：

```json
{
  "meta": "./meta.md",
  "blocks": [
    "./intro.md",
    "./part1.md",
    "./part2.md"
  ]
}
```

- `meta`：指向全局设置文件的路径（相对于 `project.json` 所在目录）
- `blocks`：内容文件路径列表，按顺序合并；每个文件只包含块，不包含 `--- meta ---` 段
- 块 ID（`#B01`）在所有内容文件中全局唯一；省略时按所有文件合并后的出现顺序自动编号

### 3.2 全局设置文件（`meta.md`）

```markdown
--- meta ---
title: 200 行手撕 GPT
aspect: 16:9
theme: dark-code
fps: 30
---
```

只包含 `--- meta ---` 段，不含任何块内容。未指定 `voiceRef` 时默认使用与 meta.md 同目录的 `B00.wav`。如需指定其他文件：

```markdown
--- meta ---
title: 200 行手撕 GPT
voiceRef: ./voice/my-voice.wav
aspect: 16:9
theme: dark-code
fps: 30
---
```

### 3.3 内容文件（`*.md`）

每个内容文件只包含一个或多个块，**不含** `--- meta ---` 段：

```markdown
>>> GPT 是什么 #B01
@enter: fade-up
@duration: 8s

--- visual ---
屏幕中央显示大标题 "GPT = 下一个词预测器"，白色大字，渐显

--- narration ---
GPT 本质上就是一个下一个词预测器
给它一串文字，它告诉你下一个最可能的词

>>> 下一个块 #B02
...
```

- 每个 `>>>` 开启一个块；`#B01` ID 可选，省略则按合并后顺序自动编号
- 块之间互相独立；块内顺序：标题行 → directive → `--- visual ---` → `--- narration ---`
- 每个块都必须同时有 `--- visual ---` 和 `--- narration ---` 两段

### 3.4 元数据字段

| 字段 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `title` | ✓ | — | 视频标题 |
| `voiceRef` | | `./B00.wav` | 参考音频路径（相对于 meta.md 或绝对路径）；10–30 秒清晰人声 WAV；整部视频所有块共用此音色 |
| `aspect` | | `16:9` | 仅支持 `16:9` / `9:16` / `1:1` |
| `theme` | | `dark-code` | 视觉主题 |
| `fps` | | `30` | 帧率 |

`voiceRef` 是保证全片音色一致的**唯一机制**。默认值 `./B00.wav` 相对于 meta.md 所在目录解析。VoxCPM2 为 zero-shot 克隆引擎，没有内置预设音色名；每次 TTS 调用都将此 WAV 作为参考音色传入，因此整部视频音色完全固定。compile 阶段校验 voiceRef 文件存在，不存在则立即报错。

### 3.5 块指令（`@directive:`）

| 指令 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `@enter` | | `fade` | 入场动画预设 |
| `@exit` | | `fade` | 出场动画预设 |
| `@duration` | | 自动 | 强制时长（秒）；有旁白时可省略，由 TTS 时长决定 |

块不再有类型之分，所有视觉内容统一由 `--- visual ---` 描述、LLM 生成组件渲染。

### 3.6 内容段：视觉描述 + 旁白

每个块都用 `--- visual ---` 与 `--- narration ---` 显式分隔视觉描述与口播文字：

```markdown
>>> 下一个词预测器 #B02
@enter: fade-up

--- visual ---
0s: 屏幕中央显示大标题 "GPT = ?"，带脉冲动画
3s: 标题变为 "GPT = 下一个词预测器"
6s: 左侧文本框显示 "今天天气真"，右侧概率条形图
8s: "好" 弹出飞入文本末尾变成 "今天天气真好"

--- narration ---
我们有 "今天天气真" 这几个字的输入
然后我们要预测下一个字
按概率选最高的字拼上去
```

```markdown
>>> Value 类源码 #B03

--- visual ---
代码编辑器风格界面，展示 Python 代码，文件 microgpt.py 第 30-50 行
第 32-35 行高亮，重点是 Value 类的 __add__ 和 backward 方法

--- narration ---
要训练神经网络，必须有 **自动求导**
karpathy 用一个 [[Value]] 类实现了它
```

```markdown
>>> 架构总览图 #B04
@duration: 6s

--- visual ---
显示图片 ./assets/architecture.png，居中展示，清晰可读

--- narration ---
整体架构分为四层，从下到上依次是输入层、嵌入层、注意力层、输出层
```

**`--- visual ---` 写作规范**：
- 用自然语言描述视觉效果；时间线用 `Xs:` 前缀标注关键帧（可选）
- 引用本地图片时直接写相对路径，如 `显示图片 ./assets/diagram.png`；compile 阶段自动复制到 `public/assets/` 并替换为 `/assets/diagram.png`，LLM 生成的组件用 `<Img src={staticFile("assets/diagram.png")} />` 加载
- 描述越具体，生成效果越准确；主题色、字号等无需指定，由 `theme` 统一控制

### 3.7 旁白语法

- **每个非空行 = 一条字幕**，TTS 合成后该行音频结尾自动附加 **200ms 静音**。
- 空行忽略（不产生额外停顿）。
- **`**word**`** 在字幕中高亮显示（不影响 TTS）。
- **`[[word]]`** 标记朗读重音（ttsText 中去掉括号保留词语；VoxCPM2 依赖模型自然理解，不影响字幕样式）。

### 3.8 动画预设（`@enter` / `@exit`）

`fade` / `fade-up` / `fade-down` / `slide-left` / `slide-right` / `zoom-in` / `zoom-out` / `none`

入场和出场动画由系统统一执行（包裹在组件外层），不进入 LLM 生成的组件内部。

---

## 4. 数据模型：`script.json`

```typescript
interface Script {
  meta: {
    schemaVersion: "1.0";
    title: string;
    voiceRef: string;           // 参考音频绝对路径（compile 阶段解析；默认为 meta.md 同目录的 B00.wav）
    aspect: "16:9" | "9:16" | "1:1";
    width: number;
    height: number;
    fps: number;
    theme: string;
    subtitleSafeBottom: number; // 字幕占据的底部像素高度，由系统按分辨率计算
  };
  blocks: Block[];
  artifacts: {
    compiledAt?: string;
    audioGeneratedAt?: string;
    visualsGeneratedAt?: string;
    renderedAt?: string;
  };
}

interface Block {
  id: string;                   // "B01"
  title: string;
  enter: AnimationPreset;
  exit: AnimationPreset;

  visual: {
    description: string;        // --- visual --- 原文，喂给 LLM
    componentPath?: string;     // Stage 3 填写（生成的 .tsx 路径）
    degraded?: boolean;         // 3 轮生成仍失败时标记，渲染时降级为纯色背景
  };

  narration: {
    lines: NarrationLine[];
    explicitDurationSec?: number;   // @duration
  };

  // Stage 2 填写
  audio?: {
    wavPath: string;
    durationSec: number;
    wordTimings: { word: string; startMs: number; endMs: number }[];
    lineTimings: { lineIndex: number; startMs: number; endMs: number }[];
    // lineIndex 对应 narration.lines[lineIndex]；由 tts stage 在 whisper alignment 后计算
  };

  // Stage 4 填写
  timing?: {
    enterSec: number;
    holdSec: number;
    exitSec: number;
    totalSec: number;
    frames: number;
    startFrame: number;         // 在最终视频中的起始帧
  };
}

interface NarrationLine {
  text: string;                 // 原文（含 ** 和 [[]] 标记）
  ttsText: string;              // 喂给 VoxCPM2 的文本（[[]] 标记去掉，** 去掉，保留纯文字）
  highlights: { start: number; end: number }[];  // ** 范围（用于字幕渲染）
}

// 每行末尾固定附加 200ms 静音，无需在数据模型中存储。
```

**LLM 生成的组件接口**（所有块统一）：

```typescript
interface AnimationProps {
  frame: number;              // 块内帧（0 起）
  durationInFrames: number;
  width: number;              // 视频宽度（px）
  height: number;             // 视频高度（px）
  subtitleSafeBottom: number; // 底部字幕区高度（px）；组件应将重要内容保持在 height - subtitleSafeBottom 以上
  theme: Theme;
  fps: number;
}

export default function Component(props: AnimationProps): JSX.Element;
```

组件始终全屏渲染（`width × height`），字幕作为独立的 `SubtitleOverlay` 层叠加在上方，无需在组件内绘制字幕。

JSON Schema 在 `schemas/script.schema.json` 维护。每个 stage 必须先验证再处理。

---

## 5. 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                  autovideo (CLI, TypeScript)                     │
│                                                                  │
│  project.json                                                    │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐      │
│  │ compile  │ → │   tts    │ → │ visuals  │ → │  render  │      │
│  │          │   │          │ ⇣ │          │   │          │      │
│  │  parser  │   │  voxcpm  │   │  Claude  │   │ Remotion │      │
│  │          │   │  whisper │   │   API    │   │  ffmpeg  │      │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘      │
│       │              │              │              │            │
│       └──────────────┴──────┬───────┴──────────────┘            │
│                             ▼                                    │
│                      script.json                                 │
│                      (canonical IR)                              │
│                             │                                    │
│                             ▼                                    │
│                {cache-dir}/  (audio, components)                  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
                      output/final.mp4
```

四个 stage **顺序依赖、各自可单独运行**。`tts` 和 `visuals` 都只读 `script.json` 的不同字段，理论可并行（Stage 3 不依赖 Stage 2 输出），但默认串行执行简化日志。

`visuals` stage 现在处理**所有块**（而非仅 animation 类型），每块均调用 Claude 生成 React 组件；缓存命中的块跳过 API 调用，仅 cache miss 块产生 API 费用。

---

## 6. 各 Stage 详解

### 6.1 Stage 1 — `compile`：Markdown → IR

**输入**：`project.json`（含 meta 路径 + blocks 文件列表）+ meta CLI override
**输出**：`script.json`（不含 audio / componentPath / timing）

**职责**：
1. 读取 `project.json`，解析 `meta` 文件路径和 `blocks` 文件路径列表（均相对 `project.json` 所在目录）
2. 解析 meta 文件中的 `--- meta ---` 段（CLI 参数可覆盖任意字段）；`voiceRef` 未指定时默认为 meta.md 同目录的 `B00.wav`；将 voiceRef 解析为绝对路径并校验文件存在，不存在则立即报错
3. 按 `blocks` 列表顺序依次读取各内容文件，合并所有 `>>>` 块
4. 校验块 ID 全局唯一；省略 ID 的块按合并后出现顺序自动编号
5. 对每个块解析 directive、`--- visual ---`、`--- narration ---`；两段均必须存在，缺失则报错
6. 旁白预处理：拆行（忽略空行）→ 解析 `**` `[[]]` → 生成 `NarrationLine[]`
7. 解析 `aspect` → 计算 `width/height`；按分辨率计算 `subtitleSafeBottom`（默认为 height × 0.15）
8. 扫描每个块 `--- visual ---` 描述中的本地文件路径引用（形如 `./xxx` 或 `../xxx`），将引用的文件复制到构建目录 `public/assets/`，并将描述中的路径替换为 `/assets/filename`（供 LLM 生成的组件通过 Remotion `staticFile()` 加载）
9. JSON Schema 验证后写出 `script.json`

**实现**：纯函数；无外部服务调用；可在毫秒级完成。

### 6.2 Stage 2 — `tts`：旁白 → 音频 + 字幕时序

**输入**：`script.json`（已 compile，含 `meta.voiceRef` 绝对路径）
**输出**：每块 `audio/B**.wav` + word-level 及 line-level 时序，写回 `script.json.blocks[].audio`

#### 6.2.1 VoxCPM2 服务

VoxCPM2 是 zero-shot 语音克隆引擎，没有内置预设音色。音色完全由调用时传入的**参考音频**决定。

- stage 启动前检测 voxcpm2-api HTTP 服务（默认 `http://127.0.0.1:8000`）是否可达
- 不可达时尝试自动启动（`uvicorn server:app`），仍失败则报错，提示用户运行 `autovideo doctor`

#### 6.2.2 参考音频

`meta.voiceRef` 是整部视频**唯一**的音色来源，**必须由用户预先提供**（10–30 秒清晰人声 WAV，默认为 `B00.wav`）。系统在每次 TTS 调用时都将此文件 base64 编码后传入；base64 编码在 tts stage 启动时一次性计算并复用，不重复读盘。

#### 6.2.3 TTS 调用流程

对每个块的 `narration.lines` 逐行处理：

1. 检查缓存（key：`MD5(ttsText + voiceRefHash)`），命中直接复制，跳过 API 调用
2. Cache miss → 调用 voxcpm2-api：

```http
POST /v1/speech
Content-Type: application/json

{
  "text": "<narration line>",
  "reference_audio_base64": "<base64 of voiceRef WAV>",
  "cfg_value": 2.0
}
```

响应为 WAV 二进制（48kHz）。

3. 将每行音频末尾附加 **200ms 静音**，按行顺序拼接，合并为 `audio/B**.wav`
4. 对合并后的 WAV 调用 `whisper-timestamped` 做 forced alignment，获得 word-level 时间戳
5. 根据 word-level 时间戳与 `narration.lines` 的文本对齐，计算每行的起止时间，生成 `lineTimings`；写入 `audio` 字段

#### 6.2.4 约束

- 单块 TTS 失败时重试 3 次（间隔 5s），仍失败 → 此块标记错误，stage 末尾汇总报告
- 多块并发数默认 4（`voxcpm.concurrency`），可配置

### 6.3 Stage 3 — `visuals`：所有块 → React 组件

**输入**：`script.json`
**输出**：`src/blocks/B**/Component.tsx`，写回 `script.json.blocks[].visual.componentPath`

**职责**：
1. 处理**所有**块；逐块检查缓存，命中则直接复制组件文件，跳过 API 调用
2. 缓存 key：`MD5(visual.description + theme + width + height + promptVersion)`
   - `promptVersion`：系统 prompt 文件（组件模板 + AnimationProps 接口）的内容 hash 前 8 位；prompt 变更时自动失效旧缓存
3. Cache miss → Claude API 调用：
   - 默认 `claude-sonnet-4-6`（可配置）
   - 使用 prompt caching：系统 prompt 包含组件模板、theme tokens、AnimationProps 接口定义（长期不变部分）
   - 工具调用要求返回 `{ tsx: string }` JSON
   - 生成的组件必须全屏渲染（`width × height`），重要内容避开底部 `subtitleSafeBottom` 像素
4. 生成后做两轮验证：
   - **静态**：`tsc --noEmit` 通过
   - **动态**：`remotion render` 单帧（中间帧）非纯黑、非纯白
5. 任一验证失败 → 将错误信息回喂给模型，最多 3 轮重试
6. 3 轮仍失败 → 标记 `visual.degraded: true`，渲染时降级为纯色背景 + 旁白文字，不阻塞后续块

**并发**：默认同时处理 4 个块（`anthropic.concurrency`）；Claude API 限速时自动退避。

### 6.4 Stage 4 — `render`：IR + 资产 → MP4

**输入**：`script.json`（带 audio + componentPath） + `audio/` + `src/blocks/`
**输出**：`output/final.mp4`、`output/final_normalized.mp4`

**职责**：
1. 计算每块时序：`hold = max(audio?.durationSec ?? 0, narration.explicitDurationSec ?? 0, MIN_HOLD)`，`total = enter + hold + exit`，写回 `timing`（`@duration` 与 TTS 时长取较长者，TTS 不会被截断）
2. 生成 `public/script.json`（Remotion 静态读取）
3. 写一个 `Root.tsx` 注册**单一** Composition：
   ```tsx
   <Composition id="Video" durationInFrames={totalFrames} fps={fps} ...>
     <VideoComposition />
   </Composition>
   ```
   `VideoComposition` 内用 `<Sequence>` 串起所有块；每个块的渲染结构：
   ```
   <BlockFrame enter exit>           ← 系统处理入场/出场动画
     <DynamicComponent />            ← LLM 生成的全屏组件
     <SubtitleOverlay                ← 字幕层，叠加在底部，带半透明背景条
       lines={narration.lines}       ← 字幕文本（含高亮标记）
       lineTimings={audio.lineTimings} ← 每行起止时间（ms），由 tts stage 算好
       frame={frame} fps={fps} />    ← 当前帧，组件据此决定显示哪行
   </BlockFrame>
   ```
4. `npx remotion render` 一次输出 `output/final.mp4`
5. ffmpeg `loudnorm` 标准化 → `output/final_normalized.mp4`
6. 质量校验：分辨率、时长、5 个抽样帧非黑

**优势**：单 composition 可在 Remotion Studio 完整 scrub、跨块过渡、按时间范围重渲。

### 6.5 Stage 5 — `preview`：本地交互预览

**输入**：`script.json`
**输出**：浏览器打开 Remotion Studio

```bash
autovideo preview script.json                # 打开 Studio，预览全片
autovideo preview script.json --block B03    # 仅显示该块
```

实现：写一个临时 `Root.tsx`（含或不含 `--block` 过滤），调 `npx remotion studio`。

### 6.6 Stage 6 — `build`：一键全流程

```bash
autovideo build project.json
```

等价于 `compile → tts → visuals → render`，但中间任一阶段失败立即停下，不继续后面。

---

## 7. 命令行接口

```bash
# 一键
autovideo build <project.json> [--out DIR] [--config FILE] [--meta key=value]...

# 分步（每步可单独运行）
autovideo compile <project.json>         [--out DIR]
autovideo tts     <script.json>          [--block B03] [--force]
autovideo visuals <script.json>          [--block B03] [--force]
autovideo render  <script.json>          [--range B03-B05]

# 预览
autovideo preview <script.json>          [--block B03]

# 工具
autovideo cache    stats | clean [--type audio|component]
autovideo doctor                          # 检查 VoxCPM2 服务、Claude API、ffmpeg、whisper-timestamped、字体
autovideo init     <dir>                  # 生成模板项目（含示例 project.json + meta.md + script.md）
```

通用 flag：

- `--force`：忽略缓存，强制重做
- `--block <id>`：仅处理指定块
- `--out <dir>`：输出目录（默认 `./build/{title}/`）
- `--cache-dir <dir>`：覆盖缓存目录（优先于 config 和默认值）
- `--verbose`：详细日志
- `--dry-run`：仅显示要做什么，不执行

---

## 8. 文件布局

### 8.1 项目（autovideo 仓库）

```
autovideo/
├── package.json                  # 唯一 package.json
├── tsconfig.json
├── remotion.config.ts
│
├── bin/
│   └── autovideo.ts              # CLI entry，commander.js
│
├── src/
│   ├── cli/                      # 各子命令实现
│   │   ├── compile.ts
│   │   ├── tts.ts
│   │   ├── visuals.ts
│   │   ├── render.ts
│   │   ├── preview.ts
│   │   ├── build.ts
│   │   ├── cache.ts
│   │   ├── doctor.ts
│   │   └── init.ts
│   │
│   ├── parser/                   # Markdown DSL 解析
│   │   ├── project.ts            # project.json 读取与路径解析
│   │   ├── meta.ts               # --- meta --- 段解析
│   │   ├── blocks.ts             # 多文件块合并
│   │   ├── directives.ts
│   │   └── narration.ts
│   │
│   ├── tts/
│   │   ├── voxcpm-client.ts      # voxcpm2-api HTTP client（POST /v1/speech）
│   │   ├── voxcpm-server.ts      # 服务启停管理（autoStart）
│   │   ├── audio.ts              # ffmpeg helpers（拼接静音、格式转换）
│   │   └── align.ts              # whisper-timestamped forced alignment wrapper
│   │
│   ├── ai/
│   │   ├── component-gen.ts      # Claude SDK 调用
│   │   ├── validate.ts           # tsc + 渲染冒烟
│   │   └── prompts/
│   │       └── component.md      # cached system prompt
│   │
│   ├── cache/
│   │   └── store.ts              # 全局缓存（lockfile 安全）
│   │
│   └── types/
│       └── script.ts
│
├── remotion/                     # 渲染层
│   ├── Root.tsx                  # 在 build 时由 render.ts 改写
│   ├── VideoComposition.tsx
│   ├── components/
│   │   └── SubtitleOverlay.tsx   # 字幕覆盖层（叠加在 LLM 组件上方）
│   └── engine/
│       ├── theme.ts              # 主题 token（传入 LLM 组件）
│       ├── animations.ts         # enter/exit 包裹实现
│       └── block-frame.tsx       # 通用块外壳（动画 + 字幕叠加）
│
├── tts-server/                   # VoxCPM2 Python 服务（voxcpm2-api）
│   ├── server.py                 # FastAPI，POST /v1/speech + POST /v1/transcribe
│   ├── align.py                  # whisper-timestamped forced alignment
│   └── requirements.txt
│
├── schemas/
│   └── script.schema.json
│
├── templates/
│   └── starter/                  # autovideo init 复制此模板
│       ├── project.json
│       ├── meta.md
│       └── script.md
│
├── tests/
│   ├── parser.test.ts
│   ├── narration.test.ts
│   ├── cache.test.ts
│   └── e2e.test.ts
│
└── docs/
    ├── INPUT_SPEC.md             # 用户文档
    └── ARCHITECTURE.md           # 开发者文档
```

### 8.2 用户源文件（推荐结构）

```
./microgpt/                       # 用户自己的项目目录
├── project.json                  # 入口：指向 meta 文件和内容文件列表
├── meta.md                       # 全局设置（--- meta --- 段）
├── B00.wav                       # 默认参考音色（10–30 秒清晰人声，用户自备）
├── intro.md                      # 内容文件（只含块）
├── part1.md
└── part2.md
```

### 8.3 构建产物目录（`autovideo build` 输出）

```
./build/microgpt/
├── script.json                   # canonical IR
├── audio/
│   ├── B01.wav
│   └── ...
├── src/
│   └── blocks/
│       ├── B01/Component.tsx     # LLM 生成的组件（每块一个）
│       └── ...
├── public/
│   └── script.json               # Remotion 静态读取
├── logs/
│   ├── tts-2026-05-01.log
│   └── visuals-2026-05-01.log
└── output/
    ├── final.mp4
    └── final_normalized.mp4
```

---

## 9. 配置

唯一配置文件 `autovideo.config.json`（项目根可选；CLI 参数优先）：

```json
{
  "voxcpm": {
    "endpoint": "http://127.0.0.1:8000",  // voxcpm2-api 服务地址
    "modelDir": "~/.cache/voxcpm/VoxCPM2", // 模型权重目录（供 autoStart 使用）
    "autoStart": true,                      // 服务不可达时自动启动
    "cfgValue": 2.0,                        // 分类器自由引导强度，越高越像参考音色
    "concurrency": 4                        // 并发 TTS 块数
  },
  "anthropic": {
    "apiKeyEnv": "ANTHROPIC_API_KEY",
    "model": "claude-sonnet-4-6",
    "promptCaching": true,
    "maxRetries": 3,
    "concurrency": 4             // visuals stage 同时调用 Claude 生成的块数
  },
  "render": {
    "concurrency": 4,
    "browser": "/usr/bin/chromium-browser",
    "minHoldSec": 1.5,
    "defaultEnterSec": 0.5,
    "defaultExitSec": 0.3
  },
  "cache": {
    "dir": "~/.autovideo/cache"    // 支持绝对路径或 ~ 路径；CLI --cache-dir 优先级更高
  }
}
```

---

## 10. 错误处理

| 场景 | 行为 |
|------|------|
| Markdown 语法错误 | `compile` 立即失败，输出行号；不生成部分 IR |
| 块缺少 `--- visual ---` 或 `--- narration ---` | `compile` 立即失败，指出块 ID 和文件行号 |
| Schema 验证失败 | 立即失败，输出 JSON path 与原因 |
| `voiceRef` 文件不存在或不可读 | `compile` 阶段立即失败，输出解析后的绝对路径和建议（默认 B00.wav 或 meta.md 中指定的路径） |
| VoxCPM2 服务无法启动 | `tts` 立即失败；提示用户运行 `autovideo doctor` |
| 单块 TTS 失败 | 重试 3 次（间隔 5s）；仍失败 → 此块标记错误；本 stage 末尾汇总报告，让用户决定 |
| Claude API 失败 | 重试 3 次（指数退避） |
| 生成的组件验证失败 | 错误回喂模型，最多 3 轮；仍失败 → 此块标记 `degraded`，渲染时降级为纯色背景+旁白文字，不阻塞流程 |
| 渲染失败 | 立即失败，保留所有 artifact 便于调试 |
| 磁盘 < 5GB | 任何 stage 启动前预检，不足拒绝 |

**所有错误都有结构化日志**：`build/logs/{stage}-{date}.log`，每条带 stage / block-id / 时间戳 / 错误堆栈。

**stage 失败汇总**：失败结束时输出可执行的恢复命令清单，例如：

```
✗ Build failed at stage `tts` (2 block(s) failed)

Failed blocks:
  B03: VoxCPM timeout after 3 retries
  B07: VoxCPM connection refused

Resume:
  autovideo tts ./build/microgpt/script.json --block B03,B07 --force

Or skip these blocks (use placeholder audio):
  autovideo tts ./build/microgpt/script.json --block B03,B07 --skip
```

---

## 11. 缓存

### 11.1 缓存目录

优先级：`--cache-dir` CLI flag > `autovideo.config.json` 中 `cache.dir` > 默认 `~/.autovideo/cache/`

目录结构：

```
{cache-dir}/
├── manifest.json
├── audio/
│   ├── {hash}.wav
│   └── {hash}.timings.json
└── components/
    └── {hash}.tsx
```

`voiceRef` WAV 文件由用户自己管理，存放在项目目录中；缓存通过 `voiceRefHash` 感知音色变更，无需在缓存目录内存储参考音频副本。

### 11.2 缓存键

| 类型 | 缓存键组成 |
|------|-----------|
| audio | `MD5(ttsText + voiceRefHash)` |
| component | `MD5(visual.description + theme + width + height + promptVersion)` |

- `voiceRefHash`：`voiceRef` WAV 文件内容的 MD5，保证参考音频变更时缓存自动失效
- `promptVersion`：`src/ai/prompts/component.md` 文件内容的 MD5 前 8 位；系统 prompt 变动时所有旧 component 缓存自动失效

### 11.3 manifest 条目格式

```json
{
  "component:f3a1b2c4...": {
    "type": "component",
    "file": "components/f3a1b2c4.tsx",
    "key": {
      "descriptionHash": "...",
      "theme": "dark-code",
      "width": 1920,
      "height": 1080,
      "promptVersion": "a3f9c12e"
    },
    "createdAt": "2026-05-01T10:00:00Z",
    "lastHitAt": "2026-05-01T11:00:00Z",
    "hitCount": 3
  },
  "audio:d4e5f6a7...": {
    "type": "audio",
    "files": { "wav": "audio/d4e5f6a7.wav", "timings": "audio/d4e5f6a7.timings.json" },
    "key": { "ttsText": "...", "voiceRefHash": "ab12cd34..." },
    "createdAt": "2026-05-01T10:00:00Z",
    "lastHitAt": "2026-05-01T11:00:00Z",
    "hitCount": 7
  }
}
```

并发安全：用 `proper-lockfile` 锁 manifest 读写。

### 11.4 CLI

```bash
autovideo cache stats                        # 显示总条目数、磁盘占用、命中率（分 audio/component）
autovideo cache clean                        # 清空全部
autovideo cache clean --type audio           # 仅清音频缓存
autovideo cache clean --type component       # 仅清组件缓存
autovideo cache clean --older-than 30d
autovideo cache clean --stale                # 仅清 promptVersion 已过期的 component 条目
```

---

## 12. 测试策略

| 类型 | 范围 | 工具 |
|------|------|------|
| 单元 | parser、cache（含 promptVersion 失效逻辑）、ffmpeg helpers、narration 处理 | vitest |
| 快照 | `compile` 输入 .md → `script.json` 输出（含 subtitleSafeBottom、图片路径替换） | vitest snapshot |
| 单元 | tts lineTimings 计算（word timings → line timings 映射逻辑） | vitest |
| 集成 | tts 缓存命中（voiceRefHash 变更时失效）、voiceRef 文件校验 | vitest + mock voxcpm2-api |
| 集成 | visuals 缓存命中；validate 失败后错误回喂重试流程 | vitest + mock Claude API |
| E2E | 最小 2 块脚本（各含 visual + narration）跑完整 build | vitest（需 ffmpeg + Chromium） |

**不测试**：Claude 实际生成的组件内容（不可重现）；但要测 validate 流程（喂错误能恢复）。

CI：GitHub Actions 跑除 E2E 之外的全部；E2E 在本地 / 周期性运行。

---

## 13. 依赖

### 13.1 Node 依赖（`package.json`）

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@remotion/bundler": "^4.0.0",
    "@remotion/renderer": "^4.0.0",
    "commander": "^12.0.0",
    "proper-lockfile": "^4.1.2",
    "remotion": "^4.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.0.0"
  }
}
```

### 13.2 Python 依赖（仅 TTS 服务）

```
# voxcpm2-api 服务端（tts-server/requirements.txt）
voxcpm                 # VoxCPM2 推理库
fastapi
uvicorn[standard]
soundfile
numpy
torch

# forced alignment（独立进程）
whisper-timestamped
```

### 13.3 系统依赖（一次性 install 脚本）

- Node 20+
- Python 3.10+ + venv
- ffmpeg
- chromium-browser（Remotion 渲染）
- CJK 字体（`fonts-noto-cjk`）

提供 `install.sh` 脚本一次性装齐；不在 `autovideo build` 内部检查 / 安装。

---

## 14. 成功标准

| 标准 | 衡量方式 |
|------|---------|
| 单命令出片 | `autovideo build project.json` 一次跑完，产出可播 MP4 |
| 音色一致 | 全片所有块共用同一 `voiceRef` WAV，无论重跑多少次音色不变；换 WAV 文件才会变 |
| 行间停顿可感 | 每行末尾固定 200ms 静音，字幕切换自然不跳帧 |
| 增量重做高效 | 改 1 句话仅重跑 TTS 1 块 + render；改 1 个动画仅重跑 visuals 1 块 + render |
| 单块预览 | `autovideo preview --block B03` 5 秒内打开 Studio 显示该块 |
| 失败可恢复 | 任何 stage 失败后，`autovideo {stage} --block` 可单独续跑 |
| 代码体量 | 总 TS 代码 ≤ 4000 行；Python TTS 服务 ≤ 200 行 |

---

## 15. 范围之外（v1 不做）

- 多语言 TTS（仅中文 / 中英混读）
- Web UI / 桌面 app（保持 CLI）
- 实时 / 流式合成
- 多人协作（单机工具）
- Cloud rendering
- 现有视频自动剪辑（另一个工具）
- BGM / 多音轨
- 转场特效以外的镜头语言（推拉摇移）

---

## 16. 里程碑

| 里程碑 | 内容 | 验收 |
|--------|------|------|
| **M1 — Compile + Render 基线** | parser（project.json + meta + blocks）、`script.json` 数据模型、Remotion 框架（BlockFrame + SubtitleOverlay）、单 composition 输出 MP4（用占位组件，不含音频） | 手写 `script.json` + 占位 Component.tsx，渲染出无声 MP4，字幕层正确显示 |
| **M2 — TTS 全链路** | VoxCPM2 服务（autoStart）、voiceRef 校验、逐行合成+静音拼接、whisper forced alignment、音频缓存 | E2E 跑 2 块脚本，出带配音字幕 MP4；换 voiceRef 后缓存自动失效重新合成 |
| **M3 — Visuals 全链路** | Claude SDK 集成（所有块）、promptVersion 失效机制、validate + 重试、降级、component 缓存、可配置缓存目录 | 跑含 2 块真实描述的脚本，成功出片；改描述后仅重生成该块 |
| **M4 — Iter 工作流** | preview、`--block --force`、cache CLI、doctor、init | 改单块重跑 < 30 秒 |
| **M5 — 打磨** | 完整文档、错误信息打磨、E2E 测试套件 | README 起手 5 分钟出第一个 demo |
