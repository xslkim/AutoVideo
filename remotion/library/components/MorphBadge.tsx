/**
 * AutoVideo — Library component: MorphBadge
 *
 * Shape-morphing badge: a glyph cycles through built-in shapes (circle →
 * star → check …) with interpolatePaths over equal-sampled polygon paths,
 * popping in on a spring and pulsing as it morphs; optional labels
 * cross-fade in sync with each shape. For concept transformations, step
 * completions and before/after beats.
 * Registry entry: see src/ai/visual-registry.ts ("MorphBadge").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate.
 */

import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { interpolatePaths } from "@remotion/paths";
import type { AccentOverride, LibraryProps } from "../props.js";
import { LAYOUT, availHeight, frames, space, typeSize } from "../tokens";
import { EASE, clamp01, springIn } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface MorphBadgeSpec extends AccentOverride {
  /**
   * Built-in shape names to cycle through, in order:
   * "circle" | "square" | "diamond" | "triangle" | "hexagon" | "star" |
   * "check" | "bolt" | "plus". Unknown names are ignored; with fewer than
   * two known shapes the badge holds the first one static.
   */
  shapes: string[];
  /** Optional caption per shape (labels[i] pairs with shapes[i]). */
  labels?: string[];
  /** Seconds each shape holds before morphing into the next. Default 1.5. */
  intervalSec?: number;
}

export type MorphBadgeProps = LibraryProps<MorphBadgeSpec>;

// ---------------------------------------------------------------------------
// Built-in shapes — every path is M + (K-1) L + Z over K perimeter samples,
// starting at the top and running clockwise (screen coords, y down), so
// interpolatePaths morphs point-by-point without twisting.
// ---------------------------------------------------------------------------

const MORPH_SAMPLES = 48;

/** Walk a closed polygon's perimeter uniformly and emit an SVG path. */
function sampleClosedPolygon(verts: [number, number][], k: number): string {
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segLens.push(l);
    total += l;
  }
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  const parts: string[] = [];
  let seg = 0;
  let segStart = 0;
  for (let i = 0; i < k; i++) {
    const target = (i / k) * total;
    while (seg < verts.length - 1 && segStart + segLens[seg] < target) {
      segStart += segLens[seg];
      seg++;
    }
    const a = verts[seg];
    const b = verts[(seg + 1) % verts.length];
    const l = segLens[seg] || 1;
    const t = Math.min(1, Math.max(0, (target - segStart) / l));
    const x = round1(a[0] + (b[0] - a[0]) * t);
    const y = round1(a[1] + (b[1] - a[1]) * t);
    parts.push(`${i === 0 ? "M" : "L"}${x} ${y}`);
  }
  return `${parts.join(" ")} Z`;
}

const SHAPE_VERTS: Record<string, [number, number][]> = {
  circle: Array.from({ length: MORPH_SAMPLES }, (_, i) => {
    const a = ((-90 + (i * 360) / MORPH_SAMPLES) * Math.PI) / 180;
    return [50 + 38 * Math.cos(a), 50 + 38 * Math.sin(a)] as [number, number];
  }),
  square: [
    [50, 12],
    [88, 12],
    [88, 88],
    [12, 88],
    [12, 12],
  ],
  diamond: [
    [50, 10],
    [90, 50],
    [50, 90],
    [10, 50],
  ],
  triangle: [
    [50, 12],
    [88, 84],
    [12, 84],
  ],
  hexagon: [
    [50, 12],
    [82.9, 31],
    [82.9, 69],
    [50, 88],
    [17.1, 69],
    [17.1, 31],
  ],
  star: [
    [50, 10],
    [60, 36.2],
    [88, 37.6],
    [66.2, 55.3],
    [73.5, 82.4],
    [50, 67],
    [26.5, 82.4],
    [33.8, 55.3],
    [12, 37.6],
    [40, 36.2],
  ],
  check: [
    [76, 24],
    [88, 36],
    [44, 80],
    [12, 48],
    [24, 36],
    [44, 56],
  ],
  bolt: [
    [56, 6],
    [54, 42],
    [80, 42],
    [38, 94],
    [44, 56],
    [20, 56],
  ],
  plus: [
    [50, 10],
    [58, 10],
    [58, 42],
    [90, 42],
    [90, 58],
    [58, 58],
    [58, 90],
    [42, 90],
    [42, 58],
    [10, 58],
    [10, 42],
    [42, 42],
    [42, 10],
  ],
};

const SHAPE_PATHS: Record<string, string> = {};
for (const [name, verts] of Object.entries(SHAPE_VERTS)) {
  SHAPE_PATHS[name] = sampleClosedPolygon(verts, MORPH_SAMPLES);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MorphBadge: React.FC<MorphBadgeProps> = ({
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

  const known = (spec.shapes ?? []).filter((s) => SHAPE_PATHS[s] !== undefined);
  const shapes = known.length > 0 ? known : ["circle"];
  const n = shapes.length;
  const labels = spec.labels ?? [];

  const intervalSec = Math.max(0.6, spec.intervalSec ?? 1.5);
  /** Last slice of each interval is the morph; the rest is a hold. */
  const MORPH_FRAC = 0.45;
  const startSec = 0.55;

  // ---- Morph timeline (loops after the entrance settles) -------------------
  const t = frame / fps - startSec;
  const cycle = n * intervalSec;
  const tt = t > 0 ? (t % cycle) : 0;
  const idx = Math.min(n - 1, Math.floor(tt / intervalSec));
  const next = (idx + 1) % n;
  const local = (tt - idx * intervalSec) / intervalSec;
  const morphP =
    t <= 0 || n < 2
      ? 0
      : interpolate(local, [1 - MORPH_FRAC, 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE.inOut,
        });
  const d =
    n < 2 || morphP === 0
      ? SHAPE_PATHS[shapes[idx]]
      : interpolatePaths(
          morphP,
          [0, 1],
          [SHAPE_PATHS[shapes[idx]], SHAPE_PATHS[shapes[next]]],
        );

  // ---- Entrance & pulse ----------------------------------------------------
  const enter = springIn(frame, fps, frames(0.12, fps), "pop");
  const enterC = clamp01(enter);
  const badgeScale = 0.35 + 0.65 * enter;
  const glyphScale = 1 + Math.sin(morphP * Math.PI) * 0.06;
  const ringRot = (frame / fps) * 12;

  // ---- Geometry --------------------------------------------------------------
  const badgeD = Math.min(availH * 0.42, width * 0.26);
  const labelSize = typeSize(height, "body");
  const labelH = labels.length > 0 ? labelSize * 1.7 : 0;
  const clusterH = badgeD + (labelH > 0 ? space(height, 3) + labelH : 0);
  const top = availH * LAYOUT.heroCenterPct - clusterH / 2;
  const labelW = Math.min(width * 0.7, badgeD * 2.4);

  const labelStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    fontFamily: theme.fonts.sans,
    fontSize: labelSize,
    fontWeight: 500,
    lineHeight: 1.4,
    color: theme.colors.fg,
    textAlign: "center",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {/* Ambient accent wash */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 45%, ${accent} 0%, transparent 55%)`,
          opacity: 0.07,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          top,
          left: width / 2 - badgeD / 2,
          width: badgeD,
          opacity: enterC,
          transform: `translateY(${(1 - enterC) * space(height, 3)}px) scale(${badgeScale})`,
        }}
      >
        <svg
          width={badgeD}
          height={badgeD}
          viewBox="0 0 100 100"
          style={{
            display: "block",
            overflow: "visible",
            filter: `drop-shadow(0 0 ${space(height, 1.2)}px ${accent})`,
          }}
        >
          {/* Badge plate */}
          <circle
            cx={50}
            cy={50}
            r={46}
            fill={theme.colors.code.bg}
            stroke={accent}
            strokeOpacity={0.45}
            strokeWidth={1}
          />
          {/* Slow-spinning dashed orbit ring (frame-driven) */}
          <g transform={`rotate(${ringRot} 50 50)`}>
            <circle
              cx={50}
              cy={50}
              r={49}
              fill="none"
              stroke={accent}
              strokeOpacity={0.35}
              strokeWidth={0.9}
              strokeDasharray="0.5 5"
              strokeLinecap="round"
            />
          </g>
          {/* Morphing glyph */}
          <path
            d={d}
            fill={accent}
            transform={`translate(50 50) scale(${glyphScale}) translate(-50 -50)`}
          />
        </svg>

        {labels.length > 0 ? (
          <div
            style={{
              position: "absolute",
              top: badgeD + space(height, 3),
              left: badgeD / 2 - labelW / 2,
              width: labelW,
              height: labelH,
            }}
          >
            {labels[idx] !== undefined && (n < 2 || morphP < 1) ? (
              <div
                style={{
                  ...labelStyle,
                  opacity: n < 2 ? 1 : 1 - morphP,
                  transform: `translateY(${-morphP * space(height, 1)}px)`,
                }}
              >
                {labels[idx]}
              </div>
            ) : null}
            {n > 1 && labels[next] !== undefined && morphP > 0 ? (
              <div
                style={{
                  ...labelStyle,
                  opacity: morphP,
                  transform: `translateY(${(1 - morphP) * space(height, 1)}px)`,
                }}
              >
                {labels[next]}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export default MorphBadge;
