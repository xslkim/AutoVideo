/**
 * Generate React component TSX from a visual description using Claude API.
 *
 * Credentials are resolved from:
 *   1. Environment variables (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY)
 *   2. ~/.claude/settings.json (cc-switch / Claude Code config)
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { resolveClaudeCredentials } from "../config/claude-settings.js";

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
}

/** Input for a single component-generation call */
export interface ComponentGenInput {
  /** The visual description from the block's --- visual --- section */
  visualDescription: string;
  /** System prompt (component template, theme tokens, AnimationProps interface) */
  systemPrompt: string;
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
 * Call Claude to generate a React component TSX from a visual description.
 *
 * @returns {tsx, usage}
 * @throws Error if credentials are missing, or if the API returns an empty response
 */
export async function generateComponent(
  input: ComponentGenInput,
  config: AnthropicConfig
): Promise<ComponentGenResult> {
  // ---- Resolve credentials ------------------------------------------------
  const creds = resolveClaudeCredentials();
  if (!creds) {
    throw new Error(
      "Claude credentials not found. Set ANTHROPIC_AUTH_TOKEN env var, or configure ~/.claude/settings.json via cc-switch."
    );
  }

  const apiKey = creds.authToken;
  const baseURL = config.baseURL || creds.baseUrl;
  const model = config.model || creds.model || "claude-sonnet-4-6";

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
  const response: Message = await client.messages.create({
    model,
    max_tokens: 8192,
    system: input.systemPrompt,
    messages,
  });

  // ---- Extract TSX from response -------------------------------------------
  let tsx = "";
  for (const block of response.content) {
    if (block.type === "text") {
      tsx += block.text;
    }
  }

  // Strip markdown code fences if present
  tsx = tsx
    .replace(/^```(?:tsx|typescript|jsx|javascript)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  if (tsx.length === 0) {
    throw new Error(
      "Claude returned empty response."
    );
  }

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
