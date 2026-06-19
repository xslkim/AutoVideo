/**
 * AutoVideo — meta.md parser
 *
 * Reads a meta.md file, extracts the `--- meta ---` YAML-like segment,
 * validates fields per PRD §3.4, resolves voiceRef to absolute path,
 * and computes width × height from aspect ratio.
 *
 * CLI overrides (--meta key=value) are applied here.
 *
 * PRD references: §3.2 (meta.md), §3.4 (元数据字段), §6.1 (compile step 2)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { AspectRatio } from "../types/script.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed meta fields (before width/height computation) */
export interface ParsedMeta {
  title: string;
  voiceRef: string;        // absolute path
  aspect: AspectRatio;
  theme: string;
  fps: number;
  /** Optional slug override for output directory naming */
  slug?: string;
  /** Optional avatar loop video for lip-sync overlay (absolute path to mp4) */
  avatarRef?: string;
  /** Skip MuseTalk lip-sync, just overlay avatar.mp4 on repeat (default false) */
  skipLipsync: boolean;
  /** PiP corner radius in pixels when avatar overlay is used (8–128, default 24) */
  avatarRadius: number;
}

/** Parsed meta with dimensions computed */
export interface ResolvedMeta extends ParsedMeta {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];

const ASPECT_TO_DIMS: Record<AspectRatio, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
};

/** Default values per PRD §3.4 */
const DEFAULTS = {
  aspect: "16:9" as AspectRatio,
  theme: "dark-code",
  fps: 30,
  avatarRadius: 24,
};

const AVATAR_RADIUS_MIN = 8;
const AVATAR_RADIUS_MAX = 128;

// ---------------------------------------------------------------------------
// Meta segment extractor
// ---------------------------------------------------------------------------

/**
 * Extract the content between `--- meta ---` delimiters from a meta.md file.
 *
 * Expected format:
 * ```
 * --- meta ---
 * key: value
 * key: value
 * ---
 * ```
 *
 * The opening `--- meta ---` and closing `---` must be on their own lines.
 */
export function extractMetaSegment(content: string): string {
  const lines = content.split("\n");

  // Find opening delimiter: a line that is exactly "--- meta ---" (allowing trailing whitespace)
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "--- meta ---") {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    throw new MetaError(
      'meta.md must contain a "--- meta ---" segment',
    );
  }

  // Find closing delimiter: a line that is exactly "---" (after the opening)
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    throw new MetaError(
      'meta.md "--- meta ---" segment is missing closing "---"',
    );
  }

  // Return the lines between delimiters
  return lines.slice(startIdx + 1, endIdx).join("\n");
}

// ---------------------------------------------------------------------------
// YAML-like key: value parser
// ---------------------------------------------------------------------------

/**
 * Parse `key: value` lines from the meta segment.
 * Returns a Map preserving insertion order.
 */
export function parseMetaKvLines(segmentContent: string): Map<string, string> {
  const result = new Map<string, string>();

  for (const line of segmentContent.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      throw new MetaError(
        `Invalid meta line (missing ":"): "${trimmed}"`,
      );
    }

    const key = trimmed.substring(0, colonIdx).trim();
    const value = trimmed.substring(colonIdx + 1).trim();

    if (key === "") {
      throw new MetaError(
        `Invalid meta line (empty key): "${trimmed}"`,
      );
    }

    result.set(key, value);
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI override types
// ---------------------------------------------------------------------------

export interface MetaOverrides {
  [key: string]: string | number | boolean;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Read and parse a meta.md file.
 *
 * @param metaPath - Absolute path to the meta.md file
 * @param overrides - CLI --meta overrides (key=value parsed, with type inference)
 * @returns ParsedMeta with all fields validated and voiceRef resolved to absolute path
 * @throws MetaError on validation failures
 */
export function readMeta(
  metaPath: string,
  overrides?: MetaOverrides,
): ParsedMeta {
  // 1. File must exist
  if (!existsSync(metaPath)) {
    throw new MetaError(`Meta file not found: ${metaPath}`);
  }

  // 2. Read content
  let content: string;
  try {
    content = readFileSync(metaPath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MetaError(`Failed to read meta.md "${metaPath}": ${msg}`);
  }

  // 3. Extract and parse meta segment
  const segment = extractMetaSegment(content);
  const kv = parseMetaKvLines(segment);

  // 4. Apply CLI overrides (highest priority)
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      kv.set(key, String(value));
    }
  }

  // 5. Extract and validate required fields

  // title — required, no default
  const title = kv.get("title");
  if (!title || title.trim() === "") {
    throw new MetaError(
      `meta.md missing required field "title"`,
    );
  }

  // aspect — optional, default "16:9"
  const aspectRaw = kv.get("aspect") ?? DEFAULTS.aspect;
  if (!VALID_ASPECTS.includes(aspectRaw as AspectRatio)) {
    throw new MetaError(
      `Invalid aspect "${aspectRaw}". Must be one of: ${VALID_ASPECTS.join(", ")}`,
    );
  }
  const aspect = aspectRaw as AspectRatio;

  // theme — optional, default "dark-code"
  const theme = kv.get("theme") ?? DEFAULTS.theme;

  // fps — optional, default 30
  const fpsRaw = kv.get("fps") ?? String(DEFAULTS.fps);
  const fps = Number(fpsRaw);
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new MetaError(
      `Invalid fps "${fpsRaw}". Must be a positive number`,
    );
  }

  // voiceRef — optional, default "./B00.wav" relative to meta.md directory
  const voiceRefRelative = kv.get("voiceRef") ?? "./B00.wav";
  const metaDir = dirname(metaPath);
  const voiceRef = resolve(metaDir, voiceRefRelative);

  // Validate voiceRef file exists
  if (!existsSync(voiceRef)) {
    const isDefault = !kv.has("voiceRef");
    const hint = isDefault
      ? `Default voice reference file not found. Place a 10-30s clear human voice WAV file at "${voiceRef}" or specify voiceRef in meta.md`
      : `voiceRef file not found: ${voiceRef} (specified as "${voiceRefRelative}" in meta.md)`;
    throw new MetaError(hint);
  }

  // slug — optional
  const slug = kv.get("slug");

  // avatarRef — optional, lip-sync avatar video
  let avatarRef: string | undefined;
  const avatarRefRaw = kv.get("avatarRef");
  if (avatarRefRaw && avatarRefRaw.trim() !== "") {
    const avatarPath = resolve(metaDir, avatarRefRaw);
    if (!existsSync(avatarPath)) {
      throw new MetaError(
        `avatarRef file not found: ${avatarPath} (specified as "${avatarRefRaw}" in meta.md)`,
      );
    }
    if (!avatarPath.toLowerCase().endsWith(".mp4")) {
      throw new MetaError(
        `avatarRef must be an .mp4 file, got: ${avatarRefRaw}`,
      );
    }
    avatarRef = avatarPath;
  }

  // skipLipsync — optional, default false (run MuseTalk lip-sync when avatarRef is set)
  const skipLipsyncRaw = kv.get("skipLipsync");
  const skipLipsync = skipLipsyncRaw === undefined ? false : skipLipsyncRaw.toLowerCase() === "true";

  // avatarRadius — optional PiP corner radius (8–128 px, default 24)
  const avatarRadiusRaw = kv.get("avatarRadius");
  let avatarRadius = DEFAULTS.avatarRadius;
  if (avatarRadiusRaw !== undefined && avatarRadiusRaw.trim() !== "") {
    const parsed = Number(avatarRadiusRaw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new MetaError(
        `avatarRadius must be an integer between ${AVATAR_RADIUS_MIN} and ${AVATAR_RADIUS_MAX}, got: ${avatarRadiusRaw}`,
      );
    }
    if (parsed < AVATAR_RADIUS_MIN || parsed > AVATAR_RADIUS_MAX) {
      throw new MetaError(
        `avatarRadius must be between ${AVATAR_RADIUS_MIN} and ${AVATAR_RADIUS_MAX}, got: ${parsed}`,
      );
    }
    avatarRadius = parsed;
  }

  return {
    title,
    voiceRef,
    aspect,
    theme,
    fps,
    skipLipsync,
    avatarRadius,
    ...(slug ? { slug } : {}),
    ...(avatarRef ? { avatarRef } : {}),
  };
}

// ---------------------------------------------------------------------------
// Aspect → dimensions
// ---------------------------------------------------------------------------

/**
 * Compute width and height from an aspect ratio string.
 *
 * - `16:9` → 1920 × 1080
 * - `9:16` → 1080 × 1920
 * - `1:1`  → 1080 × 1080
 */
export function aspectToDimensions(aspect: AspectRatio): {
  width: number;
  height: number;
} {
  const dims = ASPECT_TO_DIMS[aspect];
  if (!dims) {
    // Should never happen if aspect is validated, but just in case
    throw new MetaError(`Unknown aspect ratio: ${aspect}`);
  }
  return { width: dims[0], height: dims[1] };
}

/**
 * Parse meta.md and compute dimensions in one step.
 */
export function readMetaWithDimensions(
  metaPath: string,
  overrides?: MetaOverrides,
): ResolvedMeta {
  const meta = readMeta(metaPath, overrides);
  const { width, height } = aspectToDimensions(meta.aspect);
  return { ...meta, width, height };
}
