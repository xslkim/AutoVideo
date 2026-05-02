# AutoVideo 视频生成输入文件规范 (AI Agent 用)

本文件是 AI Agent 生成 AutoVideo 视频输入文件的完整参考。Agent 只需按照此规范创建三个文件，然后执行 `autovideo build project.json` 即可生成完整视频。

---

## 1. 文件结构

```
my-project/
  project.json           ← 项目入口清单
  meta.md                ← 视频元信息
  script.md              ← 块内容（可拆分为多个 .md 文件）
  B00.wav                ← 参考语音（可选，10-30秒清晰人声 WAV）
  autovideo.config.json  ← 可选配置覆盖
```

## 2. project.json

```json
{
  "meta": "./meta.md",
  "blocks": ["./script.md"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `meta` | string | 是 | meta.md 相对路径 |
| `blocks` | string[] | 是 | 内容文件路径列表，按顺序解析，块 ID 全局唯一 |

可以拆分为多个文件：

```json
{
  "meta": "./meta.md",
  "blocks": ["./part1.md", "./part2.md", "./part3.md"]
}
```

## 3. meta.md

用 `--- meta ---` 和 `---` 包裹的 YAML 格式：

```markdown
--- meta ---
title: 视频标题
aspect: 16:9
theme: dark-code
fps: 30
voiceRef: ./B00.wav
---
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `title` | string | 必填 | 视频标题，用于生成输出目录名 |
| `aspect` | enum | `16:9` | 宽高比，可选 `16:9`(1920×1080) `9:16`(1080×1920) `1:1`(1080×1080) |
| `theme` | string | `dark-code` | 当前仅支持 `dark-code` |
| `fps` | number | `30` | 帧率 |
| `voiceRef` | string | 自动 | 参考语音文件路径 |
| `slug` | string | 自动 | 强制指定输出目录名 |

## 4. script.md 块语法

### 4.1 整体结构

每个 `.md` 文件包含一个或多个块，块以 `>>>` 开头分隔：

```markdown
>>> 块标题 #B01
@enter: fade-up
@exit: fade

--- visual ---
视觉描述文字（AI 根据这段文字生成 React 动画组件）

--- narration ---
旁白第一行，可以用 **双星号** 标记高亮词
旁白第二行


>>> 下一个块的标题 #B02
@enter: fade

--- visual ---
视觉描述

--- narration ---
旁白文字
```

### 4.2 块头 `>>>`

```
>>> 显示标题 #BLOCK_ID
```

- **显示标题**：必填，出现在管理界面
- **#BLOCK_ID**：可选，格式 `#B` + 两位以上数字（如 `B01`、`B12`）。省略时自动从 B01 递增编号。跨文件 ID 不可重复

### 4.3 指令

放在 `>>>` 标题行之后、`--- visual ---` 之前，每行一条：

| 指令 | 格式 | 默认值 | 说明 |
|------|------|--------|------|
| `@enter` | `@enter: <preset>` | `fade` | 入场动画 |
| `@exit` | `@exit: <preset>` | `fade` | 退场动画 |
| `@duration` | `@duration: <number>s` | 自动 | 强制指定旁白持续时间（秒），仅在需要固定时长时使用 |

**动画预设值**：

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

### 4.4 `--- visual ---` 视觉描述

这段文字会原样发给 Claude AI，由 AI 生成一个完整的 React/Remotion 动画组件。写法要点：

**描述要具体**：指明布局、颜色、动画时序、文字内容。可以写中文或英文。

**时间轴标记**（可选）：用 `[Xs]` 标注关键帧时间点

```
[0s] 屏幕中央显示大标题 "GPT = ?"，带脉冲动画
[3s] 标题平滑变为 "GPT = 下一个词预测器"
[6s] 左侧文本框显示 "今天天气真"，右侧概率条形图
[8s] "好" 被选中，飞入文本末尾
```

**引用图片**（可选）：用 `./` 开头的相对路径引用项目中的图片

```
显示图片 ./hero.png 居中放大展示
```

**引用代码**（可选）：在描述中提及代码文件，编译时会自动内联

```
展示 microgpt.py lines 30-50 的代码，语法高亮
```

**组件收到的 props**（AI 生成的组件会收到这些）：

```typescript
{
  frame: number;            // 当前帧号
  durationInFrames: number; // 总帧数
  width: number;            // 视频宽度（像素）
  height: number;           // 视频高度（像素）
  subtitleSafeBottom: number; // 字幕安全区底部 y 坐标
  theme: {                  // 当前主题
    colors: {
      bg: string;           // 背景色 "#0d1117"
      fg: string;           // 前景色 "#e6edf3"
      accent: string;       // 强调色 "#58a6ff"
      muted: string;        // 次要文字色 "#8b949e"
      code: {
        bg: string;         // 代码背景 "#161b22"
        keyword: string;    // 关键字色 "#ff7b72"
        string: string;     // 字符串色 "#a5d6ff"
        comment: string;    // 注释色 "#8b949e"
      };
    };
    fonts: {
      sans: string;         // "Noto Sans SC, Noto Sans, sans-serif"
      mono: string;         // "JetBrains Mono, Menlo, Monaco, Consolas, monospace"
    };
  };
  fps: number;              // 帧率
}
```

**可用的 Remotion API**：AI 生成的组件可以使用 `remotion` 包的以下功能：
- `useCurrentFrame()` — 获取当前帧号
- `useVideoConfig()` — 获取视频配置
- `interpolate()` — 帧插值
- `spring()` — 弹簧动画
- `AbsoluteFill` — 全屏容器
- `Sequence` — 时间序列

### 4.5 `--- narration ---` 旁白

- 每个非空行 = 一条旁白，TTS 会逐行生成语音后拼接
- 行间自动插入 200ms 静音
- **高亮**：用 `**文字**` 标记字幕中需要高亮的词，TTS 会自动去除星号
- 转义：用 `\*\*` 表示字面量 `**`

```
这是一个 **非常重要** 的概念
这里需要字面量的 \*\* 符号
```

## 5. 完整示例

```markdown
--- meta ---
title: GPT 入门教程
aspect: 16:9
theme: dark-code
fps: 30
---
```

```markdown
>>> 开场标题 #B01
@enter: fade-up
@exit: fade

--- visual ---
居中显示大标题 "GPT 入门"，白色粗体 72px，深色背景。标题下方小字显示 "从零理解 Transformer"。整体从透明渐显，配合轻微上移动画。

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
顶部标题 "训练三步循环"。标题下三张卡片依次从左滑入，横向等距排列：
① 🔥 图标 + "损失函数" + "衡量预测偏差"
② 🧭 图标 + "梯度" + "参数调整方向"
③ ⚙️ 图标 + "优化器" + "执行参数更新"
卡片用半透明深色背景，图标用 accent 色。

--- narration ---
训练过程就是不断重复三个步骤
**损失函数** 衡量预测和标准答案差多远
**梯度** 告诉每个参数该往哪边调整
**优化器** 按照梯度实际更新参数
```

对应 `project.json`：

```json
{
  "meta": "./meta.md",
  "blocks": ["./script.md"]
}
```

## 6. 执行命令

```bash
cd my-project/

# 一键生成（编译 + TTS + 视觉 + 渲染）
autovideo build project.json

# 分步执行
autovideo compile project.json        # Markdown → script.json
autovideo tts <outDir>/script.json    # 生成语音
autovideo visuals <outDir>/script.json # 生成视觉组件
autovideo render <outDir>/script.json  # 渲染 MP4

# 仅重新渲染某个块
autovideo render <outDir>/script.json --block B03 --force

# 检查环境
autovideo doctor
```

## 7. 输出文件

```
build/<slug>/
  script.json                    ← 编译后的中间表示
  src/blocks/B01/Component.tsx   ← AI 生成的视觉组件
  src/blocks/B02/Component.tsx
  ...
  public/
    audio/B01.wav                ← TTS 生成的语音
    audio/B02.wav
    ...
    script.json
  output/
    partials/B01.mp4             ← 每个块的独立视频
    partials/B02.mp4
    ...
    final.mp4                    ← 拼接后的完整视频
    final_normalized.mp4         ← 音量标准化后的最终输出
```

## 8. 规则清单

1. **块 ID 格式**：`B` + 两位以上数字，如 `B01` `B12`。省略则自动编号
2. **块 ID 全局唯一**：跨文件不可重复
3. **每个块必须包含** `--- visual ---` 和 `--- narration ---` 两个 section
4. **section 顺序固定**：指令行 → `--- visual ---` → `--- narration ---`
5. **动画预设值必须是以下之一**：`fade` `fade-up` `fade-down` `slide-left` `slide-right` `zoom-in` `zoom-out` `none`
6. **`@duration` 格式**：必须是 `<数字>s`，如 `8s` `1.5s`
7. **视觉描述是自然语言**：写得越具体（布局、颜色、动画时序、文字内容），AI 生成的组件越精确
8. **旁白每行一句**：TTS 逐行生成语音，空行忽略
9. **高亮语法**：`**文字**` 在字幕中显示高亮，TTS 只读文字本身
10. **文件编码**：UTF-8
