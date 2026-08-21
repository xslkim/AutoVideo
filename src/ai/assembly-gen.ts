/**
 * JSON assembly generation (plan D).
 *
 * Instead of asking the model for a full TSX component, assembly mode asks
 * it to act as a visual orchestrator: pick one prefab component from the
 * registry (src/ai/visual-registry.ts) and fill its props as pure JSON.
 * The wrapper (src/ai/assembly-wrapper.ts) then mechanically turns the
 * validated selection into a Component.tsx.
 *
 * Transport and credential resolution live in the AgentDriver layer
 * (src/ai/agent/), same as component-gen.ts — this module owns the
 * assembly prompts and the JSON extraction/validation of raw model output.
 */

import { createAgentDriver, type AgentUsage } from "./agent/index.js";
import type { AnthropicConfig } from "./component-gen.js";
import { validateAssembly } from "./visual-registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for a single assembly call. */
export interface AssemblyGenInput {
  /** The visual description from the block's --- visual --- section */
  visualDescription: string;
  /**
   * Narration lines with their current timings, for pacing intuition
   * (same context component generation receives).
   */
  narrationContext?: string;
  /** Registry Markdown docs (from buildRegistryDocs()) — the component menu. */
  registryDocs: string;
  /** Previous attempt context for retry (error + previous JSON), if any */
  retryContext?: AssemblyRetryContext;
}

/** Context fed back to the model when an assembly fails validation. */
export interface AssemblyRetryContext {
  /** The raw JSON text the model produced in the previous attempt */
  previousJson: string;
  /** The validation error message */
  errorMessage: string;
}

/** Successful assembly outcomes. */
export type AssemblyGenResult =
  | {
      kind: "assembled";
      /** Registered component name, e.g. "KeyPoints" */
      component: string;
      /** Zod-validated spec (unknown keys stripped) */
      props: Record<string, unknown>;
      usage: AgentUsage;
    }
  | {
      kind: "fallback";
      /** Why no registered component fits — caller switches to free generation */
      reason: string;
      usage: AgentUsage;
    };

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * System prompt for the orchestrator. Contract-style: the model may only
 * pick a registered component and fill documented fields; anything else is
 * a validation failure on our side.
 */
export function buildAssemblySystemPrompt(registryDocs: string): string {
  return `You are the visual orchestrator for an educational-video pipeline. You do NOT write code. Your only job: pick the single best-fitting prefab component from the registry below and fill its props (a pure-data spec).

# Component registry

${registryDocs}

# Output contract (strict)

- Respond with ONE \`\`\`json fenced code block and NOTHING else — no prose before or after it.
- Shape: {"component": "<registered component name>", "props": { ...spec fields... }}
- If NO component fits the visual description, respond with {"component": null, "reason": "<why nothing fits>"} instead. Never force a bad fit.
- "component" must be one of the registered names above, spelled exactly. Never invent components.
- Never invent fields: props may only contain fields listed in that component's field table. Unknown fields are silently discarded — if the field you want does not exist, the component does not support it; pick another component or return null.
- Array limits are HARD: points / nodes / bars must contain 2–6 items. Summarise or split the content instead of overflowing.
- Keep copy terse: CJK glyphs are wide. Titles ≤ ~20 characters, item labels ≤ ~12, detail lines ≤ ~30. Cut words rather than crowding the slide.
- props must be pure JSON data: no functions, no comments, no trailing commas.
- All visible text comes from props — write it in the same language as the visual description (usually Chinese).`;
}

/** Build the user message from the description and optional retry context. */
export function buildAssemblyUserContent(input: AssemblyGenInput): string {
  const parts: string[] = [];

  parts.push(
    `Assemble a visual for the following description:\n\n${input.visualDescription}`
  );

  if (input.narrationContext) {
    parts.push(`\n---\n${input.narrationContext}`);
  }

  if (input.retryContext) {
    parts.push(
      `\n---\nPrevious assembly JSON failed validation:\n${input.retryContext.errorMessage}\n\nPrevious JSON:\n\`\`\`json\n${input.retryContext.previousJson}\n\`\`\`\n\nFix the JSON and return the corrected assembly.`
    );
  }

  parts.push(
    `\nReturn ONLY the \`\`\`json assembly block. No explanations.`
  );

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// JSON extraction from model output
// ---------------------------------------------------------------------------

/**
 * Parse the assembly JSON out of raw model output. Mirrors component-gen's
 * extractTsxFromOutput: prefer the first fenced code block, then try the
 * whole text, then the first balanced `{…}` (models sometimes add prose).
 */
function extractAssemblyJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("claude returned empty response.");
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidates = fenceMatch ? [fenceMatch[1].trim(), trimmed] : [trimmed];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // fall through to the balanced-brace attempt below
    }
    // First balanced {...} inside the candidate (prose around the fence).
    const start = candidate.indexOf("{");
    if (start >= 0) {
      let depth = 0;
      for (let i = start; i < candidate.length; i++) {
        if (candidate[i] === "{") depth++;
        else if (candidate[i] === "}") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(candidate.slice(start, i + 1));
            } catch {
              break;
            }
          }
        }
      }
    }
  }

  throw new Error(
    `assembly output is not valid JSON (first 200 chars): ${trimmed.slice(0, 200)}\n` +
      `请在下一轮只输出一个 \`\`\`json 代码块，结构为 {"component": 组件名, "props": {…}} 或 {"component": null, "reason": "…"}。`
  );
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Ask the configured agent for an assembly selection and validate it against
 * the registry.
 *
 * @returns { kind: "assembled", component, props } or
 *          { kind: "fallback", reason } when the model declares no fit.
 * @throws Error with model-actionable feedback when the output cannot be
 *         parsed or fails registry validation — the message is written to be
 *         fed back into the next attempt's retryContext.
 */
export async function generateAssembly(
  input: AssemblyGenInput,
  config: AnthropicConfig,
  signal?: AbortSignal
): Promise<AssemblyGenResult> {
  const driver = createAgentDriver(config);

  const result = await driver.generateText(
    {
      system: buildAssemblySystemPrompt(input.registryDocs),
      user: buildAssemblyUserContent(input),
      maxTokens: 4096,
    },
    signal
  );

  const json = extractAssemblyJson(result.text);
  const validation = validateAssembly(json);

  if (!validation.ok) {
    throw new Error(
      `assembly JSON failed registry validation:\n` +
        validation.errors.map((e) => `- ${e}`).join("\n") +
        `\n请修正 JSON：component 必须是注册组件名（或 null 表示无合适组件），` +
        `props 只允许使用该组件字段表中列出的字段，points/nodes/bars 数组长度 2–6。`
    );
  }

  const value = validation.value;
  if (value.component === null) {
    return { kind: "fallback", reason: value.reason, usage: result.usage };
  }
  return {
    kind: "assembled",
    component: value.component,
    props: value.props,
    usage: result.usage,
  };
}
