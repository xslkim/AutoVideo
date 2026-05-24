/**
 * Image Generation Module — Generate PNG images from visual descriptions.
 *
 * Supports:
 * - openai: POST {baseURL}/v1/images/generations (b64_json or url)
 * - sensenova: POST {baseURL}/api/t2i (raw PNG, SenseNova-U1 web_t2i)
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

export interface ImageGenConfig {
  provider?: ImageGenProvider;
  baseURL?: string;
  apiKey?: string;
  model: string;
  size?: string;
  timeoutMs: number;
  concurrency: number;
  numSteps?: number;
  cfgScale?: number;
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

// ── Provider resolution ────────────────────────────────────────────────────

/** Infer provider from explicit config or base URL heuristics. */
export function resolveImageGenProvider(config: ImageGenConfig): ImageGenProvider {
  if (config.provider === "openai" || config.provider === "sensenova") {
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

  return "openai";
}

function resolveBaseURL(config: ImageGenConfig, provider: ImageGenProvider): string {
  if (config.baseURL) return config.baseURL.replace(/\/+$/, "");
  return provider === "sensenova" ? SENSENOVA_DEFAULT_BASE_URL : "https://api.openai.com";
}

function cacheModel(config: ImageGenConfig, provider: ImageGenProvider): string {
  if (provider === "sensenova") return "sensenova-u1";
  return config.model;
}

function buildImageKey(
  prompt: string,
  model: string,
  size: string,
  baseURL: string,
  provider: ImageGenProvider,
  config: ImageGenConfig,
): ImageKey {
  const key: ImageKey = { prompt, model, size, baseURL, provider };
  if (provider === "sensenova") {
    key.numSteps = config.numSteps ?? 15;
    key.cfgScale = config.cfgScale ?? 4.0;
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

async function fetchRemoteImage(
  prompt: string,
  size: string,
  config: ImageGenConfig,
  provider: ImageGenProvider,
  baseURL: string,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  if (provider === "sensenova") {
    return fetchSenseNovaImage(prompt, size, config, baseURL, signal);
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
  const size = resolveSize(meta.aspect, config.size);
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
    onProgress?.({
      percent: 20,
      step: provider === "sensenova"
        ? `请求 SenseNova 文生图: ${block.id}`
        : `请求文生图 API: ${block.id}`,
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
  if (!config.apiKey) return null;
  return `${baseURL}/v1/models`;
}

/** Whether image generation is sufficiently configured to run. */
export function isImageGenConfigured(config: ImageGenConfig): boolean {
  const provider = resolveImageGenProvider(config);
  if (provider === "sensenova") return true;
  return Boolean(config.apiKey);
}
