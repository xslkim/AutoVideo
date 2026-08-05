/**
 * AutoVideo — SubtitleOverlay
 *
 * Renders narration subtitles timed to audio playback, with optional
 * word-level accent-color highlighting derived from `**...**` markup.
 *
 * Sits as an absolute-positioned layer at the bottom of the block frame.
 * During the entrance animation (audioFrame < 0) nothing is shown.
 *
 * @see PRD §4 — SubtitleOverlayProps interface
 */

import React from "react";
import { useVideoConfig } from "remotion";
import type { SubtitleOverlayProps, NarrationLine } from "../engine/types.js";

// ---------------------------------------------------------------------------
// Helper: find the line whose [startMs, endMs) window contains `audioMs`
// ---------------------------------------------------------------------------

function findCurrentLine(
  lineTimings: { lineIndex: number; startMs: number; endMs: number }[],
  audioMs: number,
): { lineIndex: number; startMs: number; endMs: number } | null {
  for (const t of lineTimings) {
    if (audioMs >= t.startMs && audioMs < t.endMs) {
      return t;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: estimate wrapped line count without touching the DOM
// ---------------------------------------------------------------------------

/**
 * Approximate the rendered width of `text` in `em` units.
 *
 * Remotion renders each frame independently, so measuring real layout would
 * need a layout effect and a re-render. A character-class estimate is accurate
 * enough here: full-width CJK glyphs are one em, Latin averages just over half.
 */
function estimateWidthEm(text: string): number {
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
function fitFontSize(args: {
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

// ---------------------------------------------------------------------------
// Helper: render ttsText with highlight spans
// ---------------------------------------------------------------------------

/**
 * Splits `ttsText` into segments according to `highlights[]` and returns
 * an array of React nodes where highlighted segments are wrapped in
 * `<span style={{ color: theme.colors.accent }}>`.
 *
 * Highlights are non-overlapping and sorted by `start` ascending (guaranteed
 * by the compile stage).  Characters outside any highlight range render in
 * the default foreground color.
 */
function renderHighlightedText(
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  lines,
  lineTimings,
  audioStartFrame,
  frame,
  fps,
  theme,
  subtitleSafeBottom,
}) => {
  const { width, height } = useVideoConfig();

  // How far into the audio timeline we are (may be negative during enter)
  const audioFrame = frame - audioStartFrame;

  // Don't render anything during the entrance animation
  if (audioFrame < 0) {
    return null;
  }

  const audioMs = (audioFrame / fps) * 1000;

  // Find the narration line that should be visible at this moment
  const timing = findCurrentLine(lineTimings, audioMs);
  if (!timing) {
    return null;
  }

  const line: NarrationLine | undefined = lines[timing.lineIndex];
  if (!line) {
    return null;
  }

  const { subtitle } = theme;

  // All px tokens in the theme are authored against 1080p and scale with height.
  const scale = height / 1080;
  const paddingY = subtitle.paddingPx * scale;
  const paddingX = subtitle.paddingPx * 2 * scale;
  const bottomMargin = (subtitle.bottomMarginPx ?? 0) * scale;
  const strokeWidth = (subtitle.strokeWidthPx ?? 0) * scale;
  const borderRadius = (subtitle.borderRadiusPx ?? 0) * scale;

  const capsuleMaxWidth = width * subtitle.maxWidthPct;
  const { fontSize } = fitFontSize({
    text: line.ttsText,
    baseFontSize: height * subtitle.fontSizePct,
    textBoxWidth: capsuleMaxWidth - paddingX * 2,
    // Reserve the bottom margin out of the band so the capsule always sits
    // inside the area the slide components were told to keep clear.
    bandHeight: subtitleSafeBottom - bottomMargin,
    lineHeight: subtitle.lineHeight,
    verticalPadding: paddingY * 2,
    maxLines: subtitle.maxLines ?? 2,
  });

  const strokeColor = subtitle.strokeColor;
  const textStroke = strokeColor && strokeWidth > 0
    ? {
        // paintOrder keeps the outline behind the glyph instead of eating into it
        paintOrder: "stroke fill",
        WebkitTextStroke: `${strokeWidth}px ${strokeColor}`,
      }
    : {};

  return React.createElement(
    "div",
    {
      style: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: bottomMargin,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        pointerEvents: "none" as const,
      },
    },
    React.createElement(
      "div",
      {
        style: {
          maxWidth: capsuleMaxWidth,
          backgroundColor: subtitle.backgroundColor,
          borderRadius,
          padding: `${paddingY}px ${paddingX}px`,
          fontFamily: subtitle.fontFamily,
          fontWeight: subtitle.fontWeight ?? 400,
          fontSize,
          lineHeight: subtitle.lineHeight,
          color: theme.colors.fg,
          textAlign: "center" as const,
          boxSizing: "border-box" as const,
          ...textStroke,
        },
      },
      renderHighlightedText(line.ttsText, line.highlights, theme.colors.accent),
    ),
  );
};

export { SubtitleOverlay };