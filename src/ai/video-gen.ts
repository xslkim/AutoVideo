/**
 * AI Video Generation Module — visualMode "aivideo" (visuals stage branch).
 *
 * Dual-track text-to-video client:
 *
 * (a) API track — async task services (submit → poll → download mp4):
 *     - "seedance": 火山引擎 Ark Seedance
 *         POST {baseURL}/api/v3/contents/generations/tasks
 *         GET  {baseURL}/api/v3/contents/generations/tasks/{id}
 *     - "wanx": 阿里 DashScope Wan2.5
 *         POST {baseURL}/api/v1/services/aigc/video-generation/video-synthesis
 *              (header X-DashScope-Async: enable)
 *         GET  {baseURL}/api/v1/tasks/{task_id}
 *
 * (b) Local track — ComfyUI T2V with the Wan2.2 TI2V-5B workflow:
 *         POST {comfyuiURL}/prompt → poll GET /history/{prompt_id}
 *         → GET /view?filename=…
 *     A custom workflow JSON can be injected via VIDEO_GEN_COMFYUI_WORKFLOW
 *     (placeholder substitution); otherwise the built-in Wan2.2 TI2V-5B graph
 *     from buildWan22Ti2vWorkflow() is used.
 *
 * Block flow (generateAIVideo):
 *   visual.description → LLM (agent backend) crafts an English video prompt +
 *   duration → provider generates the clip → assets/clips/{id}.mp4 (+ sidecar
 *   cache) → copied to public/videos/{id}.mp4 with a wrapper Component.tsx →
 *   the block is converted to visualMode "video" and rendered by the existing
 *   local-video path (same wrapper shape as compile.ts Step 7.6).
 *
 * Configuration is env-only for now (a config-file section is proposed in
 * docs/upgrade-2026/integration/aivideo-mode.md):
 *   VIDEO_GEN_PROVIDER             seedance | wanx | comfyui
 *   VIDEO_GEN_API_KEY              API-track key
 *   VIDEO_GEN_BASE_URL             API-track base URL
 *   VIDEO_GEN_MODEL                model id
 *   VIDEO_GEN_TIMEOUT_MS           overall budget per clip (default 900000)
 *   VIDEO_GEN_POLL_INTERVAL_MS     poll cadence (default 5000)
 *   VIDEO_GEN_SIZE                 WxH (or W*H) override; default: aspect → 720p tier
 *   VIDEO_GEN_DURATION_SEC         clip length when the LLM omits it (default 5)
 *   VIDEO_GEN_NEGATIVE_PROMPT      default negative prompt
 *   VIDEO_GEN_SEED                 fixed seed (default: derived from prompt hash)
 *   VIDEO_GEN_FPS                  ComfyUI clip frame rate (default 24)
 *   VIDEO_GEN_NUM_STEPS            ComfyUI KSampler steps (default 20)
 *   VIDEO_GEN_CFG_SCALE            ComfyUI CFG scale (default 5)
 *   VIDEO_GEN_COMFYUI_URL          ComfyUI base URL (default http://127.0.0.1:8188,
 *                                  falls back to COMFYUI_URL)
 *   VIDEO_GEN_COMFYUI_WORKFLOW     path to a custom workflow JSON template
 *   VIDEO_GEN_COMFYUI_UNET/CLIP/VAE  model file names for the built-in graph
 *   VIDEO_GEN_FALLBACK             image | animation — consumed by the visuals
 *                                  stage (default: fail the block)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createAgentDriver, type AgentConfig } from "./agent/index.js";
import type { Block, ProgressEvent } from "../types/script.js";
import type {
  VideoGenConfig,
  VideoGenFallback,
  VideoGenProvider,
} from "../config/defaults.js";

// ── Types ──────────────────────────────────────────────────────────────
// VideoGenProvider / VideoGenFallback / VideoGenConfig live in
// src/config/defaults.ts (the config-file schema home); re-exported here so
// existing imports from "./video-gen.js" keep working.

export type { VideoGenConfig, VideoGenFallback, VideoGenProvider };

/** The LLM-crafted generation plan for one block. */
export interface VideoPromptPlan {
  /** English text-to-video prompt */
  prompt: string;
  /** English negative prompt (optional) */
  negativePrompt?: string;
  /** Requested clip length in seconds (snapped per provider later) */
  durationSec?: number;
}

export interface GenerateVideoOptions {
  config: VideoGenConfig;
  /** Agent backend config for the prompt-crafting LLM call */
  agent: AgentConfig;
  buildOutDir: string;
  meta: { aspect: string; width: number; height: number; fps?: number };
  /** Block's on-screen length (s) — the planner keeps the clip ≤ this */
  targetDurationSec?: number;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface VideoGenResult {
  /** "public/videos/{id}.mp4" — wired into block.visual.videoPath */
  videoPath: string;
  /** "src/blocks/{id}/Component.tsx" — wrapper wired into componentPath */
  componentPath: string;
  /** "assets/clips/{id}.mp4" — raw generated artifact */
  clipPath: string;
  /** The English prompt actually sent to the generator */
  prompt: string;
  /** Clip length in seconds (post provider snapping) */
  durationSec: number;
  cacheHit: boolean;
}

// ── Error class ────────────────────────────────────────────────────────

export class VideoGenError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "VideoGenError";
    this.code = code;
  }
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 900_000; // local Wan2.2 on a consumer GPU is slow
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;

const DEFAULT_DURATION_SEC = 5;
const DEFAULT_COMFYUI_FPS = 24;
const DEFAULT_STEPS = 20;
const DEFAULT_CFG = 5;

const SEEDANCE_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com";
const WANX_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const COMFYUI_DEFAULT_BASE_URL = "http://127.0.0.1:8188";

const DEFAULT_MODEL: Record<VideoGenProvider, string> = {
  seedance: "doubao-seedance-1-0-pro-250528",
  wanx: "wan2.5-t2v-preview",
  comfyui: "wan2.2-ti2v-5b",
};

const DEFAULT_COMFYUI_UNET = "wan2.2_ti2v_5B_fp16.safetensors";
const DEFAULT_COMFYUI_CLIP = "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
const DEFAULT_COMFYUI_VAE = "wan2.2_vae.safetensors";

const DEFAULT_NEGATIVE_PROMPT =
  "text, letters, words, subtitles, captions, watermark, logo, signature, " +
  "low quality, blurry, distorted, flicker, oversaturated, deformed";

/** Exact-aspect sizes for the local track (all divisible by 16). */
const ASPECT_TO_VIDEO_SIZE: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 960, height: 960 },
};

/**
 * Bump when the prompt-crafter contract changes — folds into the clip-cache
 * description hash so stale plans regenerate once.
 */
const CLIP_PLAN_VERSION = "aivideo-plan-1";
const CLIP_CACHE_VERSION = "aivideo-clip-1";

const COMFYUI_CLIENT_ID = "autovideo-video-gen";

// ── Env config ─────────────────────────────────────────────────────────

/**
 * Build a VideoGenConfig from an optional base (future config-file section)
 * overlaid with environment variables. Base fields win; env fills gaps —
 * mirroring how DEFAULT_CONFIG bakes env into defaults and the config file
 * overrides them.
 */
export function videoGenConfigFromEnv(
  base: Partial<VideoGenConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): VideoGenConfig {
  const str = (v: string | undefined): string | undefined =>
    v !== undefined && v.trim() !== "" ? v.trim() : undefined;
  const num = (v: string | undefined): number | undefined => {
    const s = str(v);
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const providerRaw = str(env.VIDEO_GEN_PROVIDER)?.toLowerCase();
  const envProvider =
    providerRaw === "seedance" || providerRaw === "wanx" || providerRaw === "comfyui"
      ? providerRaw
      : undefined;
  const fallbackRaw = str(env.VIDEO_GEN_FALLBACK)?.toLowerCase();
  const envFallback =
    fallbackRaw === "image" || fallbackRaw === "animation" ? fallbackRaw : undefined;

  return {
    provider: base.provider ?? envProvider,
    baseURL: base.baseURL ?? str(env.VIDEO_GEN_BASE_URL),
    apiKey: base.apiKey ?? str(env.VIDEO_GEN_API_KEY),
    model: base.model ?? str(env.VIDEO_GEN_MODEL),
    timeoutMs: base.timeoutMs ?? num(env.VIDEO_GEN_TIMEOUT_MS),
    pollIntervalMs: base.pollIntervalMs ?? num(env.VIDEO_GEN_POLL_INTERVAL_MS),
    size: base.size ?? str(env.VIDEO_GEN_SIZE),
    durationSec: base.durationSec ?? num(env.VIDEO_GEN_DURATION_SEC),
    negativePrompt: base.negativePrompt ?? str(env.VIDEO_GEN_NEGATIVE_PROMPT),
    seed: base.seed ?? num(env.VIDEO_GEN_SEED),
    fps: base.fps ?? num(env.VIDEO_GEN_FPS),
    numSteps: base.numSteps ?? num(env.VIDEO_GEN_NUM_STEPS),
    cfgScale: base.cfgScale ?? num(env.VIDEO_GEN_CFG_SCALE),
    comfyuiURL: base.comfyuiURL ?? str(env.VIDEO_GEN_COMFYUI_URL) ?? str(env.COMFYUI_URL),
    comfyuiWorkflowPath: base.comfyuiWorkflowPath ?? str(env.VIDEO_GEN_COMFYUI_WORKFLOW),
    comfyuiUnet: base.comfyuiUnet ?? str(env.VIDEO_GEN_COMFYUI_UNET),
    comfyuiClip: base.comfyuiClip ?? str(env.VIDEO_GEN_COMFYUI_CLIP),
    comfyuiVae: base.comfyuiVae ?? str(env.VIDEO_GEN_COMFYUI_VAE),
    fallback: base.fallback ?? envFallback,
  };
}

// ── Provider resolution ────────────────────────────────────────────────

/** Infer provider from explicit config or base URL heuristics. */
export function resolveVideoGenProvider(config: VideoGenConfig): VideoGenProvider {
  if (
    config.provider === "seedance" ||
    config.provider === "wanx" ||
    config.provider === "comfyui"
  ) {
    return config.provider;
  }
  if (config.comfyuiURL) return "comfyui";
  const baseURL = (config.baseURL ?? "").toLowerCase();
  if (baseURL.includes(":8188") || baseURL.includes("comfy")) return "comfyui";
  if (baseURL.includes("dashscope") || baseURL.includes("aliyuncs")) return "wanx";
  return "seedance";
}

function resolveBaseURL(config: VideoGenConfig, provider: VideoGenProvider): string {
  const strip = (u: string) => u.replace(/\/+$/, "");
  if (provider === "comfyui") {
    return strip(config.comfyuiURL ?? config.baseURL ?? COMFYUI_DEFAULT_BASE_URL);
  }
  if (config.baseURL) return strip(config.baseURL);
  return provider === "wanx" ? WANX_DEFAULT_BASE_URL : SEEDANCE_DEFAULT_BASE_URL;
}

function resolveVideoGenModel(config: VideoGenConfig, provider: VideoGenProvider): string {
  return config.model ?? DEFAULT_MODEL[provider];
}

/** Configured on-failure downgrade; null = fail the block (default). */
export function resolveVideoGenFallback(config: VideoGenConfig): VideoGenFallback | null {
  return config.fallback === "image" || config.fallback === "animation"
    ? config.fallback
    : null;
}

/** Whether video generation is sufficiently configured to run. */
export function isVideoGenConfigured(config: VideoGenConfig): boolean {
  const provider = resolveVideoGenProvider(config);
  if (provider === "comfyui") return true; // local service needs no key
  return Boolean(config.apiKey);
}

/** Health-check URL for the configured video generation backend. */
export function videoGenHealthURL(config: VideoGenConfig): string | null {
  const provider = resolveVideoGenProvider(config);
  if (provider === "comfyui") {
    return `${resolveBaseURL(config, provider)}/system_stats`;
  }
  // Ark / DashScope task APIs are POST-only; no cheap authenticated GET probe.
  return null;
}

// ── Parameter helpers ──────────────────────────────────────────────────

function parseVideoSize(size: string): { width: number; height: number } {
  const match = /^(\d+)[x*](\d+)$/i.exec(size.trim());
  if (!match) {
    throw new VideoGenError(
      `Invalid video size "${size}", expected WIDTHxHEIGHT`,
      "ERR_VIDEO_GEN_BAD_SIZE",
    );
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function resolveVideoSize(
  aspect: string,
  override?: string,
): { width: number; height: number } {
  if (override) return parseVideoSize(override);
  if (ASPECT_TO_VIDEO_SIZE[aspect]) return ASPECT_TO_VIDEO_SIZE[aspect];
  console.warn(`Unknown aspect ratio "${aspect}", falling back to 1280x720`);
  return ASPECT_TO_VIDEO_SIZE["16:9"];
}

/**
 * Snap the requested clip length to what the provider accepts. Seedance and
 * Wan2.5 both take only 5 or 10 seconds; ComfyUI length is frame-quantized
 * later, so any 3–10 s request passes through here.
 */
function snapDurationSec(requested: number, provider: VideoGenProvider): number {
  const clamped = Math.min(Math.max(Math.round(requested), 3), 10);
  if (provider === "comfyui") return clamped;
  return clamped <= 5 ? 5 : 10;
}

/** Wan VAE compresses time by 4: latent length must be 4n+1 (121 = 5s @24fps). */
function wanLatentLength(durationSec: number, fps: number): number {
  const frames = Math.max(17, Math.min(241, Math.round(durationSec * fps)));
  return 4 * Math.max(1, Math.round((frames - 1) / 4)) + 1;
}

/** Deterministic default seed so identical prompts hit the clip cache. */
function deriveSeed(prompt: string, model: string, size: string): number {
  const digest = crypto.createHash("sha256").update(`${model}|${size}|${prompt}`).digest();
  return digest.readUInt32BE(0);
}

// ── Prompt planning (LLM) ──────────────────────────────────────────────

/**
 * Usage boundaries for the aivideo mode — single source of truth, embedded in
 * the prompt-crafter system prompt. docs/guidelines AUTHORING.md gets a copy
 * via the integration notes (docs/upgrade-2026/integration/aivideo-mode.md).
 */
export const AIVIDEO_USAGE_BOUNDARIES = `## Mode boundaries (hard rules)

The \`aivideo\` visual mode exists ONLY for:
- 片头片尾 — video openers / end cards,
- B-roll — transitional or illustrative footage between explanation segments,
- 抽象氛围 — abstract ambience: light fields, particles, ink in water, fluid gradients, slow camera moves over landscapes or objects.

Anything that must show legible on-screen content — charts, diagrams, code, formulas, tables, bullet text — is FORBIDDEN in aivideo and belongs to the \`animation\` mode instead (video models garble text). If the description below asks for such content, do NOT describe the text/chart literally: translate the topic's mood into abstract footage (e.g. "transformer architecture diagram" → "a glowing network of nodes pulsing in dark space").`;

/** System prompt for the LLM that turns a visual description into a T2V plan. */
export function buildVideoPromptSystemPrompt(): string {
  return `You are the text-to-video prompt engineer of an educational video pipeline. You turn one block's visual description (usually Chinese) into a single English prompt for an AI video generator (Volcano Seedance / Ali Wan2.5 / local Wan2.2).

${AIVIDEO_USAGE_BOUNDARIES}

## Prompt rules

- "prompt" and "negativePrompt" MUST be in English — the generators understand English best.
- One continuous paragraph, 40–120 words: subject + action + environment + lighting + camera motion + style + mood.
- Explicitly demand inside the prompt: no text, no letters, no watermark, no subtitles, no logos.
- Camera: pick ONE simple move (slow push-in / gentle orbit / static tripod / lateral dolly). No whip pans, no cuts.
- Motion must be ambient and loop-friendly — the clip may be looped to fill a longer block.
- Style: cinematic, shallow depth of field, volumetric light, matching the topic's tone. NEVER the corporate-default look (white background, purple gradient, rounded cards).
- durationSec: integer 5 or 10 — how long the footage should run; must be ≤ the target length the user gives you.
- negativePrompt: short comma-separated list of failure modes to avoid (default to text/watermark/artifacts).

## Output contract

Return ONLY a JSON object, no markdown fences, no explanation:
{"prompt": "...", "negativePrompt": "...", "durationSec": 5}`;
}

function buildVideoPromptUserContent(input: {
  blockId: string;
  title: string;
  description: string;
  aspect: string;
  targetDurationSec?: number;
}): string {
  return [
    `Block ${input.blockId} "${input.title}" — aspect ${input.aspect}, target on-screen length ≈ ${
      input.targetDurationSec !== undefined ? `${input.targetDurationSec.toFixed(1)}s` : "unknown"
    }.`,
    "",
    "Visual description:",
    input.description,
    "",
    "Return ONLY the JSON object.",
  ].join("\n");
}

/** Parse the planner's JSON output, tolerating markdown fences. */
export function parseVideoPromptPlan(raw: string): VideoPromptPlan {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new VideoGenError(
      "Video prompt planner returned an empty response",
      "ERR_VIDEO_GEN_BAD_PLAN",
    );
  }

  let jsonText: string | undefined;
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  } else {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) jsonText = trimmed.slice(start, end + 1);
  }
  if (!jsonText) {
    throw new VideoGenError(
      `Video prompt planner returned non-JSON output (first 200 chars): ${trimmed.slice(0, 200)}`,
      "ERR_VIDEO_GEN_BAD_PLAN",
    );
  }

  let data: { prompt?: unknown; negativePrompt?: unknown; durationSec?: unknown };
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new VideoGenError(
      `Video prompt planner returned invalid JSON: ${(err as Error).message}`,
      "ERR_VIDEO_GEN_BAD_PLAN",
    );
  }

  if (typeof data.prompt !== "string" || data.prompt.trim().length === 0) {
    throw new VideoGenError(
      "Video prompt plan is missing a non-empty \"prompt\" string",
      "ERR_VIDEO_GEN_BAD_PLAN",
    );
  }

  const plan: VideoPromptPlan = { prompt: data.prompt.trim() };
  if (typeof data.negativePrompt === "string" && data.negativePrompt.trim() !== "") {
    plan.negativePrompt = data.negativePrompt.trim();
  }
  if (typeof data.durationSec === "number" && Number.isFinite(data.durationSec)) {
    plan.durationSec = data.durationSec;
  }
  return plan;
}

/** Ask the configured agent backend to craft the video prompt plan. */
export async function craftVideoPromptPlan(
  input: {
    blockId: string;
    title: string;
    description: string;
    aspect: string;
    targetDurationSec?: number;
  },
  agent: AgentConfig,
  signal?: AbortSignal,
): Promise<VideoPromptPlan> {
  const driver = createAgentDriver(agent);
  try {
    const result = await driver.generateText(
      {
        system: buildVideoPromptSystemPrompt(),
        user: buildVideoPromptUserContent(input),
        maxTokens: 1024,
      },
      signal,
    );
    return parseVideoPromptPlan(result.text);
  } catch (err) {
    if (err instanceof VideoGenError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new VideoGenError(
      `Video prompt planning failed: ${message}`,
      "ERR_VIDEO_GEN_PROMPT_FAILED",
    );
  }
}

// ── HTTP helpers (local mirror of image-gen's; see integration notes) ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFetchController(
  timeoutMs: number,
  signal?: AbortSignal,
): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(signal.reason);
    } else {
      signal.addEventListener(
        "abort",
        () => controller.abort(signal.reason),
        { once: true },
      );
    }
  }

  return { controller, clear: () => clearTimeout(timeoutId) };
}

function wrapFetchError(err: unknown, signal: AbortSignal | undefined, timeoutMs: number): never {
  if (err instanceof VideoGenError) throw err;
  if (err instanceof Error && err.name === "AbortError") {
    if (signal?.aborted) {
      throw new VideoGenError("Video generation cancelled", "ERR_CANCELLED");
    }
    throw new VideoGenError(
      `Video generation request timed out after ${timeoutMs}ms`,
      "ERR_VIDEO_GEN_TIMEOUT",
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  throw new VideoGenError(
    `Video generation HTTP error: ${message}`,
    "ERR_VIDEO_GEN_HTTP_ERROR",
  );
}

async function readHttpError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const data = (await response.json()) as {
        detail?: string;
        message?: string;
        error?: { message?: string };
      };
      return (
        data.detail ||
        data.message ||
        data.error?.message ||
        JSON.stringify(data).slice(0, 200)
      );
    }
    return (await response.text()).slice(0, 200);
  } catch {
    return response.statusText;
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const { controller, clear } = createFetchController(timeoutMs, signal);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = await readHttpError(response);
      throw new VideoGenError(
        `Video generation API returned ${response.status}: ${detail}`,
        `ERR_VIDEO_GEN_HTTP_${response.status}`,
      );
    }
    return await response.json();
  } catch (err) {
    wrapFetchError(err, signal, timeoutMs);
  } finally {
    clear();
  }
}

async function fetchBuffer(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const { controller, clear } = createFetchController(timeoutMs, signal);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      const detail = await readHttpError(response);
      throw new VideoGenError(
        `Video download returned ${response.status}: ${detail}`,
        `ERR_VIDEO_GEN_HTTP_${response.status}`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    wrapFetchError(err, signal, timeoutMs);
  } finally {
    clear();
  }
}

// ── Polling ────────────────────────────────────────────────────────────

type PollOutcome =
  | { kind: "pending" }
  | { kind: "succeeded"; videoURL: string }
  | { kind: "failed"; detail: string };

async function pollUntilVideoURL(opts: {
  timeoutMs: number;
  intervalMs: number;
  signal?: AbortSignal;
  onTick?: (elapsedSec: number) => void;
  poll: () => Promise<PollOutcome>;
}): Promise<string> {
  const start = Date.now();
  const deadline = start + opts.timeoutMs;
  for (;;) {
    if (opts.signal?.aborted) {
      throw new VideoGenError("Video generation cancelled", "ERR_CANCELLED");
    }
    const outcome = await opts.poll();
    if (outcome.kind === "succeeded") return outcome.videoURL;
    if (outcome.kind === "failed") {
      throw new VideoGenError(
        `Video generation task failed: ${outcome.detail}`,
        "ERR_VIDEO_GEN_TASK_FAILED",
      );
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new VideoGenError(
        `Video generation timed out after ${Math.round(opts.timeoutMs / 1000)}s`,
        "ERR_VIDEO_GEN_TIMEOUT",
      );
    }
    opts.onTick?.(Math.round((Date.now() - start) / 1000));
    await sleep(Math.min(opts.intervalMs, remaining));
  }
}

// ── API track: Seedance (火山 Ark) ─────────────────────────────────────

async function submitSeedanceTask(
  baseURL: string,
  apiKey: string,
  model: string,
  prompt: string,
  params: { ratio: string; resolution: string; durationSec: number; seed?: number },
  signal?: AbortSignal,
): Promise<string> {
  const parts = [
    prompt,
    `--ratio ${params.ratio}`,
    `--resolution ${params.resolution}`,
    `--duration ${params.durationSec}`,
    "--watermark false",
  ];
  if (params.seed !== undefined) parts.push(`--seed ${params.seed}`);

  const data = (await fetchJson(
    `${baseURL}/api/v3/contents/generations/tasks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        content: [{ type: "text", text: parts.join(" ") }],
      }),
    },
    SUBMIT_TIMEOUT_MS,
    signal,
  )) as { id?: string };

  if (!data.id) {
    throw new VideoGenError(
      "Seedance submit response missing task id",
      "ERR_VIDEO_GEN_BAD_RESPONSE",
    );
  }
  return data.id;
}

async function pollSeedanceTask(
  baseURL: string,
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<PollOutcome> {
  const data = (await fetchJson(
    `${baseURL}/api/v3/contents/generations/tasks/${taskId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    POLL_REQUEST_TIMEOUT_MS,
    signal,
  )) as {
    status?: string;
    content?: { video_url?: string };
    error?: { code?: string; message?: string };
  };

  switch (data.status) {
    case "succeeded": {
      const url = data.content?.video_url;
      return url
        ? { kind: "succeeded", videoURL: url }
        : { kind: "failed", detail: "task succeeded but content.video_url is missing" };
    }
    case "failed":
    case "cancelled":
      return {
        kind: "failed",
        detail: data.error?.message ?? `status=${data.status}`,
      };
    default:
      return { kind: "pending" }; // queued / running
  }
}

// ── API track: Wan2.5 (阿里 DashScope) ─────────────────────────────────

async function submitWanxTask(
  baseURL: string,
  apiKey: string,
  model: string,
  prompt: string,
  negativePrompt: string,
  params: { width: number; height: number; durationSec: number; seed?: number },
  signal?: AbortSignal,
): Promise<string> {
  const data = (await fetchJson(
    `${baseURL}/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model,
        input: { prompt, negative_prompt: negativePrompt },
        parameters: {
          size: `${params.width}*${params.height}`,
          duration: params.durationSec,
          prompt_extend: true,
          watermark: false,
          ...(params.seed !== undefined ? { seed: params.seed } : {}),
        },
      }),
    },
    SUBMIT_TIMEOUT_MS,
    signal,
  )) as { output?: { task_id?: string } };

  const taskId = data.output?.task_id;
  if (!taskId) {
    throw new VideoGenError(
      "Wanx submit response missing output.task_id",
      "ERR_VIDEO_GEN_BAD_RESPONSE",
    );
  }
  return taskId;
}

async function pollWanxTask(
  baseURL: string,
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<PollOutcome> {
  const data = (await fetchJson(
    `${baseURL}/api/v1/tasks/${taskId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    POLL_REQUEST_TIMEOUT_MS,
    signal,
  )) as {
    output?: {
      task_status?: string;
      video_url?: string;
      code?: string;
      message?: string;
    };
  };

  const output = data.output ?? {};
  switch (output.task_status) {
    case "SUCCEEDED":
      return output.video_url
        ? { kind: "succeeded", videoURL: output.video_url }
        : { kind: "failed", detail: "task succeeded but output.video_url is missing" };
    case "FAILED":
    case "CANCELED":
    case "UNKNOWN":
      return {
        kind: "failed",
        detail: output.message ?? `task_status=${output.task_status}`,
      };
    default:
      return { kind: "pending" }; // PENDING / RUNNING / SUSPENDED
  }
}

async function generateApiVideo(
  provider: "seedance" | "wanx",
  plan: { prompt: string; negativePrompt: string },
  params: { width: number; height: number; durationSec: number; seed?: number; aspect: string },
  config: VideoGenConfig,
  baseURL: string,
  model: string,
  signal?: AbortSignal,
  onTick?: (elapsedSec: number) => void,
): Promise<Buffer> {
  if (!config.apiKey) {
    throw new VideoGenError(
      "VIDEO_GEN_API_KEY is required for the API video generation track",
      "ERR_VIDEO_GEN_KEY_MISSING",
    );
  }
  const apiKey = config.apiKey;

  let taskId: string;
  let pollFn: () => Promise<PollOutcome>;
  if (provider === "seedance") {
    const resolution = params.height >= 1000 ? "1080p" : params.height >= 700 ? "720p" : "480p";
    const ratio = ["16:9", "9:16", "1:1"].includes(params.aspect) ? params.aspect : "16:9";
    taskId = await submitSeedanceTask(
      baseURL,
      apiKey,
      model,
      plan.prompt,
      { ratio, resolution, durationSec: params.durationSec, seed: params.seed },
      signal,
    );
    pollFn = () => pollSeedanceTask(baseURL, apiKey, taskId, signal);
  } else {
    taskId = await submitWanxTask(
      baseURL,
      apiKey,
      model,
      plan.prompt,
      plan.negativePrompt,
      params,
      signal,
    );
    pollFn = () => pollWanxTask(baseURL, apiKey, taskId, signal);
  }

  const videoURL = await pollUntilVideoURL({
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    intervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    signal,
    onTick,
    poll: pollFn,
  });

  const buffer = await fetchBuffer(videoURL, DOWNLOAD_TIMEOUT_MS, signal);
  if (buffer.length === 0) {
    throw new VideoGenError(
      "Downloaded video is empty",
      "ERR_VIDEO_GEN_BAD_RESPONSE",
    );
  }
  return buffer;
}

// ── Local track: ComfyUI (Wan2.2 TI2V-5B) ──────────────────────────────

export interface Wan22WorkflowParams {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  /** Latent frame count (4n+1); see wanLatentLength */
  length: number;
  /** Clip frame rate written by the video-combine node */
  fps: number;
  seed: number;
  steps: number;
  cfg: number;
  unetName?: string;
  clipName?: string;
  vaeName?: string;
}

/**
 * Built-in ComfyUI API-format workflow for Wan2.2 TI2V-5B text-to-video
 * (single-model 5B — no high/low-noise expert split). Mirrors the official
 * ComfyUI "Wan2.2 5B video" template: UNETLoader + CLIPLoader(wan) +
 * VAELoader → ±CLIPTextEncode → EmptyHunyuanLatentVideo → KSampler →
 * VAEDecode → VHS_VideoCombine (ComfyUI-VideoHelperSuite, h264 mp4).
 * Override entirely via VIDEO_GEN_COMFYUI_WORKFLOW when your stack differs.
 */
export function buildWan22Ti2vWorkflow(params: Wan22WorkflowParams): Record<string, unknown> {
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: params.unetName ?? DEFAULT_COMFYUI_UNET,
        weight_dtype: "default",
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: params.clipName ?? DEFAULT_COMFYUI_CLIP,
        type: "wan",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: params.vaeName ?? DEFAULT_COMFYUI_VAE },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: params.prompt, clip: ["2", 0] },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: params.negativePrompt, clip: ["2", 0] },
    },
    "6": {
      class_type: "EmptyHunyuanLatentVideo",
      inputs: {
        width: params.width,
        height: params.height,
        length: params.length,
        batch_size: 1,
      },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        seed: params.seed,
        steps: params.steps,
        cfg: params.cfg,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["7", 0], vae: ["3", 0] },
    },
    "9": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["8", 0],
        frame_rate: params.fps,
        loop_count: 0,
        filename_prefix: "autovideo/clip",
        format: "video/h264-mp4",
        pix_fmt: "yuv420p",
        crf: 19,
        save_metadata: true,
        pingpong: false,
        save_output: true,
      },
    },
  };
}

/**
 * Load a custom ComfyUI workflow template and substitute placeholders:
 *   "${PROMPT}" / "${NEGATIVE_PROMPT}"  — full JSON string values
 *   ${WIDTH} ${HEIGHT} ${LENGTH} ${FPS} ${SEED} ${STEPS} ${CFG} — numbers
 */
function loadCustomWorkflow(
  workflowPath: string,
  vars: Wan22WorkflowParams,
): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(workflowPath, "utf-8");
  } catch {
    throw new VideoGenError(
      `ComfyUI workflow template not found: ${workflowPath}`,
      "ERR_VIDEO_GEN_WORKFLOW_MISSING",
    );
  }
  const out = raw
    .replaceAll('"${PROMPT}"', JSON.stringify(vars.prompt))
    .replaceAll('"${NEGATIVE_PROMPT}"', JSON.stringify(vars.negativePrompt))
    .replaceAll("${WIDTH}", String(vars.width))
    .replaceAll("${HEIGHT}", String(vars.height))
    .replaceAll("${LENGTH}", String(vars.length))
    .replaceAll("${FPS}", String(vars.fps))
    .replaceAll("${SEED}", String(vars.seed))
    .replaceAll("${STEPS}", String(vars.steps))
    .replaceAll("${CFG}", String(vars.cfg));
  try {
    return JSON.parse(out);
  } catch (err) {
    throw new VideoGenError(
      `ComfyUI workflow template is not valid JSON after substitution: ${(err as Error).message}`,
      "ERR_VIDEO_GEN_BAD_WORKFLOW",
    );
  }
}

interface ComfyMediaRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

async function submitComfyUIPrompt(
  baseURL: string,
  workflow: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const data = (await fetchJson(
    `${baseURL}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: COMFYUI_CLIENT_ID }),
    },
    SUBMIT_TIMEOUT_MS,
    signal,
  )) as {
    prompt_id?: string;
    node_errors?: Record<string, unknown>;
    error?: { message?: string };
  };

  const nodeErrors = data.node_errors ? Object.keys(data.node_errors) : [];
  if (nodeErrors.length > 0) {
    throw new VideoGenError(
      `ComfyUI rejected the workflow (node errors in ${nodeErrors.join(", ")}): ` +
        JSON.stringify(data.node_errors).slice(0, 300),
      "ERR_VIDEO_GEN_COMFYUI_NODE",
    );
  }
  if (!data.prompt_id) {
    throw new VideoGenError(
      `ComfyUI /prompt response missing prompt_id: ${data.error?.message ?? "unknown"}`,
      "ERR_VIDEO_GEN_BAD_RESPONSE",
    );
  }
  return data.prompt_id;
}

async function pollComfyUIHistory(
  baseURL: string,
  promptId: string,
  signal?: AbortSignal,
): Promise<PollOutcome> {
  const data = (await fetchJson(
    `${baseURL}/history/${promptId}`,
    {},
    POLL_REQUEST_TIMEOUT_MS,
    signal,
  )) as Record<
    string,
    {
      status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
      outputs?: Record<string, { videos?: ComfyMediaRef[]; gifs?: ComfyMediaRef[]; images?: ComfyMediaRef[] }>;
    }
  >;

  const entry = data[promptId];
  if (!entry) return { kind: "pending" }; // still queued/running

  if (entry.status?.status_str === "error") {
    const detail = (entry.status.messages ?? [])
      .map((m) => (Array.isArray(m) ? m.map((x) => String(x)).join(" ") : String(m)))
      .join(" | ")
      .slice(0, 300);
    return { kind: "failed", detail: detail || "ComfyUI execution error" };
  }

  const outputs = entry.outputs ?? {};
  for (const nodeOutput of Object.values(outputs)) {
    for (const key of ["videos", "gifs", "images"] as const) {
      const ref = nodeOutput[key]?.[0];
      if (ref?.filename) {
        const query = new URLSearchParams({
          filename: ref.filename,
          subfolder: ref.subfolder ?? "",
          type: ref.type ?? "output",
        });
        return { kind: "succeeded", videoURL: `${baseURL}/view?${query}` };
      }
    }
  }

  // Entry exists but carries no media yet (partial history during execution).
  return entry.status?.completed
    ? { kind: "failed", detail: "ComfyUI history entry completed without video outputs" }
    : { kind: "pending" };
}

async function generateComfyUIVideo(
  plan: { prompt: string; negativePrompt: string },
  params: { width: number; height: number; durationSec: number; seed: number },
  config: VideoGenConfig,
  baseURL: string,
  signal?: AbortSignal,
  onTick?: (elapsedSec: number) => void,
): Promise<Buffer> {
  const fps = config.fps ?? DEFAULT_COMFYUI_FPS;
  const vars: Wan22WorkflowParams = {
    prompt: plan.prompt,
    negativePrompt: plan.negativePrompt,
    width: params.width,
    height: params.height,
    length: wanLatentLength(params.durationSec, fps),
    fps,
    seed: params.seed,
    steps: config.numSteps ?? DEFAULT_STEPS,
    cfg: config.cfgScale ?? DEFAULT_CFG,
    unetName: config.comfyuiUnet,
    clipName: config.comfyuiClip,
    vaeName: config.comfyuiVae,
  };

  const workflow = config.comfyuiWorkflowPath
    ? loadCustomWorkflow(config.comfyuiWorkflowPath, vars)
    : buildWan22Ti2vWorkflow(vars);

  const promptId = await submitComfyUIPrompt(baseURL, workflow, signal);
  const videoURL = await pollUntilVideoURL({
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    intervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    signal,
    onTick,
    poll: () => pollComfyUIHistory(baseURL, promptId, signal),
  });

  const buffer = await fetchBuffer(videoURL, DOWNLOAD_TIMEOUT_MS, signal);
  if (buffer.length === 0) {
    throw new VideoGenError(
      "Downloaded video is empty",
      "ERR_VIDEO_GEN_BAD_RESPONSE",
    );
  }
  return buffer;
}

// ── Clip cache (self-contained sidecar in assets/clips/) ───────────────
//
// Kept independent from CacheStore on purpose: store.ts is owned by another
// track. A "videos" CacheType + VideoKey for global dedup is proposed in
// docs/upgrade-2026/integration/aivideo-mode.md.

interface ClipSidecar {
  version: string;
  /** Hash of the raw inputs (description + planner version + provider…) */
  descriptionHash: string;
  /** Hash of the final generation parameters (prompt/model/size/seed…) */
  cacheKey: string;
  prompt: string;
  negativePrompt: string;
  provider: VideoGenProvider;
  model: string;
  width: number;
  height: number;
  durationSec: number;
  createdAt: string;
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function computeDescriptionHash(opts: {
  description: string;
  aspect: string;
  provider: VideoGenProvider;
  model: string;
}): string {
  return sha256(
    JSON.stringify({
      v: CLIP_PLAN_VERSION,
      description: opts.description,
      aspect: opts.aspect,
      provider: opts.provider,
      model: opts.model,
    }),
  );
}

function computeClipCacheKey(opts: {
  prompt: string;
  negativePrompt: string;
  provider: VideoGenProvider;
  model: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  seed: number;
  steps?: number;
  cfg?: number;
  workflowHash?: string;
}): string {
  return sha256(JSON.stringify({ v: CLIP_CACHE_VERSION, ...opts }));
}

function readClipSidecar(sidecarFile: string): ClipSidecar | null {
  try {
    if (!fs.existsSync(sidecarFile)) return null;
    return JSON.parse(fs.readFileSync(sidecarFile, "utf-8")) as ClipSidecar;
  } catch {
    return null;
  }
}

// ── Wrapper component (mirrors compile.ts Step 7.6 VIDEO_WRAPPER_TSX) ──

/**
 * Same wrapper the compile stage writes for local video blocks, plus a
 * clip-hash comment: the render stage keys its partial cache on the component
 * source, so embedding the hash makes a regenerated clip bust the stale
 * partial (a plain re-copy of the identical wrapper would not).
 */
export function buildVideoWrapperComponent(blockId: string, clipHash?: string): string {
  return `import React from "react";
import { AbsoluteFill, Video, staticFile } from "remotion";
${clipHash ? `\n// clip-hash: ${clipHash}\n` : ""}
interface AnimationProps {
  frame: number; durationInFrames: number; width: number; height: number;
  subtitleSafeBottom: number; theme: any; fps: number;
}

const Component: React.FC<AnimationProps> = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <Video
      src={staticFile("videos/${blockId}.mp4")}
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
      loop
    />
  </AbsoluteFill>
);

export default Component;
`;
}

// ── Main entry ─────────────────────────────────────────────────────────

/**
 * Generate an AI video clip for an "aivideo" block and convert the block to
 * the existing local-video mode in place (visualMode "video" + videoPath +
 * wrapper componentPath), so the render stage needs no aivideo awareness.
 *
 * Layout:
 *   {buildOutDir}/assets/clips/{id}.mp4   raw clip (+ {id}.json sidecar cache)
 *   {buildOutDir}/public/videos/{id}.mp4  render-facing copy (staticFile)
 *   {buildOutDir}/src/blocks/{id}/Component.tsx  wrapper
 *
 * Cache: when the description/provider/model haven't changed (and not
 * --force), the LLM planning call and the generation are both skipped.
 */
export async function generateAIVideo(
  block: Block,
  options: GenerateVideoOptions,
): Promise<VideoGenResult> {
  const { config, agent, buildOutDir, meta, targetDurationSec, force, signal, onProgress } =
    options;

  if (signal?.aborted) {
    throw new VideoGenError("Video generation cancelled", "ERR_CANCELLED");
  }

  const provider = resolveVideoGenProvider(config);
  const baseURL = resolveBaseURL(config, provider);
  const model = resolveVideoGenModel(config, provider);

  if (!isVideoGenConfigured(config)) {
    throw new VideoGenError(
      "aivideo mode is not configured: set VIDEO_GEN_API_KEY (+ optional " +
        "VIDEO_GEN_BASE_URL/VIDEO_GEN_MODEL/VIDEO_GEN_PROVIDER) for the API track, " +
        "or VIDEO_GEN_PROVIDER=comfyui / VIDEO_GEN_COMFYUI_URL for the local track",
      "ERR_VIDEO_GEN_NOT_CONFIGURED",
    );
  }

  const emit = (percent: number, step: string) => {
    onProgress?.({ percent, step, stage: "visuals", blockId: block.id });
  };

  const clipsDir = path.join(buildOutDir, "assets", "clips");
  const clipFile = path.join(clipsDir, `${block.id}.mp4`);
  const sidecarFile = path.join(clipsDir, `${block.id}.json`);
  const videosDir = path.join(buildOutDir, "public", "videos");
  const videoFile = path.join(videosDir, `${block.id}.mp4`);
  const blockDir = path.join(buildOutDir, "src", "blocks", block.id);
  const componentFile = path.join(blockDir, "Component.tsx");

  const relativeVideoPath = `public/videos/${block.id}.mp4`;
  const relativeClipPath = `assets/clips/${block.id}.mp4`;
  const relativeComponentPath = `src/blocks/${block.id}/Component.tsx`;

  emit(5, `开始生成 AI 视频: ${block.id}`);

  const descriptionHash = computeDescriptionHash({
    description: block.visual.description,
    aspect: meta.aspect,
    provider,
    model,
  });

  /** Shared tail: copy clip into public/, write wrapper, convert the block. */
  const settleBlock = (cacheKey: string): void => {
    fs.mkdirSync(videosDir, { recursive: true });
    fs.copyFileSync(clipFile, videoFile);
    fs.mkdirSync(blockDir, { recursive: true });
    fs.writeFileSync(
      componentFile,
      buildVideoWrapperComponent(block.id, cacheKey.slice(0, 12)),
      "utf-8",
    );
    block.visual.videoPath = relativeVideoPath;
    block.visual.componentPath = relativeComponentPath;
    block.visualMode = "video";
  };

  // ── Clip cache hit: skip both the LLM plan and the generation ─────────
  if (!force) {
    const sidecar = readClipSidecar(sidecarFile);
    if (
      sidecar &&
      sidecar.descriptionHash === descriptionHash &&
      fs.existsSync(clipFile)
    ) {
      settleBlock(sidecar.cacheKey);
      emit(100, `AI 视频缓存命中: ${block.id}`);
      return {
        videoPath: relativeVideoPath,
        componentPath: relativeComponentPath,
        clipPath: relativeClipPath,
        prompt: sidecar.prompt,
        durationSec: sidecar.durationSec,
        cacheHit: true,
      };
    }
  }

  // ── Step 1: LLM crafts the English video prompt + duration ────────────
  emit(10, `生成视频 prompt: ${block.id}`);
  const plan = await craftVideoPromptPlan(
    {
      blockId: block.id,
      title: block.title,
      description: block.visual.description,
      aspect: meta.aspect,
      targetDurationSec,
    },
    agent,
    signal,
  );

  const negativePrompt =
    plan.negativePrompt ?? config.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT;
  const { width, height } = resolveVideoSize(meta.aspect, config.size);
  const durationSec = snapDurationSec(
    plan.durationSec ?? config.durationSec ?? DEFAULT_DURATION_SEC,
    provider,
  );
  const seed = config.seed ?? deriveSeed(plan.prompt, model, `${width}x${height}`);
  const fps = config.fps ?? DEFAULT_COMFYUI_FPS;

  const cacheKey = computeClipCacheKey({
    prompt: plan.prompt,
    negativePrompt,
    provider,
    model,
    width,
    height,
    durationSec,
    fps,
    seed,
    steps: provider === "comfyui" ? config.numSteps ?? DEFAULT_STEPS : undefined,
    cfg: provider === "comfyui" ? config.cfgScale ?? DEFAULT_CFG : undefined,
    workflowHash:
      provider === "comfyui" && config.comfyuiWorkflowPath
        ? sha256(fs.readFileSync(config.comfyuiWorkflowPath, "utf-8"))
        : undefined,
  });

  // ── Step 2: submit → poll → download ──────────────────────────────────
  emit(30, `提交视频生成任务 (${provider}): ${block.id}`);
  const onTick = (elapsedSec: number) => {
    const budget = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const frac = Math.min(1, (elapsedSec * 1000) / budget);
    emit(30 + Math.round(frac * 55), `等待视频生成: ${block.id} (${elapsedSec}s)`);
  };

  const buffer =
    provider === "comfyui"
      ? await generateComfyUIVideo(
          { prompt: plan.prompt, negativePrompt },
          { width, height, durationSec, seed },
          config,
          baseURL,
          signal,
          onTick,
        )
      : await generateApiVideo(
          provider,
          { prompt: plan.prompt, negativePrompt },
          { width, height, durationSec, seed, aspect: meta.aspect },
          config,
          baseURL,
          model,
          signal,
          onTick,
        );

  // ── Step 3: persist clip + sidecar, convert block to video mode ───────
  emit(90, `写入视频文件: ${block.id}`);
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.writeFileSync(clipFile, buffer);
  const sidecar: ClipSidecar = {
    version: CLIP_CACHE_VERSION,
    descriptionHash,
    cacheKey,
    prompt: plan.prompt,
    negativePrompt,
    provider,
    model,
    width,
    height,
    durationSec,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(sidecarFile, JSON.stringify(sidecar, null, 2));

  settleBlock(cacheKey);

  emit(100, `AI 视频生成完成: ${block.id}`);
  return {
    videoPath: relativeVideoPath,
    componentPath: relativeComponentPath,
    clipPath: relativeClipPath,
    prompt: plan.prompt,
    durationSec,
    cacheHit: false,
  };
}
