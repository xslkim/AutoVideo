/**
 * Agent driver factory.
 *
 * Backend selection (config.provider, falling back to legacy useCLI):
 *   - "anthropic-api" → Anthropic Messages API; also covers Anthropic-
 *                       compatible providers (DeepSeek/GLM) via baseURL
 *   - "claude-cli"    → local `claude` CLI (`claude login` credentials)
 *   - "opencode-cli"  → local `opencode` CLI (models configured in opencode)
 *   - "codex-cli"     → local `codex` CLI (OpenAI login, or DeepSeek/GLM via
 *                       Responses-API baseURL + apiKey)
 */

import type { AgentConfig, AgentDriver, AgentProvider } from "./types.js";
import { AnthropicApiDriver } from "./anthropic-api.js";
import { ClaudeCliDriver } from "./claude-cli.js";
import { OpencodeCliDriver } from "./opencode-cli.js";
import { CodexCliDriver } from "./codex-cli.js";

/** Effective provider: explicit `provider` wins; legacy useCLI → claude-cli. */
export function resolveAgentProvider(config: AgentConfig): AgentProvider {
  if (config.provider) return config.provider;
  return config.useCLI ? "claude-cli" : "anthropic-api";
}

/** Default binary name for a CLI provider (when cliPath is not configured). */
export function defaultCliBinary(provider: AgentProvider): string {
  switch (provider) {
    case "opencode-cli": return "opencode";
    case "codex-cli": return "codex";
    default: return "claude";
  }
}

export function createAgentDriver(config: AgentConfig): AgentDriver {
  switch (resolveAgentProvider(config)) {
    case "claude-cli":
      return new ClaudeCliDriver(config);
    case "opencode-cli":
      return new OpencodeCliDriver(config);
    case "codex-cli":
      return new CodexCliDriver(config);
    case "anthropic-api":
      return new AnthropicApiDriver(config);
  }
}

export { AnthropicApiDriver } from "./anthropic-api.js";
export { ClaudeCliDriver } from "./claude-cli.js";
export { OpencodeCliDriver } from "./opencode-cli.js";
export { CodexCliDriver } from "./codex-cli.js";
export { checkCliVersion, DEFAULT_CLI_TIMEOUT_MS } from "./cli-common.js";
export type {
  AgentCapabilities,
  AgentConfig,
  AgentDriver,
  AgentImage,
  AgentImageReviewRequest,
  AgentProvider,
  AgentResult,
  AgentTextRequest,
  AgentUsage,
} from "./types.js";
