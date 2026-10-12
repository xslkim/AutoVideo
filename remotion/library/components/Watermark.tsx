/**
 * AutoVideo — Library component: Watermark
 *
 * Persistent channel watermark: a small badge + text lockup pinned to a
 * corner (bottom-right by default), semi-transparent with a slow breathing
 * opacity so it stays present without fighting the content. Bottom corners
 * sit *above* the subtitle safe band — the capsule owns the bottom strip.
 *
 * Registry entry: see src/ai/visual-registry.ts ("Watermark").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; it is a HUD element that holds for the whole block.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { LAYOUT, space, typeSize } from "../tokens";
import { breathe, clamp01 } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export type WatermarkPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface WatermarkSpec extends AccentOverride {
  /** Watermark text, e.g. the channel name "@AutoVideo". */
  text: string;
  /** 1–2 characters shown in a solid accent chip before the text (logo 位). */
  badge?: string;
  /** Corner to pin to. Default "bottom-right". */
  position?: WatermarkPosition;
  /** Peak opacity 0..1; breathing oscillates gently below it. Default 0.45. */
  opacity?: number;
}

export type WatermarkProps = LibraryProps<WatermarkSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Watermark: React.FC<WatermarkProps> = ({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
  lineTimings,
  spec,
}) => {
  void durationInFrames;
  void lineTimings;

  const accent = spec.accent ?? theme.colors.accent;
  const position = spec.position ?? "bottom-right";
  const peak = clamp01(spec.opacity ?? 0.45);

  // 呼吸微透明 — slow sine between 70% and 100% of the peak opacity.
  const alpha = peak * breathe(frame, fps, { min: 0.7, max: 1, periodSec: 4.2 });

  const labelSize = typeSize(height, "label");
  const marginX = width * LAYOUT.marginXPct;
  const badgeSize = Math.round(labelSize * 1.7);

  const isBottom = position.startsWith("bottom");
  const isRight = position.endsWith("right");
  const cornerStyle: React.CSSProperties = {
    position: "absolute",
    // Bottom placements clear the reserved subtitle band.
    ...(isBottom
      ? { bottom: subtitleSafeBottom + space(height, 2.5) }
      : { top: space(height, 3) }),
    ...(isRight ? { right: marginX } : { left: marginX }),
    flexDirection: isRight ? "row-reverse" : "row",
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          ...cornerStyle,
          display: "flex",
          alignItems: "center",
          gap: space(height, 1.5),
          opacity: alpha,
        }}
      >
        {spec.badge ? (
          <div
            style={{
              width: badgeSize,
              height: badgeSize,
              borderRadius: Math.max(3, Math.round(badgeSize * 0.28)),
              backgroundColor: accent,
              color: theme.colors.bg,
              fontFamily: theme.fonts.sans,
              fontSize: Math.round(labelSize * 0.95),
              fontWeight: 700,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {spec.badge}
          </div>
        ) : null}
        <div
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: labelSize,
            fontWeight: 600,
            letterSpacing: "0.06em",
            lineHeight: 1.3,
            color: theme.colors.fg,
            whiteSpace: "nowrap",
          }}
        >
          {spec.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default Watermark;
