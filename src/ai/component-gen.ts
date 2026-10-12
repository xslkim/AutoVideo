/**
 * Generate React component TSX from a visual description.
 *
 * Transport (SDK vs local `claude` CLI) and credential resolution are
 * handled by the AgentDriver layer (src/ai/agent/). This module owns the
 * prompt construction and TSX extraction from raw model output.
 *
 * It also owns loading the design-system spec (remotion/library/DESIGN.md)
 * and appending it to every generation/assembly system prompt — see
 * withDesignGuidelines() below.
 */

import fs from "node:fs";
import path from "node:path";
import { createAgentDriver, type AgentConfig } from "./agent/index.js";

// ---------------------------------------------------------------------------
// Robust TSX extraction from model output
// ---------------------------------------------------------------------------

/**
 * Extract TSX code from raw model output.
 *
 * Models (especially non-Claude ones like GLM) often wrap code in markdown
 * fences and may add explanatory text before/after the fences.  The old
 * approach (strip first ``` and last ```) left surrounding text intact,
 * causing Babel parse errors like "Missing semicolon. (1:1)".
 *
 * This function:
 * 1. Finds the FIRST markdown code fence block and extracts its content.
 * 2. If no fences found, checks if the raw output already looks like TSX.
 * 3. Throws a descriptive error if no code can be extracted.
 */
function extractTsxFromOutput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("claude returned empty response.");
  }

  // Match the first ```tsx|typescript|ts|jsx|javascript|js ... ``` block
  const fenceMatch = trimmed.match(/```(?:tsx|typescript|ts|jsx|javascript|js)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    const code = fenceMatch[1].trim();
    if (code.length > 0) return code;
  }

  // No fences found — check if the output already looks like valid TSX.
  // Valid TSX typically starts with: import, const, function, export, //
  const firstLine = trimmed.split("\n")[0].trim();
  if (
    firstLine.startsWith("import ") ||
    firstLine.startsWith("//") ||
    firstLine.startsWith("/*") ||
    firstLine.startsWith("export ") ||
    firstLine.startsWith("const ") ||
    firstLine.startsWith("function ")
  ) {
    return trimmed;
  }

  // Last resort: return as-is and let the validator report the parse error
  // with enough context to debug
  throw new Error(
    `claude returned non-TSX output (first 200 chars): ${trimmed.slice(0, 200)}`
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the agent client (mirrors autovideo.config.json →
 * anthropic section). Extends AgentConfig with the fields the pipeline
 * always provides.
 */
export interface AnthropicConfig extends AgentConfig {
  /** Model identifier (default: "claude-sonnet-4-6") */
  model: string;
  /** Maximum SDK-level retries with exponential back-off (default: 3) */
  maxRetries: number;
}

/** Input for a single component-generation call */
export interface ComponentGenInput {
  /** The visual description from the block's --- visual --- section */
  visualDescription: string;
  /** System prompt (component template, theme tokens, AnimationProps interface) */
  systemPrompt: string;
  /**
   * Narration lines with their current timings, so the model can choreograph
   * beats that follow the voiceover. Components must still read the live
   * values from props.lineTimings — this context is for pacing intuition only.
   */
  narrationContext?: string;
  /** Previous attempt context for retry (error message + previous TSX), if any */
  retryContext?: RetryContext;
}

/** Context fed back to the model when a generated component fails validation */
export interface RetryContext {
  /** The TSX that was generated in the previous attempt */
  previousTsx: string;
  /** The validation error message */
  errorMessage: string;
}

/** Result returned from a successful component generation call */
export interface ComponentGenResult {
  /** The generated TSX string */
  tsx: string;
  /** Token usage from the API response */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Design-system guidelines (remotion/library/DESIGN.md)
// ---------------------------------------------------------------------------

/**
 * Locate remotion/library/DESIGN.md from this module's position. src/ai/
 * sits two levels below the repo root; the compiled dist/src/ai/ layout
 * resolves two levels up to dist/, so probe for the file two levels up and
 * fall back one more level (same scheme as src/render/sync-runtime.ts).
 * AUTOVIDEO_DESIGN_DOC overrides the path entirely (point it at a
 * nonexistent path to disable injection).
 */
function resolveDesignDocPath(): string {
  const override = process.env.AUTOVIDEO_DESIGN_DOC;
  if (override) return override;
  const here = path.dirname(new URL(import.meta.url).pathname);
  const twoUp = path.join(path.resolve(here, "../.."), "remotion", "library", "DESIGN.md");
  if (fs.existsSync(twoUp)) return twoUp;
  return path.join(path.resolve(here, "../../.."), "remotion", "library", "DESIGN.md");
}

let designGuidelinesCache: string | null = null;

/**
 * Read the design-system spec once per process (cached). A missing or
 * unreadable file is NOT fatal — generation falls back to the rules already
 * baked into the built-in prompts, and the injection becomes a no-op.
 */
export function loadDesignGuidelines(): string {
  if (designGuidelinesCache !== null) return designGuidelinesCache;
  let content = "";
  try {
    content = fs.readFileSync(resolveDesignDocPath(), "utf-8").trim();
  } catch {
    content = "";
  }
  designGuidelinesCache = content;
  return content;
}

/**
 * The design spec as a prompt section, or "" when unavailable. Callers
 * decide where in their prompt the section lands.
 */
export function buildDesignGuidelinesSection(): string {
  const doc = loadDesignGuidelines();
  if (!doc) return "";
  return `# Design system (remotion/library/DESIGN.md — normative, follow it)\n\n${doc}`;
}

/**
 * Append the design-system section to a system prompt. No-op when the doc
 * is unavailable, so callers never need to guard.
 */
export function withDesignGuidelines(systemPrompt: string): string {
  const section = buildDesignGuidelinesSection();
  return section ? `${systemPrompt}\n\n${section}` : systemPrompt;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the user message content from the visual description and optional retry context.
 */
function buildUserContent(
  input: ComponentGenInput
): string {
  const parts: string[] = [];

  parts.push(
    `Generate a React component for the following visual description:\n\n${input.visualDescription}`
  );

  if (input.narrationContext) {
    parts.push(`\n---\n${input.narrationContext}`);
  }

  if (input.retryContext) {
    parts.push(
      `\n---\nPrevious attempt failed with the following error:\n${input.retryContext.errorMessage}\n\nPrevious TSX:\n\`\`\`tsx\n${input.retryContext.previousTsx}\n\`\`\`\n\nPlease fix the error and return the corrected component.`
    );
  }

  parts.push(
    `\nReturn ONLY the TSX source code. No markdown fences, no explanations.`
  );

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Ask the configured agent to generate a React component TSX from a visual
 * description.
 *
 * @returns {tsx, usage}
 * @throws Error if credentials are missing, or if the model returns an empty
 *         or non-TSX response
 */
export async function generateComponent(
  input: ComponentGenInput,
  config: AnthropicConfig,
  signal?: AbortSignal
): Promise<ComponentGenResult> {
  const driver = createAgentDriver(config);

  const result = await driver.generateText(
    {
      system: withDesignGuidelines(input.systemPrompt),
      user: buildUserContent(input),
      maxTokens: 8192,
    },
    signal
  );

  // Extract TSX code from model output (handles markdown fences + surrounding text)
  const tsx = extractTsxFromOutput(result.text);

  return { tsx, usage: result.usage };
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { buildUserContent };
