# 集成事项 — doodle-icon（DoodleMark + Icon）

任务产出（已创建，未在任何共享文件注册）：

- `remotion/library/components/DoodleMark.tsx` — 手绘涂鸦批注组件（circle/underline/arrow/cross，seeded PRNG 抖动 + strokeDashoffset 描画，**透明底、专为叠加设计**）
- `remotion/library/components/Icon.tsx` — 离线描边图标组件（60 个内置图标，draw-on 描画入场）
- `remotion/library/components/icon-data.ts` — 图标 path 数据（转录自 Tabler Icons，MIT，文件头已附协议全文与版权行），纯数据零依赖

---

## 1. `remotion/library/index.ts`（追加到既有导出块）

```ts
export { DoodleMark } from "./components/DoodleMark";
export { Icon } from "./components/Icon";

export type { DoodleMarkSpec, DoodleMarkProps, DoodleMarkItem, DoodleMarkType, DoodleTarget } from "./components/DoodleMark.js";
export type { IconSpec, IconProps } from "./components/Icon.js";

// 图标名清单与别名解析是纯数据/纯函数（icon-data.ts 无 remotion 依赖），
// 导出给 web 端图标选择器与文档生成用；不需要可省略这两行。
export { ICON_NAMES, resolveIconName } from "./components/icon-data";
export type { IconName } from "./components/icon-data.js";
```

## 2. `src/ai/visual-registry.ts`（schema 草案 + registry 条目）

注意 drift guard：`tests/ai/visual-registry.test.ts` 断言 registry 名字集合 === index.ts 导出集合，两处必须同一次提交一起改。

Schema 草案（放在既有 schema 区块，`accentField` 复用现有定义）：

```ts
/** remotion/library/components/DoodleMark.tsx — DoodleMarkSpec */
const doodleTargetSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

const doodleMarkSchema = z.object({
  marks: z
    .array(
      z.object({
        type: z.enum(["circle", "underline", "arrow", "cross"]),
        target: doodleTargetSchema.optional(),
        color: z.string().optional(),
      })
    )
    .min(1)
    .max(4),
  delay: z.number().min(0).optional(),
  accent: accentField,
});

/** remotion/library/components/Icon.tsx — IconSpec
 *  名字表镜像 icon-data.ts 的 ICON_PATHS 键（60 个）。 */
const iconNameSchema = z.enum([
  "alert-triangle", "atom", "bolt", "book", "bookmark", "brackets", "brain",
  "bug", "bulb", "camera", "chart-bar", "chart-line", "chart-pie", "check",
  "clock", "cloud", "code", "copy", "cpu", "database", "download", "edit",
  "external-link", "eye", "file-text", "filter", "folder", "git-branch",
  "heart", "help", "info-circle", "key", "link", "lock", "mail", "math",
  "math-function", "message-circle", "microphone", "music", "network",
  "photo", "player-play", "plus", "robot", "rocket", "search", "server",
  "settings", "shield-lock", "star", "target", "terminal-2", "upload",
  "user", "users", "video", "wifi", "world", "x",
]);

const iconSchema = z.object({
  name: iconNameSchema,
  size: z.number().min(0.05).max(0.5).optional(),
  drawOn: z.boolean().optional(),
  accent: accentField,
});
```

Registry 条目（追加进 `VISUAL_REGISTRY` 数组）：

```ts
  {
    name: "DoodleMark",
    componentFile: "remotion/library/components/DoodleMark.tsx",
    description:
      "Hand-drawn annotation overlay: marker-pen circles, wavy underlines, curved arrows and crosses draw themselves over the frame to highlight regions (seeded-PRNG wobble, strokeDashoffset draw-on).",
    whenToUse:
      "The description asks to 圈出/划重点/箭头指向/打叉 specific regions of the frame (e.g. 强调某个区域、指出关键位置). 1–4 marks. NOTE: the component is transparent by design (no background) — standalone blocks show marks over a black frame, so prefer it for emphasis beats or when a layering mechanism stacks it over content; pick another component when the block needs its own full layout.",
    propsSchema: doodleMarkSchema,
    fields: [
      { name: "marks", type: "{ type: \"circle\" | \"underline\" | \"arrow\" | \"cross\"; target?: { x: number; y: number; w: number; h: number }; color?: string }[]", required: true, description: "1–4 marks, drawn in array order with a stagger. circle = ellipse around the target; underline = wavy line just below it; arrow = curved arrow auto-aimed at the target rim from the roomier side; cross = ✕ over it." },
      { name: "marks[].target", type: "{ x: number; y: number; w: number; h: number }", required: false, description: "Annotated region as fractions of the frame (0–1): x/y = top-left, w/h = size. Defaults to a centred box {x:0.35, y:0.36, w:0.3, h:0.2}." },
      { name: "marks[].color", type: "string (CSS colour)", required: false, description: "Stroke colour override for this mark; defaults to the spec accent." },
      { name: "delay", type: "number (seconds)", required: false, description: "Seconds before the first mark starts drawing. Default 0.15." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      marks: [
        { type: "circle", target: { x: 0.3, y: 0.3, w: 0.4, h: 0.18 } },
        { type: "arrow", target: { x: 0.62, y: 0.55, w: 0.2, h: 0.14 } },
      ],
    },
  },
  {
    name: "Icon",
    componentFile: "remotion/library/components/Icon.tsx",
    description:
      "Offline stroke-icon spotlight: one glyph from a bundled set of 60 Tabler-derived icons centred on the frame, drawing itself on with a cascading strokeDashoffset entrance and a soft breathing halo.",
    whenToUse:
      "The description calls for a single concept icon as the visual (idea/灯泡、code、database、cloud、cpu、security、rocket、warning、ai/大脑…) instead of a hand-drawn SVG. name must be one of the 60 built-in names.",
    propsSchema: iconSchema,
    fields: [
      { name: "name", type: "enum (60 names, e.g. \"bulb\" | \"brain\" | \"cpu\" | \"database\" | \"rocket\" | \"shield-lock\" | \"chart-line\" | \"code\" …)", required: true, description: "Built-in glyph name; see icon-data.ts ICON_NAMES for the full list." },
      { name: "size", type: "number (fraction of frame height)", required: false, description: "Icon edge as a fraction of frame height, 0.05–0.5. Default 0.16 (≈173px @1080p)." },
      { name: "drawOn", type: "boolean", required: false, description: "Draw-on entrance per subpath. Default true; false pops in with a spring." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Stroke colour override; defaults to the theme accent." },
    ],
    exampleProps: { name: "database", size: 0.18 },
  },
```

## 3. `docs/guidelines/AUTHORING.md` 表格行（§3.1 预制组件库表格，追加）

```md
> | `DoodleMark` | 手绘涂鸦批注：圈 / 波浪下划线 / 弯箭头 / 叉，叠加划重点 | "涂鸦批注：圆圈圈出画面中央区域，再用箭头指向右上角" |
> | `Icon` | 单个教学图标特写（60 个内置图标，描画入场） | "图标：database，尺寸偏大" |
```

同时 §525 行的组件清单（`TitleCard` / `KeyPoints` / … 枚举处）可把这两个名字补上。

## 4. 设计说明（集成时需知道的边界行为）

- **DoodleMark 透明底**：组件不画背景（其余库组件都刷 `theme.colors.bg`），VideoComposition 在组件加载完成后也没有底层底色，因此**组装路径 standalone 使用时批注落在黑帧上**。两个正确用法：① 自由生成路径里 `import { DoodleMark } from "../../../remotion/library"` 叠在自有内容之上（props 按名转发即可）；② 后续若做 layered-block 机制，把它作为叠加层。注册条目 whenToUse 已按此撰写。若集成方认为 standalone 场景更重要，可在 wrapper 层包一层 `AbsoluteFill backgroundColor=theme.colors.bg`，不要改组件本身。
- **Icon 未知名字**：`resolveIconName()` 先查 60 个本名、再查 27 个别名（idea→bulb、ai→brain、gear→settings、warning→alert-triangle、image→photo 等，见 `ICON_ALIASES`），最终回退到 `help` 图标——永不崩帧。registry zod enum 只列本名，别名是兜底而非契约。
- **Icon size 语义**：画面高度的分数（0.16 ≈ 173px @1080p），组件内部 clamp 到 [0.05h, 0.5h]；zod 的 min/max 与之对齐。
- **DoodleMark target 语义**：相对整帧（含字幕带）的 0–1 分数；arrow 的箭尾自动选画面更空的一侧并 clamp 在字幕安全区之上，其余 mark 的位置完全由调用方 target 决定（组件不 clamp，文档已写明避让责任在调用方）。
- **确定性**：DoodleMark 每条 mark 的种子 = `xfnv1a("${index}:${type}:${target}")` + mulberry32，逐帧/跨渲染位级一致；Icon 无任何随机。
- **图标版权**：Tabler Icons MIT，协议全文与版权行已写在 `icon-data.ts` 文件头（MIT 要求复制时保留，勿删）。
- 两个组件的 spec 均通过 JSON round-trip 冒烟验证；`npx tsc -p tsconfig.remotion.json` 与 `tests/ai/visual-registry.test.ts`（未改共享文件，仍 20/20 绿）已通过。
