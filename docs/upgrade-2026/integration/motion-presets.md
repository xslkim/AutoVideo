# 集成笔记 — motion-presets（动效预设升级）

> 负责文件：`remotion/library/motion.ts`、`remotion/engine/types.ts`、`remotion/engine/block-frame.tsx`
> 日期：2026-10-11

## 已完成（本任务内）

- `remotion/library/motion.ts` **只增不改**，新增「Modern animation presets」一节：
  - `PresetStyle` 接口（`opacity?/transform?/filter?/clipPath?`，可结构赋值给 `React.CSSProperties`）
  - `blurInStyle(visibility)` — blur 12px→0 + 淡入
  - `maskRevealStyle(visibility, direction = "up")` — clip-path inset 揭开；`"up"` 下至上、`"left"` 左至右
  - `zoomSettleStyle(visibility)` — scale 1.06→1 + blur 6px→0，opacity 前 60% 完成
  - `slideMaskStyle(visibility, direction = "left")` — 48px 位移 + 同轴 clip 扫过复合
  - 方向类型 `MaskRevealDirection = "up" | "left"`、`SlideMaskDirection = "left" | "right"`
  - 约定：入参 `visibility` 为**调用方已缓动**的可见度（0 隐藏 / 1 落定），enter 传 `ENTER_EASING(progress)`，exit 传 `1 - EXIT_EASING(progress)`，退场天然是入场的镜像。
- `remotion/engine/types.ts` 的 `AnimationPreset` 新增 4 个字面量（**kebab-case，与现有预设一致**）：
  `"blur-in" | "mask-reveal" | "zoom-settle" | "slide-mask"`
- `remotion/engine/block-frame.tsx` 的 `getEnterStyle`/`getExitStyle` 各新增 4 个 case，调用上述 resolver（默认值：mask-reveal 用 `"up"`，slide-mask 用 `"left"`）。
- 验证：`npx tsc -p tsconfig.remotion.json` 通过。

## 需要集成 Agent 做的共享文件改动

### 1. `src/types/script.ts` — `ANIMATION_PRESETS` 数组追加

```ts
export const ANIMATION_PRESETS = [
  "fade",
  "fade-up",
  "fade-down",
  "slide-left",
  "slide-right",
  "zoom-in",
  "zoom-out",
  "blur-in",
  "mask-reveal",
  "zoom-settle",
  "slide-mask",
  "none",
] as const;
```

### 2. `src/parser/directives.ts` — `VALID_PRESETS` 追加（第 40–49 行）

```ts
const VALID_PRESETS: readonly string[] = [
  "fade",
  "fade-up",
  "fade-down",
  "slide-left",
  "slide-right",
  "zoom-in",
  "zoom-out",
  "blur-in",
  "mask-reveal",
  "zoom-settle",
  "slide-mask",
  "none",
];
```

### 3. `schemas/script.schema.json` — `blocks[].enter` / `blocks[].exit` 枚举（第 100–107 行）

两处都改为：

```json
"enum": ["fade", "fade-up", "fade-down", "slide-left", "slide-right", "zoom-in", "zoom-out", "blur-in", "mask-reveal", "zoom-settle", "slide-mask", "none"]
```

### 4. `remotion/library/index.ts` — motion 桶导出追加（本任务按规则未注册）

```ts
export {
  EASE,
  SPRINGS,
  clamp01,
  enterProgress,
  springIn,
  staggerDelay,
  staggeredSpring,
  breathe,
  exitProgress,
  resolveBeatSchedule,
  activeIndexAt,
  blurInStyle,
  maskRevealStyle,
  zoomSettleStyle,
  slideMaskStyle,
} from "./motion";
export type {
  SpringPreset,
  BeatWindow,
  PresetStyle,
  MaskRevealDirection,
  SlideMaskDirection,
} from "./motion.js";
```

### 5. `web/src/components/block/BlockPanel.vue` — `ANIM_OPTIONS` 追加（第 91–100 行）

```ts
{ label: '聚焦', value: 'blur-in' },
{ label: '揭开', value: 'mask-reveal' },
{ label: '落定', value: 'zoom-settle' },
{ label: '滑揭', value: 'slide-mask' },
```

（插在 `'zoom-out'` 行之后、`'none'` 行之前。）

### 6. `docs/guidelines/AUTHORING.md` — 预设表与清单更新

§2.3 「动画预设值」表格（第 183–192 行）追加：

```markdown
| `blur-in` | 模糊聚焦 + 渐显 |
| `mask-reveal` | clip-path 掩码揭开（下至上） |
| `zoom-settle` | 轻微缩放落定 1.06→1 + 模糊收敛 |
| `slide-mask` | 位移 + 掩码复合滑入（从左） |
```

文末检查清单第 6 条（约第 762 行）改为：

```markdown
6. **动画预设值**必须是：`fade` `fade-up` `fade-down` `slide-left` `slide-right` `zoom-in` `zoom-out` `blur-in` `mask-reveal` `zoom-settle` `slide-mask` `none`
```

## 注意事项

- **命名映射**：motion.ts 函数是 camelCase（`blurInStyle` 等），预设字面量是 kebab-case（`blur-in` 等）——与现有 `fade-up`/`zoom-in` 约定一致。作者写 `@enter: blur-in`。
- 新预设作用于整个 BlockFrame 包裹层（含字幕层），与现有 `fade` 行为一致。
- `blur-in` / `zoom-settle` 用 `filter: blur()`，过渡期间有 GPU 开销；时长为现有 enter/exitFrames（约 0.5s/0.3s），影响可忽略。
- `mask-reveal` / `slide-mask` 用 `clip-path: inset()`，块内容在遮罩边缘下已是最终像素（无透明度渐变），这是预期效果。
- `tests/types/readiness.test.ts` 只验证非法预设被拒绝，不受枚举扩展影响；未发现快照包含预设列表字符串。
- src 侧改动（第 1–3 项）完成后请跑 `npm run build` 与 `HOME=/tmp/fakehome npx vitest run tests/parser tests/types` 确认。
