/**
 * Generate React component TSX from a visual description using Claude API.
 *
 * Credentials are resolved from:
 *   1. Environment variables (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY)
 *   2. ~/.claude/settings.json (cc-switch / Claude Code config)
 *
 * When config.useCLI is true, the local `claude` CLI is invoked instead of
 * the Anthropic SDK.  This avoids API-key setup and reuses whatever account
 * is already logged in via `claude login`.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { resolveClaudeCredentials } from "../config/claude-settings.js";
import { spawn } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

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

/** Configuration for the Claude client (mirrors autovideo.config.json → anthropic section) */
export interface AnthropicConfig {
  /** Model identifier (default: "claude-sonnet-4-6") */
  model: string;
  /** Maximum SDK-level retries with exponential back-off (default: 3) */
  maxRetries: number;
  /** Optional base URL for API proxy */
  baseURL?: string;
  /** Explicit API key (web mode) — if set, skips env/settings resolution */
  apiKey?: string;
  /**
   * When true, invoke the local `claude` CLI instead of the Anthropic SDK.
   * The CLI reuses whatever credentials are active via `claude login`.
   */
  useCLI?: boolean;
  /** Path to the `claude` binary. Defaults to "claude" (must be in PATH). */
  cliPath?: string;
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
// CLI-based generation (useCLI mode)
// ---------------------------------------------------------------------------

/**
 * Invoke the local `claude` CLI in non-interactive print mode to generate
 * a component.  System prompt is written to a temp file to avoid shell
 * argument length limits; user content is piped via stdin.
 */
async function generateComponentViaCLI(
  input: ComponentGenInput,
  config: AnthropicConfig,
  signal?: AbortSignal
): Promise<ComponentGenResult> {
  if (signal?.aborted) {
    throw Object.assign(new Error("Cancelled"), { code: "ERR_CANCELLED" });
  }

  const cliPath = config.cliPath || "claude";
  const userContent = buildUserContent(input);

  // Write system prompt to a temp file to avoid CLI argument length limits
  const tmpFile = join(
    os.tmpdir(),
    `autovideo-sp-${crypto.randomBytes(8).toString("hex")}.txt`
  );
  writeFileSync(tmpFile, input.systemPrompt, "utf-8");

  const args = [
    "-p",
    "--no-session-persistence",
    "--dangerously-skip-permissions",
    "--output-format", "text",
    "--system-prompt-file", tmpFile,
  ];

  // NOTE: we intentionally do NOT forward --model to the CLI.
  // The CLI picks its own default (typically the fastest available model).
  // Forcing a specific model via --model switches to a different backend that
  // can be orders of magnitude slower with large system prompts, causing the
  // invocation to hang until the server-side timeout kills it.

  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const proc = spawn(cliPath, args, { stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      // Feed user prompt via stdin
      proc.stdin.write(userContent, "utf-8");
      proc.stdin.end();

      proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on("close", (code) => {
        if (code === 0) {
          settle(() => resolve(stdout));
        } else {
          const detail = stderr.trim() || stdout.trim();
          settle(() =>
            reject(new Error(`claude CLI exited ${code}: ${detail.slice(0, 500)}`))
          );
        }
      });

      proc.on("error", (err: Error) => {
        settle(() => reject(new Error(`Failed to spawn claude: ${err.message}`)));
      });

      // Support cancellation via AbortSignal
      if (signal) {
        const onAbort = () => {
          proc.kill("SIGTERM");
          settle(() =>
            reject(Object.assign(new Error("Cancelled"), { code: "ERR_CANCELLED" }))
          );
        };
        signal.addEventListener("abort", onAbort, { once: true });
        proc.on("close", () => signal.removeEventListener("abort", onAbort));
      }
    });

    // Extract TSX code from model output (handles markdown fences + surrounding text)
    const tsx = extractTsxFromOutput(raw);

    return { tsx, usage: { inputTokens: 0, outputTokens: 0 } };
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Call Claude to generate a React component TSX from a visual description.
 *
 * @returns {tsx, usage}
 * @throws Error if credentials are missing, or if the API returns an empty response
 */
export async function generateComponent(
  input: ComponentGenInput,
  config: AnthropicConfig,
  signal?: AbortSignal
): Promise<ComponentGenResult> {
  // ---- Dispatch to CLI mode if requested ----------------------------------
  if (config.useCLI) {
    return generateComponentViaCLI(input, config, signal);
  }

  // ---- Resolve credentials ------------------------------------------------
  let apiKey: string | undefined;
  let baseURL: string | undefined;
  let model: string;

  if (config.apiKey) {
    // Web mode: explicit key from config
    apiKey = config.apiKey;
    baseURL = config.baseURL;
    model = config.model || "claude-sonnet-4-6";
  } else {
    // CLI mode: resolve from env / ~/.claude/settings.json
    const creds = resolveClaudeCredentials();
    if (!creds) {
      const err = new Error(
        "Claude credentials not found. Set ANTHROPIC_AUTH_TOKEN env var, or configure ~/.claude/settings.json via cc-switch."
      );
      (err as any).code = "ERR_ANTHROPIC_KEY_MISSING";
      throw err;
    }
    apiKey = creds.authToken;
    baseURL = config.baseURL || creds.baseUrl;
    model = config.model || creds.model || "claude-sonnet-4-6";
  }

  if (!apiKey) {
    const err = new Error("Anthropic API key is required but not provided.");
    (err as any).code = "ERR_ANTHROPIC_KEY_MISSING";
    throw err;
  }

  // ---- Create SDK client --------------------------------------------------
  // Pass Claude Code client headers so Anthropic can apply the correct rate-limit
  // tier for OAuth (Claude Pro) tokens — without these the request is treated as
  // an anonymous API call and hits the lowest quota bucket.
  const isOAuthToken = apiKey.startsWith("sk-ant-oat");
  const client = new Anthropic({
    apiKey,
    maxRetries: config.maxRetries,
    baseURL,
    defaultHeaders: isOAuthToken
      ? {
          "anthropic-beta": "claude-code-20250219",
          "x-client-name": "claude-code",
          "x-client-version": "2.1.126",
        }
      : undefined,
  });

  // ---- Build messages -----------------------------------------------------
  const userContent = buildUserContent(input);

  const messages: MessageParam[] = [
    {
      role: "user",
      content: userContent,
    },
  ];

  // ---- Call API -----------------------------------------------------------
  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: 8192,
    system: input.systemPrompt,
    messages,
  };
  // DeepSeek: 避免 thinking 吃掉输出预算。该参数不在 SDK 的 Anthropic 类型里，
  // 对象字面量直接写会触发多余属性检查，经松散类型开口设置。
  (params as unknown as Record<string, unknown>).thinking = { type: "disabled" };
  const response: Message = await client.messages.create(params, {
    signal,
  });

  // ---- Extract TSX from response -------------------------------------------
  let tsx = "";
  for (const block of response.content) {
    if (block.type === "text") {
      tsx += block.text;
    }
  }

  // Extract TSX code from model output (handles markdown fences + surrounding text)
  tsx = extractTsxFromOutput(tsx);

  return {
    tsx,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { buildUserContent };
