# kinetic-title — 集成事项

新增组件（已完成，未注册）：

- `remotion/library/components/KineticTitle.tsx` — `KineticTitle` / `KineticTitleSpec` / `KineticTitleProps`
- `remotion/library/components/QuoteCard.tsx` — `QuoteCard` / `QuoteCardSpec` / `QuoteCardProps`

以下共享文件改动需要集成 Agent 执行，内容可直接照抄。

## 1. `remotion/library/index.ts`

在 value 导出段追加（按现有排序习惯跟在 `DataBars` 后）：

```ts
export { KineticTitle } from "./components/KineticTitle";
export { QuoteCard } from "./components/QuoteCard";
```

在 type 导出段追加：

```ts
export type { KineticTitleSpec, KineticTitleProps } from "./components/KineticTitle.js";
export type { QuoteCardSpec, QuoteCardProps } from "./components/QuoteCard.js";
```

注意保持现有规则：value 导出无扩展名、type 导出带 `.js` 且用 `export type`。

## 2. `src/ai/visual-registry.ts`

### 2a. Schema 段追加（跟在 `dataBarsSchema` 后）

```ts
/** remotion/library/components/KineticTitle.tsx — KineticTitleSpec */
const kineticTitleSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  kicker: z.string().optional(),
  align: z.enum(["center", "left"]).optional(),
  by: z.enum(["char", "word"]).optional(),
  blurIn: z.boolean().optional(),
  accent: accentField,
});

/** remotion/library/components/QuoteCard.tsx — QuoteCardSpec */
const quoteCardSchema = z.object({
  lines: z.array(z.string().min(1)).min(1).max(6),
  author: z.string().optional(),
  source: z.string().optional(),
  accent: accentField,
});
```

### 2b. `VISUAL_REGISTRY` 数组追加两个条目

```ts
  {
    name: "KineticTitle",
    componentFile: "remotion/library/components/KineticTitle.tsx",
    description:
      "Kinetic typography headline: the title is split into chars or words and every unit pops in with a staggered spring (rise + scale + optional blur-in), plus an accent kicker chip and an optional subtitle.",
    whenToUse:
      "Block needs a high-energy punchy headline — topic intros, key-term reveals, emphasis beats — rather than the calm ceremonial TitleCard. Not for lists, code, flows, data or quotes.",
    propsSchema: kineticTitleSchema,
    fields: [
      { name: "title", type: "string", required: true, description: "Headline text; \"\\n\" starts a new line (the cascade continues across lines)." },
      { name: "kicker", type: "string", required: false, description: "Small accent chip above the title, e.g. \"核心概念\"." },
      { name: "subtitle", type: "string", required: false, description: "Muted line under the title; enters after the last title unit starts moving." },
      { name: "align", type: "\"center\" | \"left\"", required: false, description: "Text alignment of the whole block. Default \"center\"." },
      { name: "by", type: "\"char\" | \"word\"", required: false, description: "Split per character (default, best for CJK) or per word (space-separated titles)." },
      { name: "blurIn", type: "boolean", required: false, description: "Blur each unit while it enters. Default true." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      kicker: "核心概念",
      title: "注意力即权重",
      subtitle: "逐字入场的动力学标题",
      by: "char",
    },
  },
  {
    name: "QuoteCard",
    componentFile: "remotion/library/components/QuoteCard.tsx",
    description:
      "Editorial pull-quote: oversized accent quote mark, large lines that mask-reveal upward one by one, a near-still Ken Burns scale drift over the hold, and an optional author/source attribution row.",
    whenToUse:
      "The block is a quotation, aphorism, definition or a single statement meant to be read slowly — 1–6 lines, optionally with author and/or source. Not for titles, lists, code or data.",
    propsSchema: quoteCardSchema,
    fields: [
      { name: "lines", type: "string[]", required: true, description: "Quote body — one string per line, 1–6 lines; lines mask-reveal in order." },
      { name: "author", type: "string", required: false, description: "Attribution name, rendered as \"—— {author}\" under the quote." },
      { name: "source", type: "string", required: false, description: "Muted source on the attribution row, e.g. \"《时间简史》\"." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      lines: ["想象力比知识更重要", "因为知识是有限的"],
      author: "阿尔伯特·爱因斯坦",
    },
  },
```

集成后 `tests/ai/visual-registry.test.ts` 的名称对等断言会自动覆盖这两个新条目；建议同时跑：

```bash
HOME=/tmp/fakehome npx vitest run tests/ai/visual-registry.test.ts
```

## 3. 不需要的改动

- `schemas/script.schema.json`：无新字段（组件 spec 不走该 schema）。
- `src/config/` / `autovideo.config*.json`：无新配置项。
- `package.json`：无新依赖（只用了 react / remotion 与库内 tokens/motion）。
- README / docs/AGENTS.md：组件库表格若在别处有清单（如 guidelines 提到组件库），建议由集成 Agent 统一更新，本任务未改任何文档。

## 4. 行为说明（供集成时核对）

- 两组件根节点均不自行淡入淡出（遵循 BlockFrame 约定）；全部动画帧驱动，无墙钟/随机。
- KineticTitle：`by:"word"` 依赖空白分词，适合英文或中英混排标题；纯中文标题保持默认 `by:"char"`。`blurIn` 默认 true。
- QuoteCard：无 `align` 字段，固定左对齐编辑排版（measure 宽度 `LAYOUT.measurePct`）；Ken Burns 漂移为线性 1→1.035 + 轻微上移，横跨整个 block 时长。
- KineticTitle 的 kicker 徽章填充使用 `color-mix(in srgb, accent 12%, transparent)`（Remotion 4 的 Chrome headless 支持；不支持时退化为透明底+描边，不破坏布局）。
