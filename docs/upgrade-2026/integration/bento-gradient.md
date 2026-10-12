# 集成事项 — bento-gradient（BentoGrid + GradientStage）

来源任务：`bento-gradient`。新增组件文件已就位，**未**在任何共享文件注册：

- `remotion/library/components/BentoGrid.tsx` — 玻璃拟态便当格（2–4 卡，spring overshoot stagger，旁白节拍点亮）
- `remotion/library/components/GradientStage.tsx` — 动态 mesh 渐变基底场景（正弦轨迹色团 + @remotion/noise 颗粒层 + 可选网格/暗角）

验证：`npx tsc -p tsconfig.remotion.json` 通过；135 项 SSR 冒烟断言（布局×数量×blur×帧、确定性）全过。

## 1. `remotion/library/index.ts` 追加导出（照抄）

在组件 export 区追加（value 无扩展名，type 带 `.js`，遵守 barrel 头注释规则）：

```ts
export { BentoGrid } from "./components/BentoGrid";
export { GradientStage } from "./components/GradientStage";
```

```ts
export type { BentoCardSpec, BentoGridSpec, BentoGridProps } from "./components/BentoGrid.js";
export type { GradientStageSpec, GradientStageProps } from "./components/GradientStage.js";
```

## 2. `src/ai/visual-registry.ts` 追加（照抄）

Zod schema（放在 `dataBarsSchema` 之后）：

```ts
/** remotion/library/components/BentoGrid.tsx — BentoGridSpec */
const bentoGridSchema = z.object({
  title: z.string().optional(),
  cards: z
    .array(
      z.object({
        icon: z.string().optional(),
        title: z.string().min(1),
        detail: z.string().optional(),
      })
    )
    .min(2)
    .max(4),
  layout: z.enum(["auto", "row", "2x2", "1+2"]).optional(),
  blur: z.boolean().optional(),
  accent: accentField,
});

/** remotion/library/components/GradientStage.tsx — GradientStageSpec */
const gradientStageSchema = z.object({
  colors: z.array(z.string()).min(2).max(3).optional(),
  speed: z.number().positive().optional(),
  grain: z.boolean().optional(),
  grid: z.boolean().optional(),
  vignette: z.boolean().optional(),
  accent: accentField,
});
```

Registry 条目（追加进 `VISUAL_REGISTRY` 数组）：

```ts
  {
    name: "BentoGrid",
    componentFile: "remotion/library/components/BentoGrid.tsx",
    description:
      "Glassmorphism bento grid: 2–4 frosted cards (translucent fill, backdrop blur, translucent 1px border, soft shadow) pop in with an overshoot stagger; the narration beat walks an accent glow across the cards.",
    whenToUse:
      "The narration presents 2–4 parallel features, capabilities, categories or comparison items of equal weight (功能点/特性/维度), and a card grid fits better than a numbered list. Not for sequential steps (use FlowDiagram) or numeric comparisons (use DataBars).",
    propsSchema: bentoGridSchema,
    fields: [
      { name: "cards", type: "{ icon?: string; title: string; detail?: string }[]", required: true, description: "2–4 cards, in narration order. icon is a short glyph/placeholder (e.g. \"⚡\", \"API\"); defaults to a 01/02/… index." },
      { name: "title", type: "string", required: false, description: "Small mono heading pinned top-left, e.g. \"核心能力\"." },
      { name: "layout", type: "\"auto\" | \"row\" | \"2x2\" | \"1+2\"", required: false, description: "Card arrangement. \"auto\": 2→row, 3→\"1+2\" (featured left + stacked right), 4→\"2x2\". Default \"auto\"." },
      { name: "blur", type: "boolean", required: false, description: "Backdrop blur under the glass. Default true; false forces the solid translucent fallback." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      title: "核心能力",
      layout: "auto",
      cards: [
        { icon: "⚡", title: "并行解码", detail: "一次前向产出多个 token" },
        { icon: "🎯", title: "投机采样", detail: "小模型起草，大模型验收" },
        { title: "KV 复用", detail: "前缀缓存避免重复计算" },
      ],
    },
  },
  {
    name: "GradientStage",
    componentFile: "remotion/library/components/GradientStage.tsx",
    description:
      "Animated mesh-gradient backdrop: colour blobs drift on slow sinusoidal orbits over a base colour, with an optional film-grain layer, engineering grid and vignette. Full-bleed base scene for mood-setting moments.",
    whenToUse:
      "A block is pure atmosphere — an opener beat, a transition breather, a closing thought — with no list/code/data to show, or the caller will overlay its own content. Not a content component.",
    propsSchema: gradientStageSchema,
    fields: [
      { name: "colors", type: "string[] (2–3 CSS colours)", required: false, description: "[base, blobA, blobB]. Defaults to theme bg + accent + foreground tint." },
      { name: "speed", type: "number", required: false, description: "Drift speed multiplier; 1 ≈ one orbit per ~25s. Default 1." },
      { name: "grain", type: "boolean", required: false, description: "Animated film grain overlay. Default true." },
      { name: "grid", type: "boolean", required: false, description: "Faint engineering grid overlay. Default false." },
      { name: "vignette", type: "boolean", required: false, description: "Darken the frame edges. Default true." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      colors: ["#0d1117", "#58a6ff", "#f778ba"],
      speed: 1,
      grid: true,
    },
  },
```

## 3. 其他共享文件

- `schemas/script.schema.json`：**无需改动**（visual.componentPath 为自由字符串路径，无组件名枚举）。
- `autovideo.config*.json` / `src/config/`：无需改动（两组件无新配置项，全部走 spec 可选字段）。
- `README.md` / `docs/AGENTS.md`：未记录组件清单，无需加行。
- `docs/guidelines/`（AUTHORING.md / method-block-design.md）：若集成后希望作者侧知晓新组件，可另行补一句——本任务未改动这些共享文档。

## 4. 备注

- `GradientStageProps` 在 `LibraryProps` 之外多了一个可选 `children?: React.ReactNode`（不在 spec 内，生成 wrapper 不传即可，类型上兼容现有组装代码）。
- backdrop-filter 降级：卡片始终带半透明实底；`blur: false` 时提高底不透明度并完全去掉 backdrop-filter。
- 颗粒层用 `@remotion/noise` 的 `noise2D` 驱动整层平移（确定性、无墙钟），底层纹理由固定 seed 的 SVG feTurbulence 生成；同 frame 渲染结果逐字节一致（冒烟已验证）。
