/**
 * AnthropicApiDriver — AgentDriver over the Anthropic Messages API.
 *
 * Also covers Anthropic-compatible providers (DeepSeek `api.deepseek.com/anthropic`,
 * GLM `open.bigmodel.cn/api/anthropic`, …) via config.baseURL + config.apiKey.
 *
 * Credentials are resolved from:
 *   1. config.apiKey (web mode — explicit key from the settings UI)
 *   2. Environment variables (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY)
 *   3. ~/.claude/settings.json (cc-switch / Claude Code config)
 *   4. ~/.claude/.credentials.json (Claude Pro OAuth)
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import { readFileSync } from "node:fs";
import { resolveClaudeCredentials } from "../../config/claude-settings.js";
import type {
  AgentCapabilities,
  AgentConfig,
  AgentDriver,
  AgentImageReviewRequest,
  AgentResult,
  AgentTextRequest,
} from "./types.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

interface ResolvedCredentials {
  apiKey: string;
  baseURL?: string;
  model: string;
}

function resolveCredentials(config: AgentConfig): ResolvedCredentials {
  if (config.apiKey) {
    // Web mode: explicit key from config
    return {
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: config.model || DEFAULT_MODEL,
    };
  }

  // CLI mode: resolve from env / ~/.claude/settings.json
  const creds = resolveClaudeCredentials();
  if (!creds) {
    const err = new Error(
      "Claude credentials not found. Set ANTHROPIC_AUTH_TOKEN env var, or configure ~/.claude/settings.json via cc-switch."
    );
    (err as any).code = "ERR_ANTHROPIC_KEY_MISSING";
    throw err;
  }
  if (!creds.authToken) {
    const err = new Error("Anthropic API key is required but not provided.");
    (err as any).code = "ERR_ANTHROPIC_KEY_MISSING";
    throw err;
  }

  return {
    apiKey: creds.authToken,
    baseURL: config.baseURL || creds.baseUrl || undefined,
    model: config.model || creds.model || DEFAULT_MODEL,
  };
}

/**
 * Create the SDK client. OAuth (Claude Pro) tokens get Claude Code client
 * headers so Anthropic applies the correct rate-limit tier — without these
 * the request is treated as an anonymous API call and hits the lowest quota.
 */
function createClient(creds: ResolvedCredentials, maxRetries: number): Anthropic {
  const isOAuthToken = creds.apiKey.startsWith("sk-ant-oat");
  return new Anthropic({
    apiKey: creds.apiKey,
    maxRetries,
    baseURL: creds.baseURL,
    defaultHeaders: isOAuthToken
      ? {
          "anthropic-beta": "claude-code-20250219",
          "x-client-name": "claude-code",
          "x-client-version": "2.1.126",
        }
      : undefined,
  });
}

function toAgentResult(response: Message): AgentResult {
  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  return {
    text,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

export class AnthropicApiDriver implements AgentDriver {
  readonly capabilities: AgentCapabilities = { vision: true, usageReporting: true };

  constructor(private readonly config: AgentConfig) {}

  async generateText(req: AgentTextRequest, signal?: AbortSignal): Promise<AgentResult> {
    const creds = resolveCredentials(this.config);
    const client = createClient(creds, this.config.maxRetries ?? 3);

    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: creds.model,
      max_tokens: req.maxTokens,
      messages: [{ role: "user", content: req.user }],
    };
    if (req.system) params.system = req.system;
    // DeepSeek (Anthropic 兼容端点): 避免 thinking 吃掉输出预算。该参数不在 SDK
    // 的类型里，对象字面量直接写会触发多余属性检查，经松散类型开口设置。
    // 对 Anthropic 原生模型 thinking 默认关闭，此参数无副作用。
    (params as unknown as Record<string, unknown>).thinking = { type: "disabled" };

    const response = await client.messages.create(params, { signal });
    return toAgentResult(response);
  }

  async reviewImages(req: AgentImageReviewRequest, signal?: AbortSignal): Promise<AgentResult> {
    const creds = resolveCredentials(this.config);
    const client = createClient(creds, this.config.maxRetries ?? 3);

    const content: Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam> = [];
    for (const image of req.images) {
      if (image.caption) {
        content.push({ type: "text", text: `${image.caption}:` });
      }
      const base64 = readFileSync(image.path).toString("base64");
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: base64 },
      });
    }
    if (req.trailingText) {
      content.push({ type: "text", text: req.trailingText });
    }

    const response = await client.messages.create(
      {
        model: creds.model,
        max_tokens: req.maxTokens,
        system: req.instructions,
        messages: [{ role: "user", content }],
      },
      { signal },
    );
    return toAgentResult(response);
  }
}
