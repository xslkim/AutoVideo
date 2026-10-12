# UPGRADE-2026 技术调研报告

> 升级框架的技术依据汇总。每条注明来源与落地分档：**可直接落地** / **需适配** / **观望**。
> 调研日期：2026-10-11。状态仅反映当日认知，执行前对「观望」项重新核实版本。

## 分档汇总

| 方向 | 技术选型 | 分档 | 详见 |
|------|----------|------|------|
| 渲染引擎 | Remotion 4.0.534 + 6 个新官方包 | ✅ 可直接落地（已完成） | §1 |
| Agent 技能 | remotion-dev/skills 官方规则，手工裁剪进 `.agents/skills/` | ✅ 可直接落地（已完成） | §2 |
| 组件库扩充 | spring/动力学排版/bento/图表生长/路径光点/morph/涂鸦批注/渐变/卡拉OK/转场 | ✅ 可直接落地（手法均有已装依赖支撑） | §3 |
| TTS 情感控制 | CosyVoice3 instruct（现有服务扩参）/ IndexTTS-2.5（新服务） | ⚠️ 一半可直接落地，一半需适配 | §4 |
| 字幕时间戳 | FunASR paraformer-zh 字级时间戳 | ✅ 可直接落地 | §5 |
| T2I 换底座 | Z-Image（开源 6B）/ GLM-Image（智谱） | ⚠️ Z-Image 可直接落地，GLM-Image 需适配 | §6 |
| aivideo 模式 | Seedance 2.x（闭源 API）/ Wan 2.6+（开源） | 👀 观望（只做 B-roll，不做知识点可视化） | §7 |
| 数字人口型 | EchoMimicV3 1.3B（AAAI 2026） | ⚠️ 需适配（候选替换 musetalk） | §8 |
| 几何质检 | SGA 式空间几何 QA（VLM 抽帧评审） | ⚠️ 需适配（无现成模型，方法论来自 Code2Video Critic） | §9 |
| 生成范式 | Code2Video 三 Agent 方法论 | ✅ 可直接落地（本项目已是同构架构） | §10 |

---

## 1. Remotion 4.0.534（渲染引擎底座）

**事实**：Remotion 4.0.534 是当前稳定线。本次升级新增 6 个官方包，全部为 MIT、与核心同版本：

| 包 | 能力 | 对应设计手法 |
|----|------|--------------|
| `@remotion/transitions` | `TransitionSeries` 场景转场（fade/slide/wipe/flip/clockWipe，linear/springTiming） | 场景转场 |
| `@remotion/captions` | `Caption` 类型、分页工具（`createTikTokStyleCaptions`） | 逐字卡拉OK字幕 |
| `@remotion/shapes` | Arrow/Circle/Star/Polygon 等参数化图形（支持 `effects`） | 图形元素、装饰 |
| `@remotion/paths` | `evolvePath`（描边生长）、`interpolatePaths`（图形 morph）、`getPointAtLength`（路径取点） | 路径光点、折线生长、morph |
| `@remotion/noise` | 确定性噪声（帧驱动，无墙钟） | 动态渐变/颗粒背景、手绘抖动 |
| `@remotion/animation-utils` | `makeTransform`、`interpolateStyles` | 变换拼接 |

核心动画 API 层面，4.x 的要点：`interpolate()` 支持 `output: "perceptual-scale"`（scale 感知补偿）、`posterize`（抽帧艺术效果）；`Easing.spring/bezier` 覆盖缓动个性需求。

- 来源：https://www.remotion.dev/docs/animation-utils 、https://github.com/remotion-dev/skills 内 `timing.md`/`transitions.md`（版本戳 4.0.534）、https://www.remotion.dev/blog（@remotion/noise、@remotion/paths 发布说明）
- **分档：可直接落地**（依赖已装，tsconfig.remotion.json 已通过）。

**未安装但相关**：`@remotion/rough-notation`（手绘批注 Highlight/Circle/Underline，https://www.remotion.dev/docs/text-highlights ）、`@remotion/effects`（vignette/lightLeak/glow 等帧驱动特效）。涂鸦批注是设计基准明确要的手法 → 建议补装 rough-notation（见 `docs/upgrade-2026/integration/skills-research-doc.md`）。

## 2. Remotion 官方 Agent Skills 安装机制（ visuals 阶段 Agent 的「规则供给」）

**机制**：Remotion 官方维护 `remotion-dev/skills` 仓库（含 remotion-markup / remotion-captions / remotion-best-practices 等 12 个 skill）。安装命令 `npx skills add remotion-dev/skills` 走的是 **Vercel Labs 开源的 skills CLI**（npm 包 `skills`，https://github.com/vercel-labs/skills ）：

- 项目级安装到 `./<agent>/skills/`：Kimi Code CLI / Codex / Cursor / OpenCode → `.agents/skills/`；Claude Code → `.claude/skills/`；默认 symlink 到一份 canonical copy（`--copy` 可复制实体），`-g` 装全局，`-a <agent>` 定向，`-s <skill>` 挑选。
- skill = 目录 + `SKILL.md`（YAML frontmatter 至少含 `name`、`description`）。

**本项目的处理**：不跑 npx（避免对共享依赖/目录的不可控写入），按 graphify skill 同款格式**手工裁剪**官方规则为 2 个 skill 并已落地：

- `.agents/skills/remotion-motion/SKILL.md` —— 动画时序与缓动、spring 预设、交错/旁白节拍、图表生长、路径光点/morph、转场、反 AI 默认美学红线；按本仓库 `tokens.ts`/`motion.ts`/`props.ts` 约定改写（帧驱动、spec 可序列化、subtitleSafeBottom 避让、只引用已装依赖）。
- `.agents/skills/remotion-captions/SKILL.md` —— `Caption` 结构、时间戳来源分档（TTS 行级 → FunASR 字级）、逐字高亮分页、CJK 无空格处理、底部安全区可读性红线。
- `.claude/skills/` 下放了同名 symlink，保证 claude CLI 后端同样能发现。

- 来源：https://www.remotion.dev/docs/ai/skills 、https://github.com/remotion-dev/skills 、https://github.com/vercel-labs/skills
- **分档：可直接落地（已完成）**。

## 3. 组件库扩充清单与设计手法依据

设计基准（2026 知识区水准）→ 实现路径映射，全部有已装依赖或本仓库 primitives 支撑：

| 手法 | 实现路径 | 依据 |
|------|----------|------|
| spring 物理动效 | `motion.ts` 的 `SPRINGS`（gentle/snappy/pop）+ `springIn()` | remotion `spring()` 官方语义；skills `timing.md` |
| 动力学排版（逐字入场） | 拆 char + `staggeredSpring`，translateY+opacity | remotion-markup skill 的 inline keyframe 范式 |
| 玻璃拟态 bento | `backdrop-filter: blur` + 半透明描边（同屏 ≤6 个，渲染开销） | 2026 设计基准；CSS 原生 |
| 图表生长 | `scaleY + transformOrigin: bottom`；折线用 `@remotion/paths` `evolvePath` | skills `timing.md`、paths 文档 |
| 路径引导流动光点 | `getPointAtLength` 取点 + 相位错开循环 | https://www.remotion.dev/docs/paths |
| 图形 morph | `interpolatePaths`（要求 path 命令兼容） | 同上 |
| 手绘涂鸦批注 | `@remotion/rough-notation`（**待补装**）；临时方案 = SVG path + `@remotion/noise` 扰动 + `evolvePath` | https://www.remotion.dev/docs/text-highlights |
| 动态渐变背景 | 帧驱动渐变坐标/透明度 + `@remotion/noise` 颗粒（≤0.08 透明度） | noise 包发布说明 |
| 逐字卡拉OK字幕 | `@remotion/captions` + FunASR 字级时间戳（§5） | captions skill + FunASR 文档 |
| 场景转场 | `TransitionSeries`（注意：转场重叠会缩短总时长，60+60−15=105 帧） | skills `transitions.md` |

同时落地了**反「AI 默认美学」红线**（写进 remotion-motion skill）：禁白底+紫渐变+圆角卡片三件套、禁全居中、阴影克制、每屏一个视觉主角。

- **分档：可直接落地**（除 rough-notation 补装这一项依赖动作）。

## 4. TTS 情感控制

### 4.1 CosyVoice3 / Fun-CosyVoice3-0.5B instruct —— 可直接落地

- Fun-CosyVoice3-0.5B（FunAudioLLM，2025-12 权重）：9 语种 + 18 中文方言；**instruct 模式**用自然语言指令（`instruct_text`，如「用兴奋的语气」「说慢一点」）控制风格/情绪/语速；zero-shot 3 秒克隆；双向 streaming 约 150ms 首包。
- 本项目 `third_servers/cosyvoice-tts` 已在跑 CosyVoice 链路 → 只需把 instruct 参数透传进服务 API 与 `tts` 阶段配置（可选字段，不破坏现有 provider 切换）。
- 来源：https://github.com/FunAudioLLM/CosyVoice 、https://huggingface.co/mlx-community/Fun-CosyVoice3-0.5B-2512-fp16 （instruct 模式参数表）、https://fun-audio-llm.github.io/
- **分档：可直接落地**（服务扩参 + 旁白稿加情绪标注）。

### 4.2 IndexTTS-2.5 —— 需适配

- 2026-08-10 发布：中/英/日/西/阿多语；**音色-情感解耦**的细粒度情感控制（可独立指定参考音色与情感来源/强度）；`duration_factor` 0.5–2.0 倍语速控制；拼音/音素级可控（中文拼音、英文 CMU、日文 Kana）；官方支持 vLLM 生产部署。
- 适配点：新增 `third_servers/indextts-tts` 脚手架 + 一套情绪标签体系映射到 narration.md 标注；情感参考音频资产管理是新增概念。
- 来源：https://github.com/index-tts/index-tts 、https://arxiv.org/abs/2601.03888 、https://www.modelscope.cn/models/IndexTeam/IndexTTS-2.5 、https://recipes.vllm.ai/IndexTeam/IndexTTS-2.5
- **分档：需适配**（作为 cosyvoice 之外的第二 provider 候选；先用 CosyVoice3 instruct 拿到 80% 收益）。

## 5. FunASR 字级时间戳 —— 可直接落地

- FunASR `paraformer-zh` **原生输出字级时间戳**（每个字 `[起始ms, 结束ms]`），一次调用即得，无需 DTW 后验；这正是逐字卡拉OK字幕需要的数据。中文 CER 公开集约 4–7%，优于 Whisper 系（5–8%）且 Whisper 的词级时间戳是后加的、精度一般。
- 用法：对 TTS 产出的每行 WAV 回扫 paraformer-zh → 逐字 Caption（`@remotion/captions` 类型）→ 写入 `block.audio` 的可选字段；同时可用于 TTS QA（对齐校验、爆音段定位）。
- 来源：https://www.funasr.com/blog/speech-to-text-timestamps-python.html 、https://www.funasr.com/blog/which-funasr-model.html 、https://github.com/modelscope/FunASR
- **分档：可直接落地**（CPU 可跑，接入 tts 阶段后处理；不动 schema 必填字段）。

## 6. T2I 换底座：Z-Image / GLM-Image

### 6.1 Z-Image（阿里 Tongyi-MAI）—— 可直接落地

- 2025-11-27 开源：6B 单流 DiT，**中英双语文字渲染**准确（教学插图/海报里的汉字是硬需求），视觉质量接近 20B 级商业模型；Z-Image-Turbo 1 秒出图、资源占用低，自托管门槛低。
- 替换 `third_servers/sensenova-t2i` 的默认底座，或并列 provider；接口形态不变（prompt → PNG）。
- 来源：https://github.com/Tongyi-MAI/Z-Image 、https://news.aibase.com/zh/news/23158 、https://zimage.design/zh/blog/getting-started-with-z-image/
- **分档：可直接落地**。

### 6.2 GLM-Image（智谱 × 华为）—— 需适配

- 2026-01-14 开源：原创「自回归 + 扩散解码器」混合架构，全程国产芯片训练；主打**汉字生成准确性**与海报/PPT 类强排版场景——与教学图场景高度重合。
- 适配点：权重/推理栈与现有 GPU 预算的匹配评估；也可先走智谱开放平台 API（按量计费）做质量验证，再决定自托管。
- 来源：https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image 、https://modelscope.csdn.net/69684536ea53844658f6ec2e.html
- **分档：需适配**（先 API 试质，再定自托管）。

## 7. aivideo 模式：Seedance / Wan —— 观望

- **Seedance 2.0**（字节，2026-02）：首个原生音视频同步生成的主流通用模型；2.5 已在即梦上线，「全能参考」模式可吃多张参考图。仅闭源 API。
- **Wan 2.6/2.7**（阿里）：开源线持续追平闭源，I2V 细节还原已达可用水准；2.7 偏 image-first 发布。
- 判断：教学视频的**知识点可视化**要求结构精确、可复现、可改稿——像素级 T2V 天然不保证（Code2Video 论文的核心论点，见 §10）。aivideo 模式定位只能是 B-roll 空镜/氛围镜头，且引入外部 API 成本与审核依赖。
- 来源：https://arxiv.org/abs/2510.01174 （Code2Video 动机部分）、https://blog.laozhang.ai/zh/posts/wan-2-7-vs-seedance-2-0 、https://unifuncs.com/s/eFzAF5vb
- **分档：观望**（预留 provider 接口形态即可，不进主流水线）。

## 8. EchoMimicV3（数字人口型升级候选）—— 需适配

- 蚂蚁集团，AAAI 2026：**1.3B** 参数统一多模态多任务人体动画框架；口型对齐效果与专用数字人方案相当并超过主流方法（论文自述），多任务（T2A/A2A/编辑）一个模型。
- 现状：`third_servers/musetalk-lipsync` 在用。EchoMimicV3 作为升级候选需要：部署验证（显存/吞吐）、与现有头像资产（head128x128.mp4 / avatar.mp4）的输入格式对接、长音频分块策略。
- 来源：https://github.com/antgroup/echomimic_v3 、https://arxiv.org/abs/2507.03905 、https://www.modelscope.cn/models/BadToBest/EchoMimicV3
- **分档：需适配**（先脚手架 + 小样验证，不替换现有链路）。

## 9. SGA 几何 QA —— 需适配

- 「SGA」无公认公开定义；按本次升级语境理解为 **Spatial Geometry QA（渲染帧空间几何质检）**：对抽帧截图做布局质量检查——元素重叠/越界/字幕带入侵/对比度不足/文字溢出。
- 方法论依据是 Code2Video 的 **Critic agent**：VLM + visual anchor prompts（在截图上打参考网格/锚点再让 VLM 评审）精修空间布局（见 §10）。落地形态 = 确定性几何检查器（组件上报 bounding box，纯计算判重叠/越界）+ VLM-as-Judge 抽帧评审（美学与语义层），混合而非全靠 VLM。
- 来源：https://arxiv.org/abs/2510.01174 （Critic 节）；VLM-as-a-Judge 通用实践
- **分档：需适配**（方法清晰、无现成模型；建议先做确定性检查器，VLM 评审作为可选增强）。
- ⚠️ 若任务书里「SGA」另有所指（如某具体模型/产品），以此条为占位，执行前与任务发起方对齐。

## 10. Code2Video 方法论 —— 可直接落地

- 论文（arXiv 2510.01174，2025-10，NUS Show Lab）：**code-centric** 教学视频生成框架——可执行代码是教学视频的天然载体（结构精确、可复现、可编辑），三 Agent 分工：**Planner**（把讲义组织成时间连贯的分镜流 + 备资产）、**Coder**（指令→可执行代码，scope-guided auto-fix 限定修复范围提效）、**Critic**（VLM + visual anchor prompts 精修空间布局）。评测：MMMC 基准 + **TeachQuiz**（让「unlearn」过的 VLM 看视频答卷，端到端量化教学效果）+ VLM 美学分。结果：比直接代码生成 +40%，接近人工教程水准。
- **本项目已是同构架构**：compile≈Planner、visuals「组装优先 + 自由生成回退」≈scope-guided Coder（预制组件库就是 scope 限定）、双角色评审≈Critic。可直接吸收的三点：① Critic 的 visual anchor prompts 技巧用于 §9 几何 QA；② TeachQuiz 思路用于验收（让 VLM 看片答知识点）；③ scope-guided auto-fix 的报错修复边界写入 visuals 失败重试策略。
- 来源：https://arxiv.org/abs/2510.01174
- **分档：可直接落地**（方法论层面，无需新依赖）。

---

## 附：执行注意事项

1. 所有新依赖只走集成 Agent 统一改 `package.json`；组件/服务任务一律假定「已装依赖 = §1 表格六包 + remotion 核心」。
2. 新增配置全部走环境变量或可选字段，不破坏现有类型与 web 端。
3. 「观望」项（aivideo）不进主流水线，避免外部 API 成本与不可复现性污染教学视频的质量基线。
