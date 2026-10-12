/**
 * AutoVideo — Library component: Icon
 *
 * Offline stroke-icon spotlight: renders one glyph from the bundled
 * Tabler-derived set (./icon-data.ts) centred on the frame, with a draw-on
 * entrance (per-subpath strokeDashoffset over a normalized pathLength) and
 * a soft breathing halo. Gives the LLM a fixed MIT-licensed vocabulary of
 * icons instead of letting it hand-draw SVGs. Unknown names resolve
 * through ICON_ALIASES and finally fall back to the "help" glyph.
 * Registry entry: see src/ai/visual-registry.ts ("Icon").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { availHeight, frames, LAYOUT } from "../tokens";
import { breathe, clamp01, EASE, enterProgress, springIn } from "../motion";
import {
  ICON_PATHS,
  ICON_STROKE_WIDTH,
  ICON_VIEWBOX,
  resolveIconName,
} from "./icon-data";
import type { IconName } from "./icon-data.js";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface IconSpec extends AccentOverride {
  /**
   * Glyph name from the bundled set (see icon-data.ts ICON_NAMES, e.g.
   * "bulb", "cpu", "database", "rocket"). Aliases like "idea", "ai",
   * "gear", "warning", "image" also resolve.
   */
  name: IconName | (string & {});
  /** Icon edge as a fraction of frame height. Default 0.16 (≈173px @1080p). */
  size?: number;
  /**
   * Draw-on entrance: each subpath strokes itself in with a cascading
   * strokeDashoffset. Default true; false pops the glyph in with a spring.
   */
  drawOn?: boolean;
}

export type IconProps = LibraryProps<IconSpec>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Icon: React.FC<IconProps> = ({
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
  const availH = availHeight(height, subtitleSafeBottom);

  const resolved: IconName = resolveIconName(spec.name) ?? "help";
  const subpaths = ICON_PATHS[resolved]
    .split(/(?=M)/)
    .map((d) => d.trim())
    .filter((d) => d.length > 0);

  // ---- Geometry -------------------------------------------------------------
  const sizePx = Math.max(
    height * 0.05,
    Math.min(height * 0.5, (spec.size ?? 0.16) * height),
  );
  const cx = width / 2;
  const cy = availH * LAYOUT.heroCenterPct;
  const haloSize = sizePx * 2.1;

  // ---- Entrance ---------------------------------------------------------------
  const drawOn = spec.drawOn ?? true;
  const delayF = frames(0.15, fps);
  const drawSec = 1.15;
  const n = subpaths.length;
  // Cascading windows: subpaths overlap so the glyph reads as one fluid
  // drawing motion, with the last subpath finishing exactly at drawSec.
  const stepSec = n > 1 ? (drawSec * 0.5) / n : 0;
  const perSec = drawSec - stepSec * (n - 1);

  const settle = clamp01(springIn(frame, fps, delayF, "gentle"));
  const pop = clamp01(springIn(frame, fps, delayF, "pop"));
  const overallP = enterProgress(frame, delayF, frames(drawSec, fps), EASE.inOut);
  const haloGlow = breathe(frame, fps, { min: 0.55, max: 1, periodSec: 2.8 });

  const scale = drawOn ? 0.94 + 0.06 * settle : 0.7 + 0.3 * pop;
  const groupOpacity = drawOn ? 1 : pop;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Breathing accent halo behind the glyph */}
      <div
        style={{
          position: "absolute",
          left: cx - haloSize / 2,
          top: cy - haloSize / 2,
          width: haloSize,
          height: haloSize,
          background: `radial-gradient(circle, ${accent} 0%, transparent 65%)`,
          opacity: 0.14 * haloGlow * overallP,
          pointerEvents: "none",
        }}
      />

      <svg
        width={sizePx}
        height={sizePx}
        viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
        style={{
          position: "absolute",
          left: cx - sizePx / 2,
          top: cy - sizePx / 2,
          transform: `scale(${scale})`,
          opacity: groupOpacity,
          overflow: "visible",
        }}
      >
        {subpaths.map((d, i) => {
          const p = drawOn
            ? enterProgress(
                frame,
                delayF + frames(i * stepSec, fps),
                frames(perSec, fps),
                EASE.inOut,
              )
            : 1;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={accent}
              strokeWidth={ICON_STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - p}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

export default Icon;
