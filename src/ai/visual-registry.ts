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
