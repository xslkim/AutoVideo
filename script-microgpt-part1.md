---
title: 200行手撕GPT · 上集：GPT是什么 + 自动求导
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

> 200 行 · 0 依赖 · 1 个 GPT
> microgpt.py 完全解读
> 上集：GPT 是什么 + 自动求导

大家好，我是项思炼。今天开始讲 microgpt.py——
200 行 Python，没有 PyTorch，没有 NumPy，
实现一个完整的 GPT。

上集讲两件事：GPT 到底是什么，以及它的自动求导引擎。

>>> GPT 是什么
@type: animation
@rect: safe
@enter: fade-up

一句话：**GPT 是下一个词预测器**。

给它"今天天气真"，它吐出一张概率表：
"好" 35%，"不" 12%，"冷" 8%……

你按概率选一个，拼上去，再预测，再拼——
不断循环，就生成了一整段文字。

**ChatGPT 本质上也就是这样**，
只是它知道得更多，预测得更准。

>>> 训练是什么
@type: animation
@rect: safe
@enter: fade

GPT 内部有几百万个可调的**参数**——
这些数字组合起来，决定"输入什么，输出什么概率"。

**训练**，就是自动调整这些参数，让预测越来越准。

怎么自动调？靠三件事：

**损失函数**（loss）：一个数字，衡量"预测有多离谱"。
**梯度**（gradient）：告诉你每个参数往哪个方向动，loss 会变小。
**优化器**（optimizer）：按梯度真正去更新参数。

这三件事，在 microgpt 里都有对应代码。

>>> 为什么 200 行就够
@type: textcard
@rect: center-80
@enter: fade-up
@exit: fade
@align: left
@duration: 5s

> PyTorch 给你的 99%，是效率：
>
> GPU 加速 · 自动并行 · 内存管理 · 自动求导
>
> 这些让训练快了几百倍——但不是算法本身。

karpathy 把所有效率优化剥掉，
只留**算法骨架**，就是 **200 行**。

>>> 文件六块鸟瞰
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 1-27
@reveal: all-at-once
@highlight: 14,19,24

六块：数据分词、自动求导、参数初始化、前向传播、训练循环、推理采样。

上集讲前两块，中集讲三四块，下集讲五六块。

>>> 分词器：为什么需要它
@type: animation
@rect: safe
@enter: fade

计算机只认数字，不认文字。

**分词器**（tokenizer）就是字符和数字之间的双向翻译：
"emma" → [4, 12, 12, 0]，
[4, 12, 12, 0] → "emma"。

microgpt 的分词器极简：
26 个字母各有一个 id，a=0，b=1，……z=25，
再加一个特殊 token **BOS**，id=26。

词表大小：**vocab_size = 27**。

>>> BOS 的双重身份
@type: animation
@rect: safe
@enter: fade

BOS 是"序列边界符"。

名字 "emma" 被编码成：
**BOS、4、12、12、0、BOS**

**开头的 BOS** 告诉模型："要开始生成名字了。"
**结尾的 BOS** 告诉模型："名字到这里结束。"

一个 token id 同时承担开始和结束——极简设计，省一个 id。

推理时，模型从 BOS 出发，预测到 BOS 时停止。

>>> 分词器代码
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 14-27
@reveal: line-by-line
@highlight: 15,16,17,24,25,26

字符去重排序，得到 26 个字母的列表，这就是词表。
每个字母的下标就是它的 token id。

BOS = 26，vocab_size = 27。

两个工具函数：encode 把字符串变成数字列表，decode 反过来。
整个分词器，不到 10 行。

>>> 自动求导：为什么需要它
@type: animation
@rect: safe
@enter: fade

训练需要梯度——每个参数相对 loss 的偏导数。

问题是，GPT 的 loss 是几百个参数经过十几层运算叠出来的，
不可能每次改模型结构都手推偏导。

**自动求导**（autograd）自动算出所有梯度，
不管 loss 是怎么算出来的。

原理只有一条：**链式法则**——
如果 z 依赖 y，y 依赖 x，
那么 dz/dx = dz/dy × dy/dx。

把这条规则递归地应用到整张**计算图**，
就能从 loss 一路反推到每个参数。

>>> 计算图的直觉
@type: animation
@rect: safe
@enter: fade

看一个具体例子：
a=2，b=3，c=a×b=6，d=c+1=7，loss=d²=49。

每一步运算生成一个节点，节点之间的依赖关系构成一张图——
这就是**计算图**。

图在前向计算时自动建好。

问：d(loss)/d(a) 等于多少？
我们稍后用反向传播算，答案是 **42**。

>>> Value 类：四个字段
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 30-37
@reveal: line-by-line
@highlight: 33,34,35,36

Value 类 = 计算图里的一个节点，只记四样东西：

**data**：节点的数值，前向计算时填入。
**grad**：对 loss 的梯度，反向传播时填入。
**_children**：这个节点从哪些节点算出来，记录依赖关系。
**_local_grads**：对每个子节点的局部偏导，链式法则用。

前两个前向填，后两个反向用。

>>> 运算符重载：把链式法则嵌入每次运算
@type: animation
@rect: safe
@enter: fade

加法：c = a + b。
局部偏导：对 a 是 1，对 b 是 1。

乘法：c = a × b。
局部偏导：对 a 是 b，对 b 是 a——高中微积分。

Python 的运算符重载帮我们在每次 a+b、a×b 时，
**自动把这条规则记进节点**。

幂、对数、指数、ReLU，每个都只有一行。
减法和除法用已有算子组合，不需要单独写梯度。

>>> backward：13 行反向传播
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 59-72
@reveal: line-by-line
@highlight: 60,61,68,69,71,72

反向传播只有 **13 行**。

**第一步**：从 loss 出发做拓扑排序——
梯度必须从后往前算，每个节点等下游算完才能轮到自己。

**第二步**：loss 自身的梯度设为 1。

**第三步**：按反向顺序遍历，
用局部偏导乘以下游梯度，用 **+=** 累加到每个节点。

注意是 +=，不是 =——
一个节点可能被多条路径共用，必须累加所有下游的贡献。

>>> 手算验证
@type: animation
@rect: safe
@enter: fade

手算那个例子来验证。

loss = d²，d=7，∂loss/∂d = 2×7 = **14**。

d = c+1，加法偏导 1，∂loss/∂c = 14×1 = **14**。

c = a×b，乘法偏导对 a 是 b=3，∂loss/∂a = 14×3 = **42**。

答案是 42，和之前一致。

这套 autograd 引擎不到 **50 行**，
实现了 PyTorch 自动求导的核心逻辑。

>>> 上集小结
@type: textcard
@rect: center-80
@enter: fade-up
@exit: fade
@align: left
@duration: 5s

> 上集回顾：
>
> · GPT = 下一个词预测器（参数 + loss + 梯度 + 优化器）
> · 分词器 = 字符 ↔ 数字（vocab_size=27，BOS 双重角色）
> · Autograd = 计算图 + 链式法则，50 行自动算梯度

中集解剖 Transformer 内部：
注意力是什么，MLP 是什么，它们各自解决什么问题。

>>> 片尾
@type: textcard
@rect: center-60
@enter: fade
@exit: none
@style: hero
@align: center
@duration: 4s

> microgpt.py · 上集
> by @karpathy
>
> 感谢收看，中集见
