# AutoVideo — 产品需求文档

> 把 Markdown 教学口播稿编译为 MP4 视频的命令行工具。

---

## 1. 产品定义

### 1.1 一句话

**输入一份 Markdown 口播稿 + 可选的代码/图片素材，输出一段带字幕、配音、动画的 MP4 教学视频。**

### 1.2 目标用户

写技术教学视频的个人创作者。具体画像：

- 会写代码、会用命令行
- 不想学视频剪辑软件
- 重视内容（讲清楚一段算法、一段代码），轻视花哨特效
- 通常做中文/中英混读的视频
- 一次输出 5–30 分钟的视频

### 1.3 核心使用流程

```
1. 写一份 .md 文件（口播文字 + 几行 directive）
2. 运行  autovideo build script.md
3. 等几分钟，得到  output/final.mp4
4. 不满意某一块，  autovideo visuals script.json --block B03 --force  重生成
```

---

## 2. 设计原则

1. **AI 只做必要的事**。本系统只在一个地方用大模型——为 `animation` 类型的块生成 React 动画组件。其他所有阶段（解析、TTS、字幕对齐、渲染、拼接）都是确定性代码。
2. **单一数据源**。`script.json` 是贯穿全部 stage 的 IR；每个 stage 是 `script.json → script.json` 的纯变换。
3. **每个 stage 独立可重跑**。改一句话不需要重跑全流程；改一个动画不需要重新 TTS。
4. **错误显式不降级**。失败就报错让用户处理，不偷偷切换 provider 或静默丢弃。
5. **本地优先**。除 Claude API 外，所有依赖（VoxCPM TTS、Remotion 渲染、字幕对齐）都在本机；离线可继续渲染已有 artifact。
6. **可预览可迭代**。Remotion Studio 直接预览单块，所见即所得。

---

## 3. 输入格式：Markdown DSL

### 3.1 文件总体

```markdown
--- meta ---
title: 200 行手撕 GPT
voice: zh-CN-YunxiNeural
aspect: 16:9
theme: dark-code
fps: 30
---

>>> 块标题 #B01
@type: textcard
@rect: center-60
@enter: fade-up
@duration: 5s

旁白第一行
旁白第二行

>>> 下一个块 #B02
...
```

- 顶部 `--- meta ---` 段定义视频级元数据（也可用 CLI 参数覆盖）
- 每个 `>>>` 开启一个块；`#B01` ID 可选，省略则按出现顺序自动编号
- 块之间互相独立；块内顺序：标题行 → directive → 内容段

### 3.2 元数据字段

| 字段 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `title` | ✓ | — | 视频标题 |
| `voice` | | `zh-CN-YunxiNeural` | TTS 声音名 |
| `aspect` | | `16:9` | 仅支持 `16:9` / `9:16` / `1:1` |
| `theme` | | `dark-code` | 视觉主题 |
| `fps` | | `30` | 帧率 |
| `voiceRef` | | — | 固定参考音频路径，强制所有块使用此音色 |

### 3.3 块指令（`@directive:`）

通用指令：

| 指令 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `@type` | ✓ | — | `textcard` / `code` / `animation` / `image` / `icon` |
| `@rect` | | `safe` | 位置预设或 `{x,y,w,h}` 归一化坐标 JSON |
| `@enter` | | `fade-up` | 入场动画预设 |
| `@exit` | | `fade` | 出场动画预设 |
| `@duration` | | 自动 | 强制时长（无口播块必填） |

类型专属：

| 指令 | 适用类型 | 说明 |
|------|---------|------|
| `@code` | `code` | `file.py:30-50` 文件路径加行范围 |
| `@highlight` | `code` | `32-35,40` 高亮行号 |
| `@image` | `image` | 图片路径 |
| `@icon` | `icon` | Lucide 图标名 |

### 3.4 内容段：旁白 + 视觉描述

`animation` 块用 `--- visual ---` 与 `--- narration ---` 显式分隔视觉描述与口播：

```markdown
>>> 下一个词预测器 #B02
@type: animation
@rect: safe

--- visual ---
0s: 屏幕中央显示大标题 "GPT = ?"，带脉冲动画
3s: 标题变为 "GPT = 下一个词预测器"
6s: 左侧文本框显示 "今天天气真"，右侧概率条形图
8s: "好" 弹出飞入文本末尾变成 "今天天气真好"

--- narration ---
我们有 "今天天气真" 这几个字的输入

@@pause: 0.8s

然后我们要预测下一个字
按概率选最高的字拼上去
```

其他类型块只有旁白段，directive 之后空一行直接开始：

```markdown
>>> Value 类字段 #B03
@type: code
@code: microgpt.py:30-50
@highlight: 32-35

要训练神经网络，必须有 **自动求导**
karpathy 用一个 [[Value]] 类实现了它
```

### 3.5 旁白语法

- **每个非空行 = 一条字幕**。空行被解析为一个默认 500ms 的停顿。
- **`@@pause: 1.2s`** 显式插入指定停顿。
- **`**word**`** 在字幕中高亮显示（不影响 TTS）。
- **`[[word]]`** 标记 TTS 重音（不影响字幕样式）。
- **`# 大标题` / `> 引用`** 在 `textcard` 块内会按 Markdown 渲染。

### 3.6 位置预设（`@rect`）

| 预设 | 含义 |
|------|------|
| `safe` | 居中安全区，留 3% 边距 |
| `center-60` | 居中 60% 宽度（用于标题卡） |
| `center-80` | 居中 80% 宽度 |
| `code-left` | 左侧 60% 用于代码 |
| `code-right` | 右侧 60% 用于代码 |
| `top-half` / `bottom-half` | 上半 / 下半屏 |
| 自定义 | `{"x":0.1,"y":0.1,"w":0.8,"h":0.8}` 归一化坐标 |

### 3.7 动画预设（`@enter` / `@exit`）

`fade` / `fade-up` / `fade-down` / `slide-left` / `slide-right` / `zoom-in` / `zoom-out` / `none`

---

## 4. 数据模型：`script.json`

```typescript
interface Script {
  meta: {
    schemaVersion: "1.0";
    title: string;
    voice: string;
    voiceRef?: string;          // 固定参考音频路径
    aspect: "16:9" | "9:16" | "1:1";
    width: number;
    height: number;
    fps: number;
    theme: string;
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
  type: "textcard" | "code" | "animation" | "image" | "icon";
  rect: RectSpec;
  enter: AnimationPreset;
  exit: AnimationPreset;

  narration: {
    lines: NarrationLine[];
    explicitDurationSec?: number;   // @duration
  };

  // 类型专属字段（按 type 取一个）
  textcard?: { markdown: string; align: "left" | "center" };
  code?: {
    source: string;
    range: [number, number];
    lang?: string;
    highlights?: number[];
  };
  animation?: {
    description: string;        // 完整 visual 段原文
    timeline: { atSec: number; description: string }[];
    componentPath?: string;     // Stage 3 填写
  };
  image?: { src: string; fit: "cover" | "contain" };
  icon?: { name: string; color?: string };

  // Stage 2 填写
  audio?: {
    wavPath: string;
    durationSec: number;
    wordTimings: { word: string; startMs: number; endMs: number }[];
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
  ttsText: string;              // 喂给 TTS 的文本（[[word]] 转 SSML，** 去掉）
  highlights: { start: number; end: number }[];  // ** 范围（用于字幕渲染）
  pauseAfterMs: number;         // 默认 500
}
```

JSON Schema 在 `schemas/script.schema.json` 维护。每个 stage 必须先验证再处理。

---

## 5. 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                  autovideo (CLI, TypeScript)                     │
│                                                                  │
│  script.md                                                       │
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
│                ~/.autovideo/cache/  (audio, components)          │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
                      output/final.mp4
```

四个 stage **顺序依赖、各自可单独运行**。`tts` 和 `visuals` 都只读 `script.json` 的不同字段，理论可并行（Stage 3 不依赖 Stage 2 输出），但默认串行执行简化日志。

---

## 6. 各 Stage 详解

### 6.1 Stage 1 — `compile`：Markdown → IR

**输入**：`script.md` + meta CLI override
**输出**：`script.json`（不含 audio / componentPath / timing）

**职责**：
1. 解析 `--- meta ---` 段（CLI 参数覆盖）
2. 解析每个 `>>>` 块及其 directive、`--- visual ---`、`--- narration ---`
3. 旁白预处理：拆行 → 解析 `**` `[[]]` `@@pause` → 生成 `NarrationLine[]`
4. 解析 `aspect` → 计算 `width/height`
5. `code` 块：复制源文件到 `assets/code/`
6. JSON Schema 验证后写出 `script.json`

**实现**：纯函数；无外部服务调用；可在毫秒级完成。

### 6.2 Stage 2 — `tts`：旁白 → 音频 + 字幕时序

**输入**：`script.json`（已 compile）
**输出**：每块 `audio/B**.wav` + 每行 word-level 时序，写回 `script.json.blocks[].audio`

**职责**：
1. 启动 / 检测 VoxCPM HTTP 服务（端口 50001）
2. 决定 voice reference：
   - `meta.voiceRef` 显式指定 → 用此文件
   - 否则查询全局 `~/.autovideo/voices/{voiceName}.wav`：
     - 存在 → 用此文件
     - 不存在 → 用第一个块第一行旁白合成一次，保存为该 voice 名字的全局参考；后续所有块（含其他项目）都从此克隆
3. 对每个块的 `narration.lines`：
   - 逐行调 VoxCPM（克隆 voice ref）
   - 行间插入 `pauseAfterMs` 静音
   - 拼接为 `audio/B**.wav`
4. 用 `whisper-timestamped` 做 forced alignment，获得每行的 word-level 时间戳
5. 缓存 key：`MD5(ttsText + voice + voiceRefHash)`，命中跳过 TTS 直接复制

**约束**：
- VoxCPM 失败时单块重试 3 次（间隔 5s），仍失败 → 报错退出，不切换 provider
- 多块并发数默认 4，可配置

### 6.3 Stage 3 — `visuals`：动画块 → React 组件

**输入**：`script.json`
**输出**：`src/blocks/B**/Component.tsx`，写回 `script.json.blocks[].animation.componentPath`

**职责**：
1. 仅处理 `type: "animation"` 的块；其他类型由内置组件渲染，跳过
2. 缓存 key：`MD5(title + animation.description + theme + width + height)`，命中复制返回
3. Cache miss → Claude API 调用：
   - 默认 `claude-sonnet-4-6`（可配置）
   - 使用 prompt caching：组件模板 + theme tokens + AnimationProps 接口（这些是长期不变的部分）
   - 工具调用要求返回 `{ tsx: string }` JSON
   - 生成后做两轮验证：
     - **静态**：`tsc --noEmit` 通过
     - **动态**：`remotion render` 单帧（中间帧）非纯黑、非纯白
   - 任一验证失败 → 错误回喂给模型，最多 3 轮
   - 仍失败 → 标记此块 `degraded: true`，渲染时降级为 textcard

**生成的组件接口**：

```typescript
interface AnimationProps {
  frame: number;              // 块内帧（0 起）
  durationInFrames: number;
  rect: { x: number; y: number; w: number; h: number };
  theme: Theme;
  fps: number;
}

export default function Component(props: AnimationProps): JSX.Element;
```

### 6.4 Stage 4 — `render`：IR + 资产 → MP4

**输入**：`script.json`（带 audio + componentPath） + `audio/` + `src/blocks/`
**输出**：`output/final.mp4`、`output/final_normalized.mp4`

**职责**：
1. 计算每块时序：`hold = max(audio.durationSec, MIN_HOLD)`，`total = enter + hold + exit`，写回 `timing`
2. 生成 `public/script.json`（Remotion 静态读取）
3. 写一个 `Root.tsx` 注册**单一** Composition：
   ```tsx
   <Composition id="Video" durationInFrames={totalFrames} fps={fps} ...>
     <VideoComposition />
   </Composition>
   ```
   `VideoComposition` 内用 `<Sequence>` 串起所有块
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
autovideo build script.md
```

等价于 `compile → tts → visuals → render`，但中间任一阶段失败立即停下，不继续后面。

---

## 7. 命令行接口

```bash
# 一键
autovideo build <script.md> [--out DIR] [--config FILE] [--meta key=value]...

# 分步（每步可单独运行）
autovideo compile <script.md>            [--out DIR]
autovideo tts     <script.json>          [--block B03] [--force]
autovideo visuals <script.json>          [--block B03] [--force]
autovideo render  <script.json>          [--range B03-B05]

# 预览
autovideo preview <script.json>          [--block B03]

# 工具
autovideo cache    stats | clean [--type audio|component]
autovideo doctor                          # 检查 VoxCPM、Claude API、ffmpeg、字体
autovideo init     <dir>                  # 生成模板项目（含示例 script.md）
```

通用 flag：

- `--force`：忽略缓存，强制重做
- `--block <id>`：仅处理指定块
- `--out <dir>`：输出目录（默认 `./build/{title}/`）
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
│   │   ├── meta.ts
│   │   ├── blocks.ts
│   │   ├── directives.ts
│   │   └── narration.ts
│   │
│   ├── tts/
│   │   ├── voxcpm-client.ts      # HTTP client
│   │   ├── voxcpm-server.ts      # 启停管理
│   │   ├── audio.ts              # ffmpeg helpers
│   │   ├── align.ts              # whisper-timestamped wrapper
│   │   └── voice-ref.ts          # 全局音色参考管理
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
│   ├── BlockRenderer.tsx         # 按 type 分发到 contents
│   ├── components/
│   │   ├── TextCard.tsx
│   │   ├── Code.tsx
│   │   ├── Image.tsx
│   │   ├── Icon.tsx
│   │   └── SubtitleOverlay.tsx
│   └── engine/
│       ├── theme.ts              # 主题 token
│       ├── rect.ts               # rect → CSS
│       ├── animations.ts         # enter/exit 实现
│       └── block-frame.tsx       # 通用块外壳
│
├── tts-server/                   # VoxCPM Python 服务
│   ├── server.py                 # FastAPI
│   └── requirements.txt
│
├── schemas/
│   └── script.schema.json
│
├── templates/
│   └── starter/                  # autovideo init 复制此模板
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

### 8.2 用户工作目录（`autovideo build` 产物）

```
./build/microgpt/
├── script.json                   # canonical IR
├── assets/
│   └── code/                     # compile 阶段复制的源码
│       └── microgpt.py
├── audio/
│   ├── B01.wav
│   ├── B01.timings.json          # word-level alignment
│   └── ...
├── src/
│   └── blocks/
│       └── B05/Component.tsx     # AI 生成的动画组件
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
    "endpoint": "http://127.0.0.1:50001",
    "modelDir": "~/.cache/voxcpm/VoxCPM2",
    "autoStart": true,
    "concurrency": 4
  },
  "anthropic": {
    "apiKeyEnv": "ANTHROPIC_API_KEY",
    "model": "claude-sonnet-4-6",
    "promptCaching": true,
    "maxRetries": 3
  },
  "render": {
    "concurrency": 4,
    "browser": "/usr/bin/chromium-browser",
    "minHoldSec": 1.5,
    "defaultEnterSec": 0.5,
    "defaultExitSec": 0.3
  },
  "cache": {
    "dir": "~/.autovideo/cache"
  }
}
```

---

## 10. 错误处理

| 场景 | 行为 |
|------|------|
| Markdown 语法错误 | `compile` 立即失败，输出行号；不生成部分 IR |
| Schema 验证失败 | 立即失败，输出 JSON path 与原因 |
| 代码源文件不存在 | `compile` 失败 |
| VoxCPM 服务无法启动 | `tts` 立即失败；提示用户运行 `autovideo doctor` |
| 单块 TTS 失败 | 重试 3 次（间隔 5s）；仍失败 → 此块标记错误；本 stage 末尾汇总报告，让用户决定 |
| Claude API 失败 | 重试 3 次（指数退避） |
| 生成的组件 tsc 失败 | 错误回喂模型，最多 3 轮；仍失败 → 此块降级 textcard，不阻塞流程 |
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

唯一缓存目录：`~/.autovideo/cache/`，结构：

```
~/.autovideo/cache/
├── manifest.json
├── audio/
│   ├── {hash}.wav
│   └── {hash}.timings.json
├── components/
│   └── {hash}.tsx
└── voices/                       # 全局 voice reference
    └── zh-CN-YunxiNeural.wav
```

`manifest.json` 单条：

```json
{
  "audio:f3a1b2c4...": {
    "type": "audio",
    "files": { "wav": "audio/f3a1b2c4.wav", "timings": "audio/f3a1b2c4.timings.json" },
    "key": { "ttsText": "...", "voice": "zh-CN-YunxiNeural", "voiceRefHash": "ab12..." },
    "createdAt": "2026-05-01T10:00:00Z",
    "lastHitAt": "2026-05-01T11:00:00Z",
    "hitCount": 3
  }
}
```

并发安全：用 `proper-lockfile` 锁 manifest 读写。

CLI：

```bash
autovideo cache stats              # 显示总条目数、磁盘占用、命中率
autovideo cache clean              # 清空全部
autovideo cache clean --type audio # 仅清音频缓存
autovideo cache clean --older-than 30d
```

---

## 12. 测试策略

| 类型 | 范围 | 工具 |
|------|------|------|
| 单元 | parser、cache、ffmpeg helpers、narration 处理 | vitest |
| 快照 | `compile` 输入 .md → `script.json` 输出 | vitest snapshot |
| 集成 | tts 缓存命中、voice ref 选择逻辑 | vitest + mock VoxCPM |
| E2E | 1 textcard + 1 code + 1 image 的最小脚本跑完整 build | vitest（需 ffmpeg + Chromium） |

**不测试**：Claude 生成的 animation 组件（不可重现）；但要测 validate 流程（喂错误能恢复）。

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
    "shiki": "^1.0.0",
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
voxcpm
fastapi
uvicorn[standard]
whisper-timestamped
numpy
torch
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
| 单命令出片 | `autovideo build script.md` 一次跑完，产出可播 MP4 |
| 音色一致 | 同 voice 的所有块、跨多次 build 都用同一参考音；切 voice 才会变 |
| 行间停顿可感 | 每行换行至少 500ms；空行额外 +500ms |
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
| **M1 — Compile + Render 基线** | parser、`script.json`、Remotion 模板、textcard/image/icon/code 渲染、单 composition 输出 MP4（不含音频） | 手写 `script.json`，渲染出无声 MP4 |
| **M2 — TTS 全链路** | VoxCPM 服务、voice ref 管理、whisper alignment、缓存 | E2E 跑 textcard + code 出带配音字幕 MP4 |
| **M3 — Animation 生成** | Claude SDK 集成、validate、降级机制 | 跑含 1 个 animation 的脚本成功出片 |
| **M4 — Iter 工作流** | preview、`--block --force`、cache CLI、doctor、init | 改单块重跑 < 30 秒 |
| **M5 — 打磨** | 完整文档、错误信息打磨、E2E 测试套件 | README 起手 5 分钟出第一个 demo |
