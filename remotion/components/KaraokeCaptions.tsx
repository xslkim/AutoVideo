/**
 * AutoVideo — KaraokeCaptions
 *
 * Caption renderer with three presentation presets:
 *
 * - `teach`   — whole line fades in once, `**...**` keywords keep the accent
 *               colour. Restrained default for knowledge videos.
 * - `karaoke` — per-character sweep: the current character pops to the brand
 *               colour with a 1.1× spring bounce, read characters stay bright,
 *               unread ones sit at reduced opacity. Paginated into 8–14
 *               character pages (breaking at punctuation when possible).
 * - `hype`    — short-video style: oversized weight-800 glyphs with a thick
 *               outline, per-character pop entrances and a slight alternating
 *               tilt.
 *
 * Timing input is dual-mode:
 * - `captions`: per-character entries shaped like the @remotion/captions
 *   `Caption` type (`{ text, startMs, endMs }`, optional `pageBreakAfter`) —
 *   a `Caption[]` is structurally assignable here. Entries longer than one
 *   character are split evenly across their own window.
 * - plain `text` + `startMs`/`endMs`: the line window is distributed evenly
 *   across characters (uniform CJK speech rate makes this acceptable).
 *
 * All motion is frame-driven (spring/interpolate via props.frame/fps); the
 * bottom band respects `subtitleSafeBottom` exactly like SubtitleOverlay.
 * This file also owns the shared caption helpers (width estimation, font
 * fitting, highlight spans) that SubtitleOverlay builds upon.
 */

import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Theme } from "../engine/types.js";
// Value imports stay extensionless: the Remotion webpack config has no
// extensionAlias, so "./tokens.js" would not resolve at bundle time.
import { DUR, frames, space } from "../library/tokens";
import { EASE, clamp01, enterProgress, springIn } from "../library/motion";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SubtitleStyle = "teach" | "karaoke" | "hype";

/**
 * Per-character (or per-word) caption entry. Structural subset of the
 * @remotion/captions `Caption` type, so a `Caption[]` can be passed directly.
 */
export interface KaraokeCaptionInput {
  text: string;
  startMs: number;
  endMs: number;
  /** Soft pagination hint, honoured once the page reaches `minChars`. */
  pageBreakAfter?: boolean;
}

/** A single displayable character with its own time window. */
export interface TimedChar {
  char: string;
  startMs: number;
  endMs: number;
  pageBreakAfter?: boolean;
}

export type CharReadState = "unread" | "current" | "read";

export interface KaraokeCaptionsProps {
  /** Current position on the audio timeline in ms (caller subtracts enter). */
  audioMs: number;
  frame: number;
  fps: number;
  /** Composition frame at which audio ms 0 starts (drives char springs). */
  audioStartFrame: number;
  theme: Theme;
  /** Height of the reserved bottom band; captions never grow past it */
  subtitleSafeBottom: number;
  /** Presentation preset. Default "teach". */
  style?: SubtitleStyle;
  /** Line text (ttsText — markers already stripped). */
  text: string;
  /** Line-level window; used for even distribution when `captions` is absent. */
  startMs: number;
  endMs: number;
  /** Optional per-character timings; wins over the even distribution. */
  captions?: KaraokeCaptionInput[];
  /** Keyword accent ranges over `text` (teach preset only). */
  highlights?: { start: number; end: number }[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Approximate the rendered width of `text` in `em` units.
 *
 * Remotion renders each frame independently, so measuring real layout would
 * need a layout effect and a re-render. A character-class estimate is accurate
 * enough here: full-width CJK glyphs are one em, Latin averages just over half.
 */
export function estimateWidthEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    em += /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)
      ? 1
      : 0.55;
  }
  return em;
}

/**
 * Pick the largest font size that keeps the caption within `maxLines` lines
 * and inside the reserved bottom band.
 */
export function fitFontSize(args: {
  text: string;
  baseFontSize: number;
  textBoxWidth: number;
  bandHeight: number;
  lineHeight: number;
  verticalPadding: number;
  maxLines: number;
}): { fontSize: number; lines: number } {
  const { text, baseFontSize, textBoxWidth, bandHeight, lineHeight, verticalPadding, maxLines } =
    args;

  const widthEm = estimateWidthEm(text);
  let fontSize = baseFontSize;

  const linesAt = (size: number) =>
    Math.max(1, Math.ceil((widthEm * size) / Math.max(1, textBoxWidth)));

  let lines = linesAt(fontSize);
  if (lines > maxLines) {
    fontSize = (fontSize * maxLines) / lines;
    lines = linesAt(fontSize);
  }

  // Even at maxLines the capsule must clear the reserved band.
  const capsuleHeight = lines * fontSize * lineHeight + verticalPadding;
  if (capsuleHeight > bandHeight) {
    fontSize *= bandHeight / capsuleHeight;
    lines = linesAt(fontSize);
  }

  return { fontSize, lines };
}

/**
 * Splits `ttsText` into segments according to `highlights[]` and returns
 * an array of React nodes where highlighted segments are wrapped in
 * `<span style={{ color: accentColor }}>`.
 *
 * Highlights are non-overlapping and sorted by `start` ascending (guaranteed
 * by the compile stage).  Characters outside any highlight range render in
 * the default foreground color.
 */
export function renderHighlightedText(
  ttsText: string,
  highlights: { start: number; end: number }[],
  accentColor: string,
): React.ReactNode[] {
  if (highlights.length === 0) {
    return [ttsText];
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];

    // Text before this highlight
    if (h.start > cursor) {
      nodes.push(ttsText.slice(cursor, h.start));
    }

    // Highlighted segment
    nodes.push(
      React.createElement(
        "span",
        { key: `hl-${i}`, style: { color: accentColor } },
        ttsText.slice(h.start, h.end),
      ),
    );

    cursor = h.end;
  }

  // Remaining text after last highlight
  if (cursor < ttsText.length) {
    nodes.push(ttsText.slice(cursor));
  }

  return nodes;
}

/**
 * Distribute `[startMs, endMs)` evenly across the characters of `text`.
 * Fallback for lines without character-level alignment; acceptable because
 * CJK speech rate is close to uniform. Splits by code point (emoji-safe).
 */
export function distributeCharTimings(
  text: string,
  startMs: number,
  endMs: number,
): TimedChar[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [];
  const span = Math.max(0, endMs - startMs);
  const slot = span / chars.length;
  return chars.map((char, i) => ({
    char,
    startMs: startMs + i * slot,
    endMs: startMs + (i + 1) * slot,
  }));
}

/**
 * Normalise caption entries into one `TimedChar` per character. Entries
 * longer than one character (e.g. word-level captions) are split evenly
 * across their own window; a caption-level `pageBreakAfter` hint attaches
 * to the last character it produced.
 */
export function charsFromCaptions(captions: KaraokeCaptionInput[]): TimedChar[] {
  const out: TimedChar[] = [];
  for (const cap of captions) {
    const chars = Array.from(cap.text);
    if (chars.length === 0) continue;
    if (chars.length === 1) {
      out.push({
        char: chars[0],
        startMs: cap.startMs,
        endMs: cap.endMs,
        pageBreakAfter: cap.pageBreakAfter,
      });
      continue;
    }
    const split = distributeCharTimings(cap.text, cap.startMs, cap.endMs);
    if (cap.pageBreakAfter && split.length > 0) {
      split[split.length - 1].pageBreakAfter = true;
    }
    out.push(...split);
  }
  return out;
}

/** Punctuation after which a page break reads naturally (CJK + Latin). */
const BREAK_PUNCT = /[，。、；：？！…—·”“’”’」』】》）,.!?;:\)\]\}~〉]/;

export interface PaginateOptions {
  /** Preferred minimum page length in non-whitespace characters. Default 8. */
  minChars?: number;
  /** Hard maximum page length in non-whitespace characters. Default 14. */
  maxChars?: number;
}

/**
 * Group a character stream into pages of 8–14 displayable characters.
 * A page closes at the hard maximum, or earlier right after breakable
 * punctuation / a `pageBreakAfter` hint once the minimum length is reached.
 * The trailing page may be shorter than `minChars`.
 */
export function paginateChars(chars: TimedChar[], opts: PaginateOptions = {}): TimedChar[][] {
  const minChars = opts.minChars ?? 8;
  const maxChars = Math.max(opts.maxChars ?? 14, minChars);

  const pages: TimedChar[][] = [];
  let page: TimedChar[] = [];
  let significant = 0;

  for (const tc of chars) {
    page.push(tc);
    if (/\S/.test(tc.char)) significant++;
    if (significant >= maxChars) {
      pages.push(page);
      page = [];
      significant = 0;
    } else if (significant >= minChars && (tc.pageBreakAfter || BREAK_PUNCT.test(tc.char))) {
      pages.push(page);
      page = [];
      significant = 0;
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/** Read state of one character at `audioMs`. */
export function charStateAt(
  tc: { startMs: number; endMs: number },
  audioMs: number,
): CharReadState {
  if (audioMs < tc.startMs) return "unread";
  if (audioMs < tc.endMs) return "current";
  return "read";
}

/**
 * Index of the page visible at `audioMs`, anchored on the last page that has
 * started so the final page stays up through the line's tail. Returns 0
 * before the first character begins.
 */
export function activePageIndex(pages: TimedChar[][], audioMs: number): number {
  let active = 0;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].length > 0 && audioMs >= pages[i][0].startMs) active = i;
    else break;
  }
  return active;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const KaraokeCaptions: React.FC<KaraokeCaptionsProps> = ({
  audioMs,
  frame,
  fps,
  audioStartFrame,
  theme,
  subtitleSafeBottom,
  style = "teach",
  text,
  startMs,
  endMs,
  captions,
  highlights,
}) => {
  const { width, height } = useVideoConfig();
  const { subtitle } = theme;
  const accent = theme.colors.accent;

  const chars =
    captions && captions.length > 0
      ? charsFromCaptions(captions)
      : distributeCharTimings(text, startMs, endMs);

  if (text.length === 0 || chars.length === 0) {
    return null;
  }

  // All px tokens in the theme are authored against 1080p and scale with height.
  const scale = height / 1080;
  const paddingY = subtitle.paddingPx * scale;
  const paddingX = subtitle.paddingPx * 2 * scale;
  const bottomMargin = (subtitle.bottomMarginPx ?? 0) * scale;
  const borderRadius = (subtitle.borderRadiusPx ?? 0) * scale;
  const capsuleMaxWidth = width * subtitle.maxWidthPct;

  // hype runs oversized; the fitter below still clamps it into the safe band.
  const baseFontSize = height * subtitle.fontSizePct * (style === "hype" ? 1.5 : 1);

  const pages = paginateChars(chars);
  // Size from the longest page so the font doesn't jump between pages.
  const longestPageText = pages.reduce(
    (best, p) => {
      const t = p.map((c) => c.char).join("");
      return t.length > best.length ? t : best;
    },
    "",
  );

  const { fontSize } = fitFontSize({
    text: style === "teach" ? text : longestPageText,
    baseFontSize,
    textBoxWidth: capsuleMaxWidth - paddingX * 2,
    // Reserve the bottom margin out of the band so captions always sit inside
    // the area the slide components were told to keep clear.
    bandHeight: subtitleSafeBottom - bottomMargin,
    lineHeight: subtitle.lineHeight,
    verticalPadding: paddingY * 2,
    maxLines: subtitle.maxLines ?? 2,
  });

  // hype leans on a heavy outline even when the theme doesn't define one.
  const strokeColor =
    subtitle.strokeColor ?? (style === "hype" ? theme.colors.bg : undefined);
  const baseStroke = (subtitle.strokeWidthPx ?? 0) * scale;
  const strokeWidth =
    style === "hype" ? Math.max(baseStroke * 1.6, height * 0.005) : baseStroke;
  const textStroke =
    strokeColor && strokeWidth > 0
      ? {
          // paintOrder keeps the outline behind the glyph instead of eating into it
          paintOrder: "stroke fill",
          WebkitTextStroke: `${strokeWidth}px ${strokeColor}`,
        }
      : {};

  const capsuleStyle: React.CSSProperties = {
    maxWidth: capsuleMaxWidth,
    backgroundColor: style === "hype" ? "transparent" : subtitle.backgroundColor,
    borderRadius,
    padding: `${paddingY}px ${paddingX}px`,
    fontFamily: subtitle.fontFamily,
    fontWeight: style === "hype" ? 800 : subtitle.fontWeight ?? 400,
    fontSize,
    lineHeight: subtitle.lineHeight,
    color: theme.colors.fg,
    textAlign: "center",
    boxSizing: "border-box",
    ...textStroke,
  };

  // ---- teach: whole line, one restrained entrance --------------------------
  let body: React.ReactNode;
  if (style === "teach") {
    const lineStartFrame = audioStartFrame + (startMs / 1000) * fps;
    const p = enterProgress(frame, lineStartFrame, Math.max(1, frames(DUR.snapSec, fps)));
    body = (
      <div
        style={{
          ...capsuleStyle,
          opacity: p,
          transform: `translateY(${(1 - p) * space(height, 0.75)}px)`,
        }}
      >
        {renderHighlightedText(text, highlights ?? [], accent)}
      </div>
    );
  } else {
    // ---- karaoke / hype: paginated per-character timing ---------------------
    const pageIdx = activePageIndex(pages, audioMs);
    const page = pages[pageIdx];
    const pageStartFrame = audioStartFrame + (page[0].startMs / 1000) * fps;
    const pageP = enterProgress(frame, pageStartFrame, Math.max(1, frames(0.12, fps)));

    // Absolute index of this page's first char — seeds the hype tilt parity.
    let charBase = 0;
    for (let i = 0; i < pageIdx; i++) charBase += pages[i].length;

    body = (
      <div style={{ ...capsuleStyle, opacity: pageP }}>
        {page.map((tc, i) => {
          if (tc.char.trim() === "") {
            // Whitespace stays a plain text node so spacing collapses naturally.
            return <React.Fragment key={i}>{tc.char}</React.Fragment>;
          }
          const state = charStateAt(tc, audioMs);
          const charStartFrame = audioStartFrame + (tc.startMs / 1000) * fps;

          let color = theme.colors.fg;
          let charOpacity = 1;
          let charScale = 1;
          let rotateDeg = 0;

          if (style === "karaoke") {
            if (state === "unread") {
              charOpacity = 0.42;
            } else if (state === "current") {
              // Brand-colour fill + 1.1× spring bounce settling onto the glyph.
              color = accent;
              charScale = 1 + 0.1 * springIn(frame, fps, charStartFrame, "pop");
            } else {
              // Ease the bounce back down right after the char was current.
              const sinceEndFrames = ((audioMs - tc.endMs) / 1000) * fps;
              charScale = interpolate(
                sinceEndFrames,
                [0, Math.max(1, frames(0.15, fps))],
                [1.1, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.exit },
              );
            }
          } else {
            // hype: every char pops in at its own start; current char reads bigger.
            const entrance = springIn(frame, fps, charStartFrame, "pop");
            charOpacity = clamp01(entrance);
            charScale = entrance * (state === "current" ? 1.18 : 1);
            if (state === "current") color = accent;
            rotateDeg = (charBase + i) % 2 === 0 ? -2.2 : 2.2;
            rotateDeg *= clamp01(entrance);
          }

          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                color,
                opacity: charOpacity,
                transform: `scale(${charScale}) rotate(${rotateDeg}deg)`,
                transformOrigin: "50% 88%",
              }}
            >
              {tc.char}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: bottomMargin,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        pointerEvents: "none",
      }}
    >
      {body}
    </div>
  );
};

export default KaraokeCaptions;
