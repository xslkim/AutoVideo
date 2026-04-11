# microgpt.py 完全解读：从零开始看懂一个 GPT

> **目标读者**：有 Python 基础、想真正搞懂 GPT 内部机制、但**没有训练过神经网络**的程序员。
> **参考代码**：[microgpt.py](./microgpt.py) by @karpathy
> **预期收获**：读完之后，你应该能向一个完全不懂的人解释清楚 GPT 是怎么工作的，以及"训练"到底在训练什么。

---

## 目录

- [第零章：你需要知道的背景](#第零章你需要知道的背景)
- [第一章：200 行文件的全貌](#第一章200-行文件的全貌)
- [第二章：数据与分词——GPT 的"字母表"](#第二章数据与分词gpt-的字母表)
- [第三章：Value 类——用 15 行代码手搓 Autograd](#第三章value-类用-15-行代码手搓-autograd)
- [第四章：反向传播——拓扑排序 + 链式法则](#第四章反向传播拓扑排序--链式法则)
- [第五章：模型参数——GPT 的"记忆"存在哪里](#第五章模型参数gpt-的记忆存在哪里)
- [第六章：前向传播——gpt() 函数的每一行](#第六章前向传播gpt-函数的每一行)
- [第七章：多头注意力——整个 Transformer 的灵魂](#第七章多头注意力整个-transformer-的灵魂)
- [第八章：MLP 与残差连接](#第八章mlp-与残差连接)
- [第九章：训练循环——Adam 优化器到底在做什么](#第九章训练循环adam-优化器到底在做什么)
- [第十章：推理——让模型开口说话](#第十章推理让模型开口说话)
- [第十一章：把整个流程串起来](#第十一章把整个流程串起来)
- [第十二章：你现在能回答的面试题](#第十二章你现在能回答的面试题)
- [第十三章：动手改一改](#第十三章动手改一改)

---

## 第零章：你需要知道的背景

在开始读代码之前，先确认几个基础概念。如果你已经熟悉，可以跳到第一章。

### 0.1 GPT 到底是个什么东西？

一句话：**GPT 是一个"下一个词预测器"**。

给它一段话 "今天天气真"，它会告诉你：
- "好" 的概率是 35%
- "不" 的概率是 12%
- "冷" 的概率是 8%
- ...（剩下几万个词的概率）

你随便挑一个（比如按概率抽样），把它接到后面变成 "今天天气真好"，再让它预测下一个词，再接上，一直这么循环——就生成了一整段文字。

**ChatGPT 的本质也就是这样。** 它知道得更多、预测得更准，但算法和 `microgpt.py` 里的一模一样。

### 0.2 "训练"是在训练什么？

你家的手机键盘输入法也会猜下一个词。它是怎么做到的？有人给它大量用户输入数据，统计出"你 → 好"后面接什么最常见。

神经网络的做法更细致：它有几百万个可调节的**参数**（parameters），这些参数组合起来决定"输入什么，输出什么概率分布"。训练，就是**自动调这些参数**，让模型看到 "今天天气真" 时，尽量把 "好" 这个字的概率算得高一些。

具体怎么"自动"调？靠三件事：

1. **损失函数 (loss)**：一个数字，衡量"当前模型预测的有多离谱"。预测对了，loss 小；预测错了，loss 大。
2. **梯度 (gradient)**：告诉你"每个参数往哪个方向变一点点，loss 会变小"。
3. **优化器 (optimizer)**：按照梯度的指示，实际去更新参数。

这三件事在 `microgpt.py` 里都能找到对应的代码，后面会一个一个讲。

### 0.3 为什么 200 行就够了？

深度学习框架（PyTorch、TensorFlow）给你的东西，99% 是**效率优化**：
- GPU 加速
- 自动并行
- 高性能张量运算
- 自动求导
- 内存管理
- ……

这些东西让训练**快**了几百几千倍，但它们**不是算法本身**。算法本身，就是第 0.2 节那三件事，再加上一个把输入变成概率分布的**模型结构**（microgpt 里是一个极简 Transformer）。

karpathy 把这些效率优化全部剥掉，只留算法骨架，就是 200 行。

> 这也是文件开头那句话的意思：
>
> > *"This file is the complete algorithm. Everything else is just efficiency."*
> >
> > 本文件即完整算法。其余一切只是效率优化。

### 0.4 你需要会什么？

- **Python 基础**：类、lambda、列表推导、切片
- **高中微积分**：知道 `d/dx (x²) = 2x`、知道"链式法则" `dy/dx = dy/du · du/dx`
- **不需要**会 PyTorch、不需要会线性代数（我们用标量算，不用矩阵），不需要懂机器学习

准备好了？开读。

---

## 第一章：200 行文件的全貌

先鸟瞰整个文件。我把它按职责切成六块：

```
第  1 – 13  行  │ 文件头 + import + 固定随机种子
第 14 – 27  行  │ ① 数据集（names.txt） + 字符级分词器
第 29 – 72  行  │ ② Value 类（autograd 引擎）
第 74 – 90  行  │ ③ 模型参数初始化（state_dict）
第 92 – 144 行  │ ④ 模型前向（linear/softmax/rmsnorm/gpt）
第 146 – 184行  │ ⑤ 训练循环（Adam 优化）
第 186 – 200行  │ ⑥ 推理（采样生成新名字）
```

注意这六块的**顺序和信息依赖**：

```
   ①数据           ───┐
                      ├──→ ⑤训练  ──→  ⑥推理
   ③参数 ──→ ④前向 ───┤
                      │
   ②Value (autograd) ─┘
```

- ① 数据告诉我们词表有多大（影响 ③ 的参数形状）
- ② Value 是通用工具，被 ③、④、⑤ 使用
- ③ 定义了所有可学习的参数
- ④ 把参数和输入组合成 logits（预测）
- ⑤ 反复跑 ④，用 ② 算梯度，然后更新 ③ 的值
- ⑥ 训练完之后，只跑 ④ 和采样

接下来按这个顺序拆解。

---

## 第二章：数据与分词——GPT 的"字母表"

### 2.1 数据集：3 万个英文名字

```python
if not os.path.exists('input.txt'):
    import urllib.request
    names_url = 'https://raw.githubusercontent.com/karpathy/makemore/988aa59/names.txt'
    urllib.request.urlretrieve(names_url, 'input.txt')
docs = [line.strip() for line in open('input.txt') if line.strip()]
random.shuffle(docs)
print(f"num docs: {len(docs)}")
```

逐行拆解：

- `names_url` 指向一个公开的英文名字列表（32000 个左右，都是 emma、olivia、liam 这类）
- 如果本地没有 `input.txt`，就下载一次
- 读进来变成一个 Python list，每行是一个名字
- **打乱顺序**（`random.shuffle`），避免模型按字母顺序学

**为什么用名字？**
- 短（最长 15 个字符，算力友好）
- 结构明显（有音节规律）
- 词表极小（26 个字母）
- 任何普通 CPU 都能跑

换句话说，选数据集的目的不是训练出实用的东西，而是让算法**能在你电脑上几分钟跑完**。

### 2.2 分词器：把字符串变成数字

计算机不会直接处理文字，它只能处理数字。**分词器**（tokenizer）就是一个双向翻译：

```
"emma"  ──分词器──→  [4, 12, 12, 0]
[4, 12, 12, 0]  ──分词器──→  "emma"
```

microgpt 里的分词器极其简单：

```python
uchars = sorted(set(''.join(docs)))  # ['a', 'b', 'c', ..., 'z']
BOS = len(uchars)                     # 26
vocab_size = len(uchars) + 1          # 27
print(f"vocab size: {vocab_size}")
```

逐行翻译：

1. `''.join(docs)` 把所有名字拼成一个大字符串
2. `set(...)` 去重，剩下所有出现过的字符
3. `sorted(...)` 排个序（保证每次运行结果一致）
4. `uchars` 就是我们的"字母表"：`['a', 'b', 'c', ..., 'z']`
5. 每个字母在 `uchars` 里的下标就是它的 **token id**：`a=0, b=1, c=2, ..., z=25`
6. `BOS = 26` 再加一个特殊 token，叫 "Beginning Of Sequence"，表示"一个名字的开始"
7. `vocab_size = 27`，整个词表就这么大

#### BOS 这个细节很关键

为什么要加 BOS？看训练数据里一个名字怎么被编码：

```
"emma"  → 分词  → [BOS, 4, 12, 12, 0, BOS]
                   ↑                    ↑
                  开始                  结束
```

注意**头尾各加一个 BOS**。这样：
- **开头的 BOS** 告诉模型："我接下来要生成一个名字了"
- **结尾的 BOS** 告诉模型："这个名字到这里结束了"

所以**一个 BOS 同时承担了 "BOS + EOS 两个角色"**——这是个极简设计，省掉一个 token id。

推理时：
- 输入：`[BOS]`
- 让模型预测下一个 token，假设是 `j`
- 把 `j` 接上去：`[BOS, j]`
- 继续预测下一个：假设是 `o`
- 继续：`[BOS, j, o, h, n]`
- 再预测：模型觉得应该结束了，吐出 `BOS`
- 遇到 BOS 就停，输出 "john"

这一套机制的代码在第 186 行开始，后面再细讲。

### 2.3 词表大小和 token id 的意义

`vocab_size = 27` 的意义：**模型的输出永远是一个长度为 27 的概率分布**。

不管输入是什么、模型有多复杂，最后一步一定是："给定当前上下文，下一个 token 是这 27 个中的哪一个？" 每个位置都吐一个 27 维的概率向量。

这一点很重要，因为 `lm_head`（第 81 行）的形状就是 `(vocab_size, n_embd) = (27, 16)`，它的职责就是"把 16 维的隐藏向量投影到 27 维 logits"。

#### 实际编码一个名字

让我们手动走一遍。假设 `uchars = ['a', 'b', ..., 'z']`，`BOS = 26`：

```python
name = "liam"
tokens = [BOS] + [uchars.index(ch) for ch in name] + [BOS]
#      = [26]  + [11, 8, 0, 12]                     + [26]
#      = [26, 11, 8, 0, 12, 26]
```

对应关系：

| 位置 | token id | 字符 | 含义 |
|------|---------|------|------|
| 0 | 26 | BOS | 开始标记 |
| 1 | 11 | l | 第一个字母 |
| 2 | 8  | i | 第二个字母 |
| 3 | 0  | a | 第三个字母 |
| 4 | 12 | m | 第四个字母 |
| 5 | 26 | BOS | 结束标记 |

训练时，我们会让模型学：
- 给 `[26]`（BOS），预测下一个是 `11`（l）
- 给 `[26, 11]`（BOS l），预测下一个是 `8`（i）
- 给 `[26, 11, 8]`（BOS l i），预测下一个是 `0`（a）
- ……
- 给 `[26, 11, 8, 0, 12]`（BOS l i a m），预测下一个是 `26`（结束）

**注意**：总共 5 次预测任务（从 6 个 token 里产生），这就是训练循环里 `n = len(tokens) - 1` 的意思。

---

## 第三章：Value 类——用 15 行代码手搓 Autograd

这是整个文件**最精彩**的部分。

如果你用过 PyTorch，你知道 `loss.backward()` 一行就能算出所有梯度。但底下到底发生了什么？很多人说不清。microgpt 给出了一个 45 行的答案。

### 3.1 为什么我们需要 "autograd"？

回忆第 0.2 节："梯度告诉你每个参数往哪个方向动，loss 会变小。" 问题是：**怎么算梯度？**

对于一个简单函数，比如 `loss = (w - 5)²`，我们手推梯度：
```
d(loss)/d(w) = 2(w - 5)
```

如果 `w = 3`，梯度就是 `2 × (3 - 5) = -4`。这说明 **w 应该往正方向走**（因为梯度是负的），每次走一小步，loss 就会下降。

问题来了：GPT 的 loss 函数复杂到不能手推。它是**几百万个参数经过上百层运算之后**的数字。不可能每次写模型都重新推一遍偏导。

**自动求导 (autograd) 就是一套机制，自动算出所有参数相对 loss 的梯度**，不管 loss 是怎么算出来的。

原理只有一条：**链式法则**

```
如果   z = f(y),  y = g(x)
则    dz/dx = dz/dy · dy/dx
```

把这条规则**递归地**应用到一整张计算图上，你就能从最终的 loss 反推到每一个参数。这就是 "反向传播" 的本质。

### 3.2 计算图：把代数变成一张图

先看一个最简单的例子：
```python
a = 2
b = 3
c = a * b      # c = 6
d = c + 1      # d = 7
loss = d * d   # loss = 49
```

在脑子里画成一张图：

```
  a=2       b=3
    \       /
     \     /
      ╲   ╱
       ╲ ╱
        × ──→ c=6
                 │
                 ▼
              ┌─────┐
          1 → │  +  │ ──→ d=7
              └─────┘
                       │
                       ▼
                   ┌─────┐
              d──→ │  ×  │ ──→ loss=49
                   └─────┘
```

每个**节点**是一个值，每条**边**是一次运算的依赖关系。

现在问：`d(loss)/d(a)` 是多少？手推：
```
loss = d²
     = (c + 1)²
     = (a·b + 1)²
     = (2·3 + 1)²

d(loss)/d(a) = 2(a·b + 1) · b = 2·7·3 = 42
```

如果让计算机自动求，它必须：

1. 知道每个节点是怎么算出来的（父子关系）
2. 知道每一步的"局部偏导"（比如 `c = a*b` 时 `∂c/∂a = b = 3`）
3. 从 loss 出发，反向遍历这张图，用链式法则把梯度一级一级传回去

`Value` 类干的就是这三件事。

### 3.3 Value 类的四个字段

```python
class Value:
    __slots__ = ('data', 'grad', '_children', '_local_grads')

    def __init__(self, data, children=(), local_grads=()):
        self.data = data                # 前向计算出的标量值
        self.grad = 0                   # 对最终 loss 的偏导（反向传播填入）
        self._children = children       # 这个节点从哪些节点算出来的
        self._local_grads = local_grads # 对每个 child 的局部偏导
```

**每个 Value 对象 = 计算图中的一个节点**。它记住了四样东西：

| 字段 | 类型 | 作用 | 什么时候填 |
|------|------|------|----------|
| `data` | float | 这个节点的数值 | 创建时（前向计算） |
| `grad` | float | `∂loss/∂self` 的数值 | `backward()` 时反向填入 |
| `_children` | tuple[Value] | 直接的父节点（输入） | 创建时 |
| `_local_grads` | tuple[float] | 对每个 child 的一阶偏导 | 创建时 |

#### `__slots__` 是干嘛的？

```python
__slots__ = ('data', 'grad', '_children', '_local_grads')
```

这是一个 Python 优化技巧：告诉 Python "这个类的实例只会有这四个属性"，让 Python 用固定数组而不是字典存属性，节省内存。

对于只有几个节点的玩具例子可能看不出差别，但一个 GPT 训练可能产生几百万个 Value 对象——省内存就很重要。

### 3.4 加法和乘法：最简单的运算符重载

先看加法：

```python
def __add__(self, other):
    other = other if isinstance(other, Value) else Value(other)
    return Value(self.data + other.data, (self, other), (1, 1))
```

Python 的魔法方法：当你写 `a + b`，Python 会调用 `a.__add__(b)`。所以重载 `__add__` 就等于自定义了加法运算。

这段代码做三件事：

1. **兼容裸数字**：如果 `other` 是普通的 `int/float`（不是 Value），把它包装成一个叶子 Value
2. **计算数值**：`self.data + other.data`
3. **返回一个新 Value**：
   - `data = self.data + other.data`
   - `children = (self, other)` — 新节点从 self 和 other 算出
   - `local_grads = (1, 1)` — 加法的局部偏导：`∂(a+b)/∂a = 1`，`∂(a+b)/∂b = 1`

再看乘法：

```python
def __mul__(self, other):
    other = other if isinstance(other, Value) else Value(other)
    return Value(self.data * other.data, (self, other), (other.data, self.data))
```

乘法的数值结果是 `self.data * other.data`。局部偏导是：

```
c = a * b
∂c/∂a = b
∂c/∂b = a
```

所以 `local_grads = (other.data, self.data)`——**对 self 求偏导得到 other 的值，反之亦然**。

注意这是**高中微积分**的内容，没有任何神秘。只是每次运算都顺手把这个结果记下来，方便反向传播时直接用。

### 3.5 其他原子运算

```python
def __pow__(self, other): return Value(self.data**other, (self,), (other * self.data**(other-1),))
def log(self):  return Value(math.log(self.data),  (self,), (1/self.data,))
def exp(self):  return Value(math.exp(self.data),  (self,), (math.exp(self.data),))
def relu(self): return Value(max(0, self.data),    (self,), (float(self.data > 0),))
```

一眼认出来：

| 运算 | 数值 | 局部偏导 | 对应的微积分公式 |
|------|------|---------|----------------|
| `x^n` | `x**n` | `n * x^(n-1)` | `d/dx xⁿ = n·xⁿ⁻¹` |
| `log(x)` | `math.log(x)` | `1/x` | `d/dx ln x = 1/x` |
| `exp(x)` | `math.exp(x)` | `exp(x)` | `d/dx eˣ = eˣ` |
| `relu(x)` | `max(0, x)` | `1 if x > 0 else 0` | 分段线性 |

**每个都是一行**。没有一个是"魔法"，全是课本。

注意 `__pow__` 只支持 `other` 是一个**常数**（int/float），不支持两个 Value 相互幂运算——后者会让偏导变复杂，而 microgpt 用不到。

### 3.6 派生运算：用已有算子组合出新的

```python
def __neg__(self): return self * -1
def __sub__(self, other): return self + (-other)
def __truediv__(self, other): return self * other**-1
```

- `__neg__`（一元负号，`-x`）= 乘以 -1
- `__sub__`（减法，`a - b`）= 加上相反数
- `__truediv__`（除法，`a / b`）= 乘以倒数 `a * b^(-1)`

**这些派生运算不需要单独写梯度**，因为它们只是组合现有的基础算子，底层的 `_children` 和 `_local_grads` 会自动建好。这就是"基础算子的正交性"——少量原子运算可以组合出所有常见运算。

剩下三个是"右操作数"版本：

```python
def __radd__(self, other): return self + other
def __rsub__(self, other): return other + (-self)
def __rmul__(self, other): return self * other
def __rtruediv__(self, other): return other * self**-1
```

这些是当你写 `5 + a`（5 是普通数字，a 是 Value）时，Python 先试 `int.__add__(a)` 失败，再试 `a.__radd__(5)`。这里把它映射回 `self + other`，这样左右都能工作。

### 3.7 手工建一张图，观察 `_children` 和 `_local_grads`

让我们跑一遍那个简单例子：

```python
a = Value(2)        # a.data=2, children=(), local_grads=()
b = Value(3)        # b.data=3, children=(), local_grads=()

c = a * b           # c.data=6
                    # c._children = (a, b)
                    # c._local_grads = (b.data, a.data) = (3, 2)

d = c + Value(1)    # d.data=7
                    # d._children = (c, Value(1))
                    # d._local_grads = (1, 1)

loss = d * d        # loss.data=49
                    # loss._children = (d, d)
                    # loss._local_grads = (d.data, d.data) = (7, 7)
```

图长这样：

```
a(2)   b(3)            图例：
 \    /                  ─→  children 连接
  \  /                   数字 = data
   c(6)                  括号里的小数字 = local_grad
    │
    │ 1.0        Value(1)
    ↓            │
    + ← 1.0 ←───┘
    │
    d(7)
    │ \
    │  \  7.0
    ↓   ↘
    ×────
    │
   loss(49)
```

这张图在**前向计算**时就建好了。接下来 `loss.backward()` 要做的，只是沿着 `_children` 边反向走，用链式法则把梯度填进 `grad` 字段。

---

## 第四章：反向传播——拓扑排序 + 链式法则

```python
def backward(self):
    topo = []
    visited = set()
    def build_topo(v):
        if v not in visited:
            visited.add(v)
            for child in v._children:
                build_topo(child)
            topo.append(v)
    build_topo(self)
    self.grad = 1
    for v in reversed(topo):
        for child, local_grad in zip(v._children, v._local_grads):
            child.grad += local_grad * v.grad
```

这 13 行是整个 autograd 引擎的反向部分。拆两步看。

### 4.1 Step 1：拓扑排序

```python
topo = []
visited = set()
def build_topo(v):
    if v not in visited:
        visited.add(v)
        for child in v._children:
            build_topo(child)
        topo.append(v)
build_topo(self)
```

这是一个标准的 **DFS 后序遍历**。从 `self`（最终的 loss 节点）开始，递归访问所有 `_children`，每个节点在**所有子节点都处理完之后**才被 append 到 `topo`。

**性质**（拓扑序的定义）：对 `topo` 里任意两个节点 `u` 和 `v`，如果有依赖关系 `u ← v`（u 是 v 的 child，即 v 依赖 u），那么 **u 会先于 v 出现**在 `topo` 里。

对应到我们的例子：

```
a(2)  b(3)  Value(1)
 \   /      │
  c(6)      │
    \       │
     d(7)  (right child of d)
      │
     loss
```

拓扑顺序可能是：`[a, b, Value(1), c, d, loss]`（具体顺序取决于 DFS 访问子节点的顺序，但依赖关系一定保持）。

**反过来遍历 `topo`，就是从 loss 往叶子节点走**：`[loss, d, c, Value(1), b, a]`。

### 4.2 Step 2：链式法则反向填梯度

```python
self.grad = 1
for v in reversed(topo):
    for child, local_grad in zip(v._children, v._local_grads):
        child.grad += local_grad * v.grad
```

详细动作：

1. **起点**：`self.grad = 1`。为什么？因为 `self` 是 loss 本身，`∂loss/∂loss = 1`。
2. **按反向拓扑顺序遍历**，对每个节点 `v`：
   - 对 `v` 的每个 child，用链式法则累加梯度：
     ```
     child.grad += (∂v/∂child) × (∂loss/∂v)
                 = local_grad    × v.grad
                 = ∂loss/∂child  ← 链式法则的结果
     ```
   - **关键：用 `+=`**。为什么是累加不是赋值？因为一个节点可能被多个下游共用（残差连接的典型场景），每条路径都会贡献一份梯度，必须加起来。

#### 为什么必须是拓扑序？

答：一个节点的梯度必须等**所有下游的梯度都算完之后**才能往上游传。

反例：假设你从 loss 出发直接 BFS，遇到 `d` 就把它的 grad 传给 `c`。但是 `loss = d * d`，`d` 被 loss 用了**两次**（左边一次、右边一次），如果你只传一次，就漏了一半的梯度。

拓扑序保证了"处理 v 时，v 的所有下游都已经把梯度累加到 v.grad 上了"，所以 v.grad 是完整的。

### 4.3 走一遍 backward 的具体执行

回到例子：

```python
a = Value(2)
b = Value(3)
c = a * b         # c.data = 6
d = c + Value(1)  # d.data = 7
loss = d * d      # loss.data = 49
loss.backward()
```

我们希望算出 `a.grad`（即 `∂loss/∂a`）。手推的答案是 `42`（第 3.2 节算过）。

跟着代码走：

**初始状态**（所有 grad = 0）：
```
a.grad=0  b.grad=0  c.grad=0  d.grad=0  loss.grad=0
```

**Step 1：build_topo**，得到 `topo = [a, b, c, Value(1), d, loss]`（顺序可能不同，关键是 loss 最后）。

**Step 2：`loss.grad = 1`**：
```
loss.grad = 1
```

**Step 3：按反向拓扑序遍历。**

#### 3a. 处理 `loss`

`loss._children = (d, d)`，`loss._local_grads = (7, 7)`（即 `d.data`）。

**注意**：两个 child 都是 **同一个 d**——因为 `loss = d * d`。遍历 `zip(children, local_grads)`：

```python
# 第一次：child = d, local_grad = 7
d.grad += 7 * 1  # → d.grad = 7

# 第二次：child = d, local_grad = 7（再一次）
d.grad += 7 * 1  # → d.grad = 14
```

到这里 `d.grad = 14`。这正好对应 `∂(d²)/∂d = 2d = 2·7 = 14`。✅

#### 3b. 处理 `d`

`d._children = (c, Value(1))`，`d._local_grads = (1, 1)`（加法）。

```python
# child = c
c.grad += 1 * 14  # → c.grad = 14

# child = Value(1)
Value(1).grad += 1 * 14  # 这个值不会被后续用到
```

到这里 `c.grad = 14`。对应 `∂d/∂c = 1`，所以 `∂loss/∂c = ∂loss/∂d · ∂d/∂c = 14 · 1 = 14`。✅

#### 3c. 处理 `c`

`c._children = (a, b)`，`c._local_grads = (b.data, a.data) = (3, 2)`。

```python
# child = a, local_grad = 3
a.grad += 3 * 14  # → a.grad = 42

# child = b, local_grad = 2
b.grad += 2 * 14  # → b.grad = 28
```

#### 最终结果

```
a.grad = 42  ✅（和手推一致）
b.grad = 28
c.grad = 14
d.grad = 14
loss.grad = 1
```

**这就是整个反向传播**。从 loss 往回走，每步用链式法则把梯度"分发"给子节点。没有任何张量、没有任何 GPU——只是 Python 标量的加加乘乘。

### 4.4 为什么这个机制能支撑一个完整的 GPT？

因为**神经网络本质上就是一堆加法和乘法**。

- 矩阵乘法 = 大量 `a * b` 求和
- 激活函数 = `relu`、`exp` 等一元函数
- 归一化 = 除法、平方根
- 损失函数 = `log`、求和、取负

只要这些原子操作都建了计算图，`backward()` 就能算出任何参数的梯度。

更厉害的一点：**你不需要针对 GPT 单独实现反向传播**。你只需要写出 **前向**（把参数和输入算成 loss 的过程），剩下的 autograd 全自动搞定。这就是为什么 microgpt 的 `gpt()` 函数只写了前向——反向是 `Value` 类免费赠送的。

### 4.5 一张 "作弊表" 方便你记

| 运算 | 前向 | 局部偏导 |
|------|------|---------|
| 加法 `c = a + b` | `c.data = a.data + b.data` | 对 a: `1`, 对 b: `1` |
| 减法 `c = a - b` | `c.data = a.data - b.data` | 对 a: `1`, 对 b: `-1` |
| 乘法 `c = a * b` | `c.data = a.data * b.data` | 对 a: `b.data`, 对 b: `a.data` |
| 除法 `c = a / b` | `c.data = a.data / b.data` | 对 a: `1/b`, 对 b: `-a/b²` |
| 幂 `c = a^n` | `c.data = a.data**n` | 对 a: `n · a^(n-1)` |
| 对数 `c = log(a)` | `c.data = log(a.data)` | 对 a: `1/a` |
| 指数 `c = exp(a)` | `c.data = exp(a.data)` | 对 a: `exp(a)` |
| ReLU `c = max(0,a)` | `c.data = max(0, a.data)` | 对 a: `1 if a>0 else 0` |

能记住这些，你就能手推任何神经网络的反向传播。

---

## 第五章：模型参数——GPT 的"记忆"存在哪里

```python
n_layer = 1     # Transformer 层数
n_embd = 16     # 嵌入维度 (d_model)
block_size = 16 # 最大上下文长度
n_head = 4      # 注意力头数
head_dim = n_embd // n_head  # 每头的维度 = 4
```

这五个**超参数 (hyperparameters)**定义了模型的"规模"。

- **超参数**：训练之前就定好的数字，训练过程中不变
- **参数 (parameters)**：训练过程中会被更新的数字（就是我们要学的那些）

microgpt 的规模极小：1 层、16 维宽、最大上下文 16 个 token、4 个头。对比一下：

| 模型 | 层数 | 宽度 | 头数 | 参数量 |
|------|------|------|------|--------|
| **microgpt** | **1** | **16** | **4** | **~3K** |
| GPT-2 small | 12 | 768 | 12 | 117M |
| GPT-3 | 96 | 12288 | 96 | 175B |

microgpt 只有几千个参数，可以在 CPU 上几分钟内训完 1000 步。它的目的不是打榜，是让你**看清楚结构**。

### 5.1 参数矩阵工厂

```python
matrix = lambda nout, nin, std=0.08: \
    [[Value(random.gauss(0, std)) for _ in range(nin)] for _ in range(nout)]
```

一个 lambda：`matrix(nout, nin)` 返回一个 `nout × nin` 的二维列表，每个元素都是从 **均值 0、标准差 0.08 的正态分布** 随机采样的 `Value`。

**为什么要随机初始化，不全设为 0？**

因为如果所有参数都相等，每个神经元都会得到一样的梯度，一样地更新，永远不会学到不同的东西——这叫"对称性破缺"问题。加一点随机扰动就能打破对称性。

**为什么用 0.08 这个数？**

经验值。太大会让前向数值爆炸，太小会让梯度消失。真实项目会用更复杂的初始化（Xavier、Kaiming），microgpt 简化为一个固定小方差。

### 5.2 state_dict：所有可学习参数

```python
state_dict = {
    'wte':     matrix(vocab_size, n_embd),  # 27 × 16
    'wpe':     matrix(block_size, n_embd),  # 16 × 16
    'lm_head': matrix(vocab_size, n_embd),  # 27 × 16
}
for i in range(n_layer):
    state_dict[f'layer{i}.attn_wq'] = matrix(n_embd, n_embd)     # 16 × 16
    state_dict[f'layer{i}.attn_wk'] = matrix(n_embd, n_embd)
    state_dict[f'layer{i}.attn_wv'] = matrix(n_embd, n_embd)
    state_dict[f'layer{i}.attn_wo'] = matrix(n_embd, n_embd)
    state_dict[f'layer{i}.mlp_fc1'] = matrix(4 * n_embd, n_embd) # 64 × 16
    state_dict[f'layer{i}.mlp_fc2'] = matrix(n_embd, 4 * n_embd) # 16 × 64
```

这就是 GPT 的全部"记忆"。让我一个一个解释：

#### `wte`: word token embedding（词嵌入表）

形状 `27 × 16`。**每个 token id 对应一个 16 维向量**。

把它想象成一个查找表：

```
token id 0 (a)  →  [0.01, -0.05, 0.03, ..., 0.08]  ← 16 维
token id 1 (b)  →  [0.02,  0.07, -0.01, ..., -0.04]
...
token id 25 (z) →  [-0.03, 0.02, 0.05, ..., 0.06]
token id 26 (BOS) → [0.04, -0.01, 0.09, ..., 0.00]
```

**初始化时这些向量是随机的**，训练之后它们会变得有意义——比如字母 "a" 和 "e" 的向量可能会比较接近，因为它们都是元音。

这叫 **分布式表示 (distributed representation)**——把一个离散的 token 变成一个连续的向量，让模型可以对它做数学运算。

#### `wpe`: word position embedding（位置嵌入表）

形状 `16 × 16`。**每个位置（0 到 15）对应一个 16 维向量**。

为什么需要位置信息？因为接下来的注意力机制**本身不知道 token 的顺序**（后面会解释为什么）。如果你把 "cat sat" 和 "sat cat" 输进去，注意力看到的东西几乎一样。所以我们需要手动把位置信息加进去。

做法：**把位置向量和词向量直接相加**。

```
输入位置 0 的 token (比如 "l"):
  token embedding:    wte['l']   = [0.02, 0.07, ..., -0.04]
  position embedding: wpe[0]     = [0.01, -0.03, ..., 0.05]
  合并 (直接相加):    [0.03, 0.04, ..., 0.01]
```

这样模型就知道"这个 l 出现在位置 0"。

#### `lm_head`: language model head（语言建模头）

形状 `27 × 16`。它把最后一层的 16 维隐藏向量**投影到 27 维 logits**。

为什么形状是 `(vocab_size, n_embd)`？因为它要做的事是：

```
logits = linear(hidden_16, lm_head_27x16)
      = [27 维向量，每个值对应一个 token 的 "生分"]
```

每个位置的输出都是一个 27 维向量，表示模型认为下一个 token 应该是这 27 个中每一个的"生分"（未归一化的对数概率）。经过 softmax 就是概率分布。

#### 注意力层参数（4 个矩阵）

每一层有 4 个 `16 × 16` 的矩阵：

- `attn_wq`：生成 query 的投影
- `attn_wk`：生成 key 的投影
- `attn_wv`：生成 value 的投影
- `attn_wo`：多头输出的最终投影

后面第七章会详细讲它们的用法。

#### MLP 层参数（2 个矩阵）

- `mlp_fc1`：`64 × 16`，把 16 维升到 64 维（4 倍扩展）
- `mlp_fc2`：`16 × 64`，把 64 维降回 16 维

4 倍扩展是 GPT-2 的标准配方。中间过一个 ReLU 激活函数，提供非线性。

### 5.3 展平参数列表

```python
params = [p for mat in state_dict.values() for row in mat for p in row]
print(f"num params: {len(params)}")
```

把所有矩阵摊平成一个一维 `list[Value]`，方便优化器按索引更新。

三层列表推导：
1. 对 `state_dict.values()` 里每个矩阵 `mat`
2. 对每个矩阵里每一行 `row`
3. 对每行里每个 `Value` `p`
4. 全部收集到 `params`

算一下总参数量：

```
wte:           27 × 16 = 432
wpe:           16 × 16 = 256
lm_head:       27 × 16 = 432
layer0.attn_wq: 16 × 16 = 256
layer0.attn_wk: 16 × 16 = 256
layer0.attn_wv: 16 × 16 = 256
layer0.attn_wo: 16 × 16 = 256
layer0.mlp_fc1: 64 × 16 = 1024
layer0.mlp_fc2: 16 × 64 = 1024
─────────────────────────────
总计:                   4192 个参数
```

4192 个数字。训练就是调这 4192 个数字。

### 5.4 对比一下真实的 GPT-2

GPT-2 用的结构几乎一样，只是规模大很多。注释里提到：

> *"Follow GPT-2, blessed among the GPTs, with minor differences:*
> *layernorm → rmsnorm, no biases, GeLU → ReLU"*

三个简化：

| 真实 GPT-2 | microgpt | 为什么简化？ |
|-----------|----------|------------|
| LayerNorm | RMSNorm | RMSNorm 简单 1 行，效果差不多 |
| Linear 带 bias | 不带 bias | bias 对效果影响很小，省一半代码 |
| GeLU 激活 | ReLU | ReLU 只有一行：`max(0, x)` |

这些简化让代码短了一大截，而且最终效果（在名字数据集上）差不多。

---

## 第六章：前向传播——gpt() 函数的每一行

现在我们有了：
- 数据（token 序列）
- 参数（state_dict）
- 自动求导（Value 类）

接下来需要定义**怎么把输入算成 logits**。这就是前向传播。

### 6.1 三个基础算子

先看三个 helper 函数，它们是 `gpt()` 的积木。

#### `linear`：矩阵乘法

```python
def linear(x, w):
    return [sum(wi * xi for wi, xi in zip(wo, x)) for wo in w]
```

数学上，这是 $y = Wx$（不带 bias）。

- `x` 是一个 `list[Value]`，长度 `n_in`
- `w` 是一个 `list[list[Value]]`，形状 `n_out × n_in`
- 返回一个 `list[Value]`，长度 `n_out`

用 Python 语言逐行翻译：

```
# 对 w 的每一行 wo（每一行是一个 n_in 维向量）：
#   把 wo 和 x 按位置相乘后求和（点积）
#   这就是输出向量的一个分量
```

举个例子：
```python
x = [Value(1), Value(2), Value(3)]  # 3 维
w = [
    [Value(0.1), Value(0.2), Value(0.3)],  # 第一行
    [Value(0.4), Value(0.5), Value(0.6)],  # 第二行
]  # 2×3 矩阵

linear(x, w)
# = [
#     0.1*1 + 0.2*2 + 0.3*3,    # = 1.4
#     0.4*1 + 0.5*2 + 0.6*3     # = 3.2
#   ]
# = [Value(1.4), Value(3.2)]
```

注意这些乘法和加法都会**在 Value 计算图上建节点**，所以后续 backward 时能自动算梯度。

#### `softmax`：把 logits 变成概率

```python
def softmax(logits):
    max_val = max(val.data for val in logits)
    exps = [(val - max_val).exp() for val in logits]
    total = sum(exps)
    return [e / total for e in exps]
```

数学公式：

$$\text{softmax}(x_i) = \frac{e^{x_i}}{\sum_j e^{x_j}}$$

它把任意实数向量变成一个概率分布（所有元素在 [0,1]，总和为 1）。

实现有一个**数值稳定技巧**：先减去最大值。

```python
max_val = max(val.data for val in logits)
exps = [(val - max_val).exp() for val in logits]
```

为什么？因为 `exp(大数)` 容易上溢（比如 `exp(1000) = ∞`）。减去最大值后，最大的变 0，`exp(0) = 1`，其他都是负数，`exp(负数)` 是 (0, 1) 之间，完全安全。

**这个技巧不影响结果**：减一个常数再做 softmax，概率分布不变（可以手推证明）。

**注意一个细节**：`max_val` 取的是 `val.data`，是一个普通 float，**不是 Value**。所以 `val - max_val` 这步**不建计算图节点**，减常数不进入梯度流。这正是我们想要的——因为我们只是做数值稳定，不希望这一步的梯度影响什么。

#### `rmsnorm`：归一化

```python
def rmsnorm(x):
    ms = sum(xi * xi for xi in x) / len(x)
    scale = (ms + 1e-5) ** -0.5
    return [xi * scale for xi in x]
```

数学公式：

$$\text{rmsnorm}(x_i) = \frac{x_i}{\sqrt{\text{mean}(x^2) + \epsilon}}$$

逐行：
1. `ms = mean(x²)`——平方的均值
2. `scale = 1 / sqrt(ms + ε)`——倒数平方根，ε=1e-5 防止除零
3. `xi * scale`——每个元素都除以这个 scale

**作用**：让向量的长度（RMS，即二次平均数）保持为 1，不管输入有多大。

**为什么需要归一化？**

因为神经网络有很多层，如果前面几层输出的数值越来越大（或越来越小），后面的层就难以处理。归一化强制把每层的输出规模控制住，让训练更稳定。

RMSNorm 是 LayerNorm 的简化版：LayerNorm 会先减均值再除以标准差，RMSNorm 只除以 RMS。Llama 等现代 LLM 都在用 RMSNorm，因为它简单且效果几乎一样。

### 6.2 `gpt()` 主函数：一次处理一个位置

```python
def gpt(token_id, pos_id, keys, values):
    tok_emb = state_dict['wte'][token_id]
    pos_emb = state_dict['wpe'][pos_id]
    x = [t + p for t, p in zip(tok_emb, pos_emb)]
    x = rmsnorm(x)
    ...
```

**重要设计点**：这个 `gpt()` 函数**一次只处理一个位置**。

PyTorch 里的 GPT 通常一次处理整个序列，比如 `model(tokens_tensor)` 输入一个 `(batch, seq_len)` 的 tensor，输出 `(batch, seq_len, vocab)`。但 microgpt 用的是**位置级的 for 循环**：

```python
# 训练循环里（后面会看到）
for pos_id in range(n):
    token_id = tokens[pos_id]
    logits = gpt(token_id, pos_id, keys, values)
    ...
```

**为什么这样设计？**

1. **教学清晰**：一次处理一个位置，每一步的输入输出都非常明确
2. **因果 mask 自动产生**：处理位置 `p` 时，`keys` 和 `values` 里只有位置 `0..p` 的数据（因为这些是之前的循环 append 进去的），位置 `p+1` 以后的 key/value 根本还没算出来。所以注意力天然只能看到过去，不能看到未来——**无需显式 mask**。
3. **KV cache 顺理成章**：每个位置算一次 k/v 就存下来，下一步直接复用。推理时这就是 LLM 加速的关键优化。

这个设计在代码上稍微不常见，但**概念上非常干净**。

### 6.3 嵌入与第一次 RMSNorm

```python
tok_emb = state_dict['wte'][token_id]   # 查词嵌入表，得到 16 维向量
pos_emb = state_dict['wpe'][pos_id]     # 查位置嵌入表，得到 16 维向量
x = [t + p for t, p in zip(tok_emb, pos_emb)]  # 按位置相加
x = rmsnorm(x)
```

具体例子。假设我们正在处理 `"liam"` 的第二个字符 `i`，它的 token id 是 8，位置是 2：

```
tok_emb = wte[8]   = [-0.04, 0.07, 0.02, ..., 0.09]  (16 维)
pos_emb = wpe[2]   = [0.01,  0.03, -0.02, ..., -0.01]
x       =          = [-0.03, 0.10, 0.00, ..., 0.08]  (对应位置相加)
x       = rmsnorm(x)
        ≈ [-0.48, 1.62, 0.00, ..., 1.29]  (放大到 RMS = 1 的尺度)
```

注意最后有一个 `rmsnorm`。注释里特意解释了为什么这不是多余的：

> *"note: not redundant due to backward pass via the residual connection"*

意思是：后面有残差连接 `x + sublayer(x)`，如果 `x` 太大，残差会把信号压过去，梯度也会有问题。先归一化一次让 `x` 在合理尺度上。

### 6.4 Transformer 块：注意力 + MLP

```python
for li in range(n_layer):
    # 1) Multi-head Attention block
    x_residual = x
    x = rmsnorm(x)
    q = linear(x, state_dict[f'layer{li}.attn_wq'])
    k = linear(x, state_dict[f'layer{li}.attn_wk'])
    v = linear(x, state_dict[f'layer{li}.attn_wv'])
    keys[li].append(k)
    values[li].append(v)
    ...
```

`n_layer = 1`，所以这个循环只跑一次。但如果是真正的 GPT，这里会跑 12、24、96 次。

**每一层结构相同**：先 Attention 块，再 MLP 块，每块都带残差连接和前置 RMSNorm。

让我们分开看。注意力是整个 Transformer 的核心，单独开一章讲。

### 6.5 最后一步：投影到词表

```python
logits = linear(x, state_dict['lm_head'])
return logits
```

经过所有 Transformer 层之后，`x` 还是一个 16 维向量。但我们要的是 27 维的 logits（对应 27 个可能的下一个 token）。`lm_head`（形状 27×16）做的就是这个投影。

**注意这里没做 softmax**。留给调用者（训练循环和采样）自己做。原因是：

- 训练时：loss 函数要用 `log(softmax(logits))`，直接取 log 会有更好的数值稳定性（log-sum-exp trick），在更完整的实现里通常用一个融合的 `log_softmax`。microgpt 简单起见分两步做。
- 推理时：温度采样需要先 `logits / temperature` 再 softmax

把 softmax 留在外面是个正确的设计。

---

## 第七章：多头注意力——整个 Transformer 的灵魂

这是 GPT 里**最难理解也最重要**的部分。我会用最慢的节奏讲。

### 7.1 注意力要解决什么问题？

想象你在读一句话："cat sat on the mat"。当你处理到 "mat" 时，如果要预测下一个词，你会本能地"回头看"——这句话里哪些词和 "mat" 相关？

- "cat" 高度相关（动物可能在垫子上）
- "on" 高度相关（表示空间关系）
- "the" 不太相关（功能词）

这个"回头看 + 根据相关性加权综合信息"的过程，就是**注意力**。

在数学上，注意力接收一个序列，对每个位置：
1. 根据当前位置生成一个 **query**（问题：我想找什么？）
2. 每个位置生成一个 **key**（我有什么）
3. 每个位置生成一个 **value**（我能提供什么）
4. 拿当前位置的 query 和所有位置的 key 算相似度 → 得到注意力权重
5. 用这些权重对所有位置的 value 做加权平均 → 得到综合后的信息

这三个东西（Q、K、V）都是从**同一个输入 x** 通过三个不同的线性层投影出来的。

### 7.2 代码分步解读

```python
x_residual = x           # 备份原始 x，等一下要做残差连接
x = rmsnorm(x)           # 归一化后再进入注意力（"pre-norm" 设计）
q = linear(x, state_dict[f'layer{li}.attn_wq'])  # [16] @ [16,16] → [16]
k = linear(x, state_dict[f'layer{li}.attn_wk'])  # 同上
v = linear(x, state_dict[f'layer{li}.attn_wv'])  # 同上
```

三个 16 维向量 `q`、`k`、`v`。

```python
keys[li].append(k)
values[li].append(v)
```

**关键一步**：把当前位置的 k 和 v 存到 `keys` 和 `values` 里。这两个是从外面传进来的 `list[list[Value]]`：`keys[li]` 是第 li 层的 key 历史。

第一次调用时 `keys[0] = [k0]`，第二次是 `[k0, k1]`，第三次是 `[k0, k1, k2]`……每处理一个位置就往里塞一个。

这就是 **KV cache**：历史位置的 key/value 不重算，存起来用。

### 7.3 多头：把 q/k/v 切成 4 份

```python
x_attn = []
for h in range(n_head):   # 4 个头
    hs = h * head_dim      # 头 h 的起始位置
    q_h = q[hs:hs+head_dim]                              # 当前位置的第 h 头 q (4 维)
    k_h = [ki[hs:hs+head_dim] for ki in keys[li]]        # 所有历史的第 h 头 k
    v_h = [vi[hs:hs+head_dim] for vi in values[li]]      # 所有历史的第 h 头 v
    ...
```

`n_embd = 16`，`n_head = 4`，`head_dim = 4`。

把 16 维的 q 切成 4 份，每份 4 维：
```
q = [q0, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12, q13, q14, q15]
     ↑─ 头0 ─↑  ↑─ 头1 ─↑  ↑─ 头2 ─↑   ↑── 头3 ──↑
```

每个头独立做一次注意力计算，最后把结果拼回来。

**为什么要"多头"？** 直觉上：不同的头可以关注不同维度的相似性。比如一个头可能关注"语法关系"，另一个关注"语义关系"，另一个关注"位置关系"。这让模型更有表达力。

（实际上多头有没有这种可解释性是另一个话题，但"多头比单头效果好"是经验共识。）

### 7.4 单头的注意力计算

```python
attn_logits = [
    sum(q_h[j] * k_h[t][j] for j in range(head_dim)) / head_dim**0.5
    for t in range(len(k_h))
]
```

这行代码看起来吓人，拆开就很清楚：

```python
# 对每个历史位置 t（包括当前位置）
for t in range(len(k_h)):
    # q_h 和 k_h[t] 做点积
    dot = sum(q_h[j] * k_h[t][j] for j in range(head_dim))
    # 除以 sqrt(head_dim) 做缩放
    scaled = dot / head_dim**0.5
    attn_logits.append(scaled)
```

#### 两个关键操作

**1. 点积 = 相似度**

两个向量的点积可以度量它们的相似程度：
- 方向相同 → 点积为正的大数
- 方向垂直 → 点积 ≈ 0
- 方向相反 → 点积为负

所以 `q 和 k_t 的点积大`，意味着"当前位置对位置 t 的内容很感兴趣"。

**2. 除以 √head_dim = 缩放**

为什么？因为如果 `head_dim` 很大，点积的数值会很大，softmax 之后会变成 "one-hot"（只有一个位置是 1，其他全是 0）——这会让梯度消失，训练不动。

除以 `√head_dim` 把 logits 控制在合理范围内，softmax 输出更"软"一些。这是原始 Attention 论文 "Attention Is All You Need" 里就有的设计。

#### softmax 变权重

```python
attn_weights = softmax(attn_logits)
```

把 `attn_logits`（每个历史位置一个 logit）变成概率分布。权重加起来等于 1。

比如有 3 个历史位置：
```
attn_logits    = [0.5, 2.0, -0.3]
attn_weights   = softmax(...) = [0.15, 0.75, 0.10]
```

意思是：当前位置对位置 1 的关注度最高（75%），对位置 0 次之（15%），对位置 2 最低（10%）。

#### 加权求和 values

```python
head_out = [
    sum(attn_weights[t] * v_h[t][j] for t in range(len(v_h)))
    for j in range(head_dim)
]
```

拆开：

```python
# 对每个维度 j（head_dim = 4 个维度）
for j in range(head_dim):
    # 对所有历史位置做加权平均
    component = sum(attn_weights[t] * v_h[t][j] for t in range(len(v_h)))
    head_out.append(component)
```

用上面的例子：
```
v_h = [
    [0.1, 0.2, 0.3, 0.4],   # 位置 0 的 value
    [0.5, 0.6, 0.7, 0.8],   # 位置 1 的 value
    [0.9, 1.0, 1.1, 1.2],   # 位置 2 的 value
]
attn_weights = [0.15, 0.75, 0.10]

head_out = [
    0.15*0.1 + 0.75*0.5 + 0.10*0.9 = 0.48,  # 第 0 维
    0.15*0.2 + 0.75*0.6 + 0.10*1.0 = 0.58,  # 第 1 维
    0.15*0.3 + 0.75*0.7 + 0.10*1.1 = 0.68,  # 第 2 维
    0.15*0.4 + 0.75*0.8 + 0.10*1.2 = 0.78,  # 第 3 维
]
```

这就是"注意力加权的 value 平均"。当前位置得到的信息主要来自位置 1（权重 0.75），少量来自位置 0 和 2。

### 7.5 拼接多头 + 输出投影

```python
x_attn.extend(head_out)    # 每个头的 4 维结果依次拼接
# 循环 4 次之后，x_attn 变成一个 16 维向量（4 头 × 4 维）

x = linear(x_attn, state_dict[f'layer{li}.attn_wo'])
```

`attn_wo` 是一个 `16 × 16` 矩阵，把拼接后的多头输出做最后一次线性变换。这一步是为了让不同头的信息融合（混合）。

### 7.6 残差连接

```python
x = [a + b for a, b in zip(x, x_residual)]
```

把注意力的输出和**原始的 x**（进入注意力前备份的那个）对应位置相加。这叫 **残差连接 (residual connection)**。

**为什么需要残差？**

两个原因：

**1. 梯度有"捷径"回传**

没有残差时，梯度必须穿过所有层才能回到参数。层数多了，梯度会变得很小（梯度消失）或很大（梯度爆炸）。有了残差，梯度有一条直接的"高速公路"可以从 loss 一路走到任何一层的参数：

```
没有残差:                        有残差:
    x → f1 → f2 → f3 → loss       x ─┬─→ f1 ─┬─→ f2 ─┬─→ f3 → loss
                                      └──+───┘      │
    梯度必须穿过 f1 f2 f3                  └──+───┘
                                                  │
                                                  └──+
                                      梯度有"加号"捷径，直接回传
```

**2. 层可以"选择不做什么"**

`y = x + f(x)` 意味着：如果 `f(x)` 学到一个接近 0 的函数，整层就等于恒等映射（什么都不做）。这比"层必须做点什么"友好得多——模型可以按需添加复杂度。

残差连接是 ResNet (2015) 提出的，现在几乎所有深度网络都用。

---

## 第八章：MLP 与残差连接

```python
# 2) MLP block
x_residual = x
x = rmsnorm(x)
x = linear(x, state_dict[f'layer{li}.mlp_fc1'])   # 16 → 64
x = [xi.relu() for xi in x]
x = linear(x, state_dict[f'layer{li}.mlp_fc2'])   # 64 → 16
x = [a + b for a, b in zip(x, x_residual)]
```

注意力之后是 **MLP (多层感知机) 块**，也叫 **FFN (前馈网络)**。结构很简单：

```
                ┌─────────────┐
  16 维 x ───→  │  RMSNorm    │
                └──────┬──────┘
                       │
                ┌──────▼──────┐
                │ Linear 16→64 │   (fc1)
                └──────┬──────┘
                       │
                ┌──────▼──────┐
                │    ReLU     │
                └──────┬──────┘
                       │
                ┌──────▼──────┐
                │ Linear 64→16 │   (fc2)
                └──────┬──────┘
                       │
                       +   ← 残差连接
                       │
                       ▼
                   输出 (16 维)
```

### 8.1 为什么要升维再降维？

MLP 把向量从 16 维升到 64 维（4 倍），过一个非线性激活（ReLU），再降回 16 维。

**为什么升维？** 提高容量。更高维的空间里，更容易分离不同的"概念"。4 倍扩展是 GPT-2 的经典配方，后面的模型基本都沿用。

**为什么要 ReLU？** 为了引入非线性。如果没有 ReLU，两个 Linear 串联等价于一个更大的 Linear——整个 MLP 就退化成线性变换，模型容量不升反降。ReLU 的定义：

```python
relu(x) = max(0, x)
```

简单到不能再简单。它只做一件事：把负数变成 0，正数原样保留。这个"开关"性质就是非线性的来源。

（真实 GPT-2 用的是 GeLU，效果略好但复杂。microgpt 为了简洁用了 ReLU。）

### 8.2 注意力 vs MLP 的分工

一个有意思的直觉：

- **注意力**：负责**位置之间的通信**。当前 token 看历史 token，吸收相关信息
- **MLP**：负责**每个位置独立的处理**。同一个 MLP 作用在每个位置的向量上，没有位置间的交流

这两个加起来才是完整的一层 Transformer：**先跨位置混合，再每位置独立深加工**。交替做，就能学到复杂的模式。

### 8.3 在循环之外：最后的 lm_head

```python
# 循环结束之后
logits = linear(x, state_dict['lm_head'])
return logits
```

所有 Transformer 层走完，`x` 仍是 16 维。`lm_head` 形状 `27 × 16`，把它投影到 27 维的 logits。返回给调用者。

---

## 第九章：训练循环——Adam 优化器到底在做什么

```python
learning_rate, beta1, beta2, eps_adam = 0.01, 0.85, 0.99, 1e-8
m = [0.0] * len(params)
v = [0.0] * len(params)

num_steps = 1000
for step in range(num_steps):
    # ... 一步训练 ...
```

训练 1000 步。每一步做的事：

1. 取一个名字
2. 前向传播，算出 loss
3. 反向传播，算出梯度
4. Adam 更新参数

一个一个拆。

### 9.1 取数据 + 编码

```python
doc = docs[step % len(docs)]
tokens = [BOS] + [uchars.index(ch) for ch in doc] + [BOS]
n = min(block_size, len(tokens) - 1)
```

- `step % len(docs)` 循环取，保证每个名字都会被看到
- 把名字前后各加一个 BOS
- `n = len(tokens) - 1` 是我们要做的预测数量（每个位置都要预测下一个）
- 用 `min(block_size, ...)` 截断，防止超过最大上下文长度

举例：`name = "john"`
```
tokens = [26, 9, 14, 7, 13, 26]    # BOS j o h n BOS
n = 5                               # 要预测 5 次
预测任务:
  位置 0 (BOS)      → 位置 1 (j)
  位置 1 (BOS, j)   → 位置 2 (o)
  位置 2 (BOS,j,o)  → 位置 3 (h)
  位置 3            → 位置 4 (n)
  位置 4            → 位置 5 (BOS, 结束)
```

### 9.2 前向：构建计算图直到 loss

```python
keys, values = [[] for _ in range(n_layer)], [[] for _ in range(n_layer)]
losses = []
for pos_id in range(n):
    token_id, target_id = tokens[pos_id], tokens[pos_id + 1]
    logits = gpt(token_id, pos_id, keys, values)
    probs = softmax(logits)
    loss_t = -probs[target_id].log()
    losses.append(loss_t)
loss = (1 / n) * sum(losses)
```

逐行：

1. **初始化 KV cache 为空**（新的名字，历史清零）
2. **循环每个位置**，`token_id` 是输入，`target_id` 是标签（正确答案）
3. **跑一次 `gpt()`**，得到 27 维 logits
4. **softmax 成概率分布**
5. **交叉熵损失**：`-log(正确答案的概率)`
6. **累加到 losses 列表**
7. **最终 loss = 所有位置 loss 的平均**

#### 交叉熵损失：`-log(P[target])`

直觉：

- 如果模型完美预测对了，`P[target] = 1`，`-log(1) = 0`，损失为 0 ✅
- 如果模型觉得正确答案的概率只有 0.5，`-log(0.5) ≈ 0.69`
- 如果模型觉得只有 0.01，`-log(0.01) ≈ 4.6`
- 如果模型觉得只有 0.0001，`-log(0.0001) ≈ 9.2`

模型越不确定正确答案，loss 越大。反过来训练时，loss 减小的方向就是**把正确答案的概率推高**。

**为什么用 log？**

两个原因：

1. **数值稳定**：概率会连乘（整个句子的联合概率），乘起来会变得极小。log 把乘法变加法，数值稳定。
2. **梯度友好**：`-log(p)` 在 p→0 时梯度很大，意思是"很错的时候更大力度纠正"。这比 MSE 之类的损失更适合分类。

#### 重要：每次调用 `gpt()` 都在建**同一张**计算图

**这是一个容易忽略的细节**。`keys` 和 `values` 是在循环外创建的列表，`gpt()` 每次调用时把新的 `k`、`v`（Value 对象）append 进去。下一次调用时，注意力会用这些历史 `k`、`v`——**这些是 Value 对象，它们属于同一张计算图**。

结果：虽然 `gpt()` 被调用了 5 次（每个位置一次），但所有这 5 次的运算都挂在**同一张大计算图**上，最终汇聚到 `loss`。我们在 `loss` 上调用 `backward()`，就能一次性算出所有位置、所有参数的梯度。

这也是为什么每一步训练开始都要重新初始化 `keys, values` 为空：新名字的计算图要从头开始，避免把上一个名字的计算图也拉进来。

### 9.3 反向：算梯度

```python
loss.backward()
```

一行。调用第四章的 `backward()` 方法，自动算出 `params` 里每个 Value 的 `.grad` 字段。

运行完之后：
- `params[0].grad` = `∂loss/∂params[0]`
- `params[1].grad` = `∂loss/∂params[1]`
- …… 4192 个梯度

### 9.4 Adam 更新参数

```python
lr_t = learning_rate * (1 - step / num_steps)
for i, p in enumerate(params):
    m[i] = beta1 * m[i] + (1 - beta1) * p.grad
    v[i] = beta2 * v[i] + (1 - beta2) * p.grad ** 2
    m_hat = m[i] / (1 - beta1 ** (step + 1))
    v_hat = v[i] / (1 - beta2 ** (step + 1))
    p.data -= lr_t * m_hat / (v_hat ** 0.5 + eps_adam)
    p.grad = 0
```

这是整个文件里**第二难**的部分。我们慢慢来。

#### 背景：最朴素的更新是 SGD

如果用最朴素的 **随机梯度下降 (SGD)**，更新公式就一行：

```python
p.data -= lr * p.grad
```

意思是"按梯度方向走一小步"。但 SGD 有两个问题：

1. **振荡**：如果梯度在某个方向上来回变号（像球在碗里来回滚），SGD 会来回震荡
2. **尺度不一致**：不同参数的梯度可能差好几个数量级，用同一个学习率要么太大要么太小

Adam 用**两个动量**解决这两个问题。

#### Adam 的两个动量

```python
m[i] = beta1 * m[i] + (1 - beta1) * p.grad       # 一阶矩：梯度的 EMA
v[i] = beta2 * v[i] + (1 - beta2) * p.grad ** 2  # 二阶矩：梯度平方的 EMA
```

这两行都是**指数移动平均 (EMA)**。EMA 的含义：新值 = 0.85 × 旧值 + 0.15 × 新观测。每次观察占一点权重，但整体是一个平滑的滑动平均。

- `m[i]` 平均了最近的梯度（方向）
- `v[i]` 平均了最近的梯度平方（幅度）

把 m 和 v 分别对应到"均值"和"方差"的直觉：

- `m[i]` ≈ 近期梯度的平均方向
- `v[i]` ≈ 近期梯度的典型幅度（的平方）

#### 更新公式：`lr * m / √v`

```python
p.data -= lr_t * m_hat / (v_hat ** 0.5 + eps_adam)
```

意思是：**按方向 m 更新，但用 √v 做自适应归一化**。

- `m_hat / √v_hat` 相当于"把梯度方向标准化"——不管这个参数的梯度原本是大是小，归一化后都是同一个量级
- 乘以 `lr_t` 是统一的步长
- 每个参数都有自己的 m 和 v，所以每个参数有自己的"有效学习率"

**效果**：
- 如果梯度方向稳定（m 大且 √v 小），更新幅度大，快速前进
- 如果梯度方向振荡（m 小但 √v 大），更新幅度小，谨慎前进
- 对所有参数自动适配，不需要手调每个参数的学习率

#### 偏差修正：`m / (1 - β^t)`

```python
m_hat = m[i] / (1 - beta1 ** (step + 1))
v_hat = v[i] / (1 - beta2 ** (step + 1))
```

**为什么要这个？** 因为 `m` 和 `v` 初始化为 0，前几步的 EMA 会被 0 拖累，数值偏小。

举例：`beta1 = 0.85`，第 1 步时：
```
m[0] = 0.85 * 0 + 0.15 * g   = 0.15 g
```

本来希望 `m` 近似 `g`，结果只有 `0.15 g`——偏小。除以 `(1 - 0.85^1) = 0.15` 就恢复到 `g`。

第 2 步：
```
m[0] = 0.85 * 0.15g + 0.15 * g2 = 0.1275g + 0.15g2
除以 (1 - 0.85^2) = 0.2775
→ 0.46g + 0.54g2
```

越到后面，`β^t` 越接近 0，修正越小。这是一个"冷启动补偿"。

#### 学习率线性衰减

```python
lr_t = learning_rate * (1 - step / num_steps)
```

- 第 0 步：`lr_t = 0.01`
- 第 500 步：`lr_t = 0.005`
- 第 1000 步：`lr_t = 0`

训练初期学习率大，快速接近最优；后期变小，精细调整。这是训练 LLM 的常见技巧。

#### 清零梯度

```python
p.grad = 0
```

最后把梯度清零，为下一步做准备。如果不清零，下一步的梯度会**累加**到这一步的梯度上，造成错误的更新方向。

在 PyTorch 里对应 `optimizer.zero_grad()`。

### 9.5 训练输出

```python
print(f"step {step+1:4d} / {num_steps:4d} | loss {loss.data:.4f}", end='\r')
```

在终端打印进度条。`\r` 让下一次输出覆盖当前行，看起来是单行刷新。

训练开始时 loss ≈ 3.3（`log(27) ≈ 3.3`，意思是模型还是均匀乱猜），训练结束时降到 2.0 左右，说明模型学到了字符的分布规律。

### 9.6 一步训练的完整数据流

用一张图总结（一个名字 → 一次参数更新）：

```
doc = "john"
     │
     ▼
tokens = [26, 9, 14, 7, 13, 26]
     │
     ▼
  ┌──────────────────────────────┐
  │ 前向：循环 5 次（每位置一次）│
  │                              │
  │  pos=0: gpt(26, 0) → logits0 │
  │  pos=1: gpt(9,  1) → logits1 │
  │  pos=2: gpt(14, 2) → logits2 │
  │  pos=3: gpt(7,  3) → logits3 │
  │  pos=4: gpt(13, 4) → logits4 │
  │                              │
  │  所有运算挂在同一张计算图    │
  └───────────┬──────────────────┘
              │
              ▼
    loss = mean(-log P[target])
              │
              ▼
      loss.backward()   ← 自动算出所有 params 的 .grad
              │
              ▼
    ┌──────────────────────┐
    │  Adam 更新每个 param │
    │  m += grad           │
    │  v += grad²          │
    │  p -= lr·m/√v        │
    │  p.grad = 0          │
    └──────────────────────┘
              │
              ▼
       下一个名字
```

---

## 第十章：推理——让模型开口说话

训练完之后，我们想看看模型学到了什么——让它生成一些新名字。

```python
temperature = 0.5
print("\n--- inference (new, hallucinated names) ---")
for sample_idx in range(20):
    keys, values = [[] for _ in range(n_layer)], [[] for _ in range(n_layer)]
    token_id = BOS
    sample = []
    for pos_id in range(block_size):
        logits = gpt(token_id, pos_id, keys, values)
        probs = softmax([l / temperature for l in logits])
        token_id = random.choices(range(vocab_size), weights=[p.data for p in probs])[0]
        if token_id == BOS:
            break
        sample.append(uchars[token_id])
    print(f"sample {sample_idx+1:2d}: {''.join(sample)}")
```

### 10.1 采样循环

```python
token_id = BOS       # 从 BOS 开始
sample = []          # 收集生成的字符
for pos_id in range(block_size):
    logits = gpt(token_id, pos_id, keys, values)     # 前向一次
    probs = softmax([l / temperature for l in logits])  # 温度采样
    token_id = random.choices(range(vocab_size), weights=[p.data for p in probs])[0]
    if token_id == BOS:
        break         # 遇到 BOS 就停
    sample.append(uchars[token_id])
```

步骤：

1. 从 BOS 开始，位置 0
2. 调用 `gpt()` 得到 logits
3. **除以温度**（下面解释），softmax 得到概率分布
4. **按概率随机采样**一个 token
5. 如果是 BOS，说明模型觉得名字该结束了，跳出循环
6. 否则把字符加到 `sample`，`token_id` 更新为新采到的 token，循环继续
7. 最多跑 `block_size = 16` 步，防止无限循环

### 10.2 温度 (temperature) 参数

```python
probs = softmax([l / temperature for l in logits])
```

把 logits 除以一个常数（温度）再 softmax。这个简单操作改变了概率分布的"尖锐度"：

- **temperature = 1.0**：原始分布
- **temperature < 1.0**：分布变尖锐。高概率 token 更高，低概率 token 更低。采样更"保守"，倾向于选最可能的。
- **temperature > 1.0**：分布变平缓。采样更"随机"，倾向于探索。

举例。假设原始 logits 是 `[2.0, 1.0, 0.1]`：

```
temperature = 1.0:
  logits/T = [2.0, 1.0, 0.1]
  probs    = [0.65, 0.24, 0.11]   (适中)

temperature = 0.5:
  logits/T = [4.0, 2.0, 0.2]
  probs    = [0.84, 0.11, 0.05]   (尖锐，更确定)

temperature = 2.0:
  logits/T = [1.0, 0.5, 0.05]
  probs    = [0.46, 0.28, 0.26]   (平缓，更随机)
```

ChatGPT API 里的 `temperature` 参数就是这个东西。

microgpt 里用 `temperature = 0.5`，意思是"比较保守"。生成的名字更像真实名字，但创意少一些。

### 10.3 `random.choices`：按权重采样

```python
token_id = random.choices(range(vocab_size), weights=[p.data for p in probs])[0]
```

- `range(vocab_size)` 是候选列表：`[0, 1, 2, ..., 26]`
- `weights=...` 是每个候选的权重（就是概率分布）
- `random.choices(..., k=1)[0]` 按权重随机抽一个

`random.choices` 的默认 `k=1`，返回长度为 1 的列表，所以用 `[0]` 取出来。

**注意**：`p.data` 是 `Value` 的 `data` 字段（纯 float）。推理时我们不需要梯度，所以只看数值。

### 10.4 生成的名字长什么样？

训练 1000 步之后，典型输出可能是：

```
sample  1: marian
sample  2: keylen
sample  3: jorah
sample  4: aviana
sample  5: torian
sample  6: kyra
...
```

注意这些名字**看起来像英文名字但其实都是模型瞎编的**。训练集里可能有 `mariana`、`maria`、`mary`，但没有 `marian`（或者有但位置不对）。模型通过字符级概率学到了"英文名字的一般规律"——元音辅音交替、常见词尾等——然后生成符合这些规律的新组合。

**这就是生成式模型的本质**：学到数据分布，从中采样新样本。

ChatGPT 做的也是同样的事，只不过：
- token 是 BPE 子词而不是字符
- 模型层数、宽度大好几个数量级
- 训练数据是整个互联网而不是 3 万个名字
- 最后多了一步 RLHF 让它更像"助手"

**算法层面，没有任何新东西**。这就是 microgpt 的教育价值。

---

## 第十一章：把整个流程串起来

让我用一张大图总结 microgpt 的完整数据流。

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                       ① 数据准备                                  │
 │                                                                  │
 │   names.txt  →  docs (list[str])                                 │
 │                   ↓                                              │
 │              uchars (字符表)                                      │
 │              vocab_size = 27                                     │
 │              BOS = 26                                            │
 └──────────────────────────────────────────────────────────────────┘
                                ↓
 ┌──────────────────────────────────────────────────────────────────┐
 │                       ③ 参数初始化                                │
 │                                                                  │
 │   state_dict (9 个矩阵，~4192 个 Value)                          │
 │   params (展平的 list[Value])                                     │
 │   m, v = Adam 动量缓冲                                            │
 └──────────────────────────────────────────────────────────────────┘
                                ↓
 ┌──────────────────────────────────────────────────────────────────┐
 │                     ⑤ 训练循环 (1000 步)                         │
 │                                                                  │
 │   for step in range(1000):                                       │
 │                                                                  │
 │     1. 取一个名字, 编码: tokens = [BOS, ..., BOS]                │
 │                                                                  │
 │     2. 前向 (循环 n 次)                                           │
 │        keys, values = [], []                                     │
 │        for pos_id in range(n):                                   │
 │          logits = gpt(token_id, pos_id, keys, values)            │
 │            │ 词嵌入 + 位置嵌入                                    │
 │            │ RMSNorm                                             │
 │            │ for layer in range(n_layer):                        │
 │            │   Attention:                                        │
 │            │     q,k,v = linear(x, wq/wk/wv)                     │
 │            │     keys[layer].append(k)                           │
 │            │     values[layer].append(v)                         │
 │            │     for head in 0..n_head:                          │
 │            │       dot = q·k / √d                                │
 │            │       weights = softmax(dot)                        │
 │            │       out = weights · v                             │
 │            │     x = linear(concat, wo) + x_residual             │
 │            │   MLP:                                              │
 │            │     x = linear(x, fc1)                              │
 │            │     x = relu(x)                                     │
 │            │     x = linear(x, fc2) + x_residual                 │
 │            │ logits = linear(x, lm_head)                         │
 │          loss_t = -softmax(logits)[target].log()                 │
 │        loss = mean(loss_t)                                       │
 │                                                                  │
 │     3. 反向                                                       │
 │        loss.backward()  ←  拓扑排序 + 链式法则                    │
 │                                                                  │
 │     4. 优化                                                       │
 │        for p in params:                                          │
 │          m = β1·m + (1-β1)·grad                                  │
 │          v = β2·v + (1-β2)·grad²                                 │
 │          p.data -= lr · m̂ / (√v̂ + ε)                          │
 │          p.grad = 0                                              │
 └──────────────────────────────────────────────────────────────────┘
                                ↓
 ┌──────────────────────────────────────────────────────────────────┐
 │                     ⑥ 推理（20 次采样）                          │
 │                                                                  │
 │   for 20 个名字:                                                  │
 │     token = BOS                                                  │
 │     while token != BOS (or 达到 block_size):                     │
 │       logits = gpt(token, pos, keys, values)                     │
 │       probs = softmax(logits / temperature)                      │
 │       token = random.choices(weights=probs)                     │
 │       sample.append(chr)                                         │
 │     print(sample)                                                │
 └──────────────────────────────────────────────────────────────────┘
```

**200 行完整流程就是这样**。你现在应该能从上到下读懂每一行。

---

## 第十二章：你现在能回答的面试题

如果你完整读完了前面的章节，下面这些问题你应该都能答上来。可以当做自测。

### 12.1 基础题

**Q1：什么是"下一个 token 预测"任务？它和分类任务有什么关系？**

答：给定前面的 token 序列，预测下一个 token 是词表里的哪一个。本质上是一个 K 分类问题（K = vocab_size）。训练时用交叉熵损失，推理时按概率分布采样。

**Q2：解释一下 token embedding 和 position embedding 分别在做什么。**

答：
- **token embedding**（`wte`）：把每个 token id 映射到一个 d 维向量。它是一个查找表，形状 `(vocab_size, d)`，训练过程中会学到"语义相似的 token 有相似的向量"。
- **position embedding**（`wpe`）：把每个位置（0, 1, 2, ...）映射到一个 d 维向量，告诉模型这个 token 在序列里的位置。因为注意力机制本身对位置不敏感，所以位置信息必须显式加入。
- 两个向量直接**相加**，作为 Transformer 的输入。

**Q3：为什么 attention 要除以 √d_k？**

答：点积的方差会随维度线性增长。如果 `d_k` 大，点积的数值就很大，softmax 之后会变成接近 one-hot 的分布（梯度消失）。除以 `√d_k` 把方差归一化回 1 的量级，softmax 输出更平滑，训练更稳定。

**Q4：什么是 KV cache？它为什么能加速推理？**

答：
- **是什么**：把每一步注意力计算出的 key 和 value 向量缓存下来，下一步直接复用。
- **为什么能加速**：因为 token 在一个位置的 k/v 只依赖于该位置的 x，而不依赖于后面的位置。推理时每次只生成一个新 token，历史 token 的 k/v 永远不会变，重算就是浪费。
- **代码体现**：`keys[li].append(k)`、`values[li].append(v)`。

**Q5：为什么 Transformer 需要残差连接？**

答：两个原因：
1. **梯度回传**：残差给梯度提供了"高速公路"，可以从 loss 直达任何一层的参数，缓解梯度消失问题。
2. **恒等回退**：`y = x + f(x)` 允许模型在某一层学习一个接近 0 的 f，相当于这层什么都不做。这样加深层数不会让表达力下降。

### 12.2 进阶题

**Q6：autograd 的 backward 为什么必须先做拓扑排序？**

答：一个节点可能被多个下游共用（比如残差连接），它的梯度来自多条路径。必须等**所有下游**都把梯度累加到这个节点上之后，才能再用它往上游传。拓扑序（按依赖关系排序，从下游到上游）保证了这一点：处理节点 v 时，v 的所有下游都已经处理完了。

**Q7：解释一下 Adam 的两个动量 m 和 v，以及 `m / √v` 这个公式的直觉。**

答：
- `m` 是梯度的指数移动平均（一阶矩），代表"近期梯度的平均方向"
- `v` 是梯度平方的指数移动平均（二阶矩），代表"近期梯度的典型幅度"
- `m / √v` 意思是"把每个参数的更新方向归一化到单位幅度"。不管原本梯度是大是小，归一化后更新步长都由学习率决定。这让不同参数自动有自适应的有效学习率。
- 结果：梯度稳定的方向快速前进，振荡的方向谨慎前进。

**Q8：为什么 Adam 要做 "偏差修正"？**

答：因为 `m` 和 `v` 初始化为 0，前几步的 EMA 会被 0 拖累，数值偏小。除以 `(1 - β^t)` 补偿这个冷启动偏差，让 `m_hat` 和 `v_hat` 更接近真实的"梯度均值/梯度方差"。随着 t 增大，`β^t → 0`，修正效应也消失。

**Q9：microgpt 的 `gpt()` 函数一次只处理一个位置，这个设计有什么好处？**

答：
1. **代码直观**：每一步的输入输出都是一维向量，没有批量维度
2. **因果 mask 自动产生**：因为 `keys`、`values` 只包含已经处理过的历史位置，当前位置在注意力里自然看不到未来——无需显式构造因果 mask 矩阵
3. **KV cache 自然**：for 循环每次 append 一个新的 k/v，下一步自动用上
4. **推理和训练用同一个函数**：因为推理本来就是一次生成一个 token，训练时的"教师强制"（用真实 token 作为输入）也是一次处理一个，代码完全复用

**Q10：为什么用交叉熵作为 loss 而不是均方误差（MSE）？**

答：
1. **数值稳定**：概率连乘容易溢出，log 把乘法变加法
2. **梯度大小合理**：`-log(p)` 在预测错得离谱时（p 小）梯度很大，促使模型快速改正；预测接近正确时梯度小，细调即可
3. **概率诠释**：交叉熵等价于 "最小化预测分布和真实分布（one-hot）之间的 KL 散度"，有清晰的信息论意义
4. **与 softmax 天然配合**：`log(softmax(x))` 有数值稳定的高效实现（log-sum-exp），和交叉熵一起用效率最高

### 12.3 设计题

**Q11：如果词表大小从 27 增加到 10 万（比如用 BPE 分词），哪些参数的形状会变？总参数量变化多少？**

答：受影响的参数是 `wte`（`vocab_size × n_embd`）和 `lm_head`（`vocab_size × n_embd`）。
- `wte` 从 `27 × 16 = 432` 变成 `100000 × 16 = 1.6M`
- `lm_head` 从 `27 × 16 = 432` 变成 `100000 × 16 = 1.6M`
- 总参数量从 4192 增加到约 3.2M + 其他不变的 3000 = **约 3.2M**

真实 GPT 的 embedding 和 lm_head 占了总参数量的很大一部分（尤其模型小的时候）。这也是为什么很多模型会让它们**共享权重** (weight tying)。

**Q12：如果我把 `n_layer` 从 1 改成 3，运行时间大约会变成多少倍？**

答：前向时间约 3 倍（每层都要做注意力和 MLP），反向也约 3 倍，所以总训练时间大约 3 倍。参数量：每层有 `4*n_embd² + 2*4*n_embd²/n_embd * n_embd = 6*16² = 1536` 个参数（4 个 attention 矩阵 + 2 个 MLP 矩阵），乘以 3 层就是 4608 个额外参数（比原来 layer 多的部分）。

### 12.4 代码题

**Q13：如果我想给模型加一个 "bias"（每个 linear 都带一个 `+ b`），需要改哪些地方？**

答：
1. `state_dict` 里每个线性层除了 W 还需要一个 bias 向量
2. `linear()` 函数签名改成 `linear(x, w, b)`，返回 `[Wx + b]`
3. `params` 列表要包含这些 bias
4. 初始化时 bias 通常设为 0

**Q14：为什么 `temperature` 必须大于 0 且通常小于等于 2？**

答：
- 大于 0：除以 0 会 NaN
- 大于 0 小于 1：分布变尖锐（更确定）
- 等于 1：不变
- 大于 1：分布变平缓（更随机）
- 理论上可以很大，但超过 2-3 之后分布已经接近均匀，几乎全随机，生成的文本会变得无意义

---

## 第十三章：动手改一改

读完只是第一步。真正掌握需要动手玩。下面几个改造从简到难排序：

### 13.1 入门改造（30 分钟）

**改造 1：增加训练步数，观察 loss 曲线**
```python
num_steps = 3000  # 原来 1000
```
看 loss 降到多少会趋于平稳。

**改造 2：改变温度，对比生成质量**
```python
for temperature in [0.3, 0.7, 1.0, 1.5]:
    print(f"\n=== temperature = {temperature} ===")
    # 生成 5 个名字
```
看不同温度下生成名字的多样性。

**改造 3：把 `n_layer` 改成 2 或 3**
```python
n_layer = 2
```
看参数量、训练时间、最终 loss 的变化。

### 13.2 中级改造（1-2 小时）

**改造 4：打印模型参数量和内存占用**

在 `params = [...]` 之后加：

```python
total = len(params)
print(f"总参数量: {total}")
print(f"按 float32 计算内存: {total * 4 / 1024:.2f} KB")
```

**改造 5：把 ReLU 换回 GeLU**

```python
def gelu(self):
    import math
    x = self.data
    cdf = 0.5 * (1 + math.tanh(math.sqrt(2 / math.pi) * (x + 0.044715 * x**3)))
    # GeLU 的局部偏导推导比较复杂，可以先用一个近似
    return Value(x * cdf, (self,), (cdf + x * 0.5 * (1 - math.tanh(...)**2) * ..., ))
```
手推 GeLU 的偏导是个不错的微积分练习。

**改造 6：加 batch 训练**

目前一次只处理一个名字（batch size = 1）。改成一次处理 4 个，看训练速度和稳定性的变化。

### 13.3 进阶改造（半天到一天）

**改造 7：实现 weight tying**

让 `wte` 和 `lm_head` 共享同一个矩阵（真实 GPT 的常见优化）。需要小心梯度会被累加两次。

**改造 8：替换数据集**

把 `names.txt` 换成一首诗、一段代码、一段对话，看模型能学到什么样的结构。

**改造 9：从 microgpt 过渡到 nanoGPT**

[nanoGPT](https://github.com/karpathy/nanoGPT) 是 karpathy 的另一个项目，是 microgpt 的 "工程化版本"——用 PyTorch + GPU，能训练真正规模的模型。读懂 microgpt 之后，nanoGPT 的每一行你都会觉得熟悉，只是把标量换成了张量。

---

## 尾声：200 行之后是什么？

读完 microgpt 之后，你应该意识到一件事：

> **所有你听说过的巨型 LLM（GPT-4、Claude、Llama），它们的算法骨架，就是这 200 行。**

真实系统多出的那些东西（多头的 grouped query attention、RoPE 位置编码、FlashAttention、张量并行、流水线并行、LoRA 微调……）本质上都是在**解决效率、扩展性、特殊需求**的问题，而不是在改变核心算法。

这就是 karpathy 那句话的真义：

> *Everything else is just efficiency.*
>
> 其余一切都只是效率优化。

**从 200 行到 ChatGPT**，算法层面几乎没有新东西：
- 更大的词表（BPE 代替字符）
- 更深的网络（96 层代替 1 层）
- 更宽的隐藏维度（12288 代替 16）
- 更多的头（96 代替 4）
- 更长的上下文（128K 代替 16）
- 更海量的数据（全互联网代替 3 万名字）
- 更强的硬件（千 GPU 集群代替单 CPU）
- 一层 RLHF（让它听指令）

这些加起来就是 ChatGPT。不多，也不少。

---

## 一句话收尾

> **microgpt.py 是 GPT 的一张 "透视图"。**
>
> 你平时用 PyTorch 调 `.backward()` 看到的 "一行就完事"，在这里被摊开成你亲眼能看到的每一次乘法、每一次加法、每一次拓扑排序、每一次梯度累加。
>
> **一旦你在 200 行纯 Python 里把 GPT 跑通一次，后面无论看多大的模型、多花哨的工程优化，本质都逃不出这六个部分：数据、autograd、参数、前向、训练、推理。**

祝你玩得开心。

---

## 附录 A：一行一行的 "跟读" 顺序

如果你想从头跟读一遍，按这个顺序最顺：

1. 第 14-27 行：数据和分词（先知道输入长什么样）
2. 第 30-72 行：Value 类（理解这个再看其他的）
   - 30-37：字段定义
   - 39-46：运算符重载（+, *）
   - 47-57：其他算子和派生运算
   - 59-72：backward
3. 第 74-90 行：参数初始化（知道模型有多少参数）
4. 第 92-106 行：基础算子（linear、softmax、rmsnorm）
5. 第 108-144 行：gpt 主函数（**最难，慢慢看**）
   - 108-112：embedding
   - 114-134：attention 块
   - 135-141：MLP 块
   - 143-144：lm_head
6. 第 146-149 行：Adam 缓冲初始化
7. 第 151-184 行：训练循环
   - 153-158：取数据
   - 161-169：前向 + loss
   - 172：反向
   - 175-182：Adam 更新
8. 第 186-200 行：推理

---

## 附录 B：术语小词典

| 术语 | 中文 | microgpt 里对应什么 |
|------|------|--------------------|
| token | 词元 | 字符的 id (0-26) |
| vocabulary | 词表 | 27 个 token |
| embedding | 嵌入 | `wte` / `wpe` 的行 |
| hidden state | 隐藏状态 | `gpt()` 里的 `x` |
| layer | 层 | `for li in range(n_layer)` |
| head | 头 | `for h in range(n_head)` |
| parameter | 参数 | `params` list 里的 Value |
| gradient | 梯度 | `p.grad` |
| forward pass | 前向传播 | `gpt()` 的调用 |
| backward pass | 反向传播 | `loss.backward()` |
| loss / cost | 损失 | `loss.data` |
| logit | 未归一化对数概率 | `lm_head` 的输出 |
| softmax | 归一化指数 | `softmax()` 函数 |
| attention | 注意力 | 第 114-134 行 |
| Q / K / V | 查询/键/值 | `q`, `k`, `v` 变量 |
| KV cache | KV 缓存 | `keys`, `values` 列表 |
| residual | 残差 | `x + x_residual` |
| MLP / FFN | 多层感知机/前馈网络 | 第 135-141 行 |
| optimizer | 优化器 | Adam 更新那几行 |
| learning rate | 学习率 | `lr_t` |
| momentum | 动量 | `m`, `v` |
| epoch | 一轮数据 | 代码里没有严格的 epoch 概念，只有 step |
| step | 训练步 | `for step in range(num_steps)` |
| inference | 推理 | 第 186-200 行 |
| temperature | 温度 | `temperature = 0.5` |
| sampling | 采样 | `random.choices(...)` |

---

**完**

最后一次提醒：遇到不理解的地方，回到那一行代码，对照着本文的讲解，**慢慢看**。200 行代码，理解透了，胜过读 100 篇博客。
