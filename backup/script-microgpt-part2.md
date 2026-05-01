---
title: 200行手撕GPT · 中集：Transformer架构 · 注意力与MLP
aspect: 16:9
theme: dark-code
voice: zh-CN-YunyiMultilingualNeural
---

>>> 开场回顾
@type: textcard
@rect: center-80
@enter: fade-up
@exit: fade
@align: left
@duration: 4s

> 上集：GPT是什么 · 分词器 · 50行 autograd 引擎

中集打开 Transformer 内部——
超参数、词嵌入、注意力、KV cache、残差连接、MLP。

每个概念先讲**是什么、为什么需要**，再看代码。

>>> 超参数与模型参数
@type: animation
@rect: safe
@enter: fade

[0s: 画面分为左右两栏：
 左栏标题 "超参数 Hyperparameters"，副标题 "你手动设定，训练中不变"，
 下方列出五项（依次淡入）：
 n_layer=1 · n_embd=16 · block_size=16 · n_head=4 · vocab=27
 右栏标题 "参数 Parameters"，副标题 "模型自动学习，训练中更新"，
 下方显示一个大矩阵网格图标，标注 "4192 个数字"]
[4s: 两栏缩小上移，底部出现对比表格（从左到右展开）：
 | 模型 | 层数 | 维度 | 参数量 |
 | microgpt | 1 | 16 | 4K |
 | GPT-2 | 12 | 768 | 117M |
 | GPT-3 | 96 | 12288 | 175B |
 microgpt 行高亮]
[7s: 底部出现注释文字 "规模差几千倍，但结构完全一样"]

两个概念先分清楚：

**参数**：模型**自动学习**的数字，训练中调整。
**超参数**：你**手动设定**的数字，描述模型规模。

microgpt 的超参数：1 层、16 维、16 上下文、4 头、词表 27。
训练完之后所有学到的东西，都存在 state_dict 里——**4192 个数字**。

对比 GPT-2 small：12 层、768 维，参数量 1.17 亿。
规模差几千倍，但结构完全一样。

>>> 超参数与 state_dict 代码
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 75-90
@reveal: line-by-line
@highlight: 75,76,81,89

五行超参数，下面是 state_dict——GPT 的全部参数：

**wte**（词嵌入）：27×16，把 token id 变成 16 维向量。
**wpe**（位置嵌入）：16×16，把位置编号变成 16 维向量。
**lm_head**（输出投影）：27×16，把 16 维变成 27 个 token 的分数。

每层注意力有四个矩阵：wq、wk、wv、wo。
MLP 有两个线性变换：fc1 升维到 64，fc2 降回 16。

最后把所有矩阵摊平成一个列表，总计 **4192** 个 Value。

>>> 词嵌入：为什么不直接用数字
@type: animation
@rect: safe
@enter: fade

[0s: 左侧显示三个字母及其 token id：
 "a=0"、"b=1"、"z=25"，旁边画一条数轴，三个点等距排列，
 标注 "编号没有语义——25 不代表 z 更重要"]
[3s: 右侧出现 wte 嵌入表的示意图（27行×16列的彩色矩阵），
 箭头从 "a=0" 指向矩阵第 0 行，从 "z=25" 指向第 25 行，
 标注 "查表：token id → 16 维向量"]
[5s: 底部出现两个向量 bar chart：
 "a" 的 16 维向量和 "e" 的 16 维向量，方向相似（都是元音），
 旁边标注 "训练后，语义相近的字符向量方向也相近"]
[7s: 左下角出现位置嵌入说明：
 "位置嵌入 wpe：同一个字母在不同位置有不同表示"，
 显示 wpe[0] 和 wpe[3] 两个向量被加到同一个 token 上]

**词嵌入**：为什么不直接用 token id？

a=0，b=1，z=25——这些编号没有语义，25 不代表 z 更重要。
词嵌入把编号变成**有意义的 16 维向量**，训练中自动调整，
让语义相近的字符，向量方向也相近。

（停顿）

**位置嵌入**也一样，给每个位置一个 16 维向量。
两者直接相加，模型就同时知道"这是什么字母"和"它在第几个位置"。

>>> 激活函数：为什么需要非线性
@type: animation
@rect: safe
@enter: fade

[0s: 中央显示标题 "如果只有线性变换会怎样？"
 下方画出多层网络示意图，每层标注 "Linear"，
 最终输出框标注 "叠多少层还是线性 → 学不了复杂规律"]
[3s: 画面切换，显示三种激活函数的图像（从左到右排列）：
 ① ReLU：折线图 max(0,x)，标注 "小于0变0，用在 MLP"
 ② Softmax：S型曲线组，标注 "变概率分布，用在注意力和输出"
 ③ RMSNorm：归一化示意（向量长度统一），标注 "长度归一化，稳定训练"]
[6s: 底部出现总结文字：
 "激活函数引入非线性 → 网络才能学复杂模式"]

**激活函数**：为什么需要非线性？

如果网络里只有矩阵乘法，
叠多少层整体还是线性，学不了复杂规律。
激活函数引入非线性。

microgpt 用三种：
**ReLU**（小于0变0，用在MLP），
**Softmax**（变概率分布，用在注意力和输出），
**RMSNorm**（长度归一化，稳定训练）。

（停顿）

>>> 注意力：解决什么问题
@type: animation
@rect: safe
@enter: fade

[0s: 屏幕上方显示一排 token 方块序列："c a t _ s a t _ o n _ m a t"，
 当前处理位置 "mat" 的最后一个 "t" 高亮闪烁]
[2s: 从高亮 token 向前方所有 token 画出虚线连线，
 连线粗细代表相关度：
 "cat" → 粗线（高度相关，高亮色）
 "on" → 中等线（空间关系）
 "the" → 很细线（不太相关，灰色）]
[5s: 连线上出现权重数值：0.45, 0.30, 0.05, ...
 标注 "按相关性加权 → 注意力权重"]
[7s: 底部出现总结：
 "注意力 = 让每个位置能动态地、有选择地看其他位置"]

来到本集核心——**注意力机制**。

它解决什么问题？

朴素神经网络处理每个 token 时，只看当前位置，
没法理解"它"和"猫"的指代关系。

注意力让**每个位置能动态地、有选择地看其他位置**，
按需提取上下文信息——这是 Transformer 的核心创新。

>>> Q、K、V 与注意力计算
@type: animation
@rect: safe
@enter: fade

[0s: 画面左侧显示图书馆类比场景：
 一个人手持卡片 "Q = 你的需求"，
 书架上每本书标有 "K = 标签"，
 书的内容标注 "V = 内容"]
[3s: 类比场景缩到左上角，右侧展开注意力计算流程图（从上到下）：
 输入 x（16维）→ 三个并行箭头分别经过 Wq/Wk/Wv → 得到 q/k/v（各16维）
 q 和所有历史 k 计算点积 → 除以 √head_dim 缩放 → softmax 得到权重
 → 对所有 v 加权求和 → 输出]
[6s: 流程图中的"点积"步骤放大高亮，
 旁边标注 "点积越大 = 越相关"
 "除以√d 缩放"步骤也高亮，标注 "防止数值太大导致 softmax 变 one-hot"]
[9s: 底部出现注意力公式：
 "Attention = softmax(QK^T / √d) · V"]

注意力用三个角色实现：**Query、Key、Value**。

类比图书馆找书：
Query = 你的需求，Key = 每本书的标签，Value = 书的内容。
拿 Query 和所有 Key 比相似度，按相似度对 Value 加权平均。

注意力里：每个 token 生成 Q/K/V，
Q 和所有历史 K 算点积，
除以 √head_dim 缩放，softmax 变权重，
最后对所有 V 加权求和——得到融合了上下文的新表示。

>>> 多头注意力代码
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 114-134
@reveal: line-by-line
@highlight: 118,119,120,129,130

"多头"是什么意思？

把 16 维向量切成 4 份，每份 4 维，4 个头**并行**做注意力。
每个头关注不同类型的信息——语法、语义、位置关系……

每个头独立算 QK 点积、缩放、softmax、对 V 加权求和。
最后把四个头拼接回来，经过 wo 融合。

多头比单头表达能力强得多。

>>> KV cache：推理加速的关键
@type: animation
@rect: safe
@enter: fade

[0s: 左侧显示代码片段高亮两行：
 "keys[li].append(k)"
 "values[li].append(v)"
 旁边标注 "每处理一个位置，就把 k/v 存下来"]
[3s: 右侧出现动画序列，展示 KV cache 逐步增长：
 第1步：keys = [k₀]，values = [v₀]
 第2步：keys = [k₀, k₁]，values = [v₀, v₁]
 第3步：keys = [k₀, k₁, k₂]，values = [v₀, v₁, v₂]
 新增部分用 accent 色高亮]
[6s: 底部出现对比图：
 左侧 "无缓存"：每次重算所有历史 k/v → 大量红色重复计算标记
 右侧 "KV cache"：只算新 token 的 q → 直接复用历史 k/v → 绿色勾号]
[8s: 底部总结文字："推理时历史没变，k/v 当然没变 → 存起来直接用"]

代码里有个细节：每次算完 k 和 v，就 **append 到列表里**——
这是 **KV cache**。

为什么需要它？

推理时每生成一个新 token，
都需要计算它和所有历史 token 的注意力。
如果每次重算历史 token 的 k 和 v，太浪费了——历史没变，k/v 当然没变。

KV cache：**把历史的 k 和 v 存起来，下次直接用**，
只需计算新 token 的 q 就够。

这是 LLM 推理加速的核心技术之一。

>>> 残差连接：梯度高速公路
@type: animation
@rect: safe
@enter: fade

[0s: 左侧显示无残差的深层网络示意图：
 x → f₁ → f₂ → f₃ → loss，
 底部标注 "梯度必须穿过所有层"，
 梯度箭头从右到左逐渐变细变淡，标注 "梯度消失"]
[3s: 右侧出现有残差的网络：
 x 分出两条路径——一条经过 f₁，一条直连（跳过），
 两条在加号 "+" 汇合。多层重复此结构。
 底部标注 "梯度有高速公路直接回传"，
 梯度箭头保持粗线宽度]
[6s: 底部出现公式 "x_out = x + f(x)"，
 标注 "如果 f(x) ≈ 0，整层等于恒等映射——模型可以按需选择复杂度"]

注意力之后还有一个关键操作：**残差连接**。

**残差连接**：x = x + 注意力输出。

为什么？深层网络有**梯度消失**问题——
梯度反向传播经过多层后越来越小，前面的层学不动。
残差连接给梯度开了"高速公路"，绕过中间层直接传回去。

>>> MLP：每个位置独立深加工
@type: animation
@rect: safe
@enter: fade

[0s: 画面上方显示 MLP 数据流图（水平方向）：
 输入 x(16维) → RMSNorm → Linear 16→64 → ReLU → Linear 64→16 → +残差 → 输出(16维)
 "16→64" 用宽度扩展的梯形表示，"64→16" 用收窄的梯形表示]
[3s: 图中 ReLU 环节放大高亮，显示折线函数图像 "max(0,x)"，
 标注 "引入非线性：把负数变0，正数保留"]
[5s: 底部出现两行对比总结：
 "注意力 = 跨位置通信（哪些位置相关？）"
 "MLP = 单位置加工（提取更复杂的特征）"
 两行之间加双向箭头标注 "缺一不可"]

**MLP 块**：注意力负责跨位置聚合，但没有复杂的非线性加工。
MLP 接在注意力之后，做**每个位置的独立深加工**。

RMSNorm 归一化，linear 从 16 维升到 64 维，
ReLU 引入非线性，再 linear 降回 16 维，加残差。

（停顿）

两者分工：**注意力通信，MLP 加工**，缺一不可。

>>> MLP 代码
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 135-141
@reveal: line-by-line
@highlight: 138,139,140

MLP 代码几行：fc1 升维到 64，ReLU 激活，fc2 降回 16，加残差。

注意力（跨位置通信）+ MLP（单位置加工），
这两个模块交替做，就是一层完整的 Transformer。

>>> 一层 Transformer 的完整流程
@type: animation
@rect: safe
@enter: fade

[0s: 画面左侧显示输入 "token + position embedding"，
 右侧开始构建垂直流程图]
[1s: 流程图从上到下依次出现六个步骤方块（每秒出现一个）：
 ① RMSNorm 归一化（灰色方块）
 ② 多头注意力（蓝色方块，标注"跨位置聚合上下文"）
 ③ 残差连接 x = x + attn（绿色加号节点）
 ④ RMSNorm 归一化（灰色方块）
 ⑤ MLP（橙色方块，标注"每个位置独立深加工"）
 ⑥ 残差连接 x = x + mlp（绿色加号节点）]
[7s: 流程图底部出现 lm_head 方块，
 标注 "16维 → 27维 logits"，箭头指向输出概率分布]
[9s: 底部出现对比行：
 "microgpt: 1 层 | GPT-2: 12 层 | GPT-3: 96 层"
 标注 "层数越多，处理深度越深"]

完整的一层 Transformer：

① RMSNorm 归一化
② 多头注意力——跨位置聚合上下文
③ 残差连接——x = x + 注意力输出
④ RMSNorm 归一化
⑤ MLP——每个位置独立深加工
⑥ 残差连接——x = x + MLP 输出

最后用 lm_head 把 16 维向量投影到 27 维 logits。

microgpt 只有 1 层，GPT-2 有 12 层，GPT-3 有 96 层。
层数越多，模型处理信息的深度越深。

>>> 中集小结
@type: textcard
@rect: center-80
@enter: fade-up
@exit: fade
@align: left
@duration: 5s

> 中集回顾：
>
> · 超参数 = 你设定的规模（层数/维度/头数）
> · 词嵌入 = token id → 16维语义向量
> · 激活函数 = 引入非线性（ReLU/Softmax/RMSNorm）
> · 注意力 = Q/K/V 机制，动态聚合上下文
> · KV cache = 缓存历史 k/v，推理加速
> · 残差连接 = 梯度高速公路，解决梯度消失
> · MLP = 每个位置独立深加工

下集讲训练循环：交叉熵损失、Adam，以及让模型开口生成。

>>> 片尾
@type: textcard
@rect: center-60
@enter: fade
@exit: none
@style: hero
@align: center
@duration: 4s

> microgpt.py · 中集
> by @karpathy
>
> 感谢收看，下集见
