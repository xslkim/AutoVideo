# AutoVideo 输入资源编写指南

> **本文档专为编写视频输入资源的 AI Agent 编写**。
>
> 任务：在 AutoVideo 工程目录下产出两个 Markdown 文件：
> - `meta.md` — 视频元数据
> - `script.md` — 视频脚本（按 `>>>` 分块）
>
> 写完之后由另一个 Agent 按 [`BUILD.md`](BUILD.md) 跑构建生成 MP4。本文档**不涉及**任何构建命令。

---

## 0. 一分钟速览

```
project/MyVideo/
├── meta.md          ← 你要产出的文件 1：YAML 元数据
└── script.md        ← 你要产出的文件 2：视频脚本（>>> 分块）
```

```markdown
# meta.md
--- meta ---
title: 我的视频
aspect: 16:9
theme: dark-code
fps: 30
slug: my-video
voiceRef: ../../B00.wav
---
```

```markdown
# script.md
>>> 开场 #B01
@enter: fade-up
@exit: fade

--- visual ---
（这里写视觉描述，AI 会据此生成 React 动画组件）

--- narration ---
（这里写旁白，每行一句，**双星号** 表示字幕高亮词）
```

---

## 1. `meta.md` — 视频元数据

YAML 风格，用 `--- meta ---` 和 `---` 包裹：

```markdown
--- meta ---
title: 视频标题
aspect: 16:9
theme: dark-code
fps: 30
slug: my-video-slug
voiceRef: ../../B00.wav
---
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `title` | string | **必填** | 视频标题，用于生成输出目录名 |
| `aspect` | enum | `16:9` | `16:9`(1920×1080) / `9:16`(1080×1920) / `1:1`(1080×1080) |
| `theme` | string | `dark-code` | 当前仅支持 `dark-code` |
| `fps` | number | `30` | 帧率 |
| `voiceRef` | string | 自动 | 参考音色 WAV 文件路径（10–30s 清晰人声） |
| `slug` | string | 由 title 推导 | 强制指定输出目录名（英文，连字符） |

**注意事项：**
- `slug` 用英文连字符命名（如 `microgpt-py-survival-guide`），它决定 `build/<slug>/...` 的目录名
- `voiceRef` 路径相对 `meta.md` 自身。可以指向项目内的 WAV，也可以指向公共音色（如 `../../B00.wav`）
- `aspect` 决定输出视频的实际像素尺寸，不要再单独指定宽高

---

## 2. `script.md` — 视频脚本

### 2.1 整体结构

每个 `.md` 文件包含一个或多个块，每个块以 `>>>` 开头：

```markdown
>>> 块标题 #B01
@enter: fade-up
@exit: fade

--- visual ---
视觉描述（自然语言，AI 据此生成 React/Remotion 组件）

--- narration ---
旁白第一行
旁白第二行，可以用 **双星号** 标记字幕高亮词


>>> 下一个块的标题 #B02
@enter: fade

--- visual ---
另一段视觉描述

--- narration ---
旁白文字
```

**section 顺序固定**：`>>>` 标题行 → 指令行（可选）→ `--- visual ---` → `--- narration ---`

### 2.2 块头 `>>>`

```
>>> 显示标题 #BLOCK_ID
```

- **显示标题**：必填，会出现在管理界面
- **`#BLOCK_ID`**：可选，格式为 `#B` + 两位以上数字（如 `#B01`、`#B12`）
  - 省略时自动从 `B01` 起递增
  - **跨文件全局唯一**（如果拆成多个文件，不可重号）

### 2.3 指令

放在 `>>>` 标题行之后、`--- visual ---` 之前，每行一条：

| 指令 | 格式 | 默认值 | 说明 |
|------|------|--------|------|
| `@enter` | `@enter: <preset>` | `fade` | 入场动画 |
| `@exit` | `@exit: <preset>` | `fade` | 退场动画 |
| `@duration` | `@duration: <number>s` | 自动（按旁白时长） | 强制指定总时长（秒），如 `@duration: 8s` |

**动画预设值**（`@enter` / `@exit` 必须用以下之一）：

| 预设 | 效果 |
|------|------|
| `fade` | 透明度渐变 |
| `fade-up` | 从下方上移 + 渐显 |
| `fade-down` | 从上方下移 + 渐显 |
| `slide-left` | 从右侧滑入 |
| `slide-right` | 从左侧滑入 |
| `zoom-in` | 缩放放大 + 渐显 |
| `zoom-out` | 缩放缩小 + 渐显 |
| `none` | 无动画（持续时间为 0） |

---

## 3. `--- visual ---` 视觉描述

这段文本会**原样发送给 Claude AI**，由 AI 生成完整的 React/Remotion 动画组件。**写得越具体，AI 生成的组件越精准**。

### 3.1 写法要点

#### 描述要具体

指明：**布局位置 / 颜色（建议用 16 进制）/ 字号 / 动画时序 / 文字内容**。

```
全屏深色背景 (#0d1117)。画面垂直居中布局：
[0s] 主标题 "microgpt.py 生存教程" 淡入，白色 (#e6edf3)，粗体，字号 64px，居中。
[0.5s] 副标题 "从零看懂一个能训练、能生成的最小 GPT" 淡入，颜色 #8b949e，字号 22px，主标题下方 24px。
[1s] 主标题正下方 12px 处出现一条 2px 粗的 accent 色 (#58a6ff) 横线，从左到右扫入。
```

#### 时间轴标记

用 `[Xs]` 标注关键帧时间点（推荐用法）：

```
[0s]   主标题淡入
[1.5s] 副标题滑入
[3s]   底部出现进度条
[6s]   全部 fade-out
```

#### 引用图片

用 `./` 开头的相对路径：

```
显示图片 ./hero.png 居中放大展示
```

构建时会自动哈希并复制到 `build/<slug>/public/assets/<hash>.png`。

#### 引用代码

在描述中提及代码文件，编译时会内联：

```
展示 microgpt.py lines 30-50 的代码，语法高亮
```

### 3.2 AI 生成的组件可用的 props

写描述时可以引用这些值（如「使用 theme.colors.accent」）：

```typescript
{
  frame: number;              // 当前帧号
  durationInFrames: number;   // 总帧数
  width: number;              // 视频宽度（像素）
  height: number;             // 视频高度（像素）
  subtitleSafeBottom: number; // 字幕安全区底部 y 坐标
  fps: number;                // 帧率
  theme: {
    colors: {
      bg: string;             // 背景色      "#0d1117"
      fg: string;             // 前景色      "#e6edf3"
      accent: string;         // 强调色      "#58a6ff"
      muted: string;          // 次要文字色  "#8b949e"
      code: {
        bg: string;           // 代码背景    "#161b22"
        keyword: string;      // 关键字色    "#ff7b72"
        string: string;       // 字符串色    "#a5d6ff"
        comment: string;      // 注释色      "#8b949e"
      };
    };
    fonts: {
      sans: string;           // "Noto Sans SC, Noto Sans, sans-serif"
      mono: string;           // "JetBrains Mono, Menlo, Monaco, Consolas, monospace"
    };
  };
}
```

### 3.3 可用的 Remotion API

AI 生成的组件可以使用 `remotion` 包的：

- `useCurrentFrame()` — 获取当前帧号
- `useVideoConfig()` — 获取视频配置
- `interpolate()` — 帧插值
- `spring()` — 弹簧动画
- `AbsoluteFill` — 全屏容器
- `Sequence` — 时间序列

写描述时**无需关心代码层面**，只需用自然语言描述视觉效果即可。

---

## 4. `--- narration ---` 旁白

### 4.1 基本规则

- **每行 = 一条旁白**，TTS 逐行生成语音后拼接
- 行间自动插入 **200ms 静音**
- 空行被忽略

### 4.2 字幕高亮

`**文字**` 在字幕中显示高亮（accent 色），TTS 只读文字本身：

```
这是一个 **非常重要** 的概念
```

→ TTS 朗读「这是一个非常重要的概念」，字幕中「非常重要」高亮显示。

### 4.3 字面量转义

如需在旁白中出现字面 `**`，用 `\*\*`：

```
这里需要字面量的 \*\* 符号
```

### 4.4 写作建议

- 每行控制在 1 句话内（约 15–25 个字），节奏感更好
- 配合视觉描述的时序，旁白也按 `[Xs]` 节拍组织
- 关键术语首次出现时用 `**` 高亮，便于观众抓住要点

---

## 5. 资产文件

### 图片

放在项目目录下，用相对路径在 `--- visual ---` 中引用（如 `./hero.png`）。
构建时会按 SHA-256 哈希复制到 `build/<slug>/public/assets/<hash>.png`，无需手动管理。

### 参考音色

`meta.md` 的 `voiceRef` 字段指向 10–30 秒的清晰人声 WAV：

- 路径相对 `meta.md` 自身
- 可放在项目目录里（`./voice.wav`），也可指向共享位置（`../../B00.wav`）
- TTS 会复用此音色的音色特征生成所有旁白

---

## 6. 拆分多个脚本文件（可选）

当 `script.md` 过长时，可以拆成多个文件，例如：

```
project/MyVideo/
├── meta.md
├── part1.md      # 块 B01–B05
├── part2.md      # 块 B06–B10
└── part3.md      # 块 B11–B15
```

需要相应地修改 `project.json`（如果存在）：

```json
{
  "meta": "./meta.md",
  "blocks": ["./part1.md", "./part2.md", "./part3.md"]
}
```

> **注意**：构建脚本通常会自动生成 `project.json`，你只需关心 `.md` 文件即可。
> 如果使用单文件方案，命名为 `script.md` 是默认约定。

---

## 7. 完整示例

### 7.1 `meta.md`

```markdown
--- meta ---
title: GPT 入门教程
aspect: 16:9
theme: dark-code
fps: 30
slug: gpt-intro
voiceRef: ../../B00.wav
---
```

### 7.2 `script.md`

```markdown
>>> 开场标题 #B01
@enter: fade-up
@exit: fade

--- visual ---
居中显示大标题 "GPT 入门"，白色粗体 72px，深色背景 #0d1117。
[0s] 标题从透明渐显，伴随 24px 上移动画。
[1s] 标题下方 32px 处出现小字 "从零理解 Transformer"，颜色 #8b949e，字号 22px。
[1.5s] 标题正下方 12px 处出现 2px 粗的 accent 色 (#58a6ff) 横线，从左向右扫入。

--- narration ---
大家好
今天我们从零开始理解 **GPT** 的工作原理


>>> 什么是语言模型 #B02
@enter: fade-up
@exit: fade

--- visual ---
分步动画演示：
[0s] 屏幕中央显示 "输入 → ???" 的等式，问号带闪烁动画
[3s] 等式平滑变为 "今天天气 → 预测下一个字"
[6s] 右侧弹出概率条形图：好 35%(accent 色)、不 12%、冷 8%
[8s] "好" 被选中高亮，移入等式变成 "今天天气好 → 预测下一个字"

--- narration ---
语言模型的核心就是预测下一个词
给定一段文字作为输入
模型会输出一个 **概率分布**
告诉每个可能的下一个词的概率有多高


>>> 训练过程 #B03
@enter: fade
@exit: fade

--- visual ---
顶部居中标题 "训练三步循环"，字号 36px，颜色 #e6edf3。
下方三张卡片依次从左滑入（间隔 0.5s），横向等距排列：
① 🔥 图标 + "损失函数" + "衡量预测偏差"
② 🧭 图标 + "梯度" + "参数调整方向"
③ ⚙️ 图标 + "优化器" + "执行参数更新"
卡片背景 #161b22，圆角 12px，边框 1px solid #30363d；图标 accent 色。

--- narration ---
训练过程就是不断重复三个步骤
**损失函数** 衡量预测和标准答案差多远
**梯度** 告诉每个参数该往哪边调整
**优化器** 按照梯度实际更新参数
```

> 想看真实项目示例：[`project/MicroGpt/meta.md`](project/MicroGpt/meta.md) + [`project/MicroGpt/part1.md`](project/MicroGpt/part1.md)

---

## 8. 写作规则清单（必读）

1. **块 ID 格式**：`B` + 两位以上数字（如 `B01`、`B12`），省略则自动编号
2. **块 ID 全局唯一**：跨文件不可重号
3. **每个块必须包含** `--- visual ---` 和 `--- narration ---` 两个 section
4. **section 顺序固定**：`>>>` 标题 → 指令行（可选）→ `--- visual ---` → `--- narration ---`
5. **动画预设值**必须是：`fade` `fade-up` `fade-down` `slide-left` `slide-right` `zoom-in` `zoom-out` `none`
6. **`@duration` 格式**：必须是 `<数字>s`，如 `8s`、`1.5s`
7. **视觉描述用自然语言**：写得越具体（布局、颜色、时序、文字内容），AI 生成的组件越精准
8. **旁白每行一句**：TTS 逐行生成，空行忽略
9. **高亮语法**：`**文字**` 在字幕高亮，TTS 只读文字本身；字面 `**` 用 `\*\*`
10. **资产路径**：图片用 `./` 开头的相对路径
11. **文件编码**：UTF-8
12. **`meta.md` 必填字段**：`title`；其余有默认值

---

## 下一步

写完 `meta.md` 和 `script.md` 后，把项目目录路径交给负责构建的 Agent，由它按 [`BUILD.md`](BUILD.md) 跑构建生成最终 MP4。
