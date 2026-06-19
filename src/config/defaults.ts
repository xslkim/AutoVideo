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
  /** Model weights directory (for autoStart) */
  modelDir: string;
  /** Auto-start voxcpm2-api when unreachable */
  autoStart: boolean;
  /** Classifier-free guidance strength */
  cfgValue: number;
  /** Diffusion inference steps */
  inferenceTimesteps: number;
  /** Whether to denoise reference audio */
  denoise: boolean;
  /** VoxCPM internal bad-case retry */
  retryBadcase: boolean;
  /** Max concurrent TTS lines */
  concurrency: number;
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
  /** Minimum number of visible JSX elements a slide must contain */
  minElements: number;
  /** Minimum fraction (0..1) of the canvas grid that must carry visible content */
  minCoverage: number;
  /** Run the multimodal visual review (plan B) after deterministic metrics pass */
  review: boolean;
  /** Max number of review-driven regeneration rounds (separate from correctness retries) */
  maxReviewRounds: number;
}

export interface AutoVideoConfig {
  voxcpm: VoxcpmConfig;
  anthropic: AnthropicConfig;
  imageGen: ImageGenConfig;
  render: RenderConfig;
  cache: CacheConfig;
  /** Visual-quality feedback loop (optional; falls back to DEFAULT_VISUAL_QUALITY) */
  visualQuality?: VisualQualityConfig;
}

// ---------------------------------------------------------------------------
// Defaults — exhaustive per PRD §9
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: AutoVideoConfig = {
  voxcpm: {
    endpoint: "http://127.0.0.1:8000",
    modelDir: "/home/ubuntu/model/voxcpm/VoxCPM2",
    autoStart: true,
    cfgValue: 2.0,
    inferenceTimesteps: 10,
    denoise: false,
    retryBadcase: true,
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
  },
  cache: {
    dir: "~/.autovideo/cache",
    maxSizeGB: 20,
    evictTrigger: "stage-start",
  },
  visualQuality: {
    enabled: true,
    minFontCoeff: 0.07,
    minElements: 4,
    minCoverage: 0.7,
    review: true,
    maxReviewRounds: 1,
  },
};

/** Fallback used when a config object omits the visualQuality section. */
export const DEFAULT_VISUAL_QUALITY: VisualQualityConfig = DEFAULT_CONFIG.visualQuality!;
