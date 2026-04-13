# AutoVideo v2 输入格式规范

> 版本：2.1
> 输入文件只包含块（`>>>`），不含任何前言或 frontmatter。
> 视频标题、主题等元数据通过 CLI 参数传入。

---

## 一、整体结构

```markdown
>>> 块标题
@type: <类型>
@rect: <位置>
@enter: <入场动画>
@exit:  <出场动画>
[其他类型专属字段]

块的旁白文案（空行之后开始）。
**加粗词** 会在字幕里高亮显示。

（停顿）可以插入额外停顿。

>>> 下一个块
...
```

**注意：**
- 输入文件**只由块构成**，第一个 `>>>` 之前的任何文字会被忽略。
- 视频标题、画面比例、主题、TTS 声音等元数据通过 `run.sh` 的 CLI 参数传入（`--title`、`--aspect`、`--theme`、`--voice`）。
- 可以指定多个输入文件（逗号分隔），按顺序合并为单个视频，块编号跨文件连续递增。

---

## 二、CLI 元数据参数

元数据不再写在文件里，而是通过命令行传入：

```bash
bash run.sh \
  --script  "part1.md,part2.md" \   # 逗号分隔多文件，合并为单个视频
  --title   "200 行纯 Python 手撕 GPT" \  # 视频标题（必填）
  --aspect  16:9 \                  # 画面比例（默认 16:9）
  --theme   dark-code \             # 主题（默认 dark-code）
  --voice   zh-CN-YunxiNeural      # TTS 声音（默认 zh-CN-YunxiNeural）
```

如果文件中仍然存在 YAML frontmatter（`---` 包裹），编译器会解析它作为后备，但 CLI 参数优先级更高。

---

## 三、块（Block）语法

### 3.1 块头部

```
>>> 块标题
```

- `>>>` 后面是块标题（简短可读，用于调试和 Remotion Studio 中的 Sequence 名称）

### 3.2 @指令行

紧跟块标题，每行一个指令：

```
@type:    <内容类型>          # 必填，见 §四
@rect:    <位置预设>          # 可选，默认 safe
@enter:   <入场动画>          # 可选，默认 auto
@exit:    <出场动画>          # 可选，默认 auto
@duration: <时长，如 4s>      # 可选，仅无口播块需要
```

类型专属指令见 §四。

### 3.3 旁白文案

空行之后开始，到下一个 `>>>` 或文件末尾结束。

```markdown
>>> Value 类字段
@type: code
@source: microgpt.py
@range: 30-50

要训练神经网络，必须有 **自动求导**。  ← 旁白（TTS + 字幕）
karpathy 用一个 Value 类实现了它。     ← 旁白（TTS + 字幕）
```

---

## 四、内容类型（@type）

### 4.1 `textcard` — 文字卡

```markdown
>>> 标题卡
@type: textcard
@rect: center-60
@enter: fade-up
@exit: fade
@duration: 4s

> microgpt.py
> by @karpathy
> 200 行 · 0 依赖 · 1 个 GPT

只用标准库，没有 PyTorch，没有 NumPy，
200 行代码，从零训练一个 **GPT**。
```

- `> 引用行` → 显示在卡片上的大字（视觉内容）
- `# 标题` → 同上，作为 `hero` 尺寸文字
- 其余文字 → 旁白（TTS + 字幕）

| 专属字段 | 说明 | 示例 |
|---------|------|------|
| `@align` | 文字对齐 | left / center / right |
| `@style` | 文字样式 | hero / body / mono |

### 4.2 `code` — 代码展示

```markdown
>>> Value 类字段
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 30-50
@reveal: line-by-line
@highlight: 35,38

要训练神经网络，必须有 **自动求导**。
karpathy 用一个 Value 类实现了它。
```

| 专属字段 | 说明 | 示例 |
|---------|------|------|
| `@source` | source-samples 里的文件名 | microgpt.py |
| `@range` | 行号范围 | 30-50 |
| `@reveal` | 显示方式 | line-by-line / all-at-once / typewriter |
| `@highlight` | 高亮行号（逗号分隔）| 35,38 |
| `@speed` | 每秒显示行数（line-by-line 模式）| 3 |

### 4.3 `animation` — AI 生成动画

```markdown
>>> 多头注意力原理
@type: animation
@rect: safe
@enter: fade

当前 token 的 query 和历史所有 key 计算相似度，
归一化之后对 value 加权平均。

这就是 **注意力** 的本质。
```

- **旁白文案全文**会作为 `description` 传给 AI 生成组件
- 如需更精确地控制动画时序，在旁白里用 `[0s: ...]` `[2s: ...]` 标注关键帧

### 4.4 `image` — 图片

```markdown
>>> 账单截图
@type: image
@rect: center-80
@src: images/bill.png
@fit: contain
@ken-burns: true
```

| 专属字段 | 说明 | 示例 |
|---------|------|------|
| `@src` | 图片路径（相对 assets/）| images/bill.png |
| `@fit` | 适配方式 | contain / cover |
| `@ken-burns` | 是否加缓慢缩放 | true / false |

### 4.5 `icon` — 图标（Lucide）

```markdown
>>> 图标展示
@type: icon
@rect: center-60
@icon: lucide:sparkles
@icon-size: 0.4
@color: accent
@anim: pulse
```

| 专属字段 | 说明 | 示例 |
|---------|------|------|
| `@icon` | Lucide 图标名 | lucide:sparkles |
| `@size` | 占 Rect 短边的比例 | 0.3 |
| `@color` | 颜色 token | accent / accent2 / danger |
| `@anim` | 动效 | none / pulse / rotate / bounce |

完整 Lucide 图标列表：https://lucide.dev/icons/

### 4.6 `lottie` — Lottie 动画

```markdown
>>> 庆祝动画
@type: lottie
@rect: safe
@src: lottie/celebration.json
@loop: false
@duration: 3s
```

### 4.7 `video` — 视频切片

```markdown
>>> 操作录屏
@type: video
@rect: center-80
@src: clips/demo.mp4
@speed: 1.5
@muted: true
```

---

## 五、Rect 预设表

| 预设名 | 位置 | 说明 |
|--------|------|------|
| `fullscreen` | 全屏 | 满铺 |
| `safe` | 左右 5%、上下 5%，高 75% | **默认**，留底部给字幕 |
| `center-60` | 居中 60% | 小卡片 |
| `center-80` | 居中 80% | 主要内容 |
| `left-half` | 左半区 | 代码/图片 |
| `right-half` | 右半区 | 代码/图片 |
| `top-half` | 上半区 | — |
| `bottom-half` | 下半区 | — |
| `code-left` | 代码专用左侧宽区 | — |
| `code-right` | 代码专用右侧宽区 | — |

自定义（归一化坐标）：`@rect: {x:0.1,y:0.1,w:0.8,h:0.6}`

---

## 六、动画预设表

### 入场（@enter）

| 预设 | 效果 |
|------|------|
| `none` | 立即出现 |
| `fade` | 渐显 |
| `fade-up` | 从下方滑入 + 渐显 |
| `fade-down` | 从上方滑入 + 渐显 |
| `fade-left` | 从右向左 + 渐显 |
| `fade-right` | 从左向右 + 渐显 |
| `scale` | 从 80% 缩放到正常 |
| `zoom-in` | 从 115% 缩小到正常 |
| `blur-in` | 从模糊到清晰 |
| `auto` | 根据内容类型自动选择（**默认**）|

### 出场（@exit）

| 预设 | 效果 |
|------|------|
| `none` | 立即消失 |
| `fade` | 渐隐 |
| `fade-up` | 向上滑出 + 渐隐 |
| `fade-down` | 向下滑出 + 渐隐 |
| `zoom-out` | 缩小 + 渐隐 |
| `blur-out` | 模糊 + 渐隐 |
| `auto` | 根据内容类型自动选择（**默认**）|

---

## 七、旁白控制

### 7.1 字幕行 = 旁白行（逐行对应）

**每个非空行就是一条字幕。** 不再自动切段。空行直接忽略，不算字幕。

```markdown
要训练神经网络，必须有自动求导。
karpathy 用一个 Value 类实现了它。

每个 Value 节点记四件事：
当前值、梯度、子节点、局部偏导。
```

上面的文案会产生 4 条字幕（空行被忽略）。

### 7.2 字幕时间计算

字幕的 `startMs` / `endMs` 由 TTS 生成的 VTT 文件中的词级时间戳自动计算：
1. 解析 VTT 的每个词/片段的起止时间
2. 将 VTT 文本模糊匹配到完整旁白文本中的字符位置
3. 每条字幕行在旁白文本中的字符范围映射到 VTT 时间轴
4. 如果 VTT 不可用，按字符数比例均分总时长

### 7.3 停顿标记

| 标记 | 效果 |
|------|------|
| `（停顿）` | 额外 1 秒静音 |
| `（长停顿）` | 额外 2 秒静音 |

```markdown
我决定自己造一个。

（停顿）

让我们从 Value 类开始。
```

### 7.4 强调词

```markdown
用 **RMSNorm** 代替 LayerNorm，
用 **ReLU** 代替 GeLU。
```

- 字幕中以 `accent` 颜色高亮
- 路由到高质量 TTS（CosyVoice / Azure）时，会在 SSML 中加 `<emphasis>`

---

## 八、完整示例

运行命令：
```bash
bash run.sh --script script.md --title "200 行纯 Python 手撕 GPT" --theme dark-code --voice zh-CN-YunyiMultilingualNeural
```

script.md 内容：
```markdown
>>> 开场标题卡
@type: textcard
@rect: center-60
@enter: fade-up
@exit: fade-down
@duration: 4s

> microgpt.py
> by @karpathy
> 200 行 · 0 依赖 · 1 个 GPT

只用标准库，没有 PyTorch，没有 NumPy，
200 行代码，从零训练一个 **GPT**。

这是 karpathy 的极简之作。

>>> 文件结构鸟瞰
@type: animation
@rect: center-80
@enter: fade

整个文件分成六块，
我们按顺序拆开看。

>>> Value 类字段
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 30-50
@reveal: line-by-line
@highlight: 35,38

要训练神经网络，必须有 **自动求导**。
karpathy 用一个 Value 类实现了它。

每个 Value 节点记四件事：
当前值、梯度、子节点、局部偏导。

>>> 反向传播
@type: animation
@rect: safe
@enter: fade

先用 DFS 后序遍历把计算图 **拓扑排序**，
然后从 loss 出发反向遍历，
用 **链式法则** 把梯度一层层传回去。

（停顿）

整个 autograd，不到 15 行。

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
```

---

## 九、自查清单

写完脚本后检查：

- [ ] 文件只包含 `>>>` 块，无 frontmatter（标题等由 CLI 参数传入）
- [ ] 每个块有 `>>> 标题` + `@type:` 指令
- [ ] `@type: code` 的块写了 `@source:` 文件名
- [ ] 无口播的块写了 `@duration:`（如片头、片尾）
- [ ] 文字卡的显示内容用 `>` 引用行或 `# 标题` 标出
- [ ] 主题切换处用 `（停顿）` 或 `（长停顿）`
- [ ] 最后一个块是片尾文字卡
- [ ] 字幕行与旁白行一一对应，每行就是一条字幕（注意行长度适中）
