/**
 * AutoVideo — Slugify utility
 *
 * Converts a title string to a filesystem-safe directory name.
 *
 * Rules (per PRD §7):
 * 1. CJK characters → pinyin (tone marks stripped)
 * 2. Remove non-ASCII-safe characters
 * 3. Spaces / `/` / emoji etc → `-`
 * 4. All lowercase
 * 5. Collapse multiple `-` into single `-`
 * 6. Strip leading/trailing `-`
 *
 * Also provides `resolveOutDir` to compute the build output directory
 * from a title and optional CLI/config overrides.
 */

import { resolve } from "node:path";
import { pinyin } from "pinyin-pro";

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

/**
 * Convert a title string to a filesystem-safe slug.
 *
 * CJK characters are converted to pinyin (without tones),
 * then all non-alphanumeric characters are replaced with `-`,
 * collapsed, and lowercased.
 */
export function slugify(title: string): string {
  // Step 1: Convert CJK characters to pinyin (no tone marks)
  // pinyin-pro splits Latin chars into individual characters, so we
  // process CJK and non-CJK segments separately.
  const chars = [...title];
  const segments: string[] = [];
  let cjkBuffer = "";

  for (const ch of chars) {
    // CJK Unified Ideographs ranges + CJK Extension ranges
    const code = ch.codePointAt(0)!;
    const isCJK =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df);

    if (isCJK) {
      cjkBuffer += ch;
    } else {
      if (cjkBuffer) {
        segments.push(pinyin(cjkBuffer, { toneType: "none" }).replace(/\s+/g, "-"));
        cjkBuffer = "";
      }
      segments.push(ch);
    }
  }
  if (cjkBuffer) {
    segments.push(pinyin(cjkBuffer, { toneType: "none" }).replace(/\s+/g, "-"));
  }

  const combined = segments.join("");

  // Step 2: Replace non-alphanumeric characters with `-`
  let result: string = combined.replace(/[^a-zA-Z0-9]/g, "-");

  // Step 3: Collapse multiple `-` into single
  result = result.replace(/-+/g, "-");

  // Step 4: Strip leading/trailing `-`
  result = result.replace(/^-+|-+$/g, "");

  // Step 5: Lowercase
  result = result.toLowerCase();

  // Fallback
  if (!result) {
    result = "untitled";
  }

  return result;
}

// ---------------------------------------------------------------------------
// resolveOutDir
// ---------------------------------------------------------------------------

/**
 * Compute the build output directory.
 *
 * Priority:
 * 1. Explicit --out flag (absolute or relative to cwd)
 * 2. meta.md `slug:` field override → `{projectDir}/build/{slug}/`
 * 3. Auto slug from title → `{projectDir}/build/{slug(title)}/`
 *
 * When `projectDir` is omitted (e.g. in unit tests), falls back to
 * `./build/{slug}/` relative to cwd for backwards compatibility.
 *
 * @param title - Video title from meta
 * @param outFlag - Explicit --out flag value (if provided)
 * @param slugOverride - slug field from meta.md (if provided)
 * @param projectDir - project.json's directory; build output goes inside it
 */
export function resolveOutDir(
  title: string,
  outFlag?: string,
  slugOverride?: string,
  projectDir?: string
): string {
  if (outFlag) {
    return resolve(outFlag);
  }
  const slug = slugOverride ? slugify(slugOverride) : slugify(title);
  // Build output lives inside the project directory: project/{name}/build/{slug}/
  return projectDir ? resolve(projectDir, "build", slug) : resolve("build", slug);
}