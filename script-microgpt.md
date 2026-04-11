---
title: 200 行纯 Python 手撕 GPT · microgpt.py 完全解读
aspect: 16:9
theme: dark-code
voice: zh-CN-YunyiMultilingualNeural
---

>>> 开场标题卡
@type: textcard
@rect: center-60
@enter: fade-up
@exit: fade
@style: hero
@align: center
@duration: 5s

> microgpt.py
> 200 行 · 0 依赖 · 1 个 GPT
> by @karpathy

大家好，我是项思炼，今天介绍 microgpt。

只用 Python 标准库，没有 PyTorch，没有 NumPy，
**200 行代码**，从零训练一个 **GPT**。

今天我们逐行读完它。

>>> GPT 是什么
@type: animation
@rect: safe
@enter: fade

一句话：**GPT 是一个下一个词预测器**。

给它 "今天天气真"，它告诉你：
"好" 的概率 35%，"不" 的概率 12%，"冷" 的概率 8%……

挑一个接上去，再预测下一个，循环往复——
就生成了一整段文字。

**ChatGPT 的本质也就是这样**。

>>> 训练在训什么
@type: animation
@rect: safe
@enter: fade

神经网络里有几百万个可调的 **参数**。
训练，就是自动调这些参数，让模型预测得更准。

三件事缺一不可：
一个衡量错得多离谱的 **损失函数**，
一个指明参数该往哪动的 **梯度**，
一个实际去更新参数的 **优化器**。

这三件事在 microgpt.py 里都能找到对应代码。

>>> 为什么 200 行就够
@type: textcard
@rect: center-80
@enter: fade-up
@exit: fade
@duration: 6s
@align: left

> PyTorch、TensorFlow 给你的 99%
> 是 **效率优化**：
>
> GPU 加速、自动并行、张量运算、
> 自动求导、内存管理……
>
> 但这些 **不是算法本身**。

karpathy 把所有效率优化全部剥掉，
只留算法骨架，就是 **200 行**。

>>> 文件六块鸟瞰
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 1-27
@reveal: all-at-once
@highlight: 14,19,24

整个文件按职责切成六块：
**数据与分词**、**Value 自动求导**、**参数初始化**、
**前向传播**、**训练循环**、**推理采样**。

我们按顺序拆开看。

>>> 数据与字符级分词
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 14-27
@reveal: line-by-line
@highlight: 24,25,26

数据集是 3 万个英文名字。
短、结构明显、词表极小，CPU 就能跑。

**分词器** 只有三行：
把所有字符去重排序，每个字母对应一个 token id，
再加一个特殊的 **BOS** token 作为边界。

最终 vocab_size 等于 **27**。

>>> BOS 的双重身份
@type: animation
@rect: safe
@enter: fade

一个叫 "emma" 的名字，被编码成：
BOS、4、12、12、0、BOS。

**头尾各一个 BOS**——
开头的 BOS 告诉模型 "要开始生成名字了"，
结尾的 BOS 告诉模型 "这个名字到此结束"。

一个 token 同时承担开始和结束两个角色，
**极简设计**，省掉一个 id。

>>> Value 类四个字段
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 30-37
@reveal: line-by-line
@highlight: 34,35,36,37

接下来是整个文件 **最精彩** 的部分——自动求导。

每个 Value 对象就是计算图中的一个节点。
它只记四样东西：
当前 **数值**、对 loss 的 **梯度**、
**子节点**，以及对每个子节点的 **局部偏导**。

前两个前向填，后两个反向用。

>>> 加法和乘法的运算符重载
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 39-45
@reveal: line-by-line
@highlight: 41,45

加法的局部偏导永远是 1 和 1。
乘法的局部偏导，对 a 求偏导得到 b，
对 b 求偏导得到 a——

这是 **高中微积分**，没有任何神秘。

Python 的运算符重载帮我们把这条规则
悄悄写进每一次 a + b 和 a * b。

>>> 其它原子运算
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 47-57
@reveal: all-at-once
@highlight: 47,48,49,50

幂、对数、指数、ReLU——每个都一行。
减法、除法用已有算子组合出来，
**不需要单独写梯度**。

少量原子运算能组合出所有常见运算，
这就是 **基础算子的正交性**。

>>> 计算图可视化
@type: animation
@rect: safe
@enter: fade

看一个最简单的例子：
a 等于 2，b 等于 3，
c 等于 a 乘 b，d 等于 c 加 1，loss 等于 d 的平方。

每个节点是一个值，
每条边是一次运算的依赖关系。

整张图在 **前向计算** 的时候就建好了。

>>> backward 的 13 行实现
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 59-72
@reveal: line-by-line
@highlight: 60,68,69,71,72

整个反向传播只有 **13 行**。

先用 DFS 后序遍历把计算图 **拓扑排序**，
再把 loss 自身的梯度设为 1，
然后按反向拓扑序遍历，
用 **链式法则** 把梯度一层层传回去。

注意这里用的是 **+=**——
因为一个节点可能被多条路径共用，
必须把所有下游的梯度累加起来。

>>> 手算反向传播
@type: animation
@rect: safe
@enter: fade

让我们手算一遍。

loss 等于 d 的平方，d 等于 7，
所以 d 的梯度是 2 乘 7 等于 **14**。

d 等于 c 加 1，加法偏导是 1，
c 的梯度继承 14。

c 等于 a 乘 b，对 a 的偏导是 b 等于 3，
所以 a 的梯度等于 3 乘 14 等于 **42**。

（停顿）

整个 autograd 引擎，不到 **50 行** 就搞定。

>>> 超参数定义
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 75-79
@reveal: line-by-line

五个 **超参数** 定义了模型规模。
1 层 Transformer、16 维宽、最大上下文 16 个 token、4 个注意力头。

对比一下：
GPT-2 small 有 12 层 768 维，
GPT-3 有 96 层 12288 维。

microgpt 只有几千参数——**不是为了打榜，是为了看清结构**。

>>> state_dict 全部参数
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 80-90
@reveal: line-by-line
@highlight: 81,83,84,85,86,87,88

这就是 GPT 的全部 **记忆**。

词嵌入表 wte、位置嵌入表 wpe、输出投影 lm_head，
再加每层的 Q、K、V、O 四个注意力矩阵
和 MLP 的两个线性层。

全部展平，总共 **4192 个数字**。
训练，就是调这 4192 个数字。

>>> linear 矩阵乘法
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 94-95
@reveal: all-at-once
@highlight: 94,95

前向传播要用三个基础算子，都是一行实现。

linear 就是 **矩阵乘向量**：
对 w 的每一行，和 x 做点积，得到输出的一个分量。

没有 bias，因为 bias 对效果影响很小，省一半代码。

>>> softmax 数值稳定技巧
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 97-101
@reveal: line-by-line
@highlight: 98,99

softmax 把任意实数向量变成 **概率分布**。

注意第一行先取最大值再减掉——
这是 **数值稳定技巧**，防止 exp 上溢。

减一个常数，概率分布不变，
但最大的变成 0，其它都在安全范围。

>>> rmsnorm 归一化
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 103-106
@reveal: all-at-once

rmsnorm 让向量的长度保持为 1，
不管输入有多大。

LayerNorm 会先减均值再除标准差，
RMSNorm 只除以 RMS——**简化版**，
但 Llama 等现代 LLM 都在用。

归一化让每一层的输出规模可控，训练更稳定。

>>> gpt 函数入口
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 108-112
@reveal: line-by-line
@highlight: 109,110,111

gpt 函数 **一次只处理一个位置**。

先查词嵌入，再查位置嵌入，
两个 16 维向量 **直接相加**——
这样模型就知道 "哪个 token 出现在哪个位置"。

为什么要加位置信息？
因为注意力本身 **对顺序不敏感**。

>>> 注意力的直觉
@type: animation
@rect: safe
@enter: fade

想象你在读 "cat sat on the mat"。
处理到 mat 时，你会本能地 **回头看**——
cat 很相关，on 很相关，the 不太相关。

这就是 **注意力**。

每个位置生成一个 **query**（我想找什么），
每个位置生成一个 **key**（我有什么），
一个 **value**（我能提供什么）。

query 和所有 key 算相似度，
再用这些权重对 value 加权平均。

>>> 多头注意力代码
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 114-134
@reveal: line-by-line
@highlight: 118,119,120,121,122,129,130,131

这就是 **多头注意力** 的完整实现。

把 16 维的 q、k、v **切成 4 份**，每份 4 维。
每个头独立算 q 和 k 的点积，
除以根号下 head_dim 做缩放，
softmax 得到注意力权重，
再对 value 做加权平均。

最后把四个头的结果 **拼接回来**，
用 attn_wo 做最后一次融合。

>>> KV cache 的秘密
@type: animation
@rect: safe
@enter: fade

注意这两行：
每次算完 k 和 v，就 **append 到列表里**。

下一次调用时，注意力自动看到
所有历史位置的 key 和 value——

**因果 mask 自动产生**，
历史 k、v **不重算**，
这就是推理时加速的关键：**KV cache**。

>>> 残差连接
@type: animation
@rect: safe
@enter: fade

注意力之后，输出和进入前的 x **对应位置相加**。
这叫 **残差连接**。

它给梯度提供了一条 "高速公路"，
可以从 loss 一路直达任何一层的参数，
**缓解梯度消失**。

而且它让每一层可以 "选择什么都不做"——
模型可以按需加深复杂度，
这是 ResNet 留给深度学习的宝贵遗产。

>>> MLP 升降维
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 135-141
@reveal: line-by-line
@highlight: 138,139,140

注意力之后是 MLP 块。

先 RMSNorm，再把 16 维 **升到 64 维**，
过一个 ReLU 引入非线性，
再降回 16 维，最后加上残差。

注意力负责 **跨位置通信**，
MLP 负责 **每个位置独立深加工**。
这两个交替做，就是一层完整的 Transformer。

>>> 训练循环
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 153-172
@reveal: line-by-line
@highlight: 156,157,163,164,165,169,172

训练每一步做四件事：

取一个名字编码成 tokens，
循环每个位置 **建同一张计算图** 直到 loss，
调用 **loss.backward** 算出所有梯度，
最后用 Adam 更新参数。

注意 loss 用的是 **交叉熵**——
负对数 **正确答案的概率**。
模型越不确定正确答案，loss 越大。

>>> Adam 的两个动量
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 175-182
@reveal: line-by-line
@highlight: 177,178,179,180,181

Adam 用 **两个指数移动平均** 解决 SGD 的毛病。

m 是梯度的一阶矩——**平均方向**。
v 是梯度平方的二阶矩——**典型幅度**。

更新量等于 lr 乘 m 除以根号 v——
方向由 m 决定，步长被 v 自动归一化。

**梯度稳定的方向快速前进，振荡的方向谨慎前进**，
每个参数都有自己的自适应学习率。

>>> 推理与温度采样
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 186-200
@reveal: line-by-line
@highlight: 187,194,195,196

训练完之后，让模型生成新名字。

从 BOS 开始，调用 gpt 得到 logits，
**除以温度** 再 softmax，
按权重随机采样一个 token，
遇到 BOS 就停止。

温度越低分布越尖锐，生成越保守；
温度越高分布越平缓，生成越有创意——
**ChatGPT API 里的 temperature 就是这个**。

>>> 生成效果
@type: textcard
@rect: center-80
@enter: fade-up
@exit: fade
@duration: 6s
@align: left

> sample  1: marian
> sample  2: keylen
> sample  3: jorah
> sample  4: aviana
> sample  5: torian

训练 1000 步之后，
模型学到了字符级的概率规律，
生成了一批 **从未见过、但看起来像英文名** 的新名字。

**这就是生成式模型的本质**。

>>> 总结金句
@type: textcard
@rect: center-60
@enter: fade-up
@exit: fade
@duration: 6s
@style: hero
@align: center

> 200 行
> 0 依赖
> 1 个完整的 GPT

**200 行，0 依赖，1 个完整的 GPT**。

ChatGPT 和它在算法层面完全一样——
只是模型更大、数据更多、训练更久。

剩下的一切，都只是 **效率优化**。

>>> 片尾
@type: textcard
@rect: center-60
@enter: fade
@exit: none
@duration: 5s
@style: hero
@align: center

> microgpt.py
> by @karpathy
>
> 感谢收看

去读一遍完整代码吧，
你会对 GPT 有全新的理解。
