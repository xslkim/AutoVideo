---
name: remotion-motion
description: "写/改 AutoVideo 视觉组件 TSX（visuals 阶段、remotion/library/ 预制组件、src/blocks 自由生成回退）时必用：帧驱动动画时序与缓动、spring 预设、交错入场、图表生长、路径光点/morph、场景转场、动态背景。汇聚 Remotion 官方 remotion-markup 最佳实践并按本仓库 tokens/motion/props 约定裁剪。"
---

# remotion-motion — AutoVideo 动画与转场最佳实践

为 AutoVideo 的 visuals 阶段写 Remotion TSX 时遵循本 skill。来源：Remotion 官方 agent skills（`remotion-dev/skills` 的 remotion-markup / transitions，v4.0.534），已按本仓库约定改写；冲突时以本文件为准。

## 铁律（违反 = 渲染不确定或 sandbox 校验失败）

1. **一切动画帧驱动**：用 props 传入的 `frame`/`fps`（自由生成组件里也可 `useCurrentFrame()`/`useVideoConfig()`）。严禁 `Date.now()`、`performance.now()`、CSS `transition`/`animation`、framer-motion/anime.js 等墙钟库。
2. **严禁 `Math.random()`**。需要随机感时用确定性伪随机（以 index/seed 为输入的 hash PRNG），保证每次渲染同一帧结果一致。
3. **spec 必须 JSON 可序列化**：无函数、无 ReactNode、无 class 实例（会被 `JSON.stringify` 内联进机器生成的 wrapper）。
4. **字号/间距/时长走 tokens**：`typeSize(height, token)`、`space(height, units)`、`LAYOUT`、`DUR` + `frames(sec, fps)`，禁止拍脑袋像素值。颜色一律 `props.theme.colors` / `theme.fonts`，accent 可用 `spec.accent` 覆盖。
5. **底部避让**：内容不得进入底部字幕带，可用高度 = `availHeight(height, subtitleSafeBottom)`。
6. **import 约定**：value import 不带扩展名（`./tokens`），type import 带 `.js`（`../engine/types.js`）。
7. **根节点不进出场淡入淡出**：block 级 enter/exit 由 BlockFrame 负责；组件内部元素自己做 staggered 入场，需要谢幕用 `exitProgress()`（反向 stagger）。

## 时序与缓动

### 插值范式

```ts
// 0→1，0.3s，两端 clamp（不写 clamp 值会飞出 [0,1]）
const p = interpolate(frame - delayFrames, [0, frames(0.3, fps)], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing: EASE.enter, // 或 Easing.bezier(0.16, 1, 0.3, 1)
});
```

- 缓动优先用 `remotion/library/motion.ts` 的 `EASE`：`enter`（快起慢落，入场）、`exit`（慢起加速，离场）、`inOut`（对称，描边/脉冲）。
- 需要个性时用 `Easing.bezier(...)`；入场推荐 `(0.16, 1, 0.3, 1)`（easeOutExpo 系）。
- **scale 动画加感知补偿**：`interpolate(..., { output: "perceptual-scale" })`（Remotion 4 新参数），否则大缩放视觉上后半程变慢。
- 多关键帧：`interpolate(frame, [0, a, b, c], [0, 1, 1, 0], { easing: [e1, e2, e3], ... })`，easing 数组长度 = 段数。

### Spring 预设（motion.ts `SPRINGS`）

| 预设 | 性格 | 用在哪 |
|------|------|--------|
| `gentle`（damping 200） | 慢、无过冲 | 大面板、hero 标题、卡片整体入场 |
| `snappy`（damping 26, stiffness 170） | 脆、轻微过冲 | 列表行、图表柱子、节点、流程图元素 |
| `pop`（damping 13, stiffness 240） | 俏皮弹跳 | 徽章、对勾、小装饰 |

```ts
const p = springIn(frame, fps, delayFrames, "snappy"); // 0→1 spring
// 注意：snappy/pop 会过冲 >1 —— opacity 必须 clamp（Math.max(0, Math.min(1, p))），scale 直接用更生动
```

### 时长 tokens（DUR，单位秒，用 `frames(x, fps)` 换算）

`snapSec 0.35`（发丝线/小装饰）· `enterSec 0.6`（标准入场）· `heroSec 0.9`（重量级 hero）· `staggerSec 0.12`（兄弟交错步距）· `staggerDenseSec 0.05`（密集列表/代码行）· `exitSec 0.5`（谢幕尾窗）。

### 交错与旁白节拍

- 兄弟元素：`staggeredSpring(frame, fps, index)` 或 `springIn(frame, fps, staggerDelay(i, frames(DUR.staggerSec, fps)))`。
- 逐字/逐行入场（动力学排版）：把文本拆 char/line，逐个字 `springIn` + 递增 delay；每字 translateY + opacity，中文优先按字拆。
- **跟旁白走**：`resolveBeatSchedule(lineTimings, count, durationSec)` 把 TTS 行级时间映射成每个视觉元素的节拍窗，`activeIndexAt(schedule, tSec)` 取当前应高亮的 index（对不齐时均匀摊开，不会卡在最后一句）。讲解什么就亮什么，这是教学视频的第一动效原则。

###  idle 微动

`breathe(frame, fps, { periodSec, min, max, phase })` —— 正弦呼吸，多元素用不同 `phase` 错开，别同步脉冲。适合发丝线辉光、背景渐变强度、装饰点。

## 组件手法速查

### 图表生长（DataBars 类）

- 柱子：`scaleY(p)` + `transformOrigin: "bottom"`（不要改 height，会引发布局抖动）。
- 数字滚动：对数值做 `interpolate` 后 `Math.round`，与柱同一 progress。
- 折线/描边生长：SVG path + `strokeDasharray`/`strokeDashoffset`，或用 `@remotion/paths` 的 `evolvePath(path, progress)`（已安装）拿 dash 值，直接驱动。

### 路径引导流动光点

`@remotion/paths`（已安装）：`getPointAtLength(path, len)` 取点 → 光点 cx/cy；`evolvePath` 做主路径 draw-on；多个光点用相位错开的 `len = (frame * speed + i * gap) % totalLen`。flow 连线、数据流向动画都用这套。

### 图形 morph

`@remotion/paths` 的 `interpolatePaths(from, to, progress)`（两条 path 的 `d` 插值）。前提：两条 path 命令结构兼容；进度用 `EASE.inOut`。适合图标形态转换、形状讲故事。

### 手绘涂鸦批注

`@remotion/rough-notation` **未安装**（集成清单里有，装好后用 `<Highlight>/<Circle>/<Underline>` + `progress` 帧驱动）。现阶段替代：SVG path 手绘感 = 直线路径叠加 `@remotion/noise` 的确定性噪声扰动控制点，`evolvePath` 做画出来的过程。

### 动态渐变背景

- 帧驱动渐变位/色：`interpolate(frame, ...)` 改 `radial-gradient(at x% y%)` 的坐标或 stop 透明度；配合 `breathe` 做缓慢流动。
- 颗粒/纸感：`@remotion/noise`（已安装）生成确定性噪声纹理叠加，低透明度（≤0.08）。
- 玻璃拟态 bento 卡片：`background: color-mix(in srgb, ${theme.colors.fg} 6%, transparent)` + `backdrop-filter: blur(...)` + 1px 半透明描边。**注意 backdrop-filter 在渲染时开销大，同屏玻璃卡片 ≤6 个。**

## 场景转场（@remotion/transitions，已安装）

块内多场景用 `TransitionSeries`：

```tsx
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
// slide/wipe/flip/clockWipe 同理：@remotion/transitions/slide 等

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={frames(2, fps)}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: frames(0.5, fps) })}
  />
  <TransitionSeries.Sequence durationInFrames={frames(2, fps)}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>
```

- 转场重叠相邻场景：**总时长 = 各场景之和 − 各转场时长**（60+60−15=105 帧）；`<TransitionSeries.Overlay>`（如光泄漏）不占用时长。
- `springTiming({ config: { damping: 200 }, durationInFrames })` 得有机转场；`linearTiming` 得匀速。
- **AutoVideo 现状**：block 之间是独立 partial + ffmpeg concat，跨块转场取决于 engine 支持；块内场景切换可直接用。别把转场当万能药——教学视频以硬切 + 内容错峰入场为主，转场只在章节转换处用一次。

## 反「AI 默认美学」红线

- 禁止「白底 + 紫渐变 + 圆角卡片」三件套；背景色用 `theme.colors.bg`，强调色用 `theme.colors.accent`，不要默认紫。
- 禁止所有元素居中：用 `LAYOUT.marginXPct`、`measurePct` 控制栏宽，左对齐/网格/bento 混排。
- 阴影克制：最多一层低透明度投影，优先用 1px 描边 + 层次背景区分层级。
- 每屏一个视觉主角；装饰元素（角标、发丝线、噪点）透明度压到 0.07–0.35。

## 写完自查

1. `npx tsc -p tsconfig.remotion.json` 通过。
2. 全文搜一遍：`Date.now|Math.random|transition:|animation:` 必须为零（CSS 属性里的 `transform` 可以）。
3. 所有动画输入能追溯到 `frame`/`fps`/`lineTimings`；spec 能 `JSON.stringify` 往返。
4. 内容不进入底部字幕带；spring 过冲没打在未 clamp 的 opacity 上。
