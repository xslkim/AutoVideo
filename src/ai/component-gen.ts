/**
 * T4.2 — Claude SDK call + prompt cache
 *
 * Generates React component TSX from a visual description using
 * the Anthropic Claude API with prompt caching.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Anthropic Claude client (mirrors autovideo.config.json → anthropic section) */
export interface AnthropicConfig {
  /** Environment variable name that holds the API key (default: "ANTHROPIC_API_KEY") */
  apiKeyEnv: string;
  /** Model identifier (default: "claude-sonnet-4-6") */
  model: string;
  /** Enable prompt caching (default: true) */
  promptCaching: boolean;
  /** Maximum SDK-level retries with exponential back-off (default: 3) */
  maxRetries: number;
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
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  /** Whether the system prompt was served from the prompt cache */
  cacheHit: boolean;
}

// ---------------------------------------------------------------------------
// Tool definition — forces Claude to return structured { tsx: string }
// ---------------------------------------------------------------------------

const RENDER_COMPONENT_TOOL: Tool = {
  name: "render_component",
  description:
    "Render a React component for a video block. Returns the TSX source code.",
  input_schema: {
    type: "object" as const,
    properties: {
      tsx: {
        type: "string" as const,
        description:
          "Complete TSX source code of the React component. Must export a default function accepting AnimationProps.",
      },
    },
    required: ["tsx"],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the system prompt content block array with optional cache control.
 */
function buildSystemContent(
  systemPrompt: string,
  promptCaching: boolean
): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
  const block: {
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  } = {
    type: "text",
    text: systemPrompt,
  };

  if (promptCaching) {
    block.cache_control = { type: "ephemeral" };
  }

  return [block];
}

/**
 * Build the user message content from the visual description and optional retry context.
 */
function buildUserContent(
  input: ComponentGenInput
): Array<{ type: "text"; text: string }> {
  const parts: string[] = [];

  parts.push(
    `Generate a React component for the following visual description:\n\n${input.visualDescription}`
  );

  if (input.retryContext) {
    parts.push(
      `\n---\nPrevious attempt failed with the following error:\n${input.retryContext.errorMessage}\n\nPrevious TSX:\n\`\`\`tsx\n${input.retryContext.previousTsx}\n\`\`\`\n\nPlease fix the error and return the corrected component.`
    );
  }

  return [{ type: "text", text: parts.join("\n") }];
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Call Claude to generate a React component TSX from a visual description.
 *
 * Uses tool_choice to force the model to return structured `{ tsx: string }`
 * output via the `render_component` tool.
 *
 * System prompt is marked with `cache_control: { type: "ephemeral" }` for
 * prompt caching — the large system prompt (component template + theme tokens
 * + AnimationProps interface) stays constant across calls, so subsequent
 * blocks should hit the cache.
 *
 * @returns {tsx, usage, cacheHit}
 * @throws Error if API key is missing, or if the API returns a non-tool-use response
 */
export async function generateComponent(
  input: ComponentGenInput,
  config: AnthropicConfig
): Promise<ComponentGenResult> {
  // ---- Resolve API key -------------------------------------------------
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Anthropic API key not found. Set the ${config.apiKeyEnv} environment variable.`
    );
  }

  // ---- Create SDK client (max_retries uses built-in exponential back-off) --
  const client = new Anthropic({
    apiKey,
    maxRetries: config.maxRetries,
  });

  // ---- Build messages --------------------------------------------------
  const messages: MessageParam[] = [
    {
      role: "user",
      content: buildUserContent(input),
    },
  ];

  // ---- Call API --------------------------------------------------------
  const response: Message = await client.messages.create({
    model: config.model,
    max_tokens: 8192,
    system: buildSystemContent(input.systemPrompt, config.promptCaching),
    messages,
    tools: [RENDER_COMPONENT_TOOL],
    tool_choice: { type: "tool", name: "render_component" },
  });

  // ---- Extract TSX from tool_use response block -------------------------
  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUseBlock || toolUseBlock.name !== "render_component") {
    throw new Error(
      `Unexpected Claude response: expected tool_use block "render_component", got ${JSON.stringify(response.content)}`
    );
  }

  const tsx = (toolUseBlock.input as { tsx: string }).tsx;
  if (typeof tsx !== "string" || tsx.length === 0) {
    throw new Error(
      `Claude returned empty or invalid tsx in tool response: ${JSON.stringify(toolUseBlock.input)}`
    );
  }

  // ---- Build usage info ------------------------------------------------
  const cacheReadInputTokens =
    response.usage?.cache_read_input_tokens ?? 0;
  const cacheCreationInputTokens =
    response.usage?.cache_creation_input_tokens ?? 0;

  return {
    tsx,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheCreationInputTokens:
        cacheCreationInputTokens > 0 ? cacheCreationInputTokens : undefined,
      cacheReadInputTokens:
        cacheReadInputTokens > 0 ? cacheReadInputTokens : undefined,
    },
    cacheHit: cacheReadInputTokens > 0,
  };
}

// ---------------------------------------------------------------------------
// Exports for testing / external inspection
// ---------------------------------------------------------------------------

export { RENDER_COMPONENT_TOOL, buildSystemContent, buildUserContent };