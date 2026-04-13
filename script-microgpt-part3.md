---
title: 200行手撕GPT · 下集：训练与生成 · Adam + 温度采样
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

> 上集：GPT是什么 · 分词器 · 自动求导
> 中集：注意力 · KV cache · MLP · 残差连接

下集讲最后两块：**训练循环**和**推理生成**。

训练怎么让模型学会预测？
Adam 解决了 SGD 的什么问题？
温度参数是什么原理？

>>> 损失函数：衡量预测有多离谱
@type: animation
@rect: safe
@enter: fade

[0s: 屏幕中央出现一个仪表盘，指针指向右侧红色区域，
 刻度从左到右标注 "0（完美）" 到 "5（瞎猜）"，
 上方标题 "Loss = 预测有多离谱"]
[3s: 仪表盘缩到左上角，右侧出现动画：
 上方是模型输出的概率条形图，27 个 token 各一条柱子，
 正确答案 "e" 对应的柱子被标注 "正确答案"，
 当概率高时（柱子长）→ 仪表盘指针偏左（绿色），标注 "loss 小"
 当概率低时（柱子短）→ 仪表盘指针偏右（红色），标注 "loss 大"]
[6s: 底部出现训练目标文字：
 "训练的目标 = 把 loss 降到最小 = 把正确答案的概率推到最高"]

训练目标是让预测越来越准。
但"准不准"要量化——靠**损失函数**。

损失函数输出一个数字 **loss**：
loss 越大，预测越离谱；loss 越小，预测越准。
训练的目标就是把 loss 降到最小。

microgpt 用的是**交叉熵损失**。

>>> 交叉熵：直觉是什么
@type: animation
@rect: safe
@enter: fade

[0s: 画面上方显示一组概率条形图，27 个 token 各一条，
 正确答案 "e"(id=4) 的柱子高亮，标注概率 "60%"]
[2s: 右侧出现计算过程（逐行淡入）：
 "交叉熵 = -log(正确答案的概率)"
 "= -log(0.6) ≈ 0.51"]
[4s: 画面切换为三行对比（从上到下淡入）：
 "预测到 95% → loss = -log(0.95) ≈ 0.05" 配绿色小仪表
 "预测到 60% → loss = -log(0.60) ≈ 0.51" 配黄色中仪表
 "预测到 4%  → loss = -log(0.04) ≈ 3.22" 配红色大仪表]
[7s: 底部出现 -log(x) 函数图像，x 轴为概率 0→1，y 轴为 loss，
 曲线从左侧无穷大急剧下降到右侧趋近于 0，
 标注 "概率越高 → loss 越小"]
[9s: 底部文字 "对整个名字：把每个位置的交叉熵求平均"]

交叉熵怎么理解？

假设正确答案是 "e"（id=4），
模型给出的概率：……"e" = **60%**……

**交叉熵 = -log（正确答案的概率）= -log(0.6) ≈ 0.51**

模型把 "e" 预测到 95%？loss ≈ 0.05，**很小**。
模型把 "e" 预测到 4%？loss ≈ 3.2，**很大**。

结论：**正确答案的概率越高，loss 越小。**
交叉熵直接惩罚对正确答案的不确定性。

对一整个名字，把每个位置的交叉熵加起来求平均，就是总 loss。

>>> 训练循环的四步
@type: animation
@rect: safe
@enter: fade

[0s: 画面中央出现一个大循环图（顺时针四个步骤方块）：
 ① 取数据（蓝色）② 前向传播（绿色）③ 反向传播（橙色）④ Adam 更新（紫色）
 中间标注 "重复 1000 轮"]
[2s: ① 高亮放大，右侧显示示例：
 name="emma" → tokens=[26, 4, 12, 12, 0, 26]，
 标注 "BOS + 字符编码 + BOS"]
[4s: ② 高亮放大，右侧显示流程：
 每个位置调用 gpt() → 得到 logits → softmax → 取 -log(P[正确]) → 累加 loss]
[6s: ③ 高亮放大，右侧显示：
 "loss.backward()" → "上集的 13 行反向传播" → "4192 个梯度全部就位"]
[8s: ④ 高亮放大，右侧显示：
 "Adam：按梯度更新所有参数" → "清零梯度" → "进入下一轮"]
[10s: 循环图恢复，动画持续旋转，底部标注 "1000 轮后，模型学会了英文名字的规律"]

训练循环每一轮做四步：

**第一步**：取一个名字，编码成 token 序列。
比如 "emma" → [26, 4, 12, 12, 0, 26]。

**第二步**：前向传播，建计算图，算每个位置的交叉熵，得到总 loss。

**第三步**：loss.backward()——调用上集的 13 行反向传播，
算出所有参数的梯度。

**第四步**：Adam 更新参数，清零梯度，进入下一轮。

循环 1000 轮，模型就学会了英文名字的规律。

>>> 训练循环代码
@type: code
@rect: center-80
@enter: zoom-in
@source: microgpt.py
@range: 153-172
@reveal: line-by-line
@highlight: 157,167,169,172

代码非常直接。

取一个名字，编码成 token 序列。
循环每个位置，gpt 函数得到 logits，
softmax 变概率，取正确答案的概率取负 log。

所有位置算完，求平均得到 total loss。

一行 loss.backward()——触发上集的 13 行反向传播，
所有 4192 个参数的梯度一次算好。

>>> Adam：为什么比 SGD 好
@type: animation
@rect: safe
@enter: fade

[0s: 画面分为上下两部分：
 上方标题 "SGD：朴素梯度下降"，
 显示一个二维 loss 等高线图，一个小球沿梯度方向走，
 但路径来回震荡（锯齿形），标注 "固定学习率 → 来回振荡"]
[3s: 下方标题 "Adam：自适应优化器"，
 同样的等高线图，小球平滑地走向最低点，
 标注 "自适应步长 → 平稳收敛"]
[5s: 画面切换，显示 Adam 的两个动量解释：
 左栏 "m（一阶矩）"：梯度方向的滑动平均图，
 一条蓝色曲线（原始梯度抖动）和一条平滑红线（m），标注 "方向稳定器"
 右栏 "v（二阶矩）"：梯度幅度的滑动平均图，
 标注 "幅度归一化器"]
[8s: 底部出现核心公式：
 "参数 -= lr × m / √v"
 标注 "m 定方向，√v 归一化步长 → 每个参数有自适应学习率"]

训练用 **Adam** 优化器。它解决了 SGD 的两个问题：

**SGD** 对所有参数用同一个固定学习率——
梯度忽大忽小的方向来回震荡，不同参数无法自适应步长。

**Adam** 维护两个滑动平均：

**m（一阶矩）**：梯度的平均方向，像惯性，朝稳定方向走。
**v（二阶矩）**：梯度平方的平均大小，反映典型幅度。

更新公式：**参数 -= lr × m / √v**

m 决定方向，v 自动归一化步长——
每个参数有自己的自适应学习率，梯度稳定的方向快走，震荡的方向慢走。

>>> Adam 代码
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 175-182
@reveal: line-by-line
@highlight: 177,178,181

beta1=0.85、beta2=0.99 控制两个动量的衰减速度。

每轮：m 用 beta1 平滑梯度方向，
v 用 beta2 平滑梯度幅度的平方。

做偏差修正——训练早期 m 和 v 偏小，用 1/(1-beta^t) 修正。

最后：参数 -= lr × m_hat / (√v_hat + ε)，epsilon 防止除以零。

就这几行，最经典的优化器。

>>> 推理与温度采样
@type: animation
@rect: safe
@enter: fade

[0s: 画面上方分两栏对比：
 左栏 "训练" → 建计算图 + 算梯度 + 更新参数（复杂，慢）
 右栏 "推理" → 只跑前向 + 采样（简单，快）
 右栏高亮闪烁]
[3s: 画面切换为推理流程动画：
 BOS → gpt() → 概率分布 → 采样 "j" → 追加 →
 gpt() → 采样 "o" → 追加 → ... → 采样 BOS → 停止 → 输出 "john"]
[6s: 底部出现温度参数的直觉图：
 三组相同的 27 维概率条形图，分别标注：
 "temperature=0.3" → 分布非常尖锐，最高的柱子极其突出
 "temperature=1.0" → 原始分布
 "temperature=2.0" → 分布很平坦，几乎均匀]
[9s: 底部文字 "ChatGPT API 的 temperature 就是这个原理"]

训练完了，到**推理**。

训练要建计算图、算梯度、更新参数；
推理**不需要梯度**，只跑前向得到概率，采样一个 token。
这也是推理比训练快得多的原因。

推理流程：BOS → gpt → 采样 → 追加 → 循环 → 遇 BOS 停止。

采样有个**温度**参数，在 softmax 前把 logits 除以它：

**temperature < 1**：分布更尖锐，生成更**保守确定**。
**temperature > 1**：分布更平坦，生成更**随机有创意**。

（停顿）

**ChatGPT API 的 temperature 就是这个**。

>>> 推理代码
@type: code
@rect: center-80
@enter: fade
@source: microgpt.py
@range: 186-200
@reveal: line-by-line
@highlight: 195,196,197

推理代码 15 行，非常直观。

从 BOS 开始，
gpt 得到 logits，除以 temperature，softmax 变概率，
random.choices 按概率采样一个 token，
采到 BOS 就停，否则追加继续。

>>> 生成效果
@type: textcard
@rect: center-80
@enter: fade-up
@exit: fade
@align: left
@style: mono
@duration: 6s

> 训练 1000 步之后：
>
> sample 1: marian
> sample 2: keylen
> sample 3: jorah
> sample 4: aviana
> sample 5: torian

模型学到了字符级的概率规律。
它从没见过这些名字，但它们听起来像真实的英文名。

这就是**生成式模型的本质**：
学习数据的分布，然后从中采样出新样本。

>>> 总结金句
@type: textcard
@rect: center-60
@enter: fade-up
@exit: fade
@style: hero
@align: center
@duration: 6s

> 200 行
> 0 依赖
> 1 个完整的 GPT

**ChatGPT 和它在算法层面完全一样**——
只是模型更大、数据更多、训练更久。

剩下的一切，都只是效率优化。

>>> 片尾
@type: textcard
@rect: center-60
@enter: fade
@exit: none
@style: hero
@align: center
@duration: 5s

> microgpt.py · 下集
> by @karpathy
>
> 去读一遍完整代码吧，
> 你会对 GPT 有全新的理解。
