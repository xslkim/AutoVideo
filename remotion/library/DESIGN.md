# AutoVideo 设计系统（DESIGN.md）

> **本文件是规范性的（normative）**。它同时服务两类读者：
> 1. visuals 阶段的 LLM —— 本文件全文会被注入生成 prompt（见 `src/ai/component-gen.ts` / `src/ai/assembly-gen.ts`）；
> 2. 预制组件作者 —— 写 `remotion/library/components/` 下新组件时必须遵守。
>
> 数值的唯一来源是 `tokens.ts`（TYPE / LAYOUT / DUR / ELEVATION / GRADIENTS / STAGGER），颜色与字体的唯一来源是 `props.theme`。本文件定义的是**搭配纪律**：什么时候用哪一档、用多少、不能怎么用。改数值去 tokens.ts，不要在这里抄数值。

---

## 1. 字体阶梯与字重搭配

字级（`typeSize(height, token)`，系数 × 屏高，1080p 参考值）：

| token | 系数 | ≈px@1080p | 用途 | 字重 |
|---|---|---|---|---|
| display | 0.104 | 112 | Hero 大标题、超大数字（signature 元素专用） | 700 |
| title | 0.058 | 63 | 内容屏标题 | 700 |
| subtitle | 0.036 | 39 | 标题下导语、副标题 | 400 |
| body | 0.027 | 29 | 正文、列表项、节点标签 | 400–500 |
| code | 0.023 | 25 | 代码行（mono） | 400 |
| caption | 0.020 | 22 | 正文下的补充说明 | 400 |
| label | 0.017 | 18 | kicker、徽章、坐标刻度（mono） | 500 |

纪律：

- **一屏至多 3 个字级**（label 不计）。层级靠字级差 + 字重差制造，主标题与正文至少相隔 2 级；**禁止全靠颜色区分层级**。
- 字重搭配：标题 700 / 正文 400 / 行内重点词 600 + accent 色。不用斜体、不下划线。
- kicker / label 用 `theme.fonts.mono` + `letterSpacing: 0.1–0.16em`；display/title 用 `letterSpacing: -0.02em` 收紧；正文不加字距。
- 硬底线（覆盖视觉描述）：可见文字 ≥ 屏高 × 0.028，主标题 ≥ 屏高 × 0.07。装不下就删内容或拆屏，**绝不缩字号**。
- 中文优先；中西文混排时西文/数字落在 mono 或 accent 色上形成点缀。

## 2. 留白节奏

- 一切间距走 8px 网格：`space(height, units)`；外边距 `width × LAYOUT.marginXPct`（6.25%）。
- **组内紧凑、组间舒展**：同一信息组内部 2–3 units，组与组之间 5–8 units。节奏对比本身就是在传达分组关系。
- 内容列顶部 ≈ 可用高度 × `LAYOUT.contentTopPct`（14%）；hero 块的视觉中心在 `LAYOUT.heroCenterPct`（44%，略偏上）——**不要几何居中**。
- 相邻元素纵向间距 ≥ 屏高 × 0.02；长文本宽度 ≤ `LAYOUT.measurePct`（72%）。
- 底部 `subtitleSafeBottom` 是字幕禁区：所有纵向计算从 `availH = height - subtitleSafeBottom` 出发。
- 深底色 + 充足留白是默认质感：**宁可空，不可挤**。

## 3. 色彩语义

颜色一律从 `props.theme` 取（bg / fg / accent / muted / code.*），语义色用下表（与 dark-code 主题同族）：

| 角色 | 取值 | 用途 | 面积纪律 |
|---|---|---|---|
| 主色 | `theme.colors.bg` / `fg` | 底色与主文字 | ≥ 85% |
| 强调 | `theme.colors.accent` | 当前焦点、关键数字、hairline、signature 元素 | ≤ 10% |
| 次要 | `theme.colors.muted` | 次要文字、未激活项、坐标轴 | — |
| 成功 | `#3fb950` | 完成、正确、正向增长 | 仅状态语义 |
| 警示 | `#d29922` | 需要注意、中间态 | 仅状态语义 |
| 危险 | `#f85149` | 错误、风险、下降 | 仅状态语义 |

纪律：

- **每屏色相 ≤ 2**：accent + 至多一个语义色。语义色只服务状态，不做装饰。
- 需要第二个"彩色"时，先用 accent 的透明度阶梯（0.35 / 0.6 / 1）或 muted，而不是引入新色相。
- 渐变只能用 `GRADIENTS` 里的成对色（`gradient("brand")` 等），用于小面积：进度填充、关键数字描边、路径光点辉光、图表填充。**禁止整屏渐变铺底；禁止蓝→紫渐变**（AI 默认美学头号特征）。
- 阴影走 `ELEVATION`（`elevation(height, level)`）：深色主题优先用明度差 + 1px hairline 分层，`flat` 是默认，`raised` 给卡片，`overlay` 只给真浮层。**一屏最多一层带阴影**。

## 4. 每屏信息密度上限

- **一屏一个核心观点**。讲两件事就拆成两屏。
- 列表 / 节点 / 柱状条：**2–6 项**（注册组件的硬限制）。
- 文案长度：标题 ≤ 20 个 CJK 字，条目标签 ≤ 12，详情行 ≤ 30。砍字，不堆字。
- 每屏可见文字总量 ≤ 约 120 个 CJK 字；视觉分组 ≤ 5 组。
- 内容覆盖率（可见元素包围盒 / 可用面积）：**60%–85%**。低于 60% 放大元素（不是加元素），高于 85% 删内容。
- 超过上限的正确做法：拆 block、交给下一屏，或者把细节留给旁白——**画面不复读旁白全文**。

## 5. Signature 视觉元素（每屏恰好一个）

每屏必须有且仅有一个"记忆点"——观众闭眼后能复述的那个元素。候选形态：

- **超大数字**：display 字级（≥ 25% 屏高）的单个数字/百分比，配 accent 描边或渐变填充。
- **贯穿图形**：全片统一的 motif——accent hairline、进度条、节点连线——在每屏以不同形态出现，结尾屏回收开场形态形成闭环。
- **路径引导流动光点**：`evolvePath` 生长路径 + 沿路径运动的光点，把注意力从 A 引到 B。
- **生长图表**：柱状/折线随旁白逐 beat 生长（`resolveBeatSchedule` + `activeIndexAt`）。
- **逐字/逐行高亮**：卡拉OK 式 accent 高亮，严格跟随 `lineTimings`。
- **图形 morph**：`interpolatePaths` 让核心图形在两态之间形变。

纪律：signature 元素是唯一允许"抢眼"的东西，其余元素服务它、让路给它；一屏两个记忆点 = 没有记忆点。

## 6. 动效节奏

- 入场一律 `spring()`：大面板/hero 用 `SPRINGS.gentle`，列表/节点/条用 `snappy`，徽章/对勾用 `pop`。时长走 `DUR`（enter 0.6s / hero 0.9s / 退出尾窗 0.5s），`frames(sec, fps)` 换算。
- 兄弟元素错峰走 `STAGGER` 预设（normal / dense / hero / cascade），交给 `staggeredSpring` / `staggerDelay`。**≥ 3 个组必须从不同延迟开始**（禁止齐步走）。
- hold 期间保留一个呼吸级微动效（`breathe()`：accent 明灭、光标闪烁、缓慢漂移），让画面"活着"但不抢戏。
- 退出：最后 ~15% 帧内错峰收束（`exitProgress`），BlockFrame 负责整帧淡入淡出，组件内不重复做。
- 旁白驱动的节拍一律读 `props.lineTimings`（锚定最后一个 `startSec ≤ t` 的行），**严禁硬编码时间戳**。
- 禁止无缓动的匀速直线位移；`interpolate()` 的 inputRange 必须是常量帧值。

## 7. 背景与质感

- 底色 = `theme.colors.bg` 纯色铺满全帧（含字幕区）。
- 至多**一层**氛围处理，不透明度 ≤ 0.08：radial accent  wash（参考 TitleCard 左上角）、细网格、微弱噪点。氛围是衬底，不是内容。
- 玻璃拟态 / bento 栅格可以用，但必须有明确层级（一个主格 + 若干次格），且玻璃底下要有真实内容可透——**禁止等大卡片矩阵 + 空背景上的 backdrop-blur 装高级**。
- 质感三选一的纪律：hairline 分隔、明度差分层、`ELEVATION` 阴影——一屏只用一种主手段。

## 8. 明确禁用：「AI 默认美学」清单

以下模式是本设计系统的**红线**，生成或评审时发现即返工：

1. 白底 + 紫（蓝紫）渐变 + 圆角卡片三件套。
2. Inter / Roboto / 系统默认 sans 的无字体策略排版——字体必须走 `theme.fonts`。
3. 千篇一律的 `box-shadow` 浮卡：每个元素都带大阴影、都圆角、都悬浮。
4. 一切居中：标题、正文、图标、图表全部水平居中的"海报病"。对齐方式要服务内容结构（hero 可居中，内容屏默认左对齐列）。
5. 无信息层级：满屏同字号同字重同颜色，或所有元素一样大。
6. 用 emoji 充当图标或装饰。
7. 无意义装饰：发光球、飘浮粒子、与内容无关的几何图形堆叠。
8. 彩虹 / 多色相渐变，蓝→紫渐变。
9. 对称等大的 3 卡片横排矩阵（内容天然三分时也要有主从之分）。
10. 画面复读旁白全文、把字幕当正文抄上屏。

## 9. 每屏自检清单

生成/评审任何一屏之前，逐条过一遍：

1. 一屏是否只有一个核心观点？信息密度在 §4 上限内？
2. 字级 ≤ 3 档，主标题与正文相差 ≥ 2 级？字重搭配符合 §1？
3. 色相 ≤ 2（accent + 至多一个语义色）？accent 面积 ≤ 10%？
4. 有且仅有一个 signature 视觉元素？其余元素在为它让路？
5. 间距走 `space()` 网格，组内紧凑组间舒展，没有几何居中堆砌？
6. ≥ 3 组元素错峰入场？hold 期有微动效？退出有错峰收束？
7. 旁白跟随走 `lineTimings`？无硬编码时间戳、无 `Date.now` / `Math.random`？
8. 背景只有纯色 + ≤ 一层低透明度氛围？无紫渐变、无浮卡三件套？

## Remotion best-practice skills（写 TSX 前必读）

- `.agents/skills/remotion-motion/SKILL.md` —— 帧驱动动画时序与缓动、spring 预设、交错/旁白节拍、图表生长、路径光点/morph、转场、反 AI 默认美学红线。
- `.agents/skills/remotion-captions/SKILL.md` —— Caption 数据结构、逐字卡拉OK 高亮、CJK 字幕分页、底部安全区规范。

两文件与本 DESIGN.md 冲突时，以 DESIGN.md + tokens.ts/motion.ts 代码为准。
