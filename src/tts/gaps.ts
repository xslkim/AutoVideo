/**
 * AutoVideo — inter-line pause lengths
 *
 * Narration lines are synthesized one at a time and stitched together with
 * silence. A single fixed gap makes the delivery sound mechanical: the pause
 * after a comma is as long as the pause after a full stop, so sentences that
 * should run together feel chopped, and paragraph breaks land too soft.
 *
 * The gap is chosen from the punctuation the line ends with, which is the
 * cheapest reliable signal of how much the speaker should breathe.
 */

/** Pause lengths in milliseconds, keyed by the kind of boundary. */
export const GAP_MS = {
  /** Full stop, question mark, exclamation — a real sentence break. */
  sentence: 380,
  /** Colon or semicolon — the next line completes the thought. */
  clause: 260,
  /** Comma or enumeration mark — barely a break. */
  comma: 180,
  /** Ellipsis or dash — a deliberate, slightly longer beat. */
  trailing: 420,
  /** No terminal punctuation at all. */
  none: 240,
} as const;

const SENTENCE_END = /[。．.！!？?]$/;
const CLAUSE_END = /[：:；;]$/;
const COMMA_END = /[，,、]$/;
const TRAILING_END = /(?:…|\.{3}|—{1,2}|--)$/;

/** Quotes and brackets that may sit after the real terminal punctuation. */
const CLOSERS = /[”"’'）)】」』〕》>]+$/;

/**
 * Silence to insert after a narration line, in milliseconds.
 *
 * The last line of a block gets no gap; callers handle that.
 */
export function gapAfterMs(text: string): number {
  const trimmed = text.trim().replace(CLOSERS, "");
  if (trimmed === "") return GAP_MS.none;
  if (TRAILING_END.test(trimmed)) return GAP_MS.trailing;
  if (SENTENCE_END.test(trimmed)) return GAP_MS.sentence;
  if (CLAUSE_END.test(trimmed)) return GAP_MS.clause;
  if (COMMA_END.test(trimmed)) return GAP_MS.comma;
  return GAP_MS.none;
}

/**
 * Gap after each line of a block. The final entry is always 0 — trailing
 * silence belongs to the block-level padding, not to the line.
 */
export function computeGapsMs(lineTexts: string[]): number[] {
  return lineTexts.map((text, i) => (i === lineTexts.length - 1 ? 0 : gapAfterMs(text)));
}
