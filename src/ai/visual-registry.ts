/**
 * Visual component registry — the single source of truth for the JSON
 * assembly mode (plan D).
 *
 * Each entry mirrors the spec type of one prefab component in
 * remotion/library/components/ as a zod schema, plus the prose the LLM
 * needs to pick and fill it. Three drift guards keep registry and library
 * in sync:
 *
 *   1. Every entry records its component file path; the component file's
 *      header comment points back at the registry entry name.
 *   2. tests/ai/visual-registry.test.ts statically reads
 *      remotion/library/index.ts and asserts the exported component names
 *      equal the registry name set (no barrel import — that would pull the
 *      whole remotion dependency tree into vitest).
 *   3. The assembly wrapper annotates the inlined spec with the real
 *      `XxxSpec` type, so the pipeline's tsc pass catches residual
 *      schema/type drift on every generated component.
 *
 * Zod's default object behaviour strips unknown keys, so LLM-invented
 * fields never reach the wrapper.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row of the props field table rendered into the LLM docs. */
export interface PropFieldDoc {
  name: string;
  /** Type as shown to the LLM, e.g. `string` or `{ title: string; detail?: string }[]`. */
  type: string;
  required: boolean;
  description: string;
}

export interface VisualRegistryEntry {
  /** Component name — must match the barrel export in remotion/library/index.ts. */
  name: string;
  /** Library component file this entry's schema mirrors (repo-relative). */
  componentFile: string;
  /** One-line summary of what the component renders. */
  description: string;
  /** When the orchestrator should pick this component over the others. */
  whenToUse: string;
  /** Zod schema for the component's spec (unknown keys stripped). */
  propsSchema: z.ZodTypeAny;
  /** Field table for the LLM docs — must stay in sync with propsSchema. */
  fields: PropFieldDoc[];
  /** Compact example spec shown in the LLM docs. */
  exampleProps: Record<string, unknown>;
}

/** Validated "use this component with these props" selection. */
export interface AssemblySelection {
  component: string;
  /** Zod-parsed spec (unknown keys stripped). */
  props: Record<string, unknown>;
}

/** Validated fallback signal: no registered component fits. */
export interface AssemblyFallback {
  component: null;
  reason: string;
}

export type AssemblyValidation =
  | { ok: true; value: AssemblySelection | AssemblyFallback }
  | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Schemas — mirror remotion/library/components/*.tsx spec types exactly.
// Arrays are capped 2–6 to match the components' documented layout ranges.
// ---------------------------------------------------------------------------

/** AccentOverride: every spec accepts an optional CSS colour override. */
const accentField = z.string().optional();

/** remotion/library/components/TitleCard.tsx — TitleCardSpec */
const titleCardSchema = z.object({
  kicker: z.string().optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  align: z.enum(["center", "left"]).optional(),
  accent: accentField,
});

/** remotion/library/components/KeyPoints.tsx — KeyPointsSpec */
const keyPointsSchema = z.object({
  title: z.string().optional(),
  points: z
    .array(
      z.object({
        title: z.string().min(1),
        detail: z.string().optional(),
      })
    )
    .min(2)
    .max(6),
  accent: accentField,
});

/** remotion/library/components/CodeBlock.tsx — CodeBlockSpec */
const codeBlockSchema = z.object({
  title: z.string().optional(),
  language: z.string().optional(),
  code: z.string().min(1),
  accent: accentField,
});

/** remotion/library/components/FlowDiagram.tsx — FlowDiagramSpec */
const flowDiagramSchema = z.object({
  title: z.string().optional(),
  direction: z.enum(["row", "column"]).optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        detail: z.string().optional(),
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

/** remotion/library/components/DataBars.tsx — DataBarsSpec */
const dataBarsSchema = z.object({
  title: z.string().optional(),
  unit: z.string().optional(),
  maxValue: z.number().optional(),
  bars: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.number(),
        color: z.string().optional(),
      })
    )
    .min(2)
    .max(6),
  accent: accentField,
});

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

/** remotion/library/components/NumberTicker.tsx — NumberTickerSpec */
const numberTickerSchema = z.object({
  value: z.number(),
  label: z.string().min(1),
  unit: z.string().optional(),
  decimals: z.number().int().min(0).max(3).optional(),
  sparkline: z.array(z.number()).min(2).max(24).optional(),
  accent: accentField,
});

/** remotion/library/components/ChartGrow.tsx — ChartGrowSpec */
const chartGrowSchema = z.object({
  type: z.enum(["line", "bar", "area"]),
  series: z
    .array(
      z.object({
        name: z.string().optional(),
        data: z.array(z.number()).min(2).max(12),
        color: z.string().optional(),
      })
    )
    .min(1)
    .max(3),
  xLabels: z.array(z.string().min(1)).min(2).max(12),
  title: z.string().optional(),
  highlight: z.enum(["max", "min", "last"]).optional(),
  accent: accentField,
});

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

/** remotion/library/components/CodeWindow.tsx — CodeWindowSpec */
const codeWindowSchema = z.object({
  code: z.string().min(1),
  language: z.string().optional(),
  filename: z.string().optional(),
  highlightLines: z.array(z.number().int().min(1)).optional(),
  diff: z
    .object({
      added: z.array(z.number().int().min(1)).optional(),
      removed: z.array(z.number().int().min(1)).optional(),
    })
    .optional(),
  typewriter: z.boolean().optional(),
  accent: accentField,
});

/** remotion/library/components/TimelineRuler.tsx — TimelineRulerSpec */
const timelineRulerSchema = z.object({
  title: z.string().optional(),
  events: z
    .array(
      z.object({
        label: z.string().min(1),
        detail: z.string().optional(),
        time: z.string().optional(),
      })
    )
    .min(2)
    .max(6),
  activeIndex: z.number().int().min(0).optional(),
  accent: accentField,
});

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

/** remotion/library/components/ProgressBar.tsx — ProgressBarSpec */
const progressBarSchema = z.object({
  progress: z.union([
    z.number().min(0).max(1),
    z.object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1) }),
  ]),
  chapters: z
    .array(z.object({ title: z.string().min(1), at: z.number().min(0).max(1) }))
    .max(12)
    .optional(),
  showLabel: z.boolean().optional(),
  accent: accentField,
});

/** remotion/library/components/Watermark.tsx — WatermarkSpec */
const watermarkSchema = z.object({
  text: z.string().min(1),
  badge: z.string().min(1).max(2).optional(),
  position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
  opacity: z.number().min(0).max(1).optional(),
  accent: accentField,
});

/** remotion/library/components/EndCard.tsx — EndCardSpec */
const endCardSchema = z.object({
  brand: z.string().min(1),
  monogram: z.string().min(1).max(2).optional(),
  kicker: z.string().optional(),
  followPrompt: z.string().optional(),
  nextTeaser: z.string().optional(),
  accent: accentField,
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const VISUAL_REGISTRY: VisualRegistryEntry[] = [
  {
    name: "TitleCard",
    componentFile: "remotion/library/components/TitleCard.tsx",
    description:
      "Hero title for openers and chapter breaks: kicker label, multi-line title with staggered entrances, accent hairline, optional subtitle.",
    whenToUse:
      "Block opens a video or a new chapter/section and the description is essentially one big title (optionally with a small label or lead line). Not for lists, code, flows or data.",
    propsSchema: titleCardSchema,
    fields: [
      { name: "title", type: "string", required: true, description: "Main title; \"\\n\" starts a new line (each line staggers in)." },
      { name: "kicker", type: "string", required: false, description: "Small mono label above the title, e.g. \"第 3 课 · L3\"." },
      { name: "subtitle", type: "string", required: false, description: "Muted lead line under the hairline." },
      { name: "align", type: "\"center\" | \"left\"", required: false, description: "Text alignment of the whole block. Default \"center\"." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      kicker: "第 3 课 · L3",
      title: "注意力机制",
      subtitle: "从序列到序列的对齐",
      align: "center",
    },
  },
  {
    name: "KeyPoints",
    componentFile: "remotion/library/components/KeyPoints.tsx",
    description:
      "Numbered key-point list: the row being narrated lights up with an accent rail and brighter type while the rest recede.",
    whenToUse:
      "The narration walks through 2–6 enumerated points, steps or takeaways (第一/第二/…, 1. 2. 3.) and the description asks for a list that follows the voiceover.",
    propsSchema: keyPointsSchema,
    fields: [
      { name: "points", type: "{ title: string; detail?: string }[]", required: true, description: "2–6 points, in narration order. One point per narration beat." },
      { name: "title", type: "string", required: false, description: "Small mono heading pinned top-left, e.g. \"核心要点\"." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      title: "核心要点",
      points: [
        { title: "查询与键做点积", detail: "得到每个位置的注意力分数" },
        { title: "softmax 归一化" },
        { title: "加权求和值向量", detail: "输出是值的凸组合" },
      ],
    },
  },
  {
    name: "CodeBlock",
    componentFile: "remotion/library/components/CodeBlock.tsx",
    description:
      "Editor-style code panel: title tab, language badge, line numbers, keyword/string/comment colouring, and a narration-driven highlight bar walking down the lines.",
    whenToUse:
      "The description shows source code or a config listing and the narration explains it line by line (or chunk by chunk).",
    propsSchema: codeBlockSchema,
    fields: [
      { name: "code", type: "string", required: true, description: "Source code, \"\\n\" separated. Blank lines are preserved. Keep it short enough to stay legible (roughly ≤ 14 lines)." },
      { name: "title", type: "string", required: false, description: "Tab / file name in the panel header, e.g. \"train.py\"." },
      { name: "language", type: "string", required: false, description: "Language badge, e.g. \"ts\". Purely decorative." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      title: "attention.py",
      language: "py",
      code: "scores = q @ k.T / sqrt(d)\nweights = softmax(scores)\nout = weights @ v",
    },
  },
  {
    name: "FlowDiagram",
    componentFile: "remotion/library/components/FlowDiagram.tsx",
    description:
      "Node-and-edge process flow: chips stagger in along a row or column, connective strokes draw themselves between them, and the narration beat walks a glow across the nodes.",
    whenToUse:
      "The description explains a pipeline, data flow, architecture or sequence of stages (A → B → C) with 2–6 nodes.",
    propsSchema: flowDiagramSchema,
    fields: [
      { name: "nodes", type: "{ id: string; label: string; detail?: string }[]", required: true, description: "2–6 nodes in logical order; positions follow array order. id is a short ASCII key used by edges." },
      { name: "edges", type: "{ from: string; to: string; label?: string }[]", required: false, description: "Connections by node id. Defaults to a simple chain nodes[i] → nodes[i+1]." },
      { name: "direction", type: "\"row\" | \"column\"", required: false, description: "Main axis of the flow. Default \"row\"." },
      { name: "title", type: "string", required: false, description: "Small mono heading pinned top-left, e.g. \"数据流\"." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      title: "推理流程",
      direction: "row",
      nodes: [
        { id: "prompt", label: "提示词" },
        { id: "model", label: "模型前向", detail: "逐 token 生成" },
        { id: "output", label: "输出文本" },
      ],
    },
  },
  {
    name: "DataBars",
    componentFile: "remotion/library/components/DataBars.tsx",
    description:
      "Animated horizontal bar chart: bars spring out from a shared baseline, values count up in sync, and the narration beat spotlights one bar at a time.",
    whenToUse:
      "The description compares 2–6 numeric values (benchmarks, timings, sizes, percentages) and a bar chart conveys the comparison.",
    propsSchema: dataBarsSchema,
    fields: [
      { name: "bars", type: "{ label: string; value: number; color?: string }[]", required: true, description: "2–6 bars. value is the number plotted; color overrides the per-bar colour." },
      { name: "unit", type: "string", required: false, description: "Unit suffix for value labels, e.g. \"ms\" or \"%\"." },
      { name: "maxValue", type: "number", required: false, description: "Scale max; defaults to the largest bar value." },
      { name: "title", type: "string", required: false, description: "Small mono heading pinned top-left, e.g. \"耗时对比\"." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      title: "耗时对比",
      unit: "ms",
      bars: [
        { label: "朴素实现", value: 120 },
        { label: "KV 缓存", value: 35 },
      ],
    },
  },
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
  {
    name: "NumberTicker",
    componentFile: "remotion/library/components/NumberTicker.tsx",
    description:
      "Big-number impact beat: odometer drums roll up to the target value and bounce onto it digit by digit, with an optional sparkline drawing itself under the caption.",
    whenToUse:
      "The narration lands on one headline statistic (用户量、性能提升、价格、百分比) and the block should hit that single number hard. Not for multi-value comparisons (use DataBars) or trends over categories (use ChartGrow).",
    propsSchema: numberTickerSchema,
    fields: [
      { name: "value", type: "number", required: true, description: "Target value the counter lands on, e.g. 128000 or 99.2. Keep the integer part ≤ 6 digits so the row fits the frame." },
      { name: "label", type: "string", required: true, description: "Caption under the number, e.g. \"本月活跃用户\"." },
      { name: "unit", type: "string", required: false, description: "Small suffix right of the digits, e.g. \"%\" or \"ms\"." },
      { name: "decimals", type: "number (int, 0–3)", required: false, description: "Decimal places; defaults to 0 for integers, 1 otherwise." },
      { name: "sparkline", type: "number[]", required: false, description: "Optional trend under the caption (2–24 points, oldest → newest)." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      value: 128000,
      label: "本月活跃用户",
      unit: "人",
      sparkline: [12, 18, 15, 26, 34, 31, 48],
    },
  },
  {
    name: "ChartGrow",
    componentFile: "remotion/library/components/ChartGrow.tsx",
    description:
      "Growing chart for trend narratives: axes and gridlines wipe in, then the series grows — line/area strokes draw themselves on, bars spring up from the baseline — and each series' key point (max/min/last) gets a pulsing ring and value callout.",
    whenToUse:
      "The description shows a trend or comparison across ordered categories (月度、版本、实验组) with 2–12 points per series and up to 3 series. For 2–6 plain value comparisons without an x axis, DataBars is simpler.",
    propsSchema: chartGrowSchema,
    fields: [
      { name: "type", type: "\"line\" | \"bar\" | \"area\"", required: true, description: "line/area strokes draw themselves on; bars rise from the baseline." },
      { name: "series", type: "{ name?: string; data: number[]; color?: string }[]", required: true, description: "1–3 series; data length should match xLabels (shorter arrays repeat their last value). name feeds the legend when more than one series is plotted." },
      { name: "xLabels", type: "string[]", required: true, description: "2–12 short category labels (≤ 4 chars each, e.g. \"1月\"), matched by index to each series' data." },
      { name: "title", type: "string", required: false, description: "Small mono heading pinned top-left, e.g. \"逐月吞吐量\"." },
      { name: "highlight", type: "\"max\" | \"min\" | \"last\"", required: false, description: "Which key point of each series gets the callout. Default \"max\"." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      type: "line",
      title: "逐月吞吐量",
      series: [
        { name: "基线", data: [12, 20, 16, 30, 42] },
        { name: "优化后", data: [18, 28, 40, 55, 80] },
      ],
      xLabels: ["1月", "2月", "3月", "4月", "5月"],
      highlight: "max",
    },
  },
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
  {
    name: "CodeWindow",
    componentFile: "remotion/library/components/CodeWindow.tsx",
    description:
      "macOS-style code window: traffic-light title bar with centred filename, optional typewriter reveal with blinking block cursor, a narration-beat highlight that glides between lines, persistent highlightLines emphasis, and optional diff mode (added green / removed red with +/− gutter markers).",
    whenToUse:
      "The description shows source code or a config listing and asks for an editor/IDE window look, a typing effect, diff/改动标注 (新增/删除行), or specific lines to stay emphasised. Prefer over CodeBlock when the visual brief mentions 窗口/打字机/diff/高亮第 N 行.",
    propsSchema: codeWindowSchema,
    fields: [
      { name: "code", type: "string", required: true, description: "Source code, \"\\n\" separated. Blank lines are preserved. Keep it short enough to stay legible (roughly ≤ 14 lines)." },
      { name: "language", type: "string", required: false, description: "Language badge, e.g. \"ts\". Purely decorative." },
      { name: "filename", type: "string", required: false, description: "File name centred in the window title bar, e.g. \"train.py\"." },
      { name: "highlightLines", type: "number[]", required: false, description: "1-based line numbers that keep a persistent accent emphasis plate." },
      { name: "diff", type: "{ added?: number[]; removed?: number[] }", required: false, description: "Diff mode: 1-based added lines go green, removed lines red, with +/− gutter markers and a header stat pill." },
      { name: "typewriter", type: "boolean", required: false, description: "Typewriter reveal: lines type out char by char under a blinking block cursor. Default false." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      filename: "train.py",
      language: "py",
      typewriter: true,
      highlightLines: [3],
      code: "import torch\n\nmodel = GPT(vocab=32000)\noptim = AdamW(model.parameters(), lr=3e-4)",
    },
  },
  {
    name: "TimelineRuler",
    componentFile: "remotion/library/components/TimelineRuler.tsx",
    description:
      "Horizontal timeline ruler: the axis draws itself with minor ticks, event nodes pop in, an accent progress line grows node to node with the narration beat, and the featured node enlarges with a glow. Event cards alternate above/below the axis.",
    whenToUse:
      "The narration walks a chronological development (发展史/演进/版本迭代) or an ordered sequence of milestones/steps with 2–6 events, especially when events carry dates or version labels.",
    propsSchema: timelineRulerSchema,
    fields: [
      { name: "events", type: "{ label: string; detail?: string; time?: string }[]", required: true, description: "2–6 events in chronological order. label = main text, time = small mono chip (e.g. \"2017\"), detail = muted secondary line." },
      { name: "title", type: "string", required: false, description: "Small mono heading pinned top-left, e.g. \"发展史\"." },
      { name: "activeIndex", type: "number (int, 0-based)", required: false, description: "Pin the featured node; omit to auto-advance with the narration beat." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      title: "发展史",
      events: [
        { time: "2017", label: "Transformer 发布", detail: "自注意力取代循环结构" },
        { time: "2018", label: "BERT / GPT-1" },
        { time: "2020", label: "GPT-3", detail: "1750 亿参数" },
      ],
    },
  },
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
  {
    name: "ProgressBar",
    componentFile: "remotion/library/components/ProgressBar.tsx",
    description:
      "Channel-packaging top rail: hairline progress fill, diamond chapter ticks that light up as the playhead passes, and a mono label naming the current chapter. Position comes from pure-data global progress, so it stays continuous across block cuts.",
    whenToUse:
      "Overlay for any block when the video wants a persistent top progress indicator. progress/at are whole-video 0..1 fractions — the caller must compute them from block timings; never let the LLM invent them. Not a standalone content visual.",
    propsSchema: progressBarSchema,
    fields: [
      { name: "progress", type: "number | { from: number; to: number }", required: true, description: "Whole-video progress 0..1. Bare number = static; { from, to } sweeps linearly across the block's frames." },
      { name: "chapters", type: "{ title: string; at: number }[]", required: false, description: "Chapter ticks; at is the chapter start as a whole-video fraction 0..1. ≤ 12." },
      { name: "showLabel", type: "boolean", required: false, description: "Show the active chapter name under the rail. Default true." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      progress: { from: 0.32, to: 0.48 },
      chapters: [
        { title: "开场", at: 0 },
        { title: "注意力机制", at: 0.3 },
        { title: "总结", at: 0.85 },
      ],
      showLabel: true,
    },
  },
  {
    name: "Watermark",
    componentFile: "remotion/library/components/Watermark.tsx",
    description:
      "Persistent channel watermark: badge chip + text lockup pinned to a corner (bottom-right default), semi-transparent with a slow breathing opacity. Bottom corners clear the subtitle safe band.",
    whenToUse:
      "Overlay for branding when the video should carry a channel mark throughout. Best injected system-wide rather than per content block.",
    propsSchema: watermarkSchema,
    fields: [
      { name: "text", type: "string", required: true, description: "Watermark text, e.g. the channel name \"@AutoVideo\"." },
      { name: "badge", type: "string", required: false, description: "1–2 characters in a solid accent chip before the text (logo 位)." },
      { name: "position", type: "\"top-left\" | \"top-right\" | \"bottom-left\" | \"bottom-right\"", required: false, description: "Corner to pin to. Default \"bottom-right\"." },
      { name: "opacity", type: "number", required: false, description: "Peak opacity 0..1; breathing oscillates gently below it. Default 0.45." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: { text: "@AutoVideo 频道", badge: "AV", position: "bottom-right", opacity: 0.45 },
  },
  {
    name: "EndCard",
    componentFile: "remotion/library/components/EndCard.tsx",
    description:
      "2-second brand end card: accent logo tile with monogram, brand lockup, growing hairline, follow CTA pill with a radar-ping ring, optional next-episode teaser. Elements stagger in with springs and hold.",
    whenToUse:
      "The closing block of a video — brand sign-off, follow call-to-action and next-episode teaser. Not for openers (use TitleCard) or content blocks.",
    propsSchema: endCardSchema,
    fields: [
      { name: "brand", type: "string", required: true, description: "Brand / channel lockup, e.g. \"AutoVideo 频道\"." },
      { name: "monogram", type: "string", required: false, description: "1–2 chars inside the logo tile; defaults to brand's first character." },
      { name: "kicker", type: "string", required: false, description: "Small mono kicker above the tile, e.g. \"感谢观看\"." },
      { name: "followPrompt", type: "string", required: false, description: "CTA inside the accent pill, e.g. \"关注频道，不错过更新\"." },
      { name: "nextTeaser", type: "string", required: false, description: "Next-episode teaser line, e.g. \"下集预告：动手写出你的第一个渲染器\"." },
      { name: "accent", type: "string (CSS colour)", required: false, description: "Accent colour override; defaults to the theme accent." },
    ],
    exampleProps: {
      brand: "AutoVideo 频道",
      kicker: "感谢观看",
      followPrompt: "关注频道，不错过更新",
      nextTeaser: "下集预告：动手写出你的第一个渲染器",
    },
  },
];

const registryByName = new Map(VISUAL_REGISTRY.map((e) => [e.name, e]));

/** Names of all registered components (== barrel component exports). */
export function registeredComponentNames(): string[] {
  return VISUAL_REGISTRY.map((e) => e.name);
}

// ---------------------------------------------------------------------------
// LLM-facing documentation
// ---------------------------------------------------------------------------

/**
 * Render the registry as Markdown for the LLM prompts (assembly mode and the
 * free-generation prompt share this single source).
 */
export function buildRegistryDocs(): string {
  const parts: string[] = [];
  for (const entry of VISUAL_REGISTRY) {
    const rows = entry.fields
      .map(
        (f) =>
          `| ${f.name} | \`${f.type}\` | ${f.required ? "yes" : "no"} | ${f.description} |`
      )
      .join("\n");
    const example = JSON.stringify(
      { component: entry.name, props: entry.exampleProps },
      null,
      2
    );
    parts.push(
      `### ${entry.name}\n` +
        `${entry.description}\n\n` +
        `**Use when:** ${entry.whenToUse}\n\n` +
        `| Field | Type | Required | Notes |\n` +
        `|---|---|---|---|\n` +
        `${rows}\n\n` +
        `Example:\n` +
        `\`\`\`json\n${example}\n\`\`\``
    );
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Assembly validation
// ---------------------------------------------------------------------------

/** `props`, `props.points`, `props.points[0].title` — human-readable path. */
function formatIssuePath(path: PropertyKey[]): string {
  let out = "props";
  for (const seg of path) {
    out += typeof seg === "number" ? `[${seg}]` : `.${String(seg)}`;
  }
  return out;
}

/**
 * Validate raw orchestrator output.
 *
 * - `{ "component": null, "reason": "…" }` is a legitimate fallback signal
 *   and passes (reason defaults to a placeholder when omitted).
 * - `{ "component": "<registered name>", "props": {…} }` is checked against
 *   that component's zod schema; unknown props keys are stripped.
 *
 * Errors are human-readable `field.path: reason` lines, written so they can
 * be fed straight back to the model as retry feedback.
 */
export function validateAssembly(json: unknown): AssemblyValidation {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return {
      ok: false,
      errors: [
        "assembly output must be a JSON object like " +
          '{"component": "<name>", "props": {…}} or {"component": null, "reason": "…"}',
      ],
    };
  }
  const obj = json as Record<string, unknown>;

  if (!("component" in obj)) {
    return {
      ok: false,
      errors: [
        'missing required field "component" — a registered component name, or null to signal fallback',
      ],
    };
  }

  if (obj.component === null) {
    const reason =
      typeof obj.reason === "string" && obj.reason.trim().length > 0
        ? obj.reason
        : "(no reason given)";
    return { ok: true, value: { component: null, reason } };
  }

  if (typeof obj.component !== "string") {
    return {
      ok: false,
      errors: [
        `"component" must be a string (registered component name) or null, got ${Array.isArray(obj.component) ? "array" : typeof obj.component}`,
      ],
    };
  }

  const entry = registryByName.get(obj.component);
  if (!entry) {
    return {
      ok: false,
      errors: [
        `unknown component "${obj.component}" — registered components are: ${registeredComponentNames().join(", ")} (or null to signal fallback)`,
      ],
    };
  }

  if (obj.props === undefined) {
    return {
      ok: false,
      errors: [
        `missing required field "props" — the spec object for ${entry.name} (see its field table)`,
      ],
    };
  }

  const parsed = (entry.propsSchema as z.ZodTypeAny).safeParse(obj.props);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`
      ),
    };
  }

  return {
    ok: true,
    value: {
      component: entry.name,
      props: parsed.data as Record<string, unknown>,
    },
  };
}
