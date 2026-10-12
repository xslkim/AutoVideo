/**
 * AutoVideo — SubtitleOverlay
 *
 * Renders narration subtitles timed to audio playback, with optional
 * word-level accent-color highlighting derived from `**...**` markup.
 *
 * Sits as an absolute-positioned layer at the bottom of the block frame.
 * During the entrance animation (audioFrame < 0) nothing is shown.
 *
 * Passing `style` ("teach" | "karaoke" | "hype") delegates rendering to
 * KaraokeCaptions, optionally fed by per-character `charTimings` (one array
 * per narration line, aligned with `lineIndex`). Without `style` the legacy
 * whole-line capsule below runs unchanged.
 *
 * @see PRD §4 — SubtitleOverlayProps interface
 */

import React from "react";
import { useVideoConfig } from "remotion";
import type { SubtitleOverlayProps, NarrationLine } from "../engine/types.js";
// Value imports stay extensionless for the Remotion webpack bundler.
import {
  KaraokeCaptions,
  fitFontSize,
  renderHighlightedText,
  type KaraokeCaptionInput,
  type SubtitleStyle,
} from "./KaraokeCaptions";

export type { KaraokeCaptionInput, SubtitleStyle } from "./KaraokeCaptions";

/**
 * Optional subtitle upgrades, kept outside the base SubtitleOverlayProps in
 * engine/types.ts so existing callers remain source-compatible.
 */
export interface SubtitleOverlayStyleProps {
  /**
   * Caption presentation preset. Omit for the legacy whole-line capsule
   * (backward-compatible default).
   */
  style?: SubtitleStyle;
  /**
   * Per-character timings, one entry array per narration line, aligned with
   * `lineIndex`. Entries follow the @remotion/captions `Caption` shape
   * (`{ text, startMs, endMs }` per character). When absent (or missing for
   * the current line) KaraokeCaptions falls back to even distribution.
   */
  charTimings?: (KaraokeCaptionInput[] | undefined)[];
}

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
// Component
// ---------------------------------------------------------------------------

const SubtitleOverlay: React.FC<SubtitleOverlayProps & SubtitleOverlayStyleProps> = ({
  lines,
  lineTimings,
  audioStartFrame,
  frame,
  fps,
  theme,
  subtitleSafeBottom,
  style,
  charTimings,
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

  // Styled presets delegate to KaraokeCaptions (per-char sweep when
  // charTimings are available, even distribution otherwise).
  if (style) {
    return React.createElement(KaraokeCaptions, {
      style,
      text: line.ttsText,
      startMs: timing.startMs,
      endMs: timing.endMs,
      captions: charTimings?.[timing.lineIndex],
      highlights: line.highlights,
      audioMs,
      frame,
      fps,
      audioStartFrame,
      theme,
      subtitleSafeBottom,
    });
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