# 内容地图 — 项目归类 / 系列 / 代表作 / 深讲优先级

> 基于 `project/` 全量阅读后的内容梳理,作为站点信息架构的内容依据。
> 配合 `SITE_PRD.md` 使用。

---

## 0. 进站项目筛选(已对齐)

**进站规则**:有完整 `final.mp4` + 有效时长的项目;同主题多版本只留最终版。

**排除项**:
- `demo` — 测试片段(2 章),非内容
- `vulkan` — 无完整视频(timing=0)
- `imu-cam-calib` 废弃 build(timing=0,另一个 build 正常,保留)
- `smallpt2` — 被 `smallpt2_remotion`(更新)取代
- `MyRender1` / `MyRender1_2` — 被 `MyRender1_3`(最新)取代

**最终进站:33 个项目**(原 36 个,排除 3 个 + 合并 4 个重复为 2 个最终版)。

---

## 1. 主题分类(四大主题域)

按内容实质归类(非按文件名)。每个主题域下设系列。

### 🎨 主题域 A:实时图形与渲染管线(15 个项目,主力)

软光栅 / 光线追踪 / SDF / Shader,从零实现渲染器的完整谱系。

| 系列 | 集数 | 项目 | 深度 |
|---|---|---|---|
| **A1. smallpt 路径追踪** | 3 集 | smallpt1(基础设施)、smallpt2_remotion(radiance 核心)、smallpt3(全貌+对比) | ⭐⭐⭐⭐⭐ 极硬核,渲染方程/蒙特卡洛/Snell/Fresnel 逐行推导 |
| **A2. Raymarching SDF** | 1 集 | Raymarching(从零到渲染器) | ⭐⭐⭐⭐⭐ SDF/Sphere Tracing/软阴影/AO/相机系统 |
| **A3. Ocean 海洋着色器** | 2 集 | ocean(几何与噪声)、ocean2(着色与业界方法) | ⭐⭐⭐⭐ Shader/噪声/FBM/菲涅尔/Gerstner/FFT |
| **A4. 软光栅器(URP 对照)** | 2 集 | urp1(光栅化基础)、urp2(材质阴影雾) | ⭐⭐⭐⭐ CPU 复刻 URP 管线,端到端对照 Unity |
| **A5. 软光栅器(MyRender)** | 1 集(留最终版) | MyRender1_3 | ⭐⭐⭐ 三角形→像素,CPU 无显卡渲染 |
| **A6. MyRender 进阶** | 1 集 | MyRender2(MVP 变换/裁剪/光栅化/深度) | ⭐⭐⭐⭐ |
| **A7. 引擎编译** | 1 集 | BuildUnreal(UE5 源码编译全流程) | ⭐⭐⭐ 引擎构建原理(UHT/UBT/模块/DDC) |

### 🚗 主题域 B:自动驾驶仿真与感知(7 个项目)

CARLA 仿真 + 端到端模型 + 传感器标定。

| 系列 | 集数 | 项目 | 深度 |
|---|---|---|---|
| **B1. CARLA × SparseDriveV2** | 6 集(EP01-06) | Carla1/2、Calrla3、Carla4/5/6/7 | ⭐⭐⭐⭐⭐ 含端到端模型架构(Deformable Aggregation/Factorized Vocab/Scoring)、闭环评测 |
| **B2. 传感器标定** | 2 集 | imu-cam-calib(IMU+相机联合标定)、kalibr(多相机标定) | ⭐⭐⭐⭐ 坐标系/内外参/Allan 方差/重投影误差/畸变模型 |

### 🤖 主题域 C:AI 与大模型(6 个项目)

LLM 训练原理 + AI Agent 工程。

| 系列 | 集数 | 项目 | 深度 |
|---|---|---|---|
| **C1. microgpt 200行看懂LLM** | 3 集 | microgpt1(训练/参数)、microgpt2(前向传播)、microgpt3(反向传播) | ⭐⭐⭐⭐⭐ Attention/Transformer/反向传播/Adam,原理与 GPT-4 对照 |
| **C2. AI 编程原理** | 3 集 | ai-codeing、ai-coding2、ai-coding3 | ⭐⭐⭐⭐ Agent 循环/工具调用/上下文压缩/MCP |

### 📡 主题域 D:音视频与并发工程(5 个项目)

WebRTC + 异步编程。

| 系列 | 集数 | 项目 | 深度 |
|---|---|---|---|
| **D1. WebRTC 实时音视频** | 2 集 | webrtc1(延迟与编解码)、webrtc2(封包与连接) | ⭐⭐⭐⭐⭐ RTP/RTCP/SRTP/ICE/NAL/H.264/SVC/Opus |
| **D2. async/await 并发** | 2 集 | sync1(本质与五语言对比)、sync2(Unity 实战 UniTask) | ⭐⭐⭐⭐ 状态机/SynchronizationContext/死锁/续体模型 |
| **D3.(单集)** | 1 集 | BuildUnreal *(注:此处已计入 A7,跨域归类,主归 A)* | — |

> BuildUnreal 跨"图形"与"工程",主归 A(引擎),首页可在工程标签下也露出。

---

## 2. 系列划分(共 10 个系列 + 若干单集)

进站的 33 个项目组织为以下系列:

| # | 系列 | 集数 | 项目成员(按观看顺序) | 系列定位 |
|---|---|---|---|---|
| 1 | smallpt:99 行路径追踪 | 3 | smallpt1 → smallpt2_remotion → smallpt3 | 从零拆解完整路径追踪器 |
| 2 | Raymarching:SDF 渲染器 | 1 | Raymarching | 距离场渲染全套 |
| 3 | Ocean:程序化海洋 | 2 | ocean → ocean2 | Shader 数学与业界方法 |
| 4 | 软光栅器对照实验 | 3 | urp1 → urp2;MyRender1_3;MyRender2 | CPU 复刻渲染管线 |
| 5 | 引擎构建 | 1 | BuildUnreal | UE5 源码编译 |
| 6 | CARLA × SparseDriveV2 | 6 | Carla1→2→(Calrla3)→4→5→6→7 | 自动驾驶仿真到端到端闭环 |
| 7 | 传感器标定 | 2 | imu-cam-calib、kalibr | 相机/IMU 标定原理与工具 |
| 8 | microgpt:看懂 LLM | 3 | microgpt1→2→3 | 200 行代码拆解语言模型 |
| 9 | AI 编程原理 | 3 | ai-codeing→2→3 | Agent 机制与工程 |
| 10 | WebRTC 实时通信 | 2 | webrtc1→2 | 低延迟音视频底层 |
| 11 | async/await 并发 | 2 | sync1→2 | 异步本质与 Unity 实战 |

**单集(无系列)**:无 —— 所有项目都能归入系列。

---

## 3. 代表作(每系列 1-2 集,首页置顶)

选取标准:技术深度最高 + 主题最完整 + 最能体现作者硬核能力。

| 系列 | 代表作 | 理由 |
|---|---|---|
| smallpt | **smallpt1** + smallpt2_remotion | smallpt1 是完美入门(渲染方程+求交推导);smallpt2_remotion 是技术高峰(radiance 逐行) |
| Raymarching | **Raymarching** | 唯一集,内容完整,19 章覆盖全套 |
| Ocean | **ocean2** | 含业界方法对比(Gerstner/FFT),深度更高 |
| 软光栅 | **urp2** + MyRender2 | urp2 阴影/球谐/色调映射最完整;MyRender2 MVP 推导清晰 |
| 引擎 | **BuildUnreal** | 唯一集,源码编译 + 构建系统原理 |
| CARLA | **Carla5** + Carla7 | Carla5 技术含量最高(模型架构);Carla7 是工程闭环(失败调试) |
| 标定 | **imu-cam-calib** | 联合标定原理深,23 章 |
| microgpt | **microgpt2** | Transformer/Attention 核心集 |
| AI编程 | **ai-coding3** | 进阶,含 20 行 Agent 实现 |
| WebRTC | **webrtc1** | 协议栈最全,延迟/编解码/抗丢包 |
| async | **sync1** | 五语言横向对比,洞察强 |

**首页置顶「精选 6 集旗舰」**(从上面挑最能打的):
1. **smallpt2_remotion** — 路径追踪核心(图形学旗舰)
2. **microgpt2** — Transformer 原理(AI 旗舰)
3. **Carla5** — 端到端模型架构(自动驾驶旗舰)
4. **webrtc1** — 实时音视频协议栈(音视频旗舰)
5. **Raymarching** — SDF 渲染器(渲染旗舰)
6. **imu-cam-calib** — 多传感器标定(感知工程旗舰)

---

## 4. 深讲优先级(501→实际进站约 450 个 block,先写哪些)

**原则**:不要求一次写完。按"代表作优先 + 高复用术语优先 + 难点优先"排序。

### P0 第一批(旗舰项目的核心难点 block)— 约 60 个 block

这些是"视频一闪而过、但网页能讲透"的高价值 block,优先扩展:

| 项目 | 优先深讲的 block | 为什么 |
|---|---|---|
| smallpt1 | 渲染方程简介 / Monte Carlo 积分 / 射线-球体求交几何推导 / 求交代码 | 数学推导,视频讲不透,网页放公式+代码 |
| smallpt2_remotion | Snell 定律推导 / Fresnel 方程与 Schlick / Russian Roulette / 漫反射 BRDF / 余弦加权采样 | 物理光学核心,公式密集 |
| microgpt2 | Q/K/V 注意力 / 打分与加权 / 多头 / 残差与 RMSNorm | Transformer 核心,矩阵运算适合静态深读 |
| webrtc1 | 为什么不能用 TCP / 拥塞控制 / 抗丢包三件套 / 抖动缓冲 / H.264 NAL 结构 | 协议细节,图+字段表最适合网页 |
| Carla5 | Deformable Aggregation / Factorized Vocabulary / Coarse-to-Fine Scoring | 模型架构,需配结构图+维度说明 |
| imu-cam-calib | 坐标系全景 / 噪声模型与 Allan 方差 / 联合标定原理 / 标定误差→测距误差 | 多坐标系变换,需图+公式 |
| Raymarching | SDF 组合操作 / Sphere Tracing / 软阴影 / 环境光遮蔽 | 算法步骤,配示意图+代码 |

### P1 第二批(系列其他集的关键 block)— 约 120 个 block
其余代表作及系列核心集的难点 block。

### P2 第三批(其余)— 剩余 block
浅讲或不扩展,保持"视频+旁白"即可。

### 高复用术语卡(优先建,全站受益)
这些术语在多个项目反复出现,**先建释义卡,全站加粗词联动复用**:
- 渲染域:BRDF / 蒙特卡洛 / 全局光照 / 菲涅尔 / 蒙特卡洛
- AI 域:Attention / Transformer / 梯度 / 交叉熵 / Softmax
- 信号域:RTP / NAL / 抖动 / SRTP / ICE
- 仿真域:闭环评测 / 端到端 / 标定 / 外参

---

## 5. 内容元信息待补(需作者最终确认)

- [ ] 系列的中文显示名(如 smallpt 系列叫"99 行看懂路径追踪"还是别的)
- [ ] 每个 project 的中文/英文正式标题(目前多为文件名如"Carla1")
- [ ] 每个系列的一句话简介(中/英)
- [ ] 代表作旗舰 6 集的最终确认
- [ ] 是否把 BuildUnreal 同时挂在"图形"和"工程"两个主题下
