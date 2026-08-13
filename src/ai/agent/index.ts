/**
 * Agent driver factory.
 *
 * Selects the backend from config:
 *   - useCLI: true  → ClaudeCliDriver (local `claude` CLI, `claude login` creds)
 *   - otherwise     → AnthropicApiDriver (Anthropic Messages API, also covers
 *                     Anthropic-compatible providers like DeepSeek/GLM via baseURL)
 *
 * Future providers (opencode CLI, OpenAI-compatible APIs) plug in here.
 */

import type { AgentConfig, AgentDriver } from "./types.js";
import { AnthropicApiDriver } from "./anthropic-api.js";
import { ClaudeCliDriver } from "./claude-cli.js";

export function createAgentDriver(config: AgentConfig): AgentDriver {
  if (config.useCLI) {
    return new ClaudeCliDriver(config);
  }
  return new AnthropicApiDriver(config);
}

export { AnthropicApiDriver } from "./anthropic-api.js";
export { ClaudeCliDriver } from "./claude-cli.js";
export type {
  AgentCapabilities,
  AgentConfig,
  AgentDriver,
  AgentImage,
  AgentImageReviewRequest,
  AgentResult,
  AgentTextRequest,
  AgentUsage,
} from "./types.js";
