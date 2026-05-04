/**
 * Image Generation Module — Generate PNG images from visual descriptions
 * using OpenAI-compatible image generation API.
 *
 * Protocol: POST {baseURL}/v1/images/generations
 * Supports b64_json and url response formats.
 *
 * Cache key: sha256(prompt + model + size + baseURL)
 *
 * Output:
 *   build/{slug}/public/images/{id}.png
 *   build/{slug}/src/blocks/{id}/Component.tsx  (wrapper with staticFile)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { type CacheStore, type ImageKey } from "../cache/store.js";
import type { Block, ProgressEvent } from "../types/script.js";

// ── Runtime config (subset of AutoVideoConfig.imageGen with runtime-only fields) ─

export interface ImageGenConfig {
  /** API base URL (e.g. https://api.openai.com) */
  baseURL?: string;
  /** API key */
  apiKey?: string;
  /** Model identifier */
  model: string;
  /** Output image size override (e.g. "1920x1080"); computed from meta.aspect if not set */
  size?: string;
  /** Request timeout in ms */
  timeoutMs: number;
  /** Max concurrent image generation calls */
  concurrency: number;
}

// ── Options ────────────────────────────────────────────────────────────────

export interface GenerateImageOptions {
  /** Image generation configuration */
  config: ImageGenConfig;
  /** Build output directory (where script.json lives) */
  buildOutDir: string;
  /** Script meta for aspect-to-size mapping */
  meta: { aspect: string; width: number; height: number };
  /** Cache store instance */
  cacheStore: CacheStore;
  /** Force cache miss */
  force?: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
}

// ── Result ─────────────────────────────────────────────────────────────────

export interface ImageGenResult {
  /** Relative POSIX path to the generated image */
  imagePath: string;
  /** Relative POSIX path to the wrapper Component.tsx */
  componentPath: string;
  /** Whether the result came from cache */
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

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveSize(aspect: string, override?: string): string {
  if (override) return override;
  if (ASPECT_TO_SIZE[aspect]) return ASPECT_TO_SIZE[aspect];
  console.warn(`Unknown aspect ratio "${aspect}", falling back to 1920x1080`);
  return "1920x1080";
}

/**
 * Build the wrapper Component.tsx for an image-mode block.
 * Uses staticFile("images/{id}.png") so Remotion resolves the PNG from publicDir.
 */
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

// ── Local image function ────────────────────────────────────────────────────

/**
 * Use a local image file (already processed by compile stage to
 * public/assets/{hash}.ext) as the block's visual output.
 *
 * Copies the image to public/images/{id}.png and writes the wrapper
 * Component.tsx — no API calls involved.
 */
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

  // Locate the source image in public/assets/
  const srcImagePath = path.join(buildOutDir, "public", block.imageSource!);

  if (!fs.existsSync(srcImagePath)) {
    throw new ImageGenError(
      `Local image not found: ${srcImagePath}`,
      "ERR_LOCAL_IMAGE_MISSING",
    );
  }

  // Copy to public/images/
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.copyFileSync(srcImagePath, imageFile);

  // Write wrapper Component.tsx
  const wrapperCode = buildWrapperComponent(block.id);
  fs.mkdirSync(blockDir, { recursive: true });
  fs.writeFileSync(componentFile, wrapperCode, "utf-8");

  // Update block in place
  block.visual.imagePath = relativeImagePath;
  block.visual.componentPath = relativeComponentPath;

  return { imagePath: relativeImagePath, componentPath: relativeComponentPath, cacheHit: false };
}

// ── API image generation ─────────────────────────────────────────────────────

/**
 * Generate a PNG image from a block's visual description using an
 * OpenAI-compatible image generation API.
 *
 * On cache hit: copies cached PNG to build dir, writes wrapper TSX.
 * On cache miss: calls API, saves PNG, caches PNG, writes wrapper TSX.
 *
 * @returns {imagePath, componentPath, cacheHit}
 * @throws {ImageGenError} on key missing, timeout, HTTP error, or bad response
 */
export async function generateImage(
  block: Block,
  options: GenerateImageOptions,
): Promise<ImageGenResult> {
  const { config, buildOutDir, meta, cacheStore, force, signal, onProgress } = options;

  const prompt = block.visual.description;
  const size = resolveSize(meta.aspect, config.size);
  const baseURL = config.baseURL || "https://api.openai.com";

  if (!config.apiKey) {
    throw new ImageGenError(
      "Image generation API key is required but not provided.",
      "ERR_IMAGE_GEN_KEY_MISSING",
    );
  }

  // Check abort before starting
  if (signal?.aborted) {
    throw new ImageGenError("Image generation cancelled", "ERR_CANCELLED");
  }

  onProgress?.({
    percent: 0,
    step: `开始生成图片: ${block.id}`,
    stage: "visuals",
    blockId: block.id,
  });

  // Directories and paths
  const imagesDir = path.join(buildOutDir, "public", "images");
  const blockDir = path.join(buildOutDir, "src", "blocks", block.id);
  const imageFile = path.join(imagesDir, `${block.id}.png`);
  const componentFile = path.join(blockDir, "Component.tsx");

  const relativeImagePath = `public/images/${block.id}.png`;
  const relativeComponentPath = `src/blocks/${block.id}/Component.tsx`;

  // Check cache (unless --force)
  let cacheHit = false;
  if (!force) {
    const imageKey: ImageKey = {
      prompt,
      model: config.model,
      size,
      baseURL,
    };
    const cachedPath = await cacheStore.get("images", imageKey);
    if (cachedPath) {
      fs.mkdirSync(imagesDir, { recursive: true });
      fs.copyFileSync(cachedPath, imageFile);
      cacheHit = true;
    }
  }

  if (!cacheHit) {
    // ---- HTTP call to OpenAI-compatible image generation API ----

    onProgress?.({
      percent: 20,
      step: `请求文生图 API: ${block.id}`,
      stage: "visuals",
      blockId: block.id,
    });

    const url = `${baseURL}/v1/images/generations`;
    const body = JSON.stringify({
      model: config.model,
      prompt,
      size,
      n: 1,
      response_format: "b64_json",
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    // Forward external signal to timeout controller
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        throw new ImageGenError("Image generation cancelled", "ERR_CANCELLED");
      }
      signal.addEventListener(
        "abort",
        () => controller.abort(signal.reason),
        { once: true },
      );
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        if (signal?.aborted) {
          throw new ImageGenError("Image generation cancelled", "ERR_CANCELLED");
        }
        throw new ImageGenError(
          `Image generation timed out after ${config.timeoutMs}ms`,
          "ERR_IMAGE_GEN_TIMEOUT",
        );
      }
      throw new ImageGenError(
        `Image generation HTTP error: ${err.message}`,
        "ERR_IMAGE_GEN_HTTP_ERROR",
      );
    }

    if (!response.ok) {
      const status = response.status;
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        // ignore body read errors
      }
      throw new ImageGenError(
        `Image generation API returned ${status}: ${errorBody.slice(0, 200)}`,
        `ERR_IMAGE_GEN_HTTP_${status}`,
      );
    }

    // Parse response
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new ImageGenError(
        "Failed to parse image generation API response",
        "ERR_IMAGE_GEN_BAD_RESPONSE",
      );
    }

    // Extract image data — support both b64_json and url
    let imageBuffer: Buffer;

    if (data.data?.[0]?.b64_json) {
      imageBuffer = Buffer.from(data.data[0].b64_json, "base64");
    } else if (data.data?.[0]?.url) {
      // Download the image from the returned URL
      onProgress?.({
        percent: 50,
        step: `下载生成图片: ${block.id}`,
        stage: "visuals",
        blockId: block.id,
      });

      try {
        const imgResponse = await fetch(data.data[0].url, {
          signal: controller.signal,
        });
        if (!imgResponse.ok) {
          throw new ImageGenError(
            `Failed to download image from URL: HTTP ${imgResponse.status}`,
            `ERR_IMAGE_GEN_HTTP_${imgResponse.status}`,
          );
        }
        const arrayBuffer = await imgResponse.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      } catch (err: any) {
        if (err instanceof ImageGenError) throw err;
        if (err.name === "AbortError") {
          if (signal?.aborted) {
            throw new ImageGenError("Image generation cancelled", "ERR_CANCELLED");
          }
          throw new ImageGenError(
            "Image download timed out",
            "ERR_IMAGE_GEN_TIMEOUT",
          );
        }
        throw new ImageGenError(
          `Failed to download image from URL: ${err.message}`,
          "ERR_IMAGE_GEN_BAD_RESPONSE",
        );
      }
    } else {
      throw new ImageGenError(
        "Image generation API response missing data[0].b64_json or data[0].url",
        "ERR_IMAGE_GEN_BAD_RESPONSE",
      );
    }

    // Write PNG to build output directory
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(imageFile, imageBuffer);

    // Cache the PNG for future reuse
    const imageKey: ImageKey = {
      prompt,
      model: config.model,
      size,
      baseURL,
    };
    await cacheStore.put("images", imageKey, imageFile, {
      prompt,
      model: config.model,
      size,
      baseURL,
    });
  }

  // Write wrapper Component.tsx (always, even on cache hit — it's cheap to regenerate)
  fs.mkdirSync(blockDir, { recursive: true });
  const wrapperTsx = buildWrapperComponent(block.id);
  fs.writeFileSync(componentFile, wrapperTsx, "utf-8");

  // Update block IR
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
