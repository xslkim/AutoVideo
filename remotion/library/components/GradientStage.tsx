/**
 * AutoVideo — Library component: GradientStage
 *
 * Living mesh-gradient backdrop: colour blobs drift on slow sinusoidal
 * orbits (pure frame math, non-commensurate periods so it never reads as a
 * loop), an @remotion/noise-driven film grain layer keeps banding off, and
 * an optional hairline grid adds structure. Full-bleed base layer for a
 * scene — callers overlay their own content; optional React children (not
 * part of the JSON spec, so generated wrappers simply omit them) render
 * above the gradient, under the grain and vignette.
 * Registry entry: see src/ai/visual-registry.ts ("GradientStage").
 *
 * Enter/exit fades are BlockFrame's job — this component never fades its
 * root; only inner elements animate (the blobs ease in over the first
 * DUR.heroSec).
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import { noise2D } from "@remotion/noise";
import type { AccentOverride, LibraryProps } from "../props.js";
import { DUR, frames, space } from "../tokens";
import { enterProgress } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export interface GradientStageSpec extends AccentOverride {
  /**
   * 2–3 CSS colours: [base, blobA, blobB]. Defaults to the theme bg with
   * accent + foreground-tinted blobs.
   */
  colors?: string[];
  /** Drift speed multiplier; 1 ≈ one orbit per ~25s. Default 1. */
  speed?: number;
  /** Animated film grain overlay. Default true. */
  grain?: boolean;
  /** Faint engineering grid overlay. Default false. */
  grid?: boolean;
  /** Darken the frame edges. Default true. */
  vignette?: boolean;
}

export type GradientStageProps = LibraryProps<GradientStageSpec> & {
  /** Optional overlay content; sits above the gradient, under grain/vignette. */
  children?: React.ReactNode;
};

// ---------------------------------------------------------------------------
// Blob orbits — Lissajous drift; periods in seconds, deliberately coprime-ish
// ---------------------------------------------------------------------------

const ORBITS = [
  { periodX: 26, periodY: 19, phase: 0.4, alpha: 46 },
  { periodX: 31, periodY: 23, phase: 2.6, alpha: 30 },
  { periodX: 23, periodY: 29, phase: 4.4, alpha: 22 },
] as const;

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GradientStage: React.FC<GradientStageProps> = ({
  frame,
  durationInFrames,
  width,
  height,
  subtitleSafeBottom,
  theme,
  fps,
  lineTimings,
  spec,
  children,
}) => {
  void durationInFrames;
  void subtitleSafeBottom;
  void lineTimings;

  const base = spec.colors?.[0] ?? theme.colors.bg;
  const blobColors = [
    spec.colors?.[1] ?? spec.accent ?? theme.colors.accent,
    spec.colors?.[2] ?? theme.colors.fg,
    spec.accent ?? theme.colors.accent,
  ];
  const speed = spec.speed ?? 1;
  const grain = spec.grain !== false;
  const grid = spec.grid === true;
  const vignette = spec.vignette !== false;

  // ---- Drift ---------------------------------------------------------------
  const t = (frame / fps) * speed;
  const blobR = Math.max(width, height) * 0.62;
  const blobs = ORBITS.map((o, i) => {
    const cx = 0.5 + 0.34 * Math.sin((t / o.periodX) * TAU + o.phase);
    const cy = 0.46 + 0.3 * Math.cos((t / o.periodY) * TAU + o.phase * 1.31);
    return { ...o, color: blobColors[i], cx, cy };
  });

  // ---- Overlays ------------------------------------------------------------
  const inP = enterProgress(frame, 0, frames(DUR.heroSec, fps));

  const gridPitch = space(height, 9);
  const gridLine = `color-mix(in srgb, ${theme.colors.fg} 7%, transparent)`;
  const gridDrift = Math.sin((t / 40) * TAU) * space(height, 0.5);
  const gridMask =
    "radial-gradient(ellipse at 50% 44%, black 30%, transparent 75%)";

  // Grain tile is oversized by `pad` on every side and translated by seeded
  // noise each frame — deterministic jitter, no wall clock, no Math.random.
  const pad = space(height, 6);
  const gx = noise2D("gs-grain-x", frame * 0.13, 0) * pad;
  const gy = noise2D("gs-grain-y", 0, frame * 0.13) * pad;

  return (
    <AbsoluteFill style={{ backgroundColor: base }}>
      {/* Drifting colour blobs, screen-blended into a mesh */}
      {blobs.map((blob, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: blob.cx * width - blobR,
            top: blob.cy * height - blobR,
            width: blobR * 2,
            height: blobR * 2,
            borderRadius: "50%",
            background: `radial-gradient(circle, color-mix(in srgb, ${blob.color} ${blob.alpha}%, transparent) 0%, transparent 68%)`,
            filter: `blur(${Math.round(height * 0.02)}px)`,
            mixBlendMode: "screen",
            opacity: inP,
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Optional engineering grid, faded at the edges */}
      {grid ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              `repeating-linear-gradient(0deg, ${gridLine} 0, ${gridLine} 1px, transparent 1px, transparent ${gridPitch}px), ` +
              `repeating-linear-gradient(90deg, ${gridLine} 0, ${gridLine} 1px, transparent 1px, transparent ${gridPitch}px)`,
            backgroundPosition: `${gridDrift}px ${gridDrift}px, ${gridDrift}px ${gridDrift}px`,
            WebkitMaskImage: gridMask,
            maskImage: gridMask,
            opacity: 0.5 * inP,
            pointerEvents: "none",
          }}
        />
      ) : null}

      {/* Caller overlay content */}
      {children ? (
        <div style={{ position: "absolute", inset: 0 }}>{children}</div>
      ) : null}

      {/* Film grain: static turbulence tile + noise-driven per-frame jitter */}
      {grain ? (
        <svg
          width={width + pad * 2}
          height={height + pad * 2}
          style={{
            position: "absolute",
            left: -pad + gx,
            top: -pad + gy,
            opacity: 0.055,
            mixBlendMode: "overlay",
            pointerEvents: "none",
          }}
        >
          <filter id="autovideo-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.82"
              numOctaves="2"
              stitchTiles="stitch"
              seed="11"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#autovideo-grain)" />
        </svg>
      ) : null}

      {/* Vignette */}
      {vignette ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 50% 46%, transparent 52%, rgba(0,0,0,0.38) 100%)",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export default GradientStage;
