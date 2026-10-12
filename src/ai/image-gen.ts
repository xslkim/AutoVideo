/**
 * Image Generation Module — Generate PNG images from visual descriptions.
 *
 * Supports:
 * - openai: POST {baseURL}/v1/images/generations (b64_json or url).
 *   Also covers OpenAI-compatible self-hosted backends (e.g. GLM-Image via
 *   sglang serve); enable `sizeMapper: "glm-image"` to snap sizes to the
 *   32-pixel grid GLM-Image requires (1920x1080 → 1664x928).
 * - sensenova: POST {baseURL}/api/t2i (raw PNG, SenseNova-U1 web_t2i)
 * - comfyui: POST {baseURL}/prompt (workflow JSON template) → poll
 *   /history/{prompt_id} → GET /view (self-hosted ComfyUI server mode)
 *
 * Cache key: sha256(prompt + model + size + baseURL + provider + provider-specific params)
 *
 * Output:
 *   build/{slug}/public/images/{id}.png
 *   build/{slug}/src/blocks/{id}/Component.tsx  (wrapper with staticFile)
 */

import fs from "node:fs";
import path from "node:path";
import { type CacheStore, type ImageKey } from "../cache/store.js";
import type { ImageGenProvider } from "../config/defaults.js";
import type { Block, ProgressEvent } from "../types/script.js";

// ── Runtime config (subset of AutoVideoConfig.imageGen with runtime-only fields) ─

/**
 * Provider kinds accepted by this module. Mirrors `ImageGenProvider` from the
 * shared config schema ("openai" | "sensenova" | "comfyui"); the alias is kept
 * so existing imports from this module keep working.
 */
export type ImageGenProviderKind = ImageGenProvider | "comfyui";

/** Optional size remapping applied before calling an OpenAI-compatible API. */
export type ImageSizeMapper = "glm-image";

export interface ImageGenConfig {
  provider?: ImageGenProviderKind;
  baseURL?: string;
  apiKey?: string;
  model: string;
  size?: string;
  timeoutMs: number;
  concurrency: number;
  numSteps?: number;
  cfgScale?: number;
  /** openai provider: snap requested size to a backend-supported grid (e.g. GLM-Image) */
  sizeMapper?: ImageSizeMapper;
  /** comfyui provider: path to an API-format workflow JSON template ({{PROMPT}} etc.) */
  workflowPath?: string;
  /** comfyui provider: negative prompt substituted into {{NEGATIVE_PROMPT}} */
  negativePrompt?: string;
  /** comfyui provider: fixed seed; random per request when omitted */
  seed?: number;
  /** comfyui provider: /history poll interval in ms (default 1000) */
  pollIntervalMs?: number;
}

// ── Options ────────────────────────────────────────────────────────────────

export interface GenerateImageOptions {
  config: ImageGenConfig;
  buildOutDir: string;
  meta: { aspect: string; width: number; height: number };
  cacheStore: CacheStore;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

// ── Result ─────────────────────────────────────────────────────────────────

export interface ImageGenResult {
  imagePath: string;
  componentPath: string;
  cacheHit: boolean;
}

// ── Error class ────────────────────────────────────────────────────────────

export class ImageGenError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ImageGenError";
    this.code = code;
  }
}

// ── Constants ──────────────────────────────────────────────────────────────

const ASPECT_TO_SIZE: Record<string, string> = {
  "16:9": "1920x1080",
  "9:16": "1080x1920",
  "1:1": "1024x1024",
};

const SENSENOVA_DEFAULT_BASE_URL = "http://127.0.0.1:8765";
const COMFYUI_DEFAULT_BASE_URL = "http://127.0.0.1:8188";
const COMFYUI_DEFAULT_POLL_INTERVAL_MS = 1000;

// ── Provider resolution ────────────────────────────────────────────────────

/** Infer provider from explicit config or base URL heuristics. */
export function resolveImageGenProvider(config: ImageGenConfig): ImageGenProviderKind {
  if (
    config.provider === "openai"
    || config.provider === "sensenova"
    || config.provider === "comfyui"
  ) {
    return config.provider;
  }

  const baseURL = (config.baseURL || "").toLowerCase();
  if (
    baseURL.includes(":8765")
    || baseURL.includes("/api/t2i")
    || baseURL.includes("sensenova")
  ) {
    return "sensenova";
  }
  if (baseURL.includes(":8188") || baseURL.includes("comfyui")) {
    return "comfyui";
  }

  return "openai";
}

function resolveBaseURL(config: ImageGenConfig, provider: ImageGenProviderKind): string {
  if (config.baseURL) return config.baseURL.replace(/\/+$/, "");
  if (provider === "sensenova") return SENSENOVA_DEFAULT_BASE_URL;
  if (provider === "comfyui") {
    return (process.env.COMFYUI_BASE_URL || COMFYUI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  }
  return "https://api.openai.com";
}

function cacheModel(config: ImageGenConfig, provider: ImageGenProviderKind): string {
  if (provider === "sensenova") return "sensenova-u1";
  if (provider === "comfyui") {
    const workflow = config.workflowPath
      || process.env.COMFYUI_WORKFLOW_PATH
      || "builtin:z-image-turbo-fp8";
    const seed = config.seed !== undefined ? `:seed=${config.seed}` : "";
    return `comfyui:${config.model || "z-image-turbo"}:${workflow}${seed}`;
  }
  return config.model;
}

function buildImageKey(
  prompt: string,
  model: string,
  size: string,
  baseURL: string,
  provider: ImageGenProviderKind,
  config: ImageGenConfig,
): ImageKey {
  const key: ImageKey = { prompt, model, size, baseURL, provider };
  if (provider === "sensenova") {
    key.numSteps = config.numSteps ?? 15;
    key.cfgScale = config.cfgScale ?? 4.0;
  }
  if (provider === "comfyui") {
    if (config.numSteps !== undefined) key.numSteps = config.numSteps;
    if (config.cfgScale !== undefined) key.cfgScale = config.cfgScale;
  }
  return key;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveSize(aspect: string, override?: string): string {
  if (override) return override;
  if (ASPECT_TO_SIZE[aspect]) return ASPECT_TO_SIZE[aspect];
  console.warn(`Unknown aspect ratio "${aspect}", falling back to 1920x1080`);
  return "1920x1080";
}

function parseSize(size: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) {
    throw new ImageGenError(
      `Invalid image size "${size}", expected WIDTHxHEIGHT`,
      "ERR_IMAGE_GEN_BAD_SIZE",
    );
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

// ── Size mapping (OpenAI-compatible backends with constrained grids) ───────

/**
 * GLM-Image (zai-org, served via sglang) requires width/height divisible by
 * 32 and only natively supports a fixed resolution ladder. Map the common
 * video frame sizes onto the closest natively supported entry.
 */
const GLM_IMAGE_SIZE_MAP: Record<string, string> = {
  "1920x1080": "1664x928",
  "1080x1920": "928x1664",
  "1024x1024": "1024x1024",
};

/** Snap a "WxH" size so both sides are multiples of `multiple` (rounded to nearest). */
export function snapSizeToMultiple(size: string, multiple = 32): string {
  const { width, height } = parseSize(size);
  if (!Number.isInteger(multiple) || multiple < 1) {
    throw new ImageGenError(
      `Invalid size multiple "${multiple}", expected a positive integer`,
      "ERR_IMAGE_GEN_BAD_SIZE",
    );
  }
  const snap = (v: number) => Math.max(multiple, Math.round(v / multiple) * multiple);
  return `${snap(width)}x${snap(height)}`;
}

/** Map a "WxH" size to the closest GLM-Image-supported size (32-divisible grid). */
export function resolveGlmImageSize(size: string): string {
  const known = GLM_IMAGE_SIZE_MAP[size.trim()];
  if (known) return known;
  return snapSizeToMultiple(size, 32);
}

function resolveSizeMapper(config: ImageGenConfig): ImageSizeMapper | undefined {
  const mapper = config.sizeMapper ?? process.env.IMAGE_GEN_SIZE_MAPPER;
  return mapper === "glm-image" ? "glm-image" : undefined;
}

/** Apply the configured size mapper (openai provider only, opt-in). */
function applySizeMapper(
  size: string,
  provider: ImageGenProviderKind,
  config: ImageGenConfig,
): string {
  if (provider !== "openai") return size;
  const mapper = resolveSizeMapper(config);
  if (mapper === "glm-image") return resolveGlmImageSize(size);
  return size;
}

function buildWrapperComponent(blockId: string): string {
  return `import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

interface AnimationProps {
  frame: number; durationInFrames: number; width: number; height: number;
  subtitleSafeBottom: number; theme: any; fps: number;
}

const Component: React.FC<AnimationProps> = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <Img
      src={staticFile("images/${blockId}.png")}
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
  </AbsoluteFill>
);

export default Component;
`;
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

  return {
    controller,
    clear: () => clearTimeout(timeoutId),
  };
}

function wrapFetchError(err: unknown, signal: AbortSignal | undefined, timeoutMs: number): never {
  if (err instanceof ImageGenError) throw err;
  if (err instanceof Error && err.name === "AbortError") {
    if (signal?.aborted) {
      throw new ImageGenError("Image generation cancelled", "ERR_CANCELLED");
    }
    throw new ImageGenError(
      `Image generation timed out after ${timeoutMs}ms`,
      "ERR_IMAGE_GEN_TIMEOUT",
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  throw new ImageGenError(
    `Image generation HTTP error: ${message}`,
    "ERR_IMAGE_GEN_HTTP_ERROR",
  );
}

async function readHttpError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const data = await response.json() as { detail?: string; error?: { message?: string } };
      return data.detail || data.error?.message || JSON.stringify(data).slice(0, 200);
    }
    return (await response.text()).slice(0, 200);
  } catch {
    return response.statusText;
  }
}

// ── Local image function ────────────────────────────────────────────────────

export async function generateLocalImage(
  block: Block,
  options: { buildOutDir: string },
): Promise<ImageGenResult> {
  const { buildOutDir } = options;

  const imagesDir = path.join(buildOutDir, "public", "images");
  const blockDir = path.join(buildOutDir, "src", "blocks", block.id);
  const imageFile = path.join(imagesDir, `${block.id}.png`);
  const componentFile = path.join(blockDir, "Component.tsx");

  const relativeImagePath = `public/images/${block.id}.png`;
  const relativeComponentPath = `src/blocks/${block.id}/Component.tsx`;

  const srcImagePath = path.join(buildOutDir, "public", block.imageSource!);

  if (!fs.existsSync(srcImagePath)) {
    throw new ImageGenError(
      `Local image not found: ${srcImagePath}`,
      "ERR_LOCAL_IMAGE_MISSING",
    );
  }

  fs.mkdirSync(imagesDir, { recursive: true });
  fs.copyFileSync(srcImagePath, imageFile);

  fs.mkdirSync(blockDir, { recursive: true });
  fs.writeFileSync(componentFile, buildWrapperComponent(block.id), "utf-8");

  block.visual.imagePath = relativeImagePath;
  block.visual.componentPath = relativeComponentPath;

  return { imagePath: relativeImagePath, componentPath: relativeComponentPath, cacheHit: false };
}

// ── Remote backends ─────────────────────────────────────────────────────────

async function fetchOpenAIImage(
  prompt: string,
  size: string,
  config: ImageGenConfig,
  baseURL: string,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  if (!config.apiKey) {
    throw new ImageGenError(
      "Image generation API key is required but not provided.",
      "ERR_IMAGE_GEN_KEY_MISSING",
    );
  }

  const { controller, clear } = createFetchController(config.timeoutMs, signal);

  try {
    const response = await fetch(`${baseURL}/v1/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        prompt,
        size,
        n: 1,
        response_format: "b64_json",
      }),
      signal: controller.signal,
    });
    clear();

    if (!response.ok) {
      const detail = await readHttpError(response);
      throw new ImageGenError(
        `Image generation API returned ${response.status}: ${detail}`,
        `ERR_IMAGE_GEN_HTTP_${response.status}`,
      );
    }

    const data = await response.json() as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    if (data.data?.[0]?.b64_json) {
      return Buffer.from(data.data[0].b64_json, "base64");
    }

    if (data.data?.[0]?.url) {
      const imgResponse = await fetch(data.data[0].url, { signal: controller.signal });
      if (!imgResponse.ok) {
        throw new ImageGenError(
          `Failed to download image from URL: HTTP ${imgResponse.status}`,
          `ERR_IMAGE_GEN_HTTP_${imgResponse.status}`,
        );
      }
      return Buffer.from(await imgResponse.arrayBuffer());
    }

    throw new ImageGenError(
      "Image generation API response missing data[0].b64_json or data[0].url",
      "ERR_IMAGE_GEN_BAD_RESPONSE",
    );
  } catch (err) {
    clear();
    wrapFetchError(err, signal, config.timeoutMs);
  }
}

async function fetchSenseNovaImage(
  prompt: string,
  size: string,
  config: ImageGenConfig,
  baseURL: string,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const { width, height } = parseSize(size);
  const { controller, clear } = createFetchController(config.timeoutMs, signal);

  try {
    const response = await fetch(`${baseURL}/api/t2i`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        width,
        height,
        num_steps: config.numSteps ?? 15,
        cfg_scale: config.cfgScale ?? 4.0,
      }),
      signal: controller.signal,
    });
    clear();

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      const detail = await readHttpError(response);
      throw new ImageGenError(
        `SenseNova t2i returned ${response.status}: ${detail}`,
        `ERR_IMAGE_GEN_HTTP_${response.status}`,
      );
    }

    if (!contentType.includes("image/png")) {
      const detail = contentType.includes("json")
        ? await readHttpError(response)
        : `unexpected content-type ${contentType}`;
      throw new ImageGenError(
        `SenseNova t2i bad response: ${detail}`,
        "ERR_IMAGE_GEN_BAD_RESPONSE",
      );
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    clear();
    wrapFetchError(err, signal, config.timeoutMs);
  }
}

// ── ComfyUI backend (server mode: /prompt → /history → /view) ─────────────

/**
 * Built-in Z-Image-Turbo FP8 workflow in ComfyUI API format.
 * Placeholders {{PROMPT}} / {{NEGATIVE_PROMPT}} / {{WIDTH}} / {{HEIGHT}} /
 * {{SEED}} are substituted before submission. Model filenames match the
 * layout installed by third_servers/comfyui/install.sh.
 */
const COMFYUI_BUILTIN_WORKFLOW = JSON.stringify({
  "10": {
    class_type: "UNETLoader",
    inputs: { unet_name: "z-image-turbo-fp8-e4m3fn.safetensors", weight_dtype: "default" },
  },
  "11": {
    class_type: "CLIPLoader",
    inputs: { clip_name: "qwen_3_4b.safetensors", type: "qwen_image" },
  },
  "12": {
    class_type: "VAELoader",
    inputs: { vae_name: "ae.safetensors" },
  },
  "20": {
    class_type: "CLIPTextEncode",
    inputs: { text: "{{PROMPT}}", clip: ["11", 0] },
  },
  "21": {
    class_type: "CLIPTextEncode",
    inputs: { text: "{{NEGATIVE_PROMPT}}", clip: ["11", 0] },
  },
  "30": {
    class_type: "EmptyLatentImage",
    inputs: { width: "{{WIDTH}}", height: "{{HEIGHT}}", batch_size: 1 },
  },
  "40": {
    class_type: "KSampler",
    inputs: {
      seed: "{{SEED}}",
      steps: 9,
      cfg: 1.0,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1.0,
      model: ["10", 0],
      positive: ["20", 0],
      negative: ["21", 0],
      latent_image: ["30", 0],
    },
  },
  "50": {
    class_type: "VAEDecode",
    inputs: { samples: ["40", 0], vae: ["12", 0] },
  },
  "60": {
    class_type: "SaveImage",
    inputs: { filename_prefix: "autovideo", images: ["50", 0] },
  },
});

interface ComfyUiHistoryImage {
  filename: string;
  subfolder?: string;
  type?: string;
}

function loadComfyWorkflowTemplate(config: ImageGenConfig): string {
  const workflowPath = config.workflowPath || process.env.COMFYUI_WORKFLOW_PATH;
  if (!workflowPath) return COMFYUI_BUILTIN_WORKFLOW;
  try {
    return fs.readFileSync(workflowPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ImageGenError(
      `Failed to read ComfyUI workflow template at ${workflowPath}: ${message}`,
      "ERR_IMAGE_GEN_WORKFLOW_MISSING",
    );
  }
}

/** Substitute {{PLACEHOLDER}}s in a raw workflow JSON string, then validate it parses. */
function buildComfyWorkflow(
  template: string,
  values: { prompt: string; negativePrompt: string; width: number; height: number; seed: number },
): Record<string, unknown> {
  const escapeJsonString = (s: string) => JSON.stringify(s).slice(1, -1);
  const filled = template
    .replaceAll("{{PROMPT}}", escapeJsonString(values.prompt))
    .replaceAll("{{NEGATIVE_PROMPT}}", escapeJsonString(values.negativePrompt))
    .replaceAll("{{WIDTH}}", String(values.width))
    .replaceAll("{{HEIGHT}}", String(values.height))
    .replaceAll("{{SEED}}", String(values.seed));

  if (filled.includes("{{")) {
    throw new ImageGenError(
      "ComfyUI workflow template has unsubstituted placeholders",
      "ERR_IMAGE_GEN_WORKFLOW_TEMPLATE",
    );
  }
  try {
    return JSON.parse(filled) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ImageGenError(
      `ComfyUI workflow template is not valid JSON after substitution: ${message}`,
      "ERR_IMAGE_GEN_WORKFLOW_TEMPLATE",
    );
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchComfyUIImage(
  prompt: string,
  size: string,
  config: ImageGenConfig,
  baseURL: string,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const { width, height } = parseSize(size);
  const template = loadComfyWorkflowTemplate(config);
  const workflow = buildComfyWorkflow(template, {
    prompt,
    negativePrompt: config.negativePrompt ?? "",
    width,
    height,
    seed: config.seed ?? randomSeed(),
  });
  const envPollInterval = Number(process.env.COMFYUI_POLL_INTERVAL_MS);
  const pollIntervalMs = config.pollIntervalMs
    ?? (Number.isFinite(envPollInterval) && envPollInterval > 0
      ? envPollInterval
      : COMFYUI_DEFAULT_POLL_INTERVAL_MS);

  const { controller, clear } = createFetchController(config.timeoutMs, signal);

  try {
    // 1) Submit the workflow. ComfyUI queues it and returns a prompt_id.
    const submitResponse = await fetch(`${baseURL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal: controller.signal,
    });

    if (!submitResponse.ok) {
      const detail = await readHttpError(submitResponse);
      throw new ImageGenError(
        `ComfyUI /prompt returned ${submitResponse.status}: ${detail}`,
        `ERR_IMAGE_GEN_HTTP_${submitResponse.status}`,
      );
    }

    const submitted = await submitResponse.json() as {
      prompt_id?: string;
      error?: string | { message?: string };
      node_errors?: Record<string, { errors?: Array<{ message?: string }> }>;
    };
    if (!submitted.prompt_id) {
      const nodeErrors = Object.entries(submitted.node_errors ?? {})
        .flatMap(([node, e]) => (e.errors ?? []).map((x) => `node ${node}: ${x.message}`))
        .join("; ");
      const detail = typeof submitted.error === "string"
        ? submitted.error
        : submitted.error?.message;
      throw new ImageGenError(
        `ComfyUI rejected the workflow: ${nodeErrors || detail || "missing prompt_id"}`,
        "ERR_IMAGE_GEN_BAD_RESPONSE",
      );
    }
    const promptId = submitted.prompt_id;

    // 2) Poll /history/{prompt_id} until the run finishes and reports outputs.
    let image: ComfyUiHistoryImage | undefined;
    for (;;) {
      const historyResponse = await fetch(`${baseURL}/history/${promptId}`, {
        signal: controller.signal,
      });
      if (!historyResponse.ok) {
        const detail = await readHttpError(historyResponse);
        throw new ImageGenError(
          `ComfyUI /history returned ${historyResponse.status}: ${detail}`,
          `ERR_IMAGE_GEN_HTTP_${historyResponse.status}`,
        );
      }

      const history = await historyResponse.json() as Record<string, {
        status?: {
          status_str?: string;
          messages?: Array<[string, { exception_message?: string }]>;
        };
        outputs?: Record<string, { images?: ComfyUiHistoryImage[] }>;
      }>;
      const entry = history[promptId];
      if (entry) {
        if (entry.status?.status_str === "error") {
          const detail = (entry.status.messages ?? [])
            .map(([, body]) => body.exception_message)
            .filter(Boolean)
            .join("; ");
          throw new ImageGenError(
            `ComfyUI execution failed: ${detail || "unknown error"}`,
            "ERR_IMAGE_GEN_EXECUTION",
          );
        }
        for (const nodeOutput of Object.values(entry.outputs ?? {})) {
          image = nodeOutput.images?.[0];
          if (image) break;
        }
        if (image) break;
        // Entry present but no outputs yet: execution still in progress.
      }
      await sleep(pollIntervalMs, controller.signal);
    }

    // 3) Download the rendered image.
    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder ?? "",
      type: image.type ?? "output",
    });
    const viewResponse = await fetch(`${baseURL}/view?${params}`, {
      signal: controller.signal,
    });
    if (!viewResponse.ok) {
      const detail = await readHttpError(viewResponse);
      throw new ImageGenError(
        `ComfyUI /view returned ${viewResponse.status}: ${detail}`,
        `ERR_IMAGE_GEN_HTTP_${viewResponse.status}`,
      );
    }

    return Buffer.from(await viewResponse.arrayBuffer());
  } catch (err) {
    clear();
    wrapFetchError(err, signal, config.timeoutMs);
  } finally {
    clear();
  }
}

async function fetchRemoteImage(
  prompt: string,
  size: string,
  config: ImageGenConfig,
  provider: ImageGenProviderKind,
  baseURL: string,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  if (provider === "sensenova") {
    return fetchSenseNovaImage(prompt, size, config, baseURL, signal);
  }
  if (provider === "comfyui") {
    return fetchComfyUIImage(prompt, size, config, baseURL, signal);
  }
  return fetchOpenAIImage(prompt, size, config, baseURL, signal);
}

// ── API image generation ─────────────────────────────────────────────────────

export async function generateImage(
  block: Block,
  options: GenerateImageOptions,
): Promise<ImageGenResult> {
  const { config, buildOutDir, meta, cacheStore, force, signal, onProgress } = options;

  const prompt = block.visual.description;
  const provider = resolveImageGenProvider(config);
  const baseURL = resolveBaseURL(config, provider);
  const size = applySizeMapper(resolveSize(meta.aspect, config.size), provider, config);
  const model = cacheModel(config, provider);

  if (signal?.aborted) {
    throw new ImageGenError("Image generation cancelled", "ERR_CANCELLED");
  }

  onProgress?.({
    percent: 0,
    step: `开始生成图片: ${block.id}`,
    stage: "visuals",
    blockId: block.id,
  });

  const imagesDir = path.join(buildOutDir, "public", "images");
  const blockDir = path.join(buildOutDir, "src", "blocks", block.id);
  const imageFile = path.join(imagesDir, `${block.id}.png`);
  const componentFile = path.join(blockDir, "Component.tsx");

  const relativeImagePath = `public/images/${block.id}.png`;
  const relativeComponentPath = `src/blocks/${block.id}/Component.tsx`;

  const imageKey: ImageKey = buildImageKey(
    prompt,
    model,
    size,
    baseURL,
    provider,
    config,
  );

  let cacheHit = false;
  if (!force) {
    const cachedPath = await cacheStore.get("images", imageKey);
    if (cachedPath) {
      fs.mkdirSync(imagesDir, { recursive: true });
      fs.copyFileSync(cachedPath, imageFile);
      cacheHit = true;
    }
  }

  if (!cacheHit) {
    const stepLabel = provider === "sensenova"
      ? `请求 SenseNova 文生图: ${block.id}`
      : provider === "comfyui"
        ? `请求 ComfyUI 文生图: ${block.id}`
        : `请求文生图 API: ${block.id}`;
    onProgress?.({
      percent: 20,
      step: stepLabel,
      stage: "visuals",
      blockId: block.id,
    });

    const imageBuffer = await fetchRemoteImage(
      prompt,
      size,
      config,
      provider,
      baseURL,
      signal,
    );

    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(imageFile, imageBuffer);

    await cacheStore.put("images", imageKey, imageFile, {
      prompt,
      model,
      size,
      baseURL,
      provider,
    });
  }

  fs.mkdirSync(blockDir, { recursive: true });
  fs.writeFileSync(componentFile, buildWrapperComponent(block.id), "utf-8");

  block.visual.imagePath = relativeImagePath;
  block.visual.componentPath = relativeComponentPath;

  onProgress?.({
    percent: 100,
    step: `图片生成完成: ${block.id}`,
    stage: "visuals",
    blockId: block.id,
  });

  return {
    imagePath: relativeImagePath,
    componentPath: relativeComponentPath,
    cacheHit,
  };
}

/** Health-check URL for the configured image generation backend. */
export function imageGenHealthURL(config: ImageGenConfig): string | null {
  const provider = resolveImageGenProvider(config);
  const baseURL = resolveBaseURL(config, provider);
  if (provider === "sensenova") return `${baseURL}/api/health`;
  if (provider === "comfyui") return `${baseURL}/system_stats`;
  if (!config.apiKey) return null;
  return `${baseURL}/v1/models`;
}

/** Whether image generation is sufficiently configured to run. */
export function isImageGenConfigured(config: ImageGenConfig): boolean {
  const provider = resolveImageGenProvider(config);
  if (provider === "sensenova") return true;
  if (provider === "comfyui") return true;
  return Boolean(config.apiKey);
}
