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
 * Connection/model configuration shared by all drivers.
 *
 * Mirrors autovideo.config.json → anthropic section. Structurally compatible
 * with the existing AnthropicConfig / VisualReviewConfig shapes so call sites
 * can pass their config through unchanged.
 */
export interface AgentConfig {
  /** Model identifier (driver applies its own default when empty) */
  model?: string;
  /** Maximum SDK-level retries with exponential back-off (default: 3) */
  maxRetries?: number;
  /** Optional base URL for API proxy / Anthropic-compatible providers */
  baseURL?: string;
  /** Explicit API key (web mode) — if set, skips env/settings resolution */
  apiKey?: string;
  /** When true, invoke a local agent CLI instead of the HTTP API */
  useCLI?: boolean;
  /** Path to the CLI binary. Defaults to "claude" (must be in PATH). */
  cliPath?: string;
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
