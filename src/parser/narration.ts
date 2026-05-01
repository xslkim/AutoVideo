/**
 * AutoVideo — Narration preprocessing
 *
 * Splits narration text into lines, parses **highlights**,
 * generates NarrationLine[] per PRD §3.7 and §4.
 *
 * Rules:
 * - Each non-empty line = one subtitle entry for TTS
 * - Empty lines are ignored (no extra pause)
 * - **word** marks highlighted text in subtitles (doesn't affect TTS)
 * - Literal ** via \*\* escape
 * - highlights[].start/end are character offsets based on ttsText (** stripped)
 *
 * PRD references: §3.7 (旁白语法), §4 (NarrationLine)
 */

import type { NarrationLine } from "../types/script.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class NarrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarrationError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Placeholder for escaped \*\* sequences.
 * Must not appear in normal text (use a Unicode private-use character).
 */
const ESCAPED_STARS_PLACEHOLDER = "\uE000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse **highlights** from text and produce NarrationLine.
 *
 * Algorithm:
 * 1. Replace `\*\*` with placeholder to protect literal `**`
 * 2. Find all `**...**` patterns (non-greedy, non-nesting)
 * 3. Remove `**` markers to produce ttsText
 * 4. Compute highlight offsets based on ttsText character positions
 * 5. Restore placeholder as literal `**`
 */
export function parseNarrationLine(rawLine: string): NarrationLine {
  const text = rawLine; // Original text with ** markers

  // Step 1: Replace escaped \*\* with placeholder
  let working = rawLine.replace(/\\\*\\\*/g, ESCAPED_STARS_PLACEHOLDER);

  // Step 2: Find all **...** patterns
  // Match **...** non-greedy; content between must not be empty
  const highlightPattern = /\*\*([^*]+)\*\*/g;
  const highlights: { start: number; end: number }[] = [];

  // We need to build ttsText and compute offsets simultaneously
  // Collect all match positions
  const matches: { index: number; length: number; content: string }[] = [];
  let m;
  while ((m = highlightPattern.exec(working)) !== null) {
    matches.push({
      index: m.index,
      length: m[0].length,
      content: m[1],
    });
  }

  // Step 3: Build ttsText by removing ** markers
  // Build it piece by piece, tracking offsets
  let ttsText = "";
  let lastIdx = 0;

  for (const match of matches) {
    // Text before this match
    ttsText += working.substring(lastIdx, match.index);
    // The start position of the highlighted content in ttsText
    const highlightStart = ttsText.length;
    // Add the highlighted content (without ** markers)
    ttsText += match.content;
    const highlightEnd = ttsText.length;
    highlights.push({ start: highlightStart, end: highlightEnd });
    lastIdx = match.index + match.length;
  }
  // Remaining text after last match
  ttsText += working.substring(lastIdx);

  // Step 5: Restore placeholder as literal **
  ttsText = ttsText.replace(new RegExp(ESCAPED_STARS_PLACEHOLDER, "g"), "**");

  return {
    text,
    ttsText,
    highlights,
  };
}

/**
 * Parse a full narration section (multi-line text) into NarrationLine[].
 *
 * - Splits on newlines
 * - Ignores empty lines
 * - Each non-empty line becomes one NarrationLine
 */
export function parseNarration(narrationText: string): NarrationLine[] {
  const lines: NarrationLine[] = [];

  for (const rawLine of narrationText.split("\n")) {
    // Skip empty lines (PRD §3.7: "空行忽略")
    if (rawLine.trim() === "") continue;
    lines.push(parseNarrationLine(rawLine));
  }

  if (lines.length === 0) {
    throw new NarrationError(
      "Narration section must contain at least one non-empty line",
    );
  }

  return lines;
}