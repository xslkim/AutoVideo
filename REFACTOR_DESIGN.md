# AutoVideo 重构设计文档

> 版本：v2.0（block-based）
> 作者：Claude + 项目作者
> 状态：**设计稿，待评审**
> 上一版：基于 `>>>` 素材块的 6-Stage 流水线

---

## 0. 设计目标

### 0.1 解决现有问题

| 现存问题 | v1 原因 | v2 方案 |
|---------|---------|---------|
| 字幕换行不可控，经常溢出 | markdown 硬换行 + 简单字符数判断 | 单行 + Canvas 像素级测量 |
| 视觉元素位置不可预测 | AI 组件自由布局 | 每块用归一化 **Rect** 约束 |
| 中英混读卡顿 | edge-tts 引擎缺陷 | TTS Provider 抽象 + 多引擎路由（详见 `TTS_RESEARCH.md`）|
| 时长与口播不对齐 | 粗粒度估算 | 词级 VTT 时间戳 + 按 TTS 实际时长推导 |
| 入场/出场动画写死 | 每个组件 AI 单独实现 | 预设枚举 + 全局动画库 |
| 失败无法局部重跑 | 单一 `blocks.json` | 每块独立 JSON + Remotion Sequence 映射 |
| 脚本格式信息量不够 | markdown 嵌入结构化字段很丑 | **两层 IR**：作者写 markdown，Stage 1 编译成 `blocks.json` |

### 0.2 非目标

- **不做**可视化编辑器（保持 "markdown in, MP4 out"）
- **不做**多说话人对话
- **不做**实时预览（Remotion studio 已经够了）
- **不考虑**向后兼容 v1 的 `script.md`（确认过：完全重构）

### 0.3 核心不变量

- 单一入口：`bash run.sh --script ./xxx.md --repo ...`
- Claude Agent 驱动：`CLAUDE.md` + `VIDEO_WORKFLOW.md` 依然是它的"使用手册"
- 断点续跑：`pipeline-state.json` 依然是状态中心
- Remotion 作为渲染底座

---

## 1. 数据模型：Block

### 1.1 顶层结构

一个视频 = **有序的 Block 列表**。`blocks.json` 是 Stage 1 的产出，也是后续所有 Stage 的唯一输入源。

```jsonc
{
  "version": "2.0",
  "meta": {
    "title": "200 行纯 Python 手撕 GPT",
    "aspect": "16:9",
    "resolution": { "w": 1920, "h": 1080 },
    "fps": 30,
    "theme": "dark-code",
    "voice": "zh-CN-YunyiMultilingualNeural"
  },
  "blocks": [
    { /* Block 0 */ },
    { /* Block 1 */ },
    ...
  ]
}
```

### 1.2 Block Schema

```jsonc
{
  "id": "B03",                          // 稳定 ID，用于断点续跑
  "title": "Value 类的字段",             // 作者给的短标题（日志/调试可读）

  // ------- 口播文案 -------
  "narration": {
    "text": "要训练神经网络，必须有自动求导。karpathy 用一个 Value 类实现了它。",
    "emphases": [                       // 从 `**加粗**` 提取出来的高亮位置
      { "start": 10, "end": 14, "word": "自动求导" }
    ],
    "hints": {
      "pauseAfter": 0,                  // 额外停顿（秒），来自 (停顿) 标记
      "rate": 1.0,                      // 语速倍率
      "style": "neutral"                // neutral | excited | calm | ...
    }
  },

  // ------- 视觉 -------
  "visual": {
    "rect": {                           // 归一化 0~1，主体内容绘制区域
      "x": 0.1, "y": 0.15,
      "w": 0.8, "h": 0.6
    },
    "enter": {                          // 入场动画
      "preset": "fade-up",              // 见 §3.2 动画预设表
      "duration": 0.5,                  // 秒
      "easing": "ease-out"
    },
    "content": {                        // 主体内容（§2）
      "type": "code",                   // image | code | animation | icon | lottie | video
      "spec": { /* 类型专属字段 */ }
    },
    "exit": {                           // 出场动画
      "preset": "fade-out",
      "duration": 0.3,
      "easing": "ease-in"
    }
  },

  // ------- 时序（Stage 2 之后自动填充）-------
  "timing": {
    "audioPath": "public/audio/B03.wav",   // TTS 产物
    "vttPath": "public/audio/B03.vtt",     // 词级时间戳
    "ttsDuration": 4.82,                    // 纯口播时长
    "enterDuration": 0.5,                   // 入场动画时长
    "holdDuration": 4.82,                   // 主体停留 = max(TTS, 0) + hints.pauseAfter
    "exitDuration": 0.3,
    "totalDuration": 5.62,                  // enter + hold + exit
    "startFrame": 1234,                     // 在整个视频中的起始帧
    "frames": 169                            // 本块总帧数
  },

  // ------- 字幕（Stage 2 之后自动填充）-------
  "subtitles": [                        // 单行字幕数组，依次显示
    {
      "text": "要训练神经网络，",
      "startMs": 0,
      "endMs": 980,
      "emphases": []
    },
    {
      "text": "必须有 **自动求导**。",
      "startMs": 980,
      "endMs": 2340,
      "emphases": [{ "start": 4, "end": 8 }]
    },
    {
      "text": "karpathy 用一个 Value 类实现了它。",
      "startMs": 2340,
      "endMs": 4820,
      "emphases": []
    }
  ],

  // ------- 产物引用（Stage 3/4 填充）-------
  "artifacts": {
    "componentPath": "src/blocks/B03/Component.tsx",
    "assetFiles": ["src/blocks/B03/microgpt.py"],
    "thumbnailPath": "src/blocks/B03/thumb.png"
  },

  // ------- 状态（Stage 2+ 运行时）-------
  "status": {
    "tts": "completed",
    "component": "completed",
    "render": "pending"
  }
}
```

### 1.3 Rect 模型

**归一化坐标系**：所有坐标和尺寸都是 `[0, 1]` 的浮点数，乘以分辨率得到像素位置。

```
(0,0)──────────────────(1,0)
  │                      │
  │        main          │
  │        rect          │
  │                      │
(0,1)──────────────────(1,1)
```

**两个独立 Rect**：

| 名称 | 作用 | 定义位置 |
|------|------|---------|
| `visual.rect` | 主体内容绘制区域 | 每个 Block 单独 |
| `meta.theme.subtitleSafeArea` | 字幕安全区 | 全局主题，所有 Block 共用 |

**字幕安全区默认值**（16:9）：
```json
{ "x": 0.05, "y": 0.82, "w": 0.9, "h": 0.1 }
```
即：左右留 5% padding，底部 10% 高度，中心线在 87% 位置。

**主体 Rect 的常用预设**（可在 markdown 里写名字）：

| 预设名 | 对应 Rect |
|--------|----------|
| `fullscreen` | `{x:0, y:0, w:1, h:1}` |
| `safe` | `{x:0.05, y:0.05, w:0.9, h:0.75}`（留底部给字幕）|
| `center-60` | `{x:0.2, y:0.2, w:0.6, h:0.6}` |
| `center-80` | `{x:0.1, y:0.1, w:0.8, h:0.8}` |
| `left-half` | `{x:0.05, y:0.1, w:0.45, h:0.7}` |
| `right-half` | `{x:0.5, y:0.1, w:0.45, h:0.7}` |
| `top-half` | `{x:0.1, y:0.05, w:0.8, h:0.4}` |
| `bottom-half` | `{x:0.1, y:0.45, w:0.8, h:0.4}` |

Stage 1 在编译 markdown 时会把这些名字解析成具体数值。

---

## 2. 主体内容类型

### 2.1 Content 类型闭集

```typescript
type ContentSpec =
  | { type: 'image';     spec: ImageSpec }
  | { type: 'code';      spec: CodeSpec }
  | { type: 'animation'; spec: AnimationSpec }
  | { type: 'icon';      spec: IconSpec }
  | { type: 'lottie';    spec: LottieSpec }
  | { type: 'video';     spec: VideoSpec }
  | { type: 'textcard';  spec: TextCardSpec };  // 文字卡也收回闭集
```

### 2.2 各类型 Schema

#### ImageSpec（图片）

```jsonc
{
  "type": "image",
  "spec": {
    "src": "assets/images/bill.png",      // 相对项目根
    "source": "user",                      // user | ai-generated | url
    "fit": "contain",                      // contain | cover | stretch
    "kenBurns": {                          // 可选：缓慢缩放
      "from": 1.0, "to": 1.08,
      "anchor": "center"
    }
  }
}
```

图片来源分两种：
- **user**：用户在 `assets/images/` 下预先放好
- **ai-generated**：Stage 3 调用图像生成 API（预留接口，本期不实现）

#### CodeSpec（代码）

```jsonc
{
  "type": "code",
  "spec": {
    "source": "microgpt.py",               // src/data/source-samples/ 下的文件名
    "range": [30, 50],                     // 可选：行号范围
    "language": "python",                  // 自动推断，可覆盖
    "theme": "from-global",                // 从全局 THEME 取
    "reveal": {
      "mode": "typewriter",                // typewriter | line-by-line | all-at-once
      "linesPerSecond": 4,
      "cursor": true
    },
    "highlights": [                         // 可选：某几行加色块
      { "line": 35, "color": "accent" }
    ],
    "annotations": [                        // 可选：侧边注释气泡
      { "line": 35, "text": "chain rule!", "side": "right" }
    ]
  }
}
```

#### AnimationSpec（AI 生成组件）

这是最灵活的类型，相当于"其他"兜底。

```jsonc
{
  "type": "animation",
  "spec": {
    "description": "多头注意力：当前 token 的 q 和历史所有 k 点积，softmax 后加权平均 v",
    "timeline": [                          // 可选：关键帧提示
      { "at": 0, "do": "画出 4 个位置的 token" },
      { "at": 2, "do": "为最后一个 token 画 q/k/v" },
      { "at": 4, "do": "q 和所有 k 点积" },
      { "at": 6, "do": "softmax 权重柱状图" },
      { "at": 8, "do": "加权求和 v → 输出向量" }
    ],
    "componentPath": "src/blocks/B08/Component.tsx"   // Stage 3 生成后填充
  }
}
```

**标准接口约束**：

```typescript
// 所有 AI 生成的动画组件必须满足这个签名
interface AnimationProps {
  frame: number;                // 当前块内帧（0 → durationInFrames-1）
  durationInFrames: number;     // 本块总帧数
  rect: { x: number; y: number; w: number; h: number };  // 归一化
  theme: Theme;                 // 全局主题
  fps: number;
}
type AnimationComponent = (props: AnimationProps) => JSX.Element;
```

组件不再自己决定大小，外层 `<BlockFrame>` 会用 absolute 定位把它约束在 `rect` 内。

#### IconSpec（图标）

```jsonc
{
  "type": "icon",
  "spec": {
    "name": "lucide:sparkles",             // lucide:<icon-name>
    "size": 0.4,                            // 占 rect 短边的比例
    "color": "accent",                      // 主题 token
    "stroke": 2,
    "anim": "pulse"                         // none | pulse | rotate | bounce
  }
}
```

**图标库**：采用 [Lucide](https://lucide.dev/)（2000+ 开源 SVG，MIT）。Stage 3 安装 `lucide-react` 包，按需导入。

#### LottieSpec（Lottie 动画）

```jsonc
{
  "type": "lottie",
  "spec": {
    "src": "assets/lottie/celebration.json",
    "loop": false,
    "speed": 1.0
  }
}
```

#### VideoSpec（视频切片）

```jsonc
{
  "type": "video",
  "spec": {
    "src": "assets/clips/screen-recording.mp4",
    "muted": true,                          // 通常静音，因为我们有独立 TTS
    "startTime": 0,
    "speed": 1.5
  }
}
```

#### TextCardSpec（纯文字卡）

```jsonc
{
  "type": "textcard",
  "spec": {
    "lines": [
      { "text": "200 行", "style": "hero", "color": "accent" },
      { "text": "0 个依赖", "style": "hero" },
      { "text": "1 个完整的 GPT", "style": "hero" }
    ],
    "align": "center",
    "background": "theme.bg-deep"
  }
}
```

---

## 3. 动画系统

### 3.1 设计原则

- **所有入场/出场动画**必须是**数据驱动**的（`preset` 字段），不出现在 AI 生成的组件里
- AI 组件只负责**主体内容的内部动画**（比如计算图节点依次出现），入场和出场由框架接管
- 动画预设实现在 `src/engine/animations.ts`，每个预设是一个纯函数 `(frame, duration, fps) => CSSProperties`

### 3.2 预设枚举表

#### 入场动画（enter）

| preset | 效果 | 适用场景 |
|--------|------|----------|
| `none` | 立即出现 | 连续块之间 |
| `fade` | 透明度 0→1 | 通用 |
| `fade-up` | 透明度 + 从下方 30px 滑入 | 文字卡、标题 |
| `fade-down` | 从上方滑入 | 副标题 |
| `fade-left` | 从右向左滑入 | 图标、侧栏内容 |
| `fade-right` | 从左向右滑入 | 图标、侧栏内容 |
| `scale` | 从 0.8 缩放到 1.0 + 淡入 | 卡片、图标 |
| `zoom-in` | 从 1.2 缩放到 1.0 + 淡入 | 代码块 |
| `typewriter` | 逐字出现（仅对文字内容）| 代码、引言 |
| `draw` | SVG 路径从左到右描绘 | 图表、箭头 |
| `blur-in` | 从模糊到清晰 | 图片 |
| `auto` | 由 AI 根据 content 类型自动选择 | 兜底 |

#### 出场动画（exit）

与 enter 对称：`none / fade / fade-up / fade-down / scale / zoom-out / blur-out / auto`

#### 动画时长约束

- 默认 `enter.duration = 0.5s`，`exit.duration = 0.3s`
- 允许范围：`0.1s ~ 1.5s`
- 总时长约束：`enter + hold + exit ≤ block.totalDuration`，不足时优先砍 exit

### 3.3 全局主题（Theme）

```jsonc
{
  "name": "dark-code",
  "bg": "#0b0f14",
  "bgDeep": "#05080c",
  "fg": "#e6edf3",
  "fgMuted": "#8b949e",
  "accent": "#ffb86b",
  "accent2": "#7ee787",
  "danger": "#ff7b72",
  "fonts": {
    "body": "Noto Sans SC, sans-serif",
    "mono": "JetBrains Mono, monospace",
    "display": "Noto Serif SC, serif"
  },
  "sizes": {
    "hero": 120,
    "title": 72,
    "body": 40,
    "subtitle": 48,
    "code": 32
  },
  "subtitleSafeArea": { "x": 0.05, "y": 0.82, "w": 0.9, "h": 0.1 },
  "codeTheme": "github-dark"
}
```

主题由 `config.theme` 选择预设，后续可扩展。

---

## 4. 字幕系统（重大重构）

### 4.1 核心约束

- **单行**：一条字幕只有一行文字
- **像素宽度**：字幕宽度 ≤ `subtitleSafeArea.w × resolution.w`（而不是按字符数）
- **词级对齐**：字幕切换时机来自 TTS 返回的词级 VTT
- **主体静止**：字幕切换时主体视觉**保持不变**，只是字幕覆盖层刷新

### 4.2 切段算法

Stage 2 的 `subtitle-split` 任务做以下事情：

```
输入：
  - narration.text (原始旁白)
  - narration.emphases (高亮词位置)
  - vtt (词级时间戳)
  - theme.fonts, theme.sizes.subtitle
  - resolution
  - subtitleSafeArea.w

算法：
1. 用 node-canvas 创建一个虚拟画布，设字体 = theme.fonts.body + theme.sizes.subtitle
2. 最大允许像素宽度 maxPx = safeArea.w * resolution.w - 2 * padding
3. 把 text 按标点（，。！？、；）预切成候选段
4. 对每个候选段：
   a. measureText(segment).width
   b. 如果 width > maxPx：
      - 继续用"空格"、"英文单词边界"做二次切分
      - 仍超宽：强制按字符截断
   c. 如果过短（< maxPx * 0.3）：尝试和下一段合并，合并后不超宽就合并
5. 对每个最终段：
   a. 用 VTT 词级时间戳找到对应的 startMs / endMs
   b. 把 emphases 映射到段内局部坐标
6. 输出 subtitles[] 数组
```

**node-canvas** 选型：
- 已经是 Remotion 的间接依赖
- 提供 `CanvasRenderingContext2D.measureText` 的 Node 端实现
- 精度和浏览器一致（基于 Cairo 后端）

### 4.3 渲染

`src/components/SubtitleOverlay.tsx`：

- 读取当前帧所属 Block 的 `subtitles[]`
- 二分查找当前应该显示的段
- 用 `<AbsoluteFill>` 定位到 safeArea
- `position: absolute; bottom: (1-safeArea.y-safeArea.h) * 100%`
- 段切换时 0.15s 快速淡入淡出（不换块才触发，换块由 block 的出入场接管）
- 高亮词用 `<span style={{ color: theme.accent }}>` 包裹

### 4.4 溢出保护

即使切段算法挂了，渲染层也有兜底：

```css
.subtitle-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90vw;
}
```

---

## 5. 输入格式（Authoring Layer）

### 5.1 作者写什么

作者继续写 **高表达力的 markdown**，不写 JSON。示例：

````markdown
---
title: 200 行纯 Python 手撕 GPT
aspect: 16:9
theme: dark-code
voice: zh-CN-YunyiMultilingualNeural
---

>>> 标题卡
@type: textcard
@rect: center-60
@enter: fade-up
@exit: fade

# microgpt.py
by @karpathy
200 行 · 0 依赖 · 1 个 GPT

只用标准库，没有 PyTorch，没有 NumPy。

>>> Value 类字段
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 30-50
@reveal: line-by-line

要训练神经网络，必须有 **自动求导**。
karpathy 用一个 Value 类实现了它。

>>> 多头注意力原理
@type: animation
@rect: safe
@enter: fade

当前 token 的 query，和历史所有 key 算相似度，
归一化之后对 value 加权平均。

这就是 **注意力** 的本质。
````

### 5.2 语法规则

1. **YAML frontmatter** 定义 meta（title、aspect、theme、voice）
2. **`>>> 块标题`** 开启一个 Block
3. **`@key: value`** 紧跟块标题，定义结构化字段：
   - `@type`：主体类型（必填）
   - `@rect`：预设名或 `{x,y,w,h}` 字典
   - `@enter` / `@exit`：动画预设名，默认 `auto`
   - `@source` / `@range`：代码块的代码源
   - `@reveal`：代码块的出现方式
   - `@src`：图片 / Lottie / 视频的资源路径
   - `@icon`：图标名
   - `@duration`：显式时长（仅无口播块）
   - 其他类型专属字段
4. **空行之后**：正文，即本块的旁白文案
5. 旁白内的 `**加粗**` 提取为 `emphases`
6. 旁白内的 `（停顿）` `（长停顿）` 映射为 `hints.pauseAfter`

### 5.3 Stage 1 编译器：markdown → blocks.json

```
┌──────────────────┐
│ script.md (作者) │
└────────┬─────────┘
         │
         ▼
┌────────────────────┐
│ T10 frontmatter    │ → meta
├────────────────────┤
│ T11 split blocks   │ → 按 `>>>` 切段
├────────────────────┤
│ T12 parse @fields  │ → 提取结构化指令
├────────────────────┤
│ T13 parse narration│ → 提取 emphases / hints
├────────────────────┤
│ T14 resolve rect   │ → 预设名 → 数值
├────────────────────┤
│ T15 resolve enter/ │ → auto 的块由 LLM 选
│     exit (auto)    │
├────────────────────┤
│ T16 validate       │ → schema 检查
└────────┬───────────┘
         │
         ▼
┌──────────────────┐
│ blocks.json (IR) │
└──────────────────┘
```

编译器本身**不调用 LLM**（除了 `@enter: auto` 的智能选择，可选），主要是确定性解析。

### 5.4 可手改的中间产物

`blocks.json` 是**人类可读的中间表示**：

- 作者可以手工改它（比如微调 rect、换动画预设），然后断点续跑只重渲染受影响的块
- Diff 友好，可以进 git
- Stage 3 组件生成失败时，可以手动编辑 `spec.description` 后让 Claude 重新生成

---

## 6. 流水线重构：Stage 与 Task

### 6.1 Stage 总览

```
Stage 0: 环境检测（v1 同）
Stage 1: 脚本编译（markdown → blocks.json）
Stage 2: 音频生成（TTS + 词级 VTT + 字幕切段）  ← 与 Stage 3 并行
Stage 3: 视觉资产（组件生成 / 资源准备）        ← 与 Stage 2 并行
Stage 4: 时序装配（Block 时长/帧计算 + Remotion Sequence 生成）
Stage 5: 渲染（remotion render）
Stage 6: 后处理（音频标准化 + 质量检查）
```

### 6.2 Task 命名规范

```
T{stage}{seq}_{kind}[_{blockId}]

T00_sudo_check           # Stage 0 全局
T10_frontmatter          # Stage 1 全局
T11_split_blocks         # Stage 1 全局
T12_parse_block_B03      # Stage 1 单块
T20_tts_B03              # Stage 2 单块（并行）
T21_vtt_align_B03        # Stage 2 单块（依赖 T20_tts_B03）
T22_subtitle_split_B03   # Stage 2 单块（依赖 T21_vtt_align_B03）
T30_theme                # Stage 3 全局
T31_component_B03        # Stage 3 单块（并行，依赖 T12_parse_block_B03）
T40_timing               # Stage 4 全局（依赖所有 Stage 2/3）
T41_compose_root         # Stage 4 全局
T42_compile_check        # Stage 4 全局
T50_preview_frames       # Stage 5
T51_full_render          # Stage 5
T60_normalize            # Stage 6
T61_quality_check        # Stage 6
```

### 6.3 依赖图（简化）

```
T00_sudo_check
    ↓
T01..T06 env setup
    ↓
T10_frontmatter ─── T11_split_blocks ─── T12_parse_block_*
                                             │
                   ┌─────────────────────────┼─────────────────────────┐
                   ▼                         ▼                         ▼
           T20_tts_B00           T20_tts_B01   ...           T31_component_B00, B01, ...
                   │                         │                         │
                   ▼                         ▼                         │
           T21_vtt_align_B00 ...                                        │
                   │                                                   │
                   ▼                                                   │
           T22_subtitle_split_B00 ...                                   │
                   └──────────────────┬────────────────────────────────┘
                                      ▼
                              T40_timing
                                      ↓
                              T41_compose_root
                                      ↓
                              T42_compile_check
                                      ↓
                              T50_preview_frames
                                      ↓
                              T51_full_render
                                      ↓
                              T60_normalize → T61_quality_check
```

### 6.4 与 v1 的差异点

| v1 | v2 |
|----|----|
| `T20_tts_B{xx}` 并行 | 同 |
| `T31_Asset_{n}` 松散 | `T31_component_B{xx}`，每块唯一 |
| 字幕作为全局组件 | 每块独立切段 `T22_subtitle_split_B{xx}` |
| `T42_compile_check` 整体 | 同，但失败时报告哪个块的组件挂了 |
| 没有 `T21_vtt_align` | 新增，用于 CosyVoice 等无原生词级时间戳的 TTS |
| Rect 不存在 | Stage 1 产出 |
| 动画 hardcoded in component | Stage 4 统一包装 |

---

## 7. Remotion 映射

### 7.1 工程结构

```
src/
├── Root.tsx                   // 注册所有 Composition
├── Video.tsx                  // <Video> 顶层组合
├── engine/
│   ├── theme.ts                // 全局 THEME
│   ├── animations.ts           // enter/exit 预设实现
│   ├── rect.ts                 // 归一化 → CSS 工具
│   ├── subtitle.ts             // 字幕选段 + 高亮渲染
│   └── block-frame.tsx         // 统一的 Block 外壳
├── components/
│   ├── SubtitleOverlay.tsx
│   ├── contents/
│   │   ├── Image.tsx
│   │   ├── Code.tsx
│   │   ├── Icon.tsx
│   │   ├── Lottie.tsx
│   │   ├── VideoClip.tsx
│   │   └── TextCard.tsx
│   └── backgrounds/
│       └── GridBackground.tsx
├── blocks/
│   ├── B00/
│   │   ├── Component.tsx       // 仅 animation 类型需要（AI 生成）
│   │   └── block.json          // 从总 blocks.json 抽出的单块快照
│   ├── B01/
│   ├── ...
│   └── B13/
└── data/
    ├── blocks.json
    └── source-samples/
```

### 7.2 Video.tsx（顶层）

```tsx
export const Video: React.FC = () => {
  const { blocks, meta } = useVideoConfig();  // 从 props 注入 blocks.json

  return (
    <AbsoluteFill style={{ background: theme.bgDeep }}>
      {blocks.map((block, i) => (
        <Sequence
          key={block.id}
          from={block.timing.startFrame}
          durationInFrames={block.timing.frames}
          name={`${block.id}: ${block.title}`}
        >
          <BlockFrame block={block} />
        </Sequence>
      ))}
      <Audio src={staticFile('audio/master.wav')} />   {/* Stage 6 拼好的主音轨 */}
    </AbsoluteFill>
  );
};
```

### 7.3 BlockFrame（每块外壳）

```tsx
const BlockFrame: React.FC<{ block: Block }> = ({ block }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { enter, exit, rect, content } = block.visual;

  // 根据全局帧计算本块内的局部帧
  const localFrame = frame - block.timing.startFrame;

  // 计算入场/出场的动画状态
  const enterStyle = applyPreset(enter.preset, localFrame, enter.duration * fps, fps);
  const exitStart = block.timing.frames - exit.duration * fps;
  const exitStyle = localFrame >= exitStart
    ? applyPreset(exit.preset + '-out', localFrame - exitStart, exit.duration * fps, fps)
    : {};

  const rectStyle = rectToCss(rect);  // 归一化 → CSS left/top/width/height

  return (
    <AbsoluteFill>
      <div style={{ ...rectStyle, ...enterStyle, ...exitStyle }}>
        <ContentRouter content={content} frame={localFrame} rect={rect} />
      </div>
      <SubtitleOverlay subtitles={block.subtitles} localFrame={localFrame} fps={fps} />
    </AbsoluteFill>
  );
};
```

### 7.4 ContentRouter（分发到具体类型）

```tsx
const ContentRouter: React.FC<{ content: ContentSpec; frame: number; rect: Rect }> = (p) => {
  switch (p.content.type) {
    case 'image':     return <ImageContent spec={p.content.spec} {...p} />;
    case 'code':      return <CodeContent spec={p.content.spec} {...p} />;
    case 'icon':      return <IconContent spec={p.content.spec} {...p} />;
    case 'lottie':    return <LottieContent spec={p.content.spec} {...p} />;
    case 'video':     return <VideoContent spec={p.content.spec} {...p} />;
    case 'textcard':  return <TextCardContent spec={p.content.spec} {...p} />;
    case 'animation': {
      // 动态 import AI 生成的组件
      const Comp = require(`@/blocks/${p.block.id}/Component`).default;
      return <Comp frame={p.frame} durationInFrames={p.durationInFrames} rect={p.rect} theme={theme} fps={fps} />;
    }
  }
};
```

---

## 8. TTS Provider 抽象

详见 `TTS_RESEARCH.md` §4。关键接口：

```python
# scripts/tts/provider.py
class TTSProvider(Protocol):
    name: str
    def is_available(self) -> bool: ...
    def synth(self, text: str, *, voice: str, emphases: list, ssml_hints: dict) -> TTSResult: ...

class TTSRouter:
    """根据 config.tts.routing 和内容特征决定用哪个 provider，失败自动降级"""
    def __init__(self, config: dict): ...
    def synth_block(self, block: Block) -> TTSResult: ...
```

每个 Block 的 `T20_tts_B{xx}` 任务调用 `TTSRouter.synth_block(block)`，router 内部：

1. 分析 `block.narration` 的内容特征（英文占比、emphasis 数量、长度）
2. 按 `config.tts.routing` 策略选 provider
3. 调用 `provider.synth()`，失败则按 `fallback` 链降级
4. 返回 `TTSResult`，包含 wav 和 vtt 路径
5. `provider_used` 记回 `block.timing.provider`，便于调试和成本审计

---

## 9. 目录结构对照

### v1（当前）

```
~/teaching-video-*/
├── video-agent-config.json
├── pipeline-state.json
├── src/
│   ├── Root.tsx
│   ├── Video.tsx
│   ├── data/
│   │   ├── script.md
│   │   ├── blocks.json
│   │   └── source-samples/
│   └── components/
│       ├── Asset1.tsx ... Asset13.tsx
│       └── SubtitleOverlay.tsx
├── public/audio/
└── output/
```

### v2（重构后）

```
~/teaching-video-*/
├── video-agent-config.json          # 扩展：tts provider 配置
├── pipeline-state.json              # schema 升级：每个 block 独立 status
├── blocks.json                      # ⭐ 新增：唯一中间 IR
├── assets/                          # ⭐ 新增：用户预备资源
│   ├── images/
│   ├── lottie/
│   ├── clips/
│   └── voice-prompts/
├── src/
│   ├── Root.tsx
│   ├── Video.tsx
│   ├── engine/                      # ⭐ 新增：框架核心
│   ├── components/
│   │   ├── SubtitleOverlay.tsx
│   │   ├── contents/                # ⭐ 新增：内容类型组件
│   │   └── backgrounds/
│   ├── blocks/                      # ⭐ 新增：每块独立目录
│   │   ├── B00/ Component.tsx       # 仅 animation 类型
│   │   ├── B01/
│   │   └── ...
│   └── data/
│       ├── script.md                # 作者原始输入
│       ├── blocks.json              # 软链接 → ../blocks.json
│       └── source-samples/
├── scripts/
│   ├── update-task.sh
│   ├── next-tasks.sh
│   ├── progress.sh
│   ├── compile-script.mjs           # ⭐ 新增：markdown → blocks.json
│   ├── measure-subtitle.mjs         # ⭐ 新增：node-canvas 字幕切段
│   └── tts/                         # ⭐ 新增：TTS provider
│       ├── router.py
│       ├── providers/
│       │   ├── edge.py
│       │   ├── azure.py
│       │   ├── cosyvoice.py
│       │   └── elevenlabs.py        # 预留
│       └── align_whisperx.py
├── public/audio/
│   ├── B00.wav
│   ├── B00.vtt
│   └── ...
└── output/
    └── final_normalized.mp4
```

### 差异点摘要

- ⭐ `blocks.json` 提到项目根（作为一等公民）
- ⭐ `assets/` 独立目录，明确区分"用户素材"和"生成产物"
- ⭐ `src/engine/` 承载框架核心（animations、rect、theme、block-frame）
- ⭐ `src/blocks/B{xx}/` 每块一个目录
- ⭐ `scripts/tts/` 新增 provider 目录
- ⭐ `scripts/compile-script.mjs` / `measure-subtitle.mjs`：Node 工具

---

## 10. 断点续跑 & 局部重跑

### 10.1 状态粒度

`pipeline-state.json` 新 schema：

```jsonc
{
  "version": "2.0",
  "blocks": {
    "B03": {
      "tts":       { "status": "completed", "provider": "cosyvoice", "duration": 4.82 },
      "vttAlign":  { "status": "completed" },
      "subtitle":  { "status": "completed", "count": 3 },
      "component": { "status": "completed", "path": "src/blocks/B03/Component.tsx" }
    },
    ...
  },
  "global": {
    "frontmatter": { "status": "completed" },
    "timing":      { "status": "completed" },
    "composeRoot": { "status": "completed" },
    "render":      { "status": "running" }
  }
}
```

### 10.2 局部重跑命令

```bash
# 重跑单块
bash run.sh --resume --rebuild B03
#  → 清空 B03 的所有 block-level 状态，重新触发 tts/vtt/subtitle/component
#  → 复用其他块的 artifacts
#  → 重跑 Stage 4 的 timing 和 compose，重新 render

# 重跑某个阶段
bash run.sh --resume --rebuild-stage 3
#  → 清空所有 block 的 component 状态

# 用户手改 blocks.json 后重新渲染
bash run.sh --resume --from-blocks-json
#  → 跳过 Stage 1，以现有 blocks.json 为起点
```

---

## 11. 迁移计划

### Phase 0：框架骨架（1 天）

- [ ] 创建 `src/engine/` 的 `theme.ts` / `animations.ts` / `rect.ts`
- [ ] 定义 `types/block.ts` 的 TypeScript 类型，和 `schemas/block.schema.json`（用于 Ajv 校验）
- [ ] 写一个静态的 `blocks.json` 手工样例，跑通 `BlockFrame` 渲染 1 个假 block

### Phase 1：Stage 1 编译器（1.5 天）

- [ ] `scripts/compile-script.mjs`：markdown → blocks.json
- [ ] 所有 `@field` 解析 + rect 预设映射
- [ ] 单元测试：用 `script-microgpt.md` 的 v2 版本跑通
- [ ] `@enter: auto` 的智能选择逻辑（可用 LLM，也可先写规则兜底）

### Phase 2：TTS Provider（2 天）

- [ ] `scripts/tts/router.py` + `edge.py` 重构
- [ ] `azure.py` provider
- [ ] `cosyvoice.py` provider（假设有现成的 FastAPI 服务地址）
- [ ] `align_whisperx.py` 词级对齐兜底
- [ ] 盲测验收

### Phase 3：字幕切段（0.5 天）

- [ ] `scripts/measure-subtitle.mjs`：node-canvas + 算法实现
- [ ] 与 VTT 对齐
- [ ] `SubtitleOverlay.tsx` 重写

### Phase 4：内容类型组件（2 天）

- [ ] `components/contents/` 全部 6 类
- [ ] `ContentRouter` 分发
- [ ] Lucide 图标集成
- [ ] 代码高亮（Shiki / Prism）

### Phase 5：Stage 4 时序装配（1 天）

- [ ] 按 block 累计 startFrame
- [ ] 生成主音轨（concat + 插入静音）
- [ ] `Video.tsx` 从 `blocks.json` 驱动

### Phase 6：局部重跑 & 状态迁移（0.5 天）

- [ ] `pipeline-state.json` v2 schema
- [ ] `run.sh --rebuild B{xx}` / `--rebuild-stage` 实现

### Phase 7：端到端验收（1 天）

- [ ] 把 `script-microgpt.md` 改写为 v2 格式
- [ ] 跑通完整流水线
- [ ] 对比 v1 输出视频，确认字幕不溢出、位置可预测、TTS 自然

**总计：约 9.5 天**

---

## 12. 待定项 / 风险

| # | 问题 | 建议 |
|---|------|------|
| 1 | CosyVoice 本地服务怎么启动？（Stage 0 起一个常驻 daemon？）| 在 Stage 0 加一个 `T07_cosyvoice_up` 任务，检测 `http://127.0.0.1:50000/health`；不可用则降级到 Azure |
| 2 | Claude Agent 在 Stage 3 生成 animation 组件时，如何保证接口一致？| 写一个严格的 prompt 模板，用 TypeScript 接口文件作为 "reference"，让它实现；加一个 `T42_compile_check` 强类型校验 |
| 3 | 用户没有 GPU 时怎么办？| `T07_cosyvoice_up` 检测失败 → 自动用 Azure，不阻塞 |
| 4 | 片尾版权信息、片头 logo 怎么插入？| 作为普通 block，用 `@type: image` 或 `@type: textcard` |
| 5 | 同一个视频里混用多种 theme？| v2 不支持，一个视频一个 theme。未来可以做 per-block override |
| 6 | 分辨率切换时 Rect 怎么自适应？| 归一化坐标天然支持。唯一问题是字体大小，theme 里按 `resolution.h` 比例缩放 |
| 7 | blocks.json 被用户手改后 schema 还有效吗？| Stage 1 出口做 Ajv 校验；每次 resume 也做一次 |

---

## 13. 附录：script.md v2 完整示例

````markdown
---
title: 200 行纯 Python 手撕 GPT
aspect: 16:9
theme: dark-code
voice: zh-CN-YunyiMultilingualNeural
---

>>> 开场
@type: textcard
@rect: center-60
@enter: fade-up
@exit: fade-down
@duration: 4s

# microgpt.py
by @karpathy
200 行 · 0 依赖 · 1 个 GPT

只用标准库，没有 PyTorch，没有 NumPy，
200 行代码，从零训练一个 **GPT**。

>>> 文件结构鸟瞰
@type: animation
@rect: center-80
@enter: fade
@exit: fade

整个文件分成六块，我们按顺序拆开看。

>>> Value 类字段
@type: code
@rect: right-half
@enter: zoom-in
@exit: fade
@source: microgpt.py
@range: 30-50
@reveal: line-by-line

要训练神经网络，必须有 **自动求导**。
karpathy 用一个 Value 类实现了它。

>>> 前向计算图
@type: animation
@rect: safe
@enter: fade

每做一次加法或乘法，
就自动生成一个新节点，
并记下它对父节点的 **局部梯度**。

>>> 总结金句
@type: textcard
@rect: center-60
@enter: fade-up
@exit: fade
@duration: 4s

> 200 行
> 0 个依赖
> 1 个完整的 GPT

**200 行，0 依赖，1 个完整的 GPT**。

剩下的一切，都只是 **效率优化**。

>>> 片尾
@type: textcard
@rect: center-60
@enter: fade
@exit: none
@duration: 4s

> microgpt.py
> by @karpathy
> 感谢收看
````

---

## 14. 下一步

1. **您评审本文档**，确认 §1 Block schema 和 §4 字幕规则没有遗漏
2. **确认 CosyVoice prompt 录音方案**（TTS_RESEARCH.md §7.1）
3. **确认是否现在启动 Phase 0**（或者先出一个可运行的 TS 类型定义 + 一个假 block 的渲染 demo）
4. 如果都 OK，我按 Phase 0 → Phase 7 顺序开干，每个 Phase 结束给您看一次增量
