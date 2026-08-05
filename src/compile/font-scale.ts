/**
 * AutoVideo — visual description font normalization
 *
 * Authors write slide descriptions with concrete pixel sizes ("字号 24px",
 * "字号 22px"). Those numbers were chosen while looking at a laptop preview,
 * and the component generator follows them literally, so the finished video is
 * full of text that is unreadable on a phone.
 *
 * Rather than deleting the sizes — they carry the author's intended hierarchy —
 * this rescales every font size in a description by one factor, chosen so the
 * smallest of them clears the readability floor. Relative proportions survive;
 * only the absolute scale moves.
 */

/** Fraction of canvas height below which text is considered unreadable. */
export const MIN_FONT_COEFF = 0.028;

/** Fraction of canvas height no single font mention should exceed after scaling. */
const MAX_FONT_COEFF = 0.14;

/**
 * A font-size mention: a `字号`/`font-size`-style label followed by a pixel
 * value. Layout numbers (圆角, 内边距, 距顶, 边框) deliberately do not match —
 * scaling those would distort the layout the author designed.
 */
const FONT_MENTION =
  /((?:字号|字体大小|字体尺寸|文字大小|font[-\s]?size)\s*[:：]?\s*)(\d+(?:\.\d+)?)(\s*(?:px|像素))/gi;

export interface FontScaleResult {
  description: string;
  /** Factor applied to every size; 1 when nothing needed changing. */
  scale: number;
  /** Smallest size found before scaling, or null when none were found. */
  originalMinPx: number | null;
}

/**
 * Raise the font sizes named in a visual description so the smallest one
 * reaches `height * MIN_FONT_COEFF`.
 *
 * Descriptions without pixel-sized fonts are returned untouched — the prompt's
 * relative floors already cover that case.
 */
export function scaleFontMentions(
  description: string,
  height: number,
  minCoeff: number = MIN_FONT_COEFF,
): FontScaleResult {
  const sizes: number[] = [];
  for (const m of description.matchAll(FONT_MENTION)) {
    const px = Number(m[2]);
    if (Number.isFinite(px) && px > 0) sizes.push(px);
  }
  if (sizes.length === 0) {
    return { description, scale: 1, originalMinPx: null };
  }

  const originalMinPx = Math.min(...sizes);
  const floorPx = height * minCoeff;
  if (originalMinPx >= floorPx) {
    return { description, scale: 1, originalMinPx };
  }

  // One factor for the whole block keeps the author's hierarchy intact. Cap it
  // so a single stray `2px` annotation cannot inflate the title off-screen.
  const ceilingPx = height * MAX_FONT_COEFF;
  const scale = Math.min(floorPx / originalMinPx, ceilingPx / Math.max(...sizes));
  if (scale <= 1) {
    return { description, scale: 1, originalMinPx };
  }

  const scaled = description.replace(
    FONT_MENTION,
    (_full, label: string, value: string, unit: string) => {
      const next = Math.max(Math.round(Number(value) * scale), Math.round(floorPx));
      return `${label}${next}${unit}`;
    },
  );

  return { description: scaled, scale, originalMinPx };
}
