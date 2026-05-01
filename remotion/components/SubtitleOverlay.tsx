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
}) => {
  const { height } = useVideoConfig();

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
  const fontSize = height * subtitle.fontSizePct;

  return React.createElement(
    "div",
    {
      style: {
        position: "absolute",
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: `${subtitle.maxWidthPct * 100}%`,
        backgroundColor: subtitle.backgroundColor,
        padding: `${subtitle.paddingPx}px`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: subtitle.fontFamily,
        fontSize,
        lineHeight: subtitle.lineHeight,
        color: theme.colors.fg,
        textAlign: "center" as const,
        boxSizing: "border-box" as const,
        pointerEvents: "none" as const,
      },
    },
    React.createElement(
      "span",
      null,
      renderHighlightedText(line.ttsText, line.highlights, theme.colors.accent),
    ),
  );
};

export { SubtitleOverlay };