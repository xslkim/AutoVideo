# 集成事项 — flow-morph（FlowArrow / MorphBadge）

新增组件（本任务已创建，未在任何共享文件注册）：

- `remotion/library/components/FlowArrow.tsx` — 导出 `FlowArrow`、`FlowArrowSpec`、`FlowArrowProps`
- `remotion/library/components/MorphBadge.tsx` — 导出 `MorphBadge`、`MorphBadgeSpec`、`MorphBadgeProps`

两者均遵循库约定：`LibraryProps<Spec>` 签名、spec 纯 JSON、帧驱动动画（spring/evolvePath/getPointAtLength/interpolatePaths，无墙钟/随机）、字号间距走 tokens、颜色走 `props.theme` + 可选 `spec.accent`、底部避让 `subtitleSafeBottom`、根节点不做整体淡入淡出（BlockFrame 负责）。

## 1. `remotion/library/index.ts`（ barrel，追加导出行）

在 `export { DataBars } ...` 一行后追加：

```ts
export { FlowArrow } from "./components/FlowArrow";
export { MorphBadge } from "./components/MorphBadge";
```

在 type re-export 区（`export type { DataBarsSpec, ... }` 一行后）追加：

```ts
export type { FlowArrowSpec, FlowArrowProps } from "./components/FlowArrow.js";
export type { MorphBadgeSpec, MorphBadgeProps } from "./components/MorphBadge.js";
```

## 2. `src/ai/visual-registry.ts`（zod schema + registry entry）

Schema 区（放在 `dataBarsSchema` 之后）：

```ts
/** remotion/library/components/FlowArrow.tsx — FlowArrowSpec */
const flowArrowSchema = z.object({
  title: z.string().optional(),
  direction: z.enum(["horizontal", "vertical"]).optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        icon: z.string().optional(),
      })
    )
    .min(2)
    .max(6),
  edges: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        label: z.string().optional(),
      })
    )
    .optional(),
  accent: accentField,
});

/** remotion/library/components/MorphBadge.tsx — MorphBadgeSpec */
const morphBadgeSchema = z.object({
  shapes: z.array(z.string().min(1)).min(1).max(5),
  labels: z.array(z.string()).optional(),
  intervalSec: z.number().min(0.6).max(10).optional(),
  accent: accentField,
});
```

`VISUAL_REGISTRY` 数组（追加在 DataBars 条目之后）：

```ts
  {
    name: "FlowArrow",
    componentFile: "remotion/library/components/FlowArrow.tsx",
    description:
      "Flowing connection diagram: node chips pop in with springs, connective paths draw themselves on, then comet dots loop along each path; the narration beat walks an accent glow across the nodes. 2026 upgrade of FlowDiagram.",
    whenToUse:
      "The description explains a pipeline, data flow, architecture or sequence of stages (A → B → C) with 2–6 nodes and a sense of live data/energy moving along the links is wanted. Prefer over FlowDiagram when the narration stresses transmission/flow; FlowDiagram remains the calmer default.",
    propsSchema: flowArrowSchema,
    fields: [
      { name: "nodes", type: "{ id: string; label: string; icon?: string }[]", required: true, description: "2–6 nodes in logical order; positions follow array order. id is a short ASCII key used by edges. icon names a built-in glyph: dot, bolt, play, database, cloud, gear, user, search, doc, chart, check, cpu." },
      { name: "edges", type: "{ from: string; to: string; label?: string }[]", required: false, description: "Connections by node id. Defaults to a simple chain nodes[i] → nodes[i+1]." },
      { name: "direction", type: "\"horizontal\" | \"vertical\"", required: false, description: "Main axis of the flow. Default \"horizontal\"." },
      { name: "title", type: "string", required: false, description: "Small mono heading pinned top-left, e.g. \"数据流\"." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      title: "推理流程",
      direction: "horizontal",
      nodes: [
        { id: "prompt", label: "提示词", icon: "doc" },
        { id: "model", label: "模型前向", icon: "cpu" },
        { id: "output", label: "输出文本", icon: "play" },
      ],
    },
  },
  {
    name: "MorphBadge",
    componentFile: "remotion/library/components/MorphBadge.tsx",
    description:
      "Shape-morphing badge: a glyph cycles through built-in shapes (circle → star → check …) with smooth path morphs on a pop spring, and optional per-shape labels cross-fade in sync.",
    whenToUse:
      "The description marks a concept transformation, a state change, or a step completing (raw → refined, idea → done, 0 → 1) and a single centred emblem with 2–5 morphing glyphs carries the beat. Not for lists, flows, code or data.",
    propsSchema: morphBadgeSchema,
    fields: [
      { name: "shapes", type: "string[]", required: true, description: "1–5 built-in shape names, cycled in order: \"circle\" | \"square\" | \"diamond\" | \"triangle\" | \"hexagon\" | \"star\" | \"check\" | \"bolt\" | \"plus\". Unknown names are ignored; one known shape renders static." },
      { name: "labels", type: "string[]", required: false, description: "Caption per shape (labels[i] pairs with shapes[i]); cross-fades as the glyph morphs." },
      { name: "intervalSec", type: "number", required: false, description: "Seconds each shape holds before morphing into the next. Default 1.5, min 0.6." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      shapes: ["circle", "star", "check"],
      labels: ["原始想法", "打磨提炼", "完成交付"],
      intervalSec: 1.5,
    },
  },
```

## 3. `docs/guidelines/AUTHORING.md`（组件速查表 + 组件名单）

§3.1 表格（`DataBars` 行后）追加两行：

```md
> | `FlowArrow` | 2–6 节点流动连接图（连线描画 + 光点沿路径流动） | "流动图：A → B → C，强调数据/能量在链路中流动" |
> | `MorphBadge` | 概念转化 / 步骤完成的图形变形徽章 | "徽章：圆形渐变为星形再变为对勾，分别配字『…』" |
>

第 525 行组件名单 `（TitleCard / KeyPoints / CodeBlock / FlowDiagram / DataBars 及 tokens/motion 原语）` 更新为：

`（TitleCard / KeyPoints / CodeBlock / FlowDiagram / DataBars / FlowArrow / MorphBadge 及 tokens/motion 原语）`

## 4. 不需要的改动

- `schemas/script.schema.json`：组件 spec 不进中间表示 schema，无需改。
- `src/config/`、`autovideo.config*.json`：无新配置项。
- `README.md`：无组件清单表，无需改。

## 5. 验证记录

- `npx tsc -p tsconfig.remotion.json`：两个新文件零错误（输出中仅有既有的 `remotion/components/SubtitleOverlay.test.tsx` KaraokeCaptionInput 报错，与本任务无关）。
- 运行时冒烟（node + @remotion/paths CJS）：`interpolatePaths` 在 circle↔star↔check 采样路径间各进度返回有效 path；`getLength`/`evolvePath`/`getPointAtLength`/`getTangentAtLength` 在直线与弓形 cubic 边上均正常。

## 6. 备注 / 边界

- FlowArrow 的 `direction` 取值是 `"horizontal" | "vertical"`（按任务指定），与 FlowDiagram 的 `"row" | "column"` 不同，registry 草案已按新值写。
- 内置图标/形状名集合是组件内常量（不进 spec 类型之外的运行时数据），未知名字静默回退（icon 不显示 / shape 忽略）。
- 光点在连线 draw-on 完成后开始循环流动；MorphBadge 在 ≤1 个已知形状时静态显示。
