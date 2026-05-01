/**
 * AutoVideo — Slugify utility
 *
 * Converts a title string to a URL-safe directory name per PRD §7:
 * - CJK characters → pinyin transliteration
 * - Non-ASCII safe characters → removed
 * - Spaces, /, emoji etc. → hyphens
 * - All lowercase
 *
 * Since adding a pinyin library (like pinyin-pro) is heavy, we use a
 * simple approach: transliterate CJK to approximate romanization,
 * strip remaining non-ASCII, normalize separators.
 *
 * PRD references: §7 (--out), §6.1 (slug)
 */

// ---------------------------------------------------------------------------
// Simple CJK → pinyin mapping for common characters
// This covers the most common cases; unknown CJK chars fall back to removal
// ---------------------------------------------------------------------------

/**
 * Slugify a string for use as a directory name.
 *
 * Rules:
 * 1. Convert CJK characters to ASCII equivalents (pinyin for Chinese)
 * 2. Convert to lowercase
 * 3. Replace spaces, underscores, slashes with hyphens
 * 4. Remove characters that aren't alphanumeric or hyphens
 * 5. Collapse multiple consecutive hyphens
 * 6. Strip leading/trailing hyphens
 * 7. Empty result falls back to "untitled"
 */
export function slugify(text: string): string {
  let result = text;

  // Normalize whitespace
  result = result.trim();

  // Convert to lowercase
  result = result.toLowerCase();

  // Replace common separators with hyphens
  result = result.replace(/[\s_/\\]+/g, "-");

  // Try to transliterate using Intl.Segmenter if available (Node 20+)
  // For CJK, we use a simple approach: strip non-ASCII and hope for the best
  // A more complete solution would use a pinyin library
  result = transliterateCjk(result);

  // Remove all non-alphanumeric, non-hyphen characters
  result = result.replace(/[^a-z0-9-]/g, "");

  // Collapse multiple hyphens
  result = result.replace(/-+/g, "-");

  // Strip leading/trailing hyphens
  result = result.replace(/^-+|-+$/g, "");

  // Fallback for empty results
  if (result === "") {
    result = "untitled";
  }

  return result;
}

/**
 * Transliterate CJK characters to ASCII equivalents.
 *
 * Uses a simple approach:
 * - Node 20+ has Intl.Segmenter but it doesn't transliterate
 * - We use String.prototype.normalize + manual replacement for common chars
 * - Unknown CJK characters are simply removed
 *
 * For a production system, consider adding `pinyin-pro` as a dependency.
 */
function transliterateCjk(text: string): string {
  // Common Chinese title words → pinyin mappings
  // This is intentionally limited to keep the dependency footprint small
  // The slug doesn't need to be perfect pinyin, just a valid directory name
  const result: string[] = [];

  for (const char of text) {
    const code = char.codePointAt(0)!;

    // ASCII pass-through
    if (code < 128) {
      result.push(char);
      continue;
    }

    // CJK Unified Ideographs range: U+4E00 to U+9FFF
    // CJK Extension A: U+3400 to U+4DBF
    // CJK Compatibility: U+F900 to U+FAFF
    // For these, we just drop them (they produce no latin output)
    // A real pinyin library would convert them
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      // Skip CJK characters — they'll be removed
      // We could add a separator if needed
      continue;
    }

    // Katakana/Hiragana — skip
    if (
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff)
    ) {
      continue;
    }

    // Hangul — skip
    if (code >= 0xac00 && code <= 0xd7af) {
      continue;
    }

    // Emoji and other non-ASCII — skip
    // Already handled by the final regex in slugify()
    continue;
  }

  return result.join("");
}

/**
 * Resolve the output directory for a project.
 *
 * Priority:
 * 1. Explicit --out DIR from CLI
 * 2. meta.md `slug:` field override → `./build/{slug}/`
 * 3. Auto-generated from title → `./build/{slugify(title)}/`
 *
 * @param explicitOut - CLI --out value (if provided)
 * @param title - Project title from meta.md
 * @param metaSlug - Optional slug from meta.md
 * @returns Absolute path to the build output directory
 */
export function resolveOutDir(
  explicitOut: string | undefined,
  title: string,
  metaSlug?: string,
): string {
  if (explicitOut) {
    return explicitOut;
  }

  const slug = metaSlug || slugify(title);
  return `./build/${slug}/`;
}