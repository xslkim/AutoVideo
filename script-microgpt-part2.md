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

两个概念先分清楚：

**参数**（parameters）：模型**自动学习**的数字，训练中调整。
**超参数**（hyperparameters）：你**手动设定**的数字，描述模型规模。

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
@highlight: 75,76,77,78,79,81,83,84,85,86,87,88

五行超参数，下面是 state_dict——GPT 的全部参数：

**wte**（词嵌入）：27×16，把 token id 变成 16 维向量。
**wpe**（位置嵌入）：16×16，把位置编号变成 16 维向量。
**lm_head**（输出投影）：27×16，把 16 维变成 27 个 token 的分数。

每层注意力有四个矩阵：wq、wk、wv、wo。
MLP 有两个线性变换：fc_1 升维到 64，fc_2 降回 16。

>>> 词嵌入与激活函数
@type: animation
@rect: safe
@enter: fade

**词嵌入**（embedding）：为什么不直接用 token id？

a=0，b=1，z=25——这些编号没有语义，25 不代表 z 更重要。
词嵌入把编号变成**有意义的 16 维向量**，训练中自动调整，
让语义相近的字符，向量方向也相近。

**激活函数**：为什么需要非线性？

如果网络里只有矩阵乘法（线性变换），
叠多少层整体还是线性，学不了复杂规律。
激活函数引入非线性。

microgpt 用三种：
**ReLU**（小于0变0，用在MLP），
**Softmax**（变概率分布，用在注意力和输出），
**RMSNorm**（长度归一化，稳定训练）。

>>> 注意力：解决什么问题
@type: animation
@rect: safe
@enter: fade

来到本集核心——**注意力机制**（attention）。

它解决什么问题？

朴素神经网络处理每个 token 时，只看当前位置，
没法理解"它"和"猫"的指代关系。

注意力让**每个位置能动态地、有选择地看其他位置**，
按需提取上下文信息——这是 Transformer 的核心创新。

>>> Q、K、V 与注意力计算
@type: animation
@rect: safe
@enter: fade

注意力用三个角色实现：**Query、Key、Value**。

类比图书馆找书：
Query = 你的需求，Key = 每本书的标签，Value = 书的内容。
拿 Query 和所有 Key 比相似度，按相似度对 Value 加权平均。

注意力里：每个 token 生成 Q/K/V，
Q 和所有历史 K 算点积（越大越相关），
除以 √head_dim 缩放，softmax 变权重，
最后对所有 V 加权求和——得到融合了上下文的新表示。

>>> 多头注意力代码
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 114-134
@reveal: line-by-line
@highlight: 118,119,120,121,122,129,130,131

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

代码里有个细节：每次算完 k 和 v，就 **append 到列表里**——
这是 **KV cache**。

为什么需要它？

推理时每生成一个新 token，
都需要计算它和所有历史 token 的注意力。
如果每次重算历史 token 的 k 和 v，太浪费了——历史没变，k/v 当然没变。

KV cache：**把历史的 k 和 v 存起来，下次直接用**，
只需计算新 token 的 q 就够。

这是 LLM 推理加速的核心技术之一。

>>> 残差连接与 MLP：后半段
@type: animation
@rect: safe
@enter: fade

注意力之后还有两个关键操作：

**残差连接**：x = x + 注意力输出。
为什么？深层网络有**梯度消失**问题——
梯度反向传播经过多层后越来越小，前面的层学不动。
残差连接给梯度开了"高速公路"，绕过中间层直接传回去。

**MLP 块**：注意力负责跨位置聚合，但没有复杂的非线性加工。
MLP 接在注意力之后，做**每个位置的独立深加工**，
提取更复杂的特征。

两者分工：注意力通信，MLP 加工，缺一不可。

>>> MLP 代码
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 135-141
@reveal: line-by-line
@highlight: 136,137,138,139,140

MLP 代码几行：

RMSNorm 归一化，linear 从 16 维升到 64 维（更大的表达空间），
ReLU 引入非线性，再 linear 降回 16 维，加残差。

注意力（跨位置通信）+ MLP（单位置加工），
这两个模块交替做，就是一层完整的 Transformer。

>>> 一层 Transformer 的完整流程
@type: animation
@rect: safe
@enter: fade

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
