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
  /** Max concurrent TTS lines */
  concurrency: number;
}

export interface TtsConfig {
  /**
   * Which speech engine the TTS stage uses. Engine-specific settings live in
   * that engine's own section (e.g. `voxcpm`).
   */
  provider: "voxcpm";
}

export interface AnthropicConfig {
  /** Claude model to use for component generation */
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
   * When true, invoke the local `claude` CLI instead of the Anthropic SDK.
   * Reuses credentials from `claude login`; no API key required.
   */
  useCLI?: boolean;
  /** Path to the `claude` binary (default: "claude", must be in PATH). */
  cliPath?: string;
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
}

export interface AutoVideoConfig {
  tts: TtsConfig;
  voxcpm: VoxcpmConfig;
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
  },
  voxcpm: {
    endpoint: "http://127.0.0.1:8000",
    modelDir: "/path/to/VoxCPM2",
    cfgValue: 2.0,
    inferenceTimesteps: 10,
    denoise: false,
    retryBadcase: true,
    normalize: true,
    concurrency: 4,
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
 * The subtitle band itself is ~14 % of the height at two lines, so 0.15 left
 * only single-digit pixels of clearance and slides read as if they collide
 * with the text. 0.20 gives a comfortable gap on every aspect ratio.
 */
export const SUBTITLE_SAFE_BOTTOM_PCT = 0.2;
