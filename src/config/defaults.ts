/**
 * AutoVideo — Default configuration values
 *
 * Based on PRD §9 "配置"
 *
 * These defaults are used when no autovideo.config.json exists
 * and no CLI overrides are provided.
 */

// ---------------------------------------------------------------------------
// Types — mirrors the structure of autovideo.config.json (PRD §9)
// ---------------------------------------------------------------------------

export interface VoxcpmConfig {
  /** voxcpm2-api service endpoint */
  endpoint: string;
  /** Model weights directory (used for cache-key versioning) */
  modelDir: string;
  /** Classifier-free guidance strength */
  cfgValue: number;
  /** Diffusion inference steps */
  inferenceTimesteps: number;
  /** Whether to denoise reference audio */
  denoise: boolean;
  /** VoxCPM internal bad-case retry */
  retryBadcase: boolean;
  /** Run wetext normalization (numbers, units, symbols) before synthesis */
  normalize: boolean;
  /**
   * Salt folded into the server-side deterministic seed (empty = stable
   * default). Change to any string to re-roll all takes. When set, it joins
   * the audio cache key — a new salt therefore re-synthesizes everything.
   */
  seedSalt?: string;
  /** Max concurrent TTS lines */
  concurrency: number;
}

export interface CosyVoiceConfig {
  /** cosyvoice-tts service endpoint */
  endpoint: string;
  /** Fun-CosyVoice3 model weights directory (used for cache-key versioning) */
  modelDir: string;
  /**
   * Transcript of the voiceRef reference wav. CosyVoice zero-shot cloning
   * requires the reference transcript; when unset, the provider falls back to
   * a same-named `.txt` file next to the voiceRef wav (e.g. B00.wav → B00.txt).
   */
  referenceText?: string;
  /**
   * Run the engine's text normalization (numbers, symbols) before synthesis.
   * CJK↔ASCII boundary spacing is always applied server-side regardless.
   */
  normalize: boolean;
  /**
   * Speaking-rate multiplier passed to the engine (>1 = faster, 0.5–2.0).
   * Zero-shot cloning inherits the reference recording's pace, so a slow
   * reference calls for e.g. 1.2. When set (!= 1.0), it joins the audio
   * cache key — changing it re-synthesizes everything.
   */
  speed?: number;
  /**
   * Salt folded into the server-side deterministic seed (empty = stable
   * default). Change to any string to re-roll all takes. When set, it joins
   * the audio cache key — a new salt therefore re-synthesizes everything.
   */
  seedSalt?: string;
  /** Max concurrent TTS lines (the server serializes GPU generation; keep 1) */
  concurrency: number;
}

export interface TtsQaConfig {
  /**
   * Per-line synthesis QA gate: analyze each take with ffmpeg (duration vs
   * text length, silence ratio, guard-level peaks, RMS) and re-roll flagged takes
   * with a per-call salt. Default on; false restores the old behavior.
   */
  enabled?: boolean;
  /**
   * Max QA re-rolls per line (default 2). When every take stays flagged the
   * best-scoring one is accepted with a warning — the stage never aborts.
   */
  maxRetries?: number;
}

export interface TtsConfig {
  /**
   * Which speech engine the TTS stage uses. Engine-specific settings live in
   * that engine's own section (e.g. `voxcpm`, `cosyvoice`).
   */
  provider: "voxcpm" | "cosyvoice";
  /** Synthesis QA gate (see src/tts/qa.ts); omitted fields use the defaults. */
  qa?: TtsQaConfig;
}

/**
 * Audio post-processing pipeline version, folded into every TTS provider's
 * cacheDescriptor. Bump when client/server post-processing changes (e.g.
 * server clip-guard, per-line gain alignment) so previously cached audio
 * invalidates once instead of silently mixing old and new levels.
 */
export const TTS_PIPELINE_VERSION = "2";

/** Agent backend. See src/ai/agent/types.ts (AgentProvider). */
export type AgentProviderName = "anthropic-api" | "claude-cli" | "opencode-cli" | "codex-cli";

/** 思考强度档位。See src/ai/agent/types.ts (ThinkingMode). */
export type ThinkingMode = "off" | "low" | "medium" | "high";

export interface AnthropicConfig {
  /**
   * Agent backend:
   * - "anthropic-api": Anthropic Messages API（DeepSeek/GLM 走各自的
   *   Anthropic 兼容端点 + baseURL）
   * - "claude-cli":    本地 claude CLI（claude login 凭证）
   * - "opencode-cli":  本地 opencode CLI（模型在 opencode 里配置）
   * - "codex-cli":     本地 codex CLI（OpenAI 登录，或 baseURL+apiKey 接
   *   Responses API 端点：DeepSeek 官方 / GLM 走 OpenRouter 或本地代理）
   * 未设置时按 legacy useCLI 映射（true → claude-cli）。
   */
  provider?: AgentProviderName;
  /** Model for component generation (API model name, or opencode provider/model) */
  model: string;
  /** Max retries on API failure */
  maxRetries: number;
  /** Optional base URL for API proxy (e.g. "https://open.bigmodel.cn/api/anthropic") */
  baseURL?: string;
  /** Explicit API key (web mode) — if set, skips env/settings resolution */
  apiKey?: string;
  /** Max concurrent block generation calls */
  concurrency: number;
  /**
   * Legacy flag（被 provider 取代，仍兼容）：true → 走本地 `claude` CLI。
   */
  useCLI?: boolean;
  /** Path to the agent CLI binary (default: provider's binary name). */
  cliPath?: string;
  /** Timeout for a single CLI invocation in ms (default: 600000). */
  cliTimeoutMs?: number;
  /**
   * 思考强度（仅 anthropic-api 驱动生效）：
   * "off" 关闭思考（thinking: disabled，现状默认）；
   * "low"/"medium"/"high" 对应 thinking.budget_tokens 2048/8192/32768
   * （clamp 到 max_tokens-1，低于 Anthropic 下限 1024 时退化为 "off"）。
   */
  thinking?: ThinkingMode;
  /**
   * 视觉评审的独立 agent 配置（可选，未设置的字段沿用上面的生成配置）。
   * 评审需要多模态：生成模型没有视觉能力时（如 deepseek-chat），
   * 在这里指定一个支持看图的模型。
   */
  review?: AgentReviewConfig;
}

/** Per-field overrides for the visual-review agent (falls back to generation config). */
export interface AgentReviewConfig {
  provider?: AgentProviderName;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  cliPath?: string;
  cliTimeoutMs?: number;
}

export interface LoudnormConfig {
  /** Integrated loudness target (LUFS) */
  i: number;
  /** True peak ceiling (dBTP) */
  tp: number;
  /** Loudness range (LU) */
  lra: number;
  /** Use two-pass loudnorm (more accurate) */
  twoPass: boolean;
  /** Audio bitrate for second pass re-encode */
  audioBitrate: string;
}

/**
 * Encoding quality for block partials.
 *
 * Remotion's own defaults are `imageFormat: "jpeg"` + `jpegQuality: 80` + `crf: 18`,
 * which puts a lossy JPEG step in front of x264. On dark slides with thin text and
 * hairlines that shows up as ringing around glyphs, so AutoVideo defaults to
 * lossless PNG frame capture instead.
 */
export interface QualityConfig {
  /** Frame capture format. "png" is lossless; "jpeg" is faster but adds artifacts. */
  imageFormat: "png" | "jpeg";
  /** JPEG quality 1–100; only read when imageFormat is "jpeg". */
  jpegQuality: number;
  /** x264 constant rate factor, 1–51. Lower is better quality and a bigger file. */
  crf: number;
  /** x264 speed/compression tradeoff. "slow" buys ~10 % bitrate at ~1.6× the time. */
  x264Preset:
    | "ultrafast"
    | "superfast"
    | "veryfast"
    | "faster"
    | "fast"
    | "medium"
    | "slow"
    | "slower"
    | "veryslow";
  /** Output pixel format. yuv420p is the only universally playable choice. */
  pixelFormat: "yuv420p" | "yuv422p" | "yuv444p";
  /** Color primaries/transfer tagging. Explicit bt709 avoids washed-out playback. */
  colorSpace: "bt709" | "bt2020-ncl" | "default";
}

export interface RenderConfig {
  /** Max concurrent block renders */
  blockConcurrency: number;
  /** Frames concurrency per block; null = auto (floor(cpus / blockConcurrency)) */
  framesConcurrencyPerBlock: number | null;
  /** Browser executable path; null = Remotion auto-detect */
  browser: string | null;
  /** Headless browser setup timeout in ms (default 120000); increase for slow WSL2 */
  browserTimeoutMs: number;
  /** Allow Chromium multi-process on Linux; false = --single-process (better for WSL2) */
  enableMultiProcessOnLinux: boolean;
  /** Minimum hold duration (seconds) for timing calculation */
  minHoldSec: number;
  /** Default enter animation duration (seconds) */
  defaultEnterSec: number;
  /** Default exit animation duration (seconds) */
  defaultExitSec: number;
  /** Loudnorm normalization settings */
  loudnorm: LoudnormConfig;
  /** Video encoding quality for block partials and the avatar overlay pass */
  quality: QualityConfig;
}

/**
 * HTML visual mode renderer settings (@visual: html).
 *
 * html blocks are rendered by a headless Chrome (puppeteer-core) that reuses
 * the Remotion-installed Chrome Headless Shell — no extra browser download.
 * See docs/architecture/HTML_VISUAL_PRD.md §4.3 for the browser resolution chain.
 */
export interface HtmlRenderConfig {
  /** Master switch; false disables @visual: html (blocks fall back to animation). */
  enabled: boolean;
  /**
   * Explicit Chrome executable path. null = walk the resolution chain:
   * config.render.browser → @remotion/renderer ensureBrowser() →
   * PUPPETEER_EXECUTABLE_PATH → system google-chrome/chromium.
   */
  browserExecutable: string | null;
  /** Per-frame screenshot timeout in ms (default 30000). */
  frameTimeoutMs: number;
  /** window.__seek(t) evaluate timeout in ms (default 5000). */
  seekTimeoutMs: number;
}

export type ImageGenProvider = "openai" | "sensenova";

export interface ImageGenConfig {
  /** Backend: OpenAI-compatible API or local SenseNova-U1 web_t2i */
  provider?: ImageGenProvider;
  /** API base URL (e.g. https://api.openai.com or http://127.0.0.1:8765) */
  baseURL?: string;
  /** API key (required for openai; optional for sensenova) */
  apiKey?: string;
  /** Model identifier (openai only) */
  model: string;
  /** Output image size (e.g. "1920x1080"); computed from meta.aspect if not set */
  size?: string;
  /** Request timeout in ms */
  timeoutMs: number;
  /** Max concurrent image generation calls */
  concurrency: number;
  /** SenseNova: diffusion steps (default 15) */
  numSteps?: number;
  /** SenseNova: classifier-free guidance scale (default 4.0) */
  cfgScale?: number;
}

export interface MusetalkConfig {
  /** MuseTalk lipsync service URL (e.g. "http://localhost:8001") */
  url?: string;
}

export interface CacheConfig {
  /** Cache root directory (supports ~ expansion) */
  dir: string;
  /** Maximum cache size in GB */
  maxSizeGB: number;
  /** When to trigger eviction: "stage-start" | "manual" */
  evictTrigger: "stage-start" | "manual";
}

export interface VisualQualityConfig {
  /** Enable the visual-quality feedback loop (render still + metrics + review) */
  enabled: boolean;
  /** Minimum height-relative coefficient for the largest font (e.g. 0.07 → height*0.07) */
  minFontCoeff: number;
  /**
   * Minimum height-relative coefficient for the smallest font (e.g. 0.030 →
   * 32px on 1080p). Captions below this are unreadable on a phone.
   */
  minAnyFontCoeff: number;
  /** Minimum number of visible JSX elements a slide must contain */
  minElements: number;
  /** Minimum fraction (0..1) of the canvas grid that must carry visible content */
  minCoverage: number;
  /** Maximum fraction (0..1) of the canvas grid that may carry visible content — above this the slide is too dense */
  maxCoverage: number;
  /** Run the multimodal visual review (plan B) after deterministic metrics pass */
  review: boolean;
  /** Max number of review-driven regeneration rounds (separate from correctness retries) */
  maxReviewRounds: number;
  /**
   * Animation-block generation strategy: "first" asks the model for a JSON
   * assembly of a prefab library component (src/ai/assembly-gen.ts) and falls
   * back to free TSX generation inside the same retry loop when assembly keeps
   * failing or no component fits; "off" keeps the legacy free-generation-only
   * path. Defaults to "first".
   */
  assembly?: "first" | "off";
}

export interface AutoVideoConfig {
  tts: TtsConfig;
  voxcpm: VoxcpmConfig;
  cosyvoice: CosyVoiceConfig;
  anthropic: AnthropicConfig;
  imageGen: ImageGenConfig;
  render: RenderConfig;
  cache: CacheConfig;
  /** MuseTalk lipsync service (optional; only needed for avatar lip-sync) */
  musetalk?: MusetalkConfig;
  /** Visual-quality feedback loop (optional; falls back to DEFAULT_VISUAL_QUALITY) */
  visualQuality?: VisualQualityConfig;
  /** HTML visual mode renderer (@visual: html; optional; falls back to DEFAULT_HTML_RENDER) */
  htmlRender?: HtmlRenderConfig;
}

// ---------------------------------------------------------------------------
// Defaults — exhaustive per PRD §9
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: AutoVideoConfig = {
  tts: {
    provider: "voxcpm",
    qa: { enabled: true, maxRetries: 2 },
  },
  voxcpm: {
    endpoint: "http://127.0.0.1:8000",
    modelDir: "/path/to/VoxCPM2",
    cfgValue: 2.0,
    inferenceTimesteps: 10,
    denoise: false,
    retryBadcase: true,
    normalize: true,
    seedSalt: "",
    concurrency: 4,
  },
  cosyvoice: {
    endpoint: "http://127.0.0.1:8002",
    modelDir: "/path/to/Fun-CosyVoice3-0.5B",
    normalize: true,
    speed: 1.0,
    seedSalt: "",
    concurrency: 1,
  },
  anthropic: {
    model: "claude-sonnet-4-6",
    maxRetries: 3,
    concurrency: 1,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  },
  imageGen: {
    provider: (process.env.IMAGE_GEN_PROVIDER as ImageGenProvider | undefined) || undefined,
    baseURL: process.env.IMAGE_GEN_BASE_URL,
    apiKey: process.env.IMAGE_GEN_API_KEY,
    model: "gpt-image-1",
    timeoutMs: 600000,
    concurrency: 1,
    numSteps: 15,
    cfgScale: 4.0,
  },
  render: {
    blockConcurrency: 4,
    framesConcurrencyPerBlock: null,
    browser: null,
    browserTimeoutMs: 120000,
    enableMultiProcessOnLinux: false,
    minHoldSec: 1.5,
    defaultEnterSec: 0.5,
    defaultExitSec: 0.3,
    loudnorm: {
      i: -16,
      tp: -1.5,
      lra: 11,
      twoPass: true,
      audioBitrate: "192k",
    },
    quality: {
      imageFormat: "png",
      jpegQuality: 100,
      crf: 16,
      x264Preset: "medium",
      pixelFormat: "yuv420p",
      colorSpace: "bt709",
    },
  },
  cache: {
    dir: "~/.autovideo/cache",
    maxSizeGB: 20,
    evictTrigger: "stage-start",
  },
  musetalk: {
    url: "http://localhost:8001",
  },
  visualQuality: {
    enabled: true,
    minFontCoeff: 0.07,
    minAnyFontCoeff: 0.028,
    minElements: 4,
    minCoverage: 0.6,
    maxCoverage: 0.92,
    review: true,
    maxReviewRounds: 1,
    assembly: "first",
  },
  htmlRender: {
    enabled: true,
    browserExecutable: null,
    frameTimeoutMs: 30000,
    seekTimeoutMs: 5000,
  },
};

/** Fallback used when a config object omits the visualQuality section. */
export const DEFAULT_VISUAL_QUALITY: VisualQualityConfig = DEFAULT_CONFIG.visualQuality!;

/** Fallback used when a config object omits the htmlRender section. */
export const DEFAULT_HTML_RENDER: HtmlRenderConfig = DEFAULT_CONFIG.htmlRender!;

/** Fallback used when a config object omits render.quality. */
export const DEFAULT_QUALITY: QualityConfig = DEFAULT_CONFIG.render.quality;

/**
 * Fraction of the frame height reserved at the bottom for subtitles.
 *
 * Doubles as BOTH the content-avoidance band AND the subtitle capsule's
 * height budget — SubtitleOverlay.fitFontSize auto-shrinks captions to fit
 * inside (band − bottomMarginPx), so keep it ≥ the capsule's real height or
 * captions will overlap content.
 *
 * Math @1080p with the dark-code theme (fontSizePct 0.04 → 43.2px base,
 * lineHeight 1.4, paddingPx 14, bottomMarginPx 0 — capsule 紧贴视频下边缘):
 *   single-line capsule = 43.2 × 1.4 + 28 ≈ 88.5px → band ≥ 89px minimum
 *   two-line capsule ≈ 149px → needs band ≥ 149px for full size
 * 120/1080 → single-line captions render at full 43.2px (normal lines are
 * short); only ≥36-char lines wrap to two lines and shrink to ~27px.
 */
export const SUBTITLE_SAFE_BOTTOM_PCT = 120 / 1080;
