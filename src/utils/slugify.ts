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
  const pinyinStr: string = pinyin(title, { toneType: "none" });

  // Step 2: Replace non-alphanumeric (non-ASCII) characters with `-`
  let result: string = pinyinStr.replace(/[^a-zA-Z0-9]/g, "-");

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
 * 2. meta.md `slug:` field override → `./build/{slug}/`
 * 3. Auto slug from title → `./build/{slug(title)}/`
 *
 * @param title - Video title from meta
 * @param outFlag - Explicit --out flag value (if provided)
 * @param slugOverride - slug field from meta.md (if provided)
 */
export function resolveOutDir(
  title: string,
  outFlag?: string,
  slugOverride?: string
): string {
  if (outFlag) {
    return resolve(outFlag);
  }
  const slug = slugOverride ? slugify(slugOverride) : slugify(title);
  return resolve("build", slug);
}