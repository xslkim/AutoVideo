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

1. **AI 只做必要的事**。只在 `visuals` 阶段做开放式生成（用 Claude 根据描述生成 React 组件）；TTS（VoxCPM2 推理虽然也是模型，但输入 → 输出固定）、字幕、渲染、拼接都是确定性流程，不依赖任何 LLM 判断。
2. **单一数据源**。`script.json` 是贯穿全部 stage 的 IR；每个 stage 是 `script.json → script.json` 的纯变换。
3. **每个 stage 独立可重跑、每个块独立可重渲**。改一句话不需要重跑全流程；改一个动画不需要重新 TTS；render 阶段每块产出独立的 `partials/B**.mp4`，最后 ffmpeg concat 拼成 `final.mp4`，单块修改的端到端时间 ≈ 单块渲染时间 + 几秒 concat。
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
| `@duration` | | 自动 | 强制时长，仅接受 `<数字>s` 格式（如 `8s`、`1.5s`）；不支持纯数字、毫秒单位、复合（`1m20s`）。有旁白时可省略，由 TTS 时长决定 |

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
karpathy 用一个 **Value** 类实现了它
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
- 引用本地图片时直接写相对路径（必须以 `./` 或 `../` 开头），如 `显示图片 ./assets/diagram.png`；compile 阶段按文件内容 hash 复制到 `public/assets/{hash}.png`，描述中的路径替换为 `assets/{hash}.png`（不带前导 `/`），LLM 生成的组件用 `<Img src={staticFile("assets/{hash}.png")} />` 加载；不同目录下同名文件、图片内容变更均会得到不同 hash
- 引用本地源代码片段时（如 `microgpt.py 第 30-50 行`），compile 阶段同样按文件内容 hash 复制到 `public/assets/{hash}.py`；同时**仅内联描述中显式指定的行号范围 + 上下文 ±5 行**（包裹在代码块标记内）到 `visual.description`，不内联整个文件——避免长文件让 component prompt 的 user 部分膨胀、破坏跨块 prompt cache 命中率；保留 `assets/{hash}.py` 引用以备组件按需 fetch 完整文件做更精细的行高亮
- 描述越具体，生成效果越准确；主题色、字号等无需指定，由 `theme` 统一控制

### 3.7 旁白语法

- **每个非空行 = 一条字幕**，TTS 合成后该行音频结尾自动附加 **200ms 静音**。
- 空行忽略（不产生额外停顿）。
- **`**word**`** 在字幕中高亮显示（不影响 TTS）。
- 字面 `**` 通过反斜杠转义：`\*\*` 解析为字面双星号，不进入高亮匹配。
- VoxCPM2 不支持 SSML 或重音控制符，因此不提供朗读重音语法；如需强调，请通过断句、感叹号等自然方式表达。

### 3.8 动画预设（`@enter` / `@exit`）

`fade` / `fade-up` / `fade-down` / `slide-left` / `slide-right` / `zoom-in` / `zoom-out` / `none`

入场和出场动画由系统统一执行（包裹在组件外层），不进入 LLM 生成的组件内部。

**预设时长**：所有预设统一使用 `render.defaultEnterSec`（默认 0.5s）和 `render.defaultExitSec`（默认 0.3s）；不同预设只改运动曲线（fade 用 opacity、slide 用 transform 等），不改时长。`none` 预设时长为 0。如需为单块覆盖时长，未来可通过 `@enter: fade-up 0.8s` 语法扩展（当前版本不支持）。

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
  };

  narration: {
    lines: NarrationLine[];
    explicitDurationSec?: number;   // @duration
  };

  // Stage 2 填写
  audio?: {
    wavPath: string;                 // 相对 build out dir 的 POSIX 路径，固定为 "public/audio/{id}.wav"
    durationSec: number;             // 合并后 WAV 实际时长，含每行尾部 200ms 静音
    lineTimings: { lineIndex: number; startMs: number; endMs: number }[];
    // lineIndex 对应 narration.lines[lineIndex]
    // startMs/endMs 以块音频原点（0ms）为参考；每行 endMs 后跟 200ms 静音再到下一行 startMs
    // 由 tts stage 从各行单独 TTS 输出的音频时长累加计算
  };

  // Stage 4 填写（每块自包含；不需要全局 startFrame，因为每块独立渲染为 partial mp4）
  timing?: {
    enterSec: number;
    holdSec: number;
    exitSec: number;
    totalSec: number;
    frames: number;
    enterFrames: number;        // = round(enterSec * fps)，给 SubtitleOverlay 和 Audio offset 用
  };

  // Stage 4 填写（partial mp4 缓存命中信息，便于 doctor / dry-run 显示）
  render?: {
    partialPath: string;        // 相对 build out dir 的 POSIX 路径，固定为 "output/partials/{id}.mp4"
    cacheHit: boolean;          // 本次 render 是否走缓存（true = 直接 cp，false = 真实渲染）
  };
}

interface NarrationLine {
  text: string;                 // 原文（含 ** 标记）
  ttsText: string;              // 喂给 VoxCPM2 的纯文本（** 已去掉）
  highlights: { start: number; end: number }[];  // 基于 ttsText 的字符 offset（** 已剥离），用于字幕渲染
}

// 每行末尾固定附加 200ms 静音，无需在数据模型中存储。
```

**LLM 生成的组件接口**（所有块统一）：

```typescript
interface AnimationProps {
  frame: number;              // 块内帧（0 起）；通常组件直接调 useCurrentFrame()，此 prop 是显式 fallback
  durationInFrames: number;
  width: number;              // 视频宽度（px）
  height: number;             // 视频高度（px）
  subtitleSafeBottom: number; // 底部字幕区高度（px）；组件应将重要内容保持在 height - subtitleSafeBottom 以上
  theme: Theme;
  fps: number;
}

export default function Component(props: AnimationProps): JSX.Element;
```

**系统侧渲染外壳接口**（用户不写，由 `remotion/engine/block-frame.tsx` 实现，render.ts / preview.ts 调用）：

```typescript
interface BlockFrameProps {
  enter: AnimationPreset;     // 入场动画预设（fade / fade-up / ... / none）
  exit: AnimationPreset;
  enterFrames: number;        // 入场动画占用帧数
  exitFrames: number;         // 出场动画占用帧数
  durationInFrames: number;   // 块总帧数（含 enter + hold + exit）
  fps: number;
  children: React.ReactNode;  // 块内容（DynamicComponent + SubtitleOverlay + Audio）
}

interface SubtitleOverlayProps {
  lines: NarrationLine[];
  lineTimings: { lineIndex: number; startMs: number; endMs: number }[];
  audioStartFrame: number;    // = enterFrames；字幕显示窗口从此帧起算（入场期间不显示）
  frame: number;              // 块内帧
  fps: number;
  theme: Theme;
}

interface Theme {
  name: string;                 // 例如 "dark-code"
  colors: {
    bg: string;
    fg: string;
    accent: string;
    muted: string;
    code: { bg: string; fg: string; keyword: string; string: string; comment: string };
  };
  fonts: { sans: string; mono: string };
  spacing: { unit: number };    // 基础间距（px）
  subtitle: {
    fontFamily: string;
    fontSizePct: number;        // 相对 height
    lineHeight: number;
    maxWidthPct: number;        // 相对 width
    backgroundColor: string;
    paddingPx: number;
  };
}
```

`Theme` 字段集合是 LLM 生成组件时可直接消费的契约，PRD 锁定的是字段集合（不锁定具体取值）；具体主题（`dark-code` 等）的 token 值在 `remotion/engine/theme.ts` 中维护。

组件始终全屏渲染（`width × height`），字幕作为独立的 `SubtitleOverlay` 层叠加在上方，无需在组件内绘制字幕。

JSON Schema 在 `schemas/script.schema.json` 维护。每个 stage 必须先验证再处理。

**Stage-specific readiness**：单一宽松 schema 无法严格校验各阶段前置条件，因此在 TypeScript 层额外定义：
- `CompiledScript`：compile 输出；无 audio / componentPath / timing
- `AudioReadyScript`：tts 输出；所有块含 `audio`
- `VisualReadyScript`：visuals 输出；所有块含 `visual.componentPath`
- `RenderInputScript`：render 入口前提；所有块含 audio + componentPath，但 **timing 尚未计算**（render stage 第 1 步会算并写回）
- `RenderedScript`：render 完成后；所有块含 audio + componentPath + timing + render.partialPath

每个 stage 入口接收对应的 readiness type，TypeScript 静态保证前置条件。

**Assets manifest**：`script.json` 顶层维护 `assets` 字段，记录所有本地资产的相对路径 → 构建路径映射：

```typescript
interface Script {
  // ...
  assets: Record<string, string>;
  // key: 相对 project.json 所在目录的 POSIX 路径（如 "intro/architecture.png"）；
  //   - 不用绝对路径：避免 IR 绑死到具体机器的 home dir / 项目位置
  //   - 同名不同目录由相对路径自然区分
  //   - 内容变更由 value 中的 hash 区分（cache 键不依赖此字段，命中行为跨机器一致）
  // value: "assets/{hash}.ext"（不带前导 /；Remotion 渲染时由 staticFile() 拼接 URL）
}
```

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
│  │          │   │          │   │   API    │   │  ffmpeg  │      │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘      │
│       │              │              │              │            │
│       └──────────────┴──────┬───────┴──────────────┘            │
│                             ▼                                    │
│                      script.json                                 │
│                      (canonical IR)                              │
│                             │                                    │
│                             ▼                                    │
│           {cache-dir}/  (audio, components, partials)             │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
              output/partials/B01.mp4  ┐
              output/partials/B02.mp4  ├─ ffmpeg concat → final.mp4
              output/partials/B03.mp4  ┘
                             │
                             ▼
                  ffmpeg loudnorm → final_normalized.mp4
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
6. 旁白预处理：拆行（忽略空行）→ 解析 `**` 高亮 → 生成 `NarrationLine[]`
7. 解析 `aspect` → 计算 `width/height`；按分辨率计算 `subtitleSafeBottom`（默认 `height × 0.15`），该高度由 `theme.subtitle` 中的字号、字体、行高、最大行宽推导，并随主题变化；字幕样式 token 包含：`fontFamily`（默认 `"Noto Sans SC, Noto Sans, sans-serif"`，覆盖 CJK + emoji fallback）、`fontSize`（按 height 比例）、`lineHeight`、`maxWidthPct`、`backgroundColor`、`paddingPx`
8. 扫描每个块 `--- visual ---` 描述中的本地文件路径引用（形如 `./xxx` 或 `../xxx`，必须以 `./` 或 `../` 开头，不匹配裸词），按所在 `.md` 文件目录解析为绝对路径，将文件内容 hash（MD5 前 8 位）+ 原始扩展名作为目标文件名复制到 `public/assets/{hash}.ext`，并将描述中的路径替换为 `assets/{hash}.ext`（不带前导 `/`，由组件 `staticFile("assets/{hash}.ext")` 拼接 URL）；在 `script.json.assets` 中以**相对 `project.json` 所在目录的 POSIX 路径**为 key 维护 manifest（不用绝对路径，便于跨机器 / CI 分享 IR；同名不同目录文件由相对路径自然区分；图片内容更新由文件 hash 区分）。
9. JSON Schema 验证后写出 `script.json`

**实现**：纯函数；无外部服务调用；可在毫秒级完成。

### 6.2 Stage 2 — `tts`：旁白 → 音频 + 字幕时序

**输入**：`script.json`（已 compile，含 `meta.voiceRef` 绝对路径）
**输出**：每块 `public/audio/B**.wav` + line-level 时序（`lineTimings`），写回 `script.json.blocks[].audio`（音频放在 `public/` 下，使 Remotion `staticFile()` 可直接解析）

#### 6.2.1 VoxCPM2 服务

VoxCPM2 是 zero-shot 语音克隆引擎，没有内置预设音色。音色完全由调用时传入的**参考音频**决定。  
`/v1/voices` 和 `/v1/speech` 是本项目 `tts-server/server.py` 自建的 FastAPI wrapper 接口约定，不是 VoxCPM2 官方原生 REST API。底层调用 `VoxCPM.generate(reference_wav_path, ...)`。

- stage 启动前检测 voxcpm2-api HTTP 服务（默认 `http://127.0.0.1:8000`）是否可达
- 不可达时尝试自动启动（`uvicorn server:app`），仍失败则报错，提示用户运行 `autovideo doctor`

#### 6.2.2 参考音频

`meta.voiceRef` 是整部视频**唯一**的音色来源，**必须由用户预先提供**（10–30 秒清晰人声 WAV，默认为 `B00.wav`）。  
tts stage 启动时调用一次 `POST /v1/voices` 注册该 WAV，server 端把文件挂载在临时目录并返回 `voice_id`；后续每行 TTS 只传 `voice_id`，避免每次 base64 上传 ~2MB 的开销。`voice_id` 仅在当前 stage 进程内复用，不持久化到 manifest——每次 tts stage 启动都强制重新注册一次（即使 server 进程没崩，也不复用上次的 `voice_id`），避免 server 中途崩溃 + autoStart 重启后旧 `voice_id` 失效导致的难排查错误。

#### 6.2.3 TTS 调用流程

对每个块的 `narration.lines` 逐行处理：

1. 检查缓存（key：`MD5(ttsText + voiceRefHash + cfgValue + inferenceTimesteps + denoise + modelVersion)`），命中直接复制，跳过 API 调用
2. Cache miss → 调用 voxcpm2-api：

```http
POST /v1/voices
Content-Type: application/json

{ "wav_base64": "<one-time at stage start>" }
→ { "voice_id": "v_abc123" }

POST /v1/speech
Content-Type: application/json

{
  "text": "<narration line>",
  "voice_id": "v_abc123",
  "cfg_value": 2.0,
  "inference_timesteps": 10,
  "denoise": false,
  "retry_badcase": true
}
```

响应为 WAV 二进制（48kHz）。`cfg_value`、`inference_timesteps`、`denoise`、`retry_badcase` 均从 `autovideo.config.json` 的 `voxcpm` 段读取，对应 `VoxCPM.generate()` 同名参数。

3. 将每行音频末尾附加 **200ms 静音**，按行顺序拼接，合并为 `public/audio/B**.wav`
4. 从各行音频时长累加计算 `lineTimings`：`startMs[i] = Σ(行[0..i-1]时长 + 200ms)`，`endMs[i] = startMs[i] + 行[i]时长`；写入 `audio` 字段

#### 6.2.4 约束

- 单行 TTS 失败时重试 3 次（间隔 5s），仍失败 → 此块标记错误，stage 立即终止；同时取消所有 in-flight HTTP 请求并等清理完成后退出（避免占用 GPU 推理资源）
- 多行并发数默认 4（`voxcpm.concurrency`），可配置

### 6.3 Stage 3 — `visuals`：所有块 → React 组件

**输入**：`script.json`
**输出**：`src/blocks/B**/Component.tsx`，写回 `script.json.blocks[].visual.componentPath`

**职责**：
1. 处理**所有**块；逐块检查缓存，命中则直接复制组件文件，跳过 API 调用
2. 缓存 key：`MD5(visual.description + theme + width + height + promptVersion + assetHashesJson + claudeModel)`
   - `promptVersion`：系统 prompt 文件（组件模板 + AnimationProps 接口）的内容 hash 前 8 位；prompt 变更时自动失效旧缓存
   - `assetHashesJson`：本块描述中引用的所有本地资产文件内容 hash 的排序 JSON 字符串；图片路径不变但内容变更时自动失效
   - `claudeModel`：`anthropic.model` 配置值；模型切换时旧缓存失效
3. Cache miss → Claude API 调用：
   - 默认 `claude-sonnet-4-6`（可配置）
   - 使用 prompt caching：系统 prompt 包含组件模板、theme tokens、AnimationProps 接口定义（长期不变部分），按 Anthropic SDK `cache_control: ephemeral` 标记，目标命中率 > 90%
   - 工具调用要求返回 `{ tsx: string }` JSON
   - 生成的组件必须全屏渲染（`width × height`），重要内容避开底部 `subtitleSafeBottom` 像素
   - 完整 system prompt 草稿和组件骨架示例维护在 `docs/ARCHITECTURE.md` 的 "Visuals prompt" 一节，PRD 不锁定具体内容
4. 生成后做两轮验证：
   - **静态**：`tsc --noEmit -p tsconfig.visuals.json` 通过
   - **动态**：`remotion render` 单帧非纯黑、非纯白
     - **临时时长**：visuals 跑在 render 之前，`block.timing` 尚未计算；用 fallback `tempDurationSec = audio?.durationSec ?? 5`，验证帧固定取 `floor(tempDurationSec * fps / 2)`（中间帧）
     - 此 fallback 仅用于验证；最终渲染时 `durationInFrames` 按 render stage 的真实计算结果
5. 任一验证失败 → 将错误信息回喂给模型，最多 3 轮重试
   - **回喂内容**：`tsc` 取 stderr 前 50 行 + 报错行号对应的源码片段（前后各 5 行）；`remotion render` 取 stderr 前 50 行 + 当前组件完整源码
   - 每轮重试都把上一轮组件源码、错误、修复指令一并放进 user message，system prompt 不变（保持 prompt cache 命中）
6. 3 轮仍失败 → 此块标记错误，stage 立即终止；输出失败块列表及恢复命令（`autovideo visuals --block <id> --force`）；不降级、不继续后续块

**安全边界**：生成的组件在 Remotion / tsc 环境中编译执行，等同于运行模型生成的代码。必须满足：
- 只允许 import `remotion`、`react`、以及 system prompt 中明确声明的 whitelist 包（主题 token、工具函数）
- 禁止 import `fs`、`path`、`child_process`、`http`/`https` 及任何 Node 内置模块
- 组件文件不得包含顶层副作用（`fetch`、文件写入、进程调用）
- 单独 `tsconfig.visuals.json`：`compilerOptions.types: ["react", "remotion"]`、`lib: ["ES2022", "DOM"]`、`noEmit: true`、`jsx: "react-jsx"`、`strict: true`（jsx 字段必填，否则 .tsx 直接编译报错；strict 用于拦截 LLM 常见的类型错误）；编译入口仅指向当前块组件 + 一个最小 shim（暴露 `AnimationProps`、`Theme` 类型别名），不引入项目其他源码
- AST 静态扫描禁止的 import / `require()` / `eval` / `Function` 构造调用
- 单帧渲染超时 30s；超时视为验证失败，触发重试
- **运行时隔离**：单帧验证、最终 `remotion render` 都在受限子进程中执行——
  - **环境变量白名单**（仅这些会传给子进程）：`PATH`、`HOME`、`LANG`、`TMPDIR`、`DISPLAY`（如需）、`NODE_OPTIONS`（如需）；其他全部剥除（含 `ANTHROPIC_API_KEY` 及任何未来引入的 token）
  - 设置 CPU/内存上限（用 `prlimit` 或 systemd-run 包裹）
  - 验证子进程关闭网络（`unshare -n`）；最终 render 子进程允许网络（部分主题字体 CDN 加载需要）
  - 仅支持 Linux（Ubuntu 22.04+）；不为其他平台保留兼容层

**并发**：默认同时处理 4 个块（`anthropic.concurrency`）；Claude API 限速时自动退避。  
**失败时取消语义**：任一块 3 轮重试仍失败时，立即取消所有 in-flight Claude 请求（`AbortController`），等取消完成后退出 stage，避免在已确定失败的 build 上继续累积 API 费用。

### 6.4 Stage 4 — `render`：IR + 资产 → MP4

**输入**：`script.json`（带 audio + componentPath） + `audio/` + `src/blocks/`
**输出**：每块 `output/partials/B**.mp4` + 最终 `output/final.mp4` + `output/final_normalized.mp4`

**核心思路**：每个块作为独立的 Remotion Composition 单独渲染产出 `partials/B**.mp4`，最后用 `ffmpeg concat` 无损拼接为 `final.mp4`。修改单块只重渲该块 + 重 concat（concat 是流复制，秒级完成），不触动其他块。

**职责**：

1. **计算每块时序**（仍是块自包含的）：`hold = max(audio?.durationSec ?? 0, narration.explicitDurationSec ?? 0, MIN_HOLD)`，其中 `MIN_HOLD = render.minHoldSec`（默认 1.5s，定义在 `autovideo.config.json`）；`enter / exit` 时长来自 `render.defaultEnterSec / defaultExitSec`（`none` 预设时长固定为 0）；`total = enter + hold + exit`，写回 `timing`；不再需要 `startFrame`（每块独立渲染时无全局帧号意义，仅在拼接顺序上保留 `blocks[]` 数组次序）

2. **生成 `public/script.json`**（Remotion 静态读取，包含全部块以便单块 render 也能拿到完整 theme/assets manifest）；由 render stage 主进程在 fork 子进程**之前**写入一次，并发渲染子进程仅读不写，避免 N 个子进程同时写同一文件的冲突

3. **写一个 `Root.tsx` 注册一个参数化 Composition**：
   ```tsx
   <Composition
     id="Block"
     component={BlockComposition}
     durationInFrames={1}   // 占位，实际由 inputProps 决定
     fps={fps} width={width} height={height}
     calculateMetadata={({ inputProps }) => {
       const block = script.blocks.find(b => b.id === inputProps.blockId);
       return { durationInFrames: block.timing.frames };
     }}
   />
   ```
   `BlockComposition` 渲染结构：
   ```tsx
   <BlockFrame enter={block.enter} exit={block.exit}>
     <DynamicComponent {...animationProps} />     // LLM 生成的全屏组件
     <SubtitleOverlay
       lines={block.narration.lines}
       lineTimings={block.audio.lineTimings}
       audioStartFrame={enterFrames}              // 入场期间不显示字幕；与 frame 同单位（帧）
       frame={frame} fps={fps} />
     <Sequence from={enterFrames}>
       <Audio src={staticFile(`audio/${block.id}.wav`)} />
     </Sequence>
   </BlockFrame>
   ```
   音频用 `<Sequence from>` 而非 `<Audio startFrom>`：`startFrom` 的语义是"裁掉音频开头 N 帧"，会让音频在 frame 0 就播放并丢掉前 enterFrames 帧的内容；`<Sequence from>` 才是"延迟 N 帧后从音频开头播放"，符合"入场动画结束才开始旁白"的需求。

4. **逐块独立渲染**：
   - **bundle 一次共享**：render stage 入口调用 `@remotion/bundler.bundle({ entryPoint: 'remotion-root.tsx' })` 一次得到 `serveUrl`，所有并发块的渲染共享此 `serveUrl`，避免每块都重新 webpack 打包（一次 bundle 5-15s，多块并发会重复浪费）
   - **每块走 renderMedia**：对每个块先检查 partial 缓存；命中则 `cp ~/.autovideo/cache/partials/{hash}.mp4 → output/partials/B**.mp4`；未命中则程序化调用：
     ```ts
     await renderMedia({
       composition,                    // selectComposition({ serveUrl, id: 'Block', inputProps })
       serveUrl,                       // 共享自上一步
       outputLocation: `output/partials/${blockId}.mp4`,
       inputProps: { blockId },
       concurrency: framesConcurrencyPerBlock,  // 见 §9
       codec: 'h264',
     });
     ```
   - **块级并发**：用 `p-limit(render.blockConcurrency)` 控制（默认 4）；单块内 Chrome 实例数走 `render.framesConcurrencyPerBlock`，避免两层并发相乘 CPU 爆掉
   - **失败语义**：任一块渲染失败立即取消其他 in-flight `renderMedia` 调用（`AbortController`），等清理完成后退出 stage

5. **partial 缓存**：缓存 key 见 §11.2，包含组件内容、音频内容、theme、尺寸、enter/exit 预设、fps、Remotion 版本。命中时直接 `cp` 到 `output/partials/`。

6. **ffmpeg concat 拼接**（在 build out dir/`output/` 下执行；`partials/B**.mp4` 是相对此 cwd 的路径）：
   ```bash
   # cwd = build/{slug}/output/
   echo "file 'partials/B01.mp4'" > concat.txt
   echo "file 'partials/B02.mp4'" >> concat.txt
   ...
   ffmpeg -fflags +genpts -f concat -safe 0 -i concat.txt \
          -c copy -avoid_negative_ts make_zero final.mp4
   ```
   `-c copy` 是流复制，无重编码，秒级完成。要求所有 partial 的编码参数（codec、分辨率、fps、像素格式、SAR、profile/level）严格一致——Remotion 已统一这些参数，但 stage 启动前用 `ffprobe` 抽样校验，不一致则报错（防止编码漂移）。
   - **PTS 处理**：`-fflags +genpts` + `-avoid_negative_ts make_zero` 重建 / 归零跨文件 PTS，避免 H.264 + AAC concat 在边界出现 PTS 不连续导致播放器卡顿或 A/V 失同步
   - **GOP 起点对齐 IDR**：每个 partial 必须以 IDR 关键帧开头才能被流复制 concat。`remotion.config.ts` 中显式 `setKeyframeInterval(1)`（或等价配置）保证 Remotion 输出的每段 mp4 首帧都是 IDR；否则少数情况会出现首帧绿屏 / 丢帧

7. **响度标准化**：ffmpeg `loudnorm` two-pass（默认 `I=-16 TP=-1.5 LRA=11`，参数从 `render.loudnorm` 读取）→ `output/final_normalized.mp4`
   - 第 1 遍 `-af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -` 解析 stderr 中的 JSON（measured_I / measured_TP / measured_LRA / measured_thresh / target_offset）
   - 第 2 遍带 measured 参数重跑：`-c:v copy -c:a aac -b:a {render.loudnorm.audioBitrate} -af loudnorm=...:measured_I=...`（视频流复制，仅音频重编码到 AAC；显式 `-b:a 192k` 与 Remotion partial 默认 AAC 比特率匹配，避免重编码后比特率漂移影响文件体积）
   - **不能与 step 6 的 concat 合并到一条 `-c copy` 命令**：loudnorm 必须重编码音频，concat 是流复制，两者互斥
   - **最终交付物是 `final_normalized.mp4`**；`final.mp4` 是 concat 中间产物，保留便于在响度异常时调试（无 loudnorm 的原始拼接）

8. **质量校验**：分辨率、总时长（partial 时长之和 ± 1 帧）、5 个抽样帧非黑

**`--block B03` / `--block B03,B07` 语义**：仅重渲指定块的 partial（强制 cache miss），然后**自动重新 concat** 生成新的 `final.mp4`（其他块的 partial 复用磁盘上已有文件）。这是该架构的核心优势：单块修改的端到端时间 ≈ 单块 Remotion 渲染时间 + 几秒 concat。

**移除原 `--range` 语义**：CSV 形式的 `--block` 已经覆盖"重渲多块"，不再需要单独的 `--range`；从 CLI 中删除。

### 6.5 Stage 5 — `preview`：本地交互预览

**输入**：`script.json`
**输出**：浏览器打开 Remotion Studio

```bash
autovideo preview script.json                # 打开 Studio，所有块作为 Composition 列表
autovideo preview script.json --block B03    # 直接定位到 B03
```

实现：写一个临时 `Root.tsx` 把每个块注册为独立 Composition（`id="B01"`, `"B02"`, ...），调 `npx remotion studio`。Studio 左侧列表显示所有块，点击单块进入 scrub。**preview 与 render 是两份不同的 `Root.tsx`**：preview 由 `cli/preview.ts` 生成（每块一个 Composition，便于 Studio 列表展示），render 由 `cli/render.ts` 生成（一个参数化 Composition `id="Block"` + `inputProps.blockId`，便于命令行渲染）；两份 Root 共用同一 `BlockComposition` 组件实现，保证 Studio 中看到的与最终 partial 内容视觉一致。

**`--block` 时序处理**：
- 若该块已有 `audio.durationSec`（tts 已跑过），用真实 TTS 时长作为 `holdSec`，`BlockComposition` 正常挂载 `<Audio>`
- 若没有 audio（用户尚未跑 tts），用 `narration.explicitDurationSec ?? render.minHoldSec` 作为占位 hold；预览中字幕按行均匀分配（无 lineTimings），仅供视觉布局检查；**此时不挂载 `<Audio>` 组件**（避免 `staticFile("audio/B**.wav")` 404 让 Studio 报错），按 muted 视频预览
- preview 不会触发 tts 或 visuals 自动重跑；缺失 componentPath 时显示占位提示

**全片预览**：preview 不再支持"跨块连续 scrub"（每块是独立 Composition）；如需查看完整成片，运行 `autovideo render` 后用任意播放器打开 `output/final.mp4`。

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

# 分步（每步可单独运行；所有命令均接受 --config / --cache-dir / --verbose / --dry-run）
autovideo compile <project.json>         [--out DIR] [--config FILE] [--meta key=value]...
autovideo tts     <script.json>          [--block B03] [--force] [--config FILE]
autovideo visuals <script.json>          [--block B03] [--force] [--config FILE]
autovideo render  <script.json>          [--block B03[,B07...]] [--force] [--config FILE]

# 预览
autovideo preview <script.json>          [--block B03] [--config FILE]

# 工具
autovideo cache    stats | clean [--type audio|component|partial] [--older-than 30d] [--stale]
autovideo doctor                          # 检查环境，输出 PASS/WARN/FAIL 表；退出码见下文
autovideo init     <dir>                  # 生成模板项目（含示例 project.json + meta.md + script.md + README.md）
                                          # 生成的 README.md 说明：在 meta.md 同目录放置 B00.wav（10–30s 清晰人声 WAV）后才能 build
```

**`autovideo doctor` 检查项 + 退出码**：

| 检查项 | 通过条件 | 失败处理 |
|--------|---------|---------|
| Node 版本 | ≥ 20 | FAIL |
| ffmpeg 版本 | ≥ 5.0 | FAIL（4.x 视为 WARN，loudnorm JSON 解析可能异常） |
| Chromium 可用 | `@remotion/renderer` 能找到或自动下载 | FAIL |
| CJK 字体 | `@remotion/google-fonts/NotoSansSC` import 成功 | WARN |
| VoxCPM2 服务可达 | `GET {endpoint}/health` 200 | WARN（autoStart 启用时可恢复） |
| VoxCPM2 模型权重 | `voxcpm.modelDir/config.json` 存在 | FAIL |
| Claude API key | `process.env[anthropic.apiKeyEnv]` 非空 | FAIL |
| Claude API 连通 | 一次最小 ping 调用返回 200 | WARN |
| 缓存目录可写 | `cache.dir` 存在且 RW | FAIL |
| 磁盘空间 | ≥ 5GB | WARN（< 1GB → FAIL） |
| `prlimit` / `unshare` 可用 | which 通过 | FAIL（Linux only） |

退出码：`0` = 全 PASS，`1` = 有 WARN 但无 FAIL，`2` = 至少一个 FAIL。

通用 flag：

- `--force`：忽略缓存，强制重做
  - 不带 `--block` 时：当前 stage 的全部块都强制 cache miss
  - 与 `--block` 一起：仅指定块强制 cache miss
- `--block <id[,id...]>`：仅处理指定块，支持单个 ID 或逗号分隔的多个 ID（如 `--block B03` 或 `--block B03,B07`）
  - 默认走 partial / audio / component cache（命中即跳过）；命中时只更新 `final.mp4`（render stage）或 `script.json` 时序字段
  - **build 子命令不接受 `--block`**（`autovideo build --block B03` 会报错并提示使用 `autovideo render --block B03`）；build 是端到端入口，"局部更新"语义只在分步命令上有意义
- `--out <dir>`：输出目录（默认 `./build/{slug(title)}/`）
  - `slug(title)` 规则：CJK 转拼音 → 移除非 ASCII 安全字符 → 空格 / `/` / emoji 等转 `-` → 全小写；保证路径在 Windows / shell / ffmpeg `-i` 中无需转义。如不希望使用自动 slug，meta.md 可显式提供 `slug:` 字段覆盖
- `--cache-dir <dir>`：覆盖缓存目录（优先于 config 和默认值）
- `--meta key=value`：覆盖 `meta.md` 中的字段；**只支持顶层 meta 字段**（即 §3.4 表格中列出的字段，如 `title` / `voiceRef` / `aspect` / `theme` / `fps`），不支持 dot notation 嵌套；字符串 / 数字 / 布尔自动推断类型，无法推断时按字符串处理。`render` / `voxcpm` / `loudnorm` 等非 meta 配置请通过 `autovideo.config.json` 覆盖，不通过 `--meta`
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
│   │   ├── audio.ts              # ffmpeg helpers（拼接静音、格式转换、时长读取）
│   │   └── timings.ts            # lineTimings 累加计算（从各行音频时长推导）
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
├── tts-server/                   # VoxCPM2 Python 服务（voxcpm2-api；自建 FastAPI wrapper）
│   ├── server.py                 # FastAPI，POST /v1/speech（返回 WAV 二进制）
│   └── requirements.txt
│
├── schemas/
│   └── script.schema.json
│
├── templates/
│   └── starter/                  # autovideo init 复制此模板
│       ├── project.json
│       ├── meta.md
│       ├── script.md
│       ├── autovideo.config.json # 可选项目级配置示例
│       └── README.md             # 提示用户放置 B00.wav
│
├── install.sh                    # 一次性安装系统依赖（apt + pip + npm）
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
./build/microgpt/                  # microgpt = slug(title)，详见 §7
├── script.json                   # canonical IR
├── src/
│   └── blocks/
│       ├── B01/Component.tsx     # LLM 生成的组件（每块一个）
│       └── ...
├── public/                        # Remotion staticFile() 根目录；下列内容均通过 staticFile() 读取
│   ├── script.json                # Remotion 静态读取
│   ├── audio/                     # block-level 合并 WAV（含尾部 200ms 静音）
│   │   ├── B01.wav
│   │   └── ...
│   └── assets/                    # compile 阶段按内容 hash 复制的本地资产
│       ├── 7b8c9d10.png
│       └── ...
├── logs/
│   ├── tts-2026-05-01.log
│   └── visuals-2026-05-01.log
├── tsconfig.visuals.json         # visuals 验证用最小 tsconfig
└── output/
    ├── partials/                 # 每块独立渲染产物（render stage 总是生成）
    │   ├── B01.mp4
    │   ├── B02.mp4
    │   └── ...
    ├── concat.txt                # ffmpeg concat list（每次 render 重写）
    ├── final.mp4                 # ffmpeg concat 拼接结果
    └── final_normalized.mp4      # loudnorm 后输出
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
    "inferenceTimesteps": 10,               // diffusion 推理步数（默认 10）
    "denoise": false,                       // 是否对参考音频做降噪
    "retryBadcase": true,                   // VoxCPM 内部 badcase 重试
    "concurrency": 4                        // 并发 TTS 行数
  },
  "anthropic": {
    "apiKeyEnv": "ANTHROPIC_API_KEY",
    "model": "claude-sonnet-4-6",
    "promptCaching": true,
    "maxRetries": 3,
    "concurrency": 4             // visuals stage 同时调用 Claude 生成的块数
  },
  "render": {
    "blockConcurrency": 4,                 // 同时渲染几个块（块级并发；每块一次 renderMedia 调用）
    "framesConcurrencyPerBlock": null,     // 单块内 Remotion Chrome 实例数；null = max(1, floor(cpus / blockConcurrency))，避免与块级并发相乘后吃爆 CPU
    "browser": null,                       // null = Remotion 自动检测/下载 Chromium；用户可显式指定路径覆盖
    "minHoldSec": 1.5,                     // §6.4 timing 计算中的 MIN_HOLD 即此值
    "defaultEnterSec": 0.5,
    "defaultExitSec": 0.3,
    "loudnorm": {
      "i": -16,                            // integrated loudness target（流媒体常用 -16 LUFS）
      "tp": -1.5,                          // true peak ceiling
      "lra": 11,                           // loudness range
      "twoPass": true,                     // 启用两遍 loudnorm（更准确）
      "audioBitrate": "192k"               // 第 2 遍 -c:a aac 的 -b:a 显式指定，避免与 partial 原始 AAC 比特率漂移
    }
  },
  "cache": {
    "dir": "~/.autovideo/cache",   // 支持绝对路径或 ~ 路径；CLI --cache-dir 优先级更高
    "maxSizeGB": 20,               // 缓存目录上限；超过时按 lastHitAt 升序 LRU evict（partial 优先于 component / audio，因 partial 单文件更大）
    "evictTrigger": "stage-start"  // "stage-start" | "manual"；前者仅在使用缓存的 stage（tts / visuals / render）启动前检查并 evict（compile 不读缓存，跳过），后者仅 `autovideo cache clean` 触发
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
| 单块 TTS 失败 | 重试 3 次（间隔 5s）；仍失败 → stage 立即失败，输出失败块列表及恢复命令 |
| Claude API 失败 | 重试 3 次（指数退避） |
| 生成的组件验证失败 | 错误回喂模型，最多 3 轮；仍失败 → stage 立即失败，输出失败块列表及恢复命令；无降级 |
| 生成组件包含禁止 import | `tsc` 静态检查阶段拦截，视为验证失败触发重试 |
| 单块 partial 渲染失败 | 重试 1 次；仍失败 → 立即取消所有 in-flight 渲染子进程，输出失败块列表 + 恢复命令（`autovideo render --block <id> --force`），保留已生成的 partial 便于调试 |
| ffmpeg concat 编码参数不一致 | concat 前 ffprobe 抽样校验 codec/分辨率/fps/像素格式/SAR；不一致立即报错并提示运行 `autovideo cache clean --type partial` 后重渲（通常因升级 Remotion 后旧 partial 残留导致）|
| 磁盘 < 5GB | 任何 stage 启动前预检，不足拒绝 |

**进程 cwd 约定**：所有 stage 进程的 cwd 统一设置为 build out dir（`./build/{slug}/`）。`logs/`、`output/concat.txt`、`public/script.json` 等路径都按此基准解析；`script.json` 中的 `audio.wavPath` / `render.partialPath` / `assets[*]` 均为相对 build out dir 的 POSIX 路径。

**所有错误都有结构化日志**：`logs/{stage}-{date}.log`（相对 build out dir），每条带 stage / block-id / 时间戳 / 错误堆栈。

**stage 失败汇总**：失败结束时输出可执行的恢复命令清单，例如：

```
✗ Build failed at stage `tts` (2 block(s) failed)

Failed blocks:
  B03: VoxCPM timeout after 3 retries
  B07: VoxCPM connection refused

Resume after fixing the issue:
  autovideo tts ./build/microgpt/script.json --block B03,B07 --force
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
│   └── {hash}.wav             # line-level 单行 TTS 输出（不含尾部 200ms 静音）
├── components/
│   └── {hash}.tsx
└── partials/
    └── {hash}.mp4             # block-level 渲染产物
```

**缓存粒度**：
- `audio/` 是 **line-level** WAV：每行 narration 一个 cache 条目，key 为 `MD5(ttsText + voiceRefHash + cfgValue + inferenceTimesteps + denoise + voxcpmModelVersion)`；不包含尾部 200ms 静音（拼接时由 ffmpeg 统一追加）
- block-level 合并 WAV（`build/{title}/audio/Bxx.wav`）和 `lineTimings` 是 **build artifact**，由 tts stage 在 cache 命中或 miss 后计算得到，**不进入全局缓存**
- `components/` 是 block-level 单文件 .tsx 组件，key 见 11.2
- `partials/` 是 **block-level** 渲染产物（独立 mp4），key 见 11.2；命中时 `cp` 到 `output/partials/`，避免重新调用 Remotion

`voiceRef` WAV 文件由用户自己管理，存放在项目目录中；缓存通过 `voiceRefHash` 感知音色变更，无需在缓存目录内存储参考音频副本。

### 11.2 缓存键

| 类型 | 缓存键组成 |
|------|-----------|
| audio | `MD5(ttsText + voiceRefHash + cfgValue + inferenceTimesteps + denoise + voxcpmModelVersion)` |
| component | `MD5(visual.description + theme + width + height + promptVersion + assetHashesJson + claudeModel)` |
| partial | `MD5(componentHash + audioHash + theme + width + height + fps + enter + exit + remotionVersion)` |

- `voiceRefHash`：`voiceRef` WAV 文件内容的 MD5，保证参考音频变更时缓存自动失效
- `cfgValue` / `inferenceTimesteps` / `denoise`：影响 TTS 输出的所有 VoxCPM 推理参数；任一变更都会让旧音频缓存失效
- `voxcpmModelVersion`：VoxCPM 模型权重目录（`voxcpm.modelDir`）下 `config.json` 或权重文件的 hash；换模型权重时缓存自动失效
- `promptVersion`：`src/ai/prompts/component.md` 文件内容的 MD5 前 8 位；系统 prompt 变动时所有旧 component 缓存自动失效
- `assetHashesJson`：描述中引用的所有本地资产文件内容 hash 的排序 JSON 字符串；图片路径不变但内容变更时组件缓存自动失效
- `claudeModel`：`anthropic.model` 配置值（如 `claude-sonnet-4-6`）；切换模型时旧组件缓存失效
- `componentHash` / `audioHash`：本块组件 .tsx 内容 MD5、合并后 block WAV 内容 MD5；组件或音频任一变化 partial 重渲
- `remotionVersion`：`@remotion/renderer` 包版本字符串；升级 Remotion 时所有 partial 自动失效（防止编码参数漂移）

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
      "promptVersion": "a3f9c12e",
      "assetHashesJson": "[\"7b8c9d10\",\"a1b2c3d4\"]",
      "claudeModel": "claude-sonnet-4-6"
    },
    "createdAt": "2026-05-01T10:00:00Z",
    "lastHitAt": "2026-05-01T11:00:00Z",
    "hitCount": 3
  },
  "audio:d4e5f6a7...": {
    "type": "audio",
    "file": "audio/d4e5f6a7.wav",
    "key": {
      "ttsText": "...",
      "voiceRefHash": "ab12cd34...",
      "cfgValue": 2.0,
      "inferenceTimesteps": 10,
      "denoise": false,
      "voxcpmModelVersion": "e7f2a019"
    },
    "createdAt": "2026-05-01T10:00:00Z",
    "lastHitAt": "2026-05-01T11:00:00Z",
    "hitCount": 7
  },
  "partial:9c8b7a65...": {
    "type": "partial",
    "file": "partials/9c8b7a65.mp4",
    "key": {
      "componentHash": "f3a1b2c4...",
      "audioHash": "5e4d3c2b...",
      "theme": "dark-code",
      "width": 1920,
      "height": 1080,
      "fps": 30,
      "enter": "fade-up",
      "exit": "fade",
      "remotionVersion": "4.0.230"
    },
    "createdAt": "2026-05-01T10:30:00Z",
    "lastHitAt": "2026-05-01T11:00:00Z",
    "hitCount": 2
  }
}
```

并发安全：用 `proper-lockfile` 锁 manifest 读写。

### 11.4 自动 LRU 清理

partial mp4 单文件几十 MB，跑十几个项目可达数 GB；仅靠手动 `cache clean` 不够。

- 受 `cache.maxSizeGB` 控制（默认 20GB），`cache.evictTrigger` 决定何时检查（默认 `stage-start`）
- 检查时若总占用超过上限：按 `lastHitAt` 升序、先 evict `partials/`，其次 `components/`，最后 `audio/`（因 partial 文件最大、重建成本最低——只需重 concat / re-render；audio 重建需要 GPU + TTS API）
- evict 仅删除条目文件并从 manifest 移除；不影响磁盘上已生成的 build 产物

### 11.5 CLI

```bash
autovideo cache stats                        # 显示总条目数、磁盘占用、命中率（分 audio/component/partial）
autovideo cache clean                        # 清空全部
autovideo cache clean --type audio           # 仅清音频缓存
autovideo cache clean --type component       # 仅清组件缓存
autovideo cache clean --type partial         # 仅清块渲染产物缓存
autovideo cache clean --older-than 30d        # ms 库格式：30d、12h、1w、90m；不接受 ISO 8601
autovideo cache clean --stale                # 仅清 promptVersion / remotionVersion 已过期的条目
```

---

## 12. 测试策略

| 类型 | 范围 | 工具 |
|------|------|------|
| 单元 | parser、cache（含 promptVersion 失效逻辑）、ffmpeg helpers、narration 处理 | vitest |
| 快照 | `compile` 输入 .md → `script.json` 输出（含 subtitleSafeBottom、图片路径替换） | vitest snapshot |
| 单元 | tts lineTimings 计算（各行音频时长累加 + 200ms 静音推导） | vitest |
| 集成 | tts 缓存命中（voiceRefHash / cfgValue 变更时失效）、voiceRef 文件校验 | vitest + mock voxcpm2-api |
| 集成 | visuals 缓存命中（assetHashesJson 变更时失效）；validate 失败后错误回喂重试；3 轮失败 stage 终止 | vitest + mock Claude API |
| 单元 | compile 阶段资产 hash 复制（同名不同目录、内容变更测试） | vitest |
| 集成 | 缓存 lockfile 并发竞争（多进程同时 build 不同项目共用缓存目录） | vitest（spawn 多 worker） |
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
    "@remotion/google-fonts": "^4.0.0",  // CJK + emoji 字体显式 loadFont（§13.3）
    "commander": "^12.0.0",
    "proper-lockfile": "^4.1.2",
    "remotion": "^4.0.0",
    "zod": "^3.22.0",
    "ms": "^2.1.3",                       // --older-than 解析（30d / 12h / 1w）
    "p-limit": "^5.0.0"                   // stage 内并发控制（block 级 / line 级）
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ms": "^0.7.34",
    "@types/proper-lockfile": "^4.1.4",
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
```

lineTimings 由 tts stage 从各行音频时长直接累加得出，无需 forced alignment，`whisper-timestamped` 已从依赖中移除。

### 13.3 系统依赖（一次性 install 脚本）

- Node 20+
- Python 3.10+ + venv
- ffmpeg **≥ 5.0**（`loudnorm` two-pass 的 JSON `print_format` + concat `-fflags +genpts` 行为依赖 5.x；4.x 部分版本 JSON 解析有 bug）
- chromium-browser（Remotion 渲染；也可由 `@remotion/renderer` 自动下载）
- CJK 字体：通过 `@remotion/google-fonts/NotoSansSC` 在 `Root.tsx` 顶部 `loadFont()` 显式加载，避免依赖 Chromium headless 系统字体 fallback；emoji 字体走 `Noto Color Emoji`（同样 google-fonts 加载）。系统包 `fonts-noto-cjk`（≥ 20220127）仍建议安装作为 doctor 兜底

`install.sh` 一次性装齐（**仅 Ubuntu 22.04+**），步骤：

1. `apt-get install` 系统包：`ffmpeg`、`chromium-browser`、`fonts-noto-cjk`、`fonts-noto-color-emoji`、`python3.10-venv`、`build-essential`、`util-linux`（含 `prlimit` / `unshare`，用于 §6.3 子进程隔离；Ubuntu 22.04 通常已预装，仅做 idempotent 兜底）
2. 安装 Node 20（nvm 或 nodesource 二选一，脚本默认 nvm）
3. 在 `tts-server/.venv` 创建 Python venv 并 `pip install -r tts-server/requirements.txt`
4. 下载 VoxCPM2 模型权重（约 4–8GB）到 `~/.cache/voxcpm/VoxCPM2`；脚本提供 `--skip-model` 跳过
5. **不**预下载 Chromium，由 `@remotion/renderer` 首次运行时按需下载（避免与系统 chromium 冲突）
6. 运行 `autovideo doctor` 自检并打印缺失项

不在 `autovideo build` 内部检查 / 安装系统依赖；首次 build 前用户需自行执行 `install.sh` 或确认 `doctor` 通过。

---

## 14. 成功标准

| 标准 | 衡量方式 |
|------|---------|
| 单命令出片 | 用户提供 `voiceRef` WAV 后，`autovideo build project.json` 一次跑完，产出可播 MP4 |
| 音色一致 | 全片所有块共用同一 `voiceRef` WAV，无论重跑多少次音色不变；换 WAV 文件才会变 |
| 行间停顿可感 | 每行末尾固定 200ms 静音，字幕切换自然不跳帧 |
| 增量重做高效 | 改 1 句话 → 该块 line-level audio cache miss 1 行 + 重渲该块 partial + ffmpeg concat（秒级）；改 1 个动画 → 重生成该块组件 + 重渲该块 partial + concat；其他块的组件/音频/partial 全部缓存命中，磁盘上原文件不变 |
| 块增删/重排无副作用 | 删除或重排块只改变 `concat.txt` 顺序与 `final.mp4`；audio/component/partial 三级缓存按内容 hash 全部命中，无任何块需要重渲 |
| 单块预览 | `autovideo preview --block B03` 5 秒内打开 Studio 显示该块 |
| 失败可恢复 | 任何 stage 失败后，`autovideo {stage} --block` 可单独续跑 |
| 代码体量 | TS 实现（src/ + remotion/ + bin/）≤ 5000 行，含 tests ≤ 8000 行；Python TTS 服务 ≤ 300 行 |

