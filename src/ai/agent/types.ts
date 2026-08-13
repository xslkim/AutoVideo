/**
 * AgentDriver — provider-agnostic interface for LLM/agent backends.
 *
 * All LLM call sites (component generation, visual review, dict suggestions)
 * go through this interface instead of talking to a specific SDK or CLI.
 * Drivers encapsulate provider quirks (auth headers, CLI flags, output
 * parsing) so new backends (e.g. opencode CLI, OpenAI-compatible APIs) can
 * be added without touching the call sites.
 */

/**
 * Which backend executes agent calls.
 *
 * - "anthropic-api": Anthropic Messages API (also DeepSeek/GLM via their
 *   Anthropic-compatible endpoints + baseURL)
 * - "claude-cli":    local `claude` CLI (`claude login` credentials)
 * - "opencode-cli":  local `opencode` CLI (models configured in opencode)
 */
export type AgentProvider = "anthropic-api" | "claude-cli" | "opencode-cli";

/**
 * Connection/model configuration shared by all drivers.
 *
 * Mirrors autovideo.config.json → anthropic section. Structurally compatible
 * with the existing AnthropicConfig / VisualReviewConfig shapes so call sites
 * can pass their config through unchanged.
 */
export interface AgentConfig {
  /** Backend selection. When unset, falls back to legacy useCLI mapping. */
  provider?: AgentProvider;
  /**
   * Model identifier (driver applies its own default when empty).
   * anthropic-api: API model name (claude-sonnet-4-6 / deepseek-chat / glm-4.6…)
   * opencode-cli:  opencode `provider/model` form (e.g. deepseek/deepseek-chat)
   * claude-cli:    ignored (the CLI picks its logged-in default)
   */
  model?: string;
  /** Maximum SDK-level retries with exponential back-off (default: 3) */
  maxRetries?: number;
  /** Optional base URL for API proxy / Anthropic-compatible providers */
  baseURL?: string;
  /** Explicit API key (web mode) — if set, skips env/settings resolution */
  apiKey?: string;
  /** Legacy flag: true → "claude-cli". Superseded by `provider`. */
  useCLI?: boolean;
  /** Path to the CLI binary. Defaults to the provider's binary name. */
  cliPath?: string;
  /** Timeout for a single CLI invocation in ms (default: 600000) */
  cliTimeoutMs?: number;
}

/** A plain text-generation request (system + single user turn). */
export interface AgentTextRequest {
  /** System prompt (optional; omitted for simple one-shot prompts) */
  system?: string;
  /** User message content */
  user: string;
  /** Response token budget */
  maxTokens: number;
}

/** One image handed to a review request. */
export interface AgentImage {
  /** Absolute path to the image on disk */
  path: string;
  /**
   * Optional caption shown/sent immediately before the image
   * (e.g. frame timeline position + narration context).
   */
  caption?: string;
}

/** A multimodal review request: instructions + ordered images + trailer. */
export interface AgentImageReviewRequest {
  /** Reviewer instructions (system prompt in API mode) */
  instructions: string;
  /** Images in presentation order */
  images: AgentImage[];
  /** Text appended after the images (e.g. the intended slide description) */
  trailingText?: string;
  /** Response token budget */
  maxTokens: number;
}

/** Token usage for a call. CLI drivers that can't report usage return zeros. */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Result of any agent call: raw text + usage. Callers parse the text. */
export interface AgentResult {
  text: string;
  usage: AgentUsage;
}

/** What a driver can do — lets callers adapt (e.g. skip review w/o vision). */
export interface AgentCapabilities {
  /** Driver can process image inputs (reviewImages is meaningful) */
  vision: boolean;
  /** Driver reports real token usage (false → usage is always zeros) */
  usageReporting: boolean;
}

/** Provider-agnostic LLM/agent backend. */
export interface AgentDriver {
  readonly capabilities: AgentCapabilities;

  /** Generate text from a system + user prompt. */
  generateText(req: AgentTextRequest, signal?: AbortSignal): Promise<AgentResult>;

  /** Review images and return the model's textual verdict. */
  reviewImages(req: AgentImageReviewRequest, signal?: AbortSignal): Promise<AgentResult>;
}
