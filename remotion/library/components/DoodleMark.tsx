/**
 * AutoVideo — Library component: DoodleMark
 *
 * Hand-drawn annotation overlay: marker-pen circles, wavy underlines,
 * curved arrows and crosses that draw themselves over content to highlight
 * whatever the narration is pointing at. The hand-drawn wobble comes from
 * a seeded PRNG (mulberry32 keyed on mark index/type/target), so paths are
 * organic but bit-identical on every frame and render — no rough.js, no
 * Math.random, no wall clock. Draw-on is classic strokeDashoffset over the
 * polyline length of each generated stroke.
 * Registry entry: see src/ai/visual-registry.ts ("DoodleMark").
 *
 * Transparent by design: this component paints no background so the
 * assembly layer can stack it over other content; standalone it simply
 * draws its marks over whatever is behind it in the composition.
 * Enter/exit fades are BlockFrame's job — inner strokes animate only.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import type { AccentOverride, LibraryProps } from "../props.js";
import { availHeight, frames } from "../tokens";
import { clamp01, EASE, enterProgress } from "../motion";

// ---------------------------------------------------------------------------
// Spec (pure data — must stay JSON-serializable)
// ---------------------------------------------------------------------------

export type DoodleMarkType = "circle" | "underline" | "arrow" | "cross";

/** Region of the frame being annotated, as fractions of the frame (0–1). */
export interface DoodleTarget {
  /** Left edge, fraction of frame width. */
  x: number;
  /** Top edge, fraction of frame height. */
  y: number;
  /** Width, fraction of frame width. */
  w: number;
  /** Height, fraction of frame height. */
  h: number;
}

export interface DoodleMarkItem {
  /** circle: ellipse around the target · underline: wavy line below it ·
   *  arrow: curved arrow auto-aimed at the target rim · cross: ✕ over it. */
  type: DoodleMarkType;
  /** Region to annotate. Defaults to a centred box {x:.35, y:.36, w:.3, h:.2}. */
  target?: DoodleTarget;
  /** Stroke colour override for this mark; defaults to the spec accent. */
  color?: string;
}

export interface DoodleMarkSpec extends AccentOverride {
  /** 1–4 marks; they draw in array order with a stagger. */
  marks: DoodleMarkItem[];
  /** Seconds before the first mark starts drawing. Default 0.15. */
  delay?: number;
}

export type DoodleMarkProps = LibraryProps<DoodleMarkSpec>;

// ---------------------------------------------------------------------------
// Deterministic PRNG — the same mark always wobbles the same way
// ---------------------------------------------------------------------------

function xfnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Path generation (pure geometry, px space)
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}

/** Target box converted to px, with degenerate sizes floored. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Stroke {
  d: string;
  length: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

function polyLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return Math.max(1, len);
}

/** Catmull-Rom → cubic bezier smoothing, then measure the polyline length. */
function smoothStroke(pts: Pt[]): Stroke {
  if (pts.length === 0) return { d: "", length: 1 };
  if (pts.length < 3) {
    return {
      d: `M ${r2(pts[0].x)} ${r2(pts[0].y)}${pts.length > 1 ? ` L ${r2(pts[1].x)} ${r2(pts[1].y)}` : ""}`,
      length: polyLength(pts),
    };
  }
  let d = `M ${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C ${r2(p1.x + (p2.x - p0.x) / 6)} ${r2(p1.y + (p2.y - p0.y) / 6)} ${r2(p2.x - (p3.x - p1.x) / 6)} ${r2(p2.y - (p3.y - p1.y) / 6)} ${r2(p2.x)} ${r2(p2.y)}`;
  }
  return { d, length: polyLength(pts) };
}

/** Straight line sampled with perpendicular jitter (endpoints stay exact). */
function jitterLine(a: Pt, b: Pt, segments: number, amp: number, rand: () => number): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const pts: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const edge = Math.sin(t * Math.PI); // taper jitter to zero at both ends
    const off = (rand() - 0.5) * 2 * amp * edge;
    pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
  }
  return pts;
}

/** Ellipse around the box, overshooting its own start like a pen loop. */
function circlePts(box: Box, rand: () => number, height: number): Pt[] {
  const cx = box.x + box.w / 2 + (rand() - 0.5) * box.w * 0.02;
  const cy = box.y + box.h / 2 + (rand() - 0.5) * box.h * 0.02;
  const rx = box.w / 2 + box.w * 0.12 + height * 0.006;
  const ry = box.h / 2 + box.h * 0.12 + height * 0.006;
  const phase = rand() * Math.PI * 2;
  const theta0 = rand() * Math.PI * 2;
  const sweep = Math.PI * 2 * (1.04 + rand() * 0.06);
  const lobes = 2 + Math.floor(rand() * 2);
  const N = 64;
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = theta0 + (i / N) * sweep;
    const rJit = 1 + Math.sin(t * lobes + phase) * 0.02 + (rand() - 0.5) * 0.024;
    pts.push({ x: cx + Math.cos(t) * rx * rJit, y: cy + Math.sin(t) * ry * rJit });
  }
  return pts;
}

/** Wavy line just below the box, bowed in the middle with a tail flick. */
function underlinePts(box: Box, rand: () => number, height: number): Pt[] {
  const y = box.y + box.h + height * 0.014 + box.h * 0.06;
  const x0 = box.x - box.w * 0.04;
  const x1 = box.x + box.w * 1.04;
  const amp = Math.max(2, height * 0.004);
  const phase = rand() * Math.PI * 2;
  const lobes = 1.5 + rand() * 1.5;
  const N = 28;
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const bow = Math.sin(t * Math.PI) * amp * 0.9;
    const wig = Math.sin(t * Math.PI * 2 * lobes + phase) * amp * 0.5 + (rand() - 0.5) * amp;
    const flick = t > 0.9 ? -(t - 0.9) * 8 * amp : 0;
    pts.push({ x: x0 + t * (x1 - x0), y: y + bow + wig + flick });
  }
  return pts;
}

/**
 * Curved arrow auto-aimed at the box rim. The tail sits on the roomier
 * side of the canvas (more empty space → annotation reads as "pointing in"
 * from the margin); the head lands exactly on the box edge.
 */
function arrowPts(
  box: Box,
  rand: () => number,
  width: number,
  availH: number,
  height: number,
): { shaft: Pt[]; wingA: Pt[]; wingB: Pt[] } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const sx = cx > width / 2 ? -1 : 1;
  const sy = cy > availH / 2 ? -1 : 1;
  const tail: Pt = {
    x: Math.min(width * 0.95, Math.max(width * 0.05, cx + sx * (box.w * 0.85 + width * 0.055))),
    y: Math.min(availH * 0.94, Math.max(availH * 0.06, cy + sy * (box.h * 1.05 + availH * 0.06))),
  };
  // Rim point: walk from the centre towards the tail, clip at the box edge.
  const dx = tail.x - cx;
  const dy = tail.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const eps = 1e-6;
  const tRay = Math.min(
    Math.abs(ux) > eps ? (box.w / 2 + 2) / Math.abs(ux) : Infinity,
    Math.abs(uy) > eps ? (box.h / 2 + 2) / Math.abs(uy) : Infinity,
  );
  const tip: Pt = { x: cx + ux * tRay, y: cy + uy * tRay };

  const bend = len * (0.18 + rand() * 0.12) * (rand() < 0.5 ? -1 : 1);
  const ctrl: Pt = {
    x: (tail.x + tip.x) / 2 - uy * bend,
    y: (tail.y + tip.y) / 2 + ux * bend,
  };

  const amp = Math.max(2, height * 0.0035);
  const N = 22;
  const shaft: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const bx = mt * mt * tail.x + 2 * mt * t * ctrl.x + t * t * tip.x;
    const by = mt * mt * tail.y + 2 * mt * t * ctrl.y + t * t * tip.y;
    const off = (rand() - 0.5) * 2 * amp * Math.sin(t * Math.PI);
    shaft.push({ x: bx - uy * off, y: by + ux * off });
  }

  // Arrowhead: two short strokes angled back from the tip tangent.
  const tx = tip.x - ctrl.x;
  const ty = tip.y - ctrl.y;
  const tLen = Math.hypot(tx, ty) || 1;
  const back = { x: -tx / tLen, y: -ty / tLen };
  const wingLen = Math.max(12, height * 0.017);
  const wingAng = 0.55 + rand() * 0.15;
  const wing = (sign: 1 | -1): Pt[] => {
    const a = wingAng * sign;
    const wx = back.x * Math.cos(a) - back.y * Math.sin(a);
    const wy = back.x * Math.sin(a) + back.y * Math.cos(a);
    return jitterLine(tip, { x: tip.x + wx * wingLen, y: tip.y + wy * wingLen }, 3, amp * 0.4, rand);
  };
  return { shaft, wingA: wing(1), wingB: wing(-1) };
}

/** Two quick diagonal strokes across the box. */
function crossPts(box: Box, rand: () => number, height: number): { a: Pt[]; b: Pt[] } {
  const pad = Math.min(box.w, box.h) * 0.08 + height * 0.004;
  const amp = Math.max(2, height * 0.0032);
  const corner = (x: number, y: number): Pt => ({
    x: x + (rand() - 0.5) * pad * 0.6,
    y: y + (rand() - 0.5) * pad * 0.6,
  });
  const a = jitterLine(corner(box.x - pad, box.y - pad), corner(box.x + box.w + pad, box.y + box.h + pad), 9, amp, rand);
  const b = jitterLine(corner(box.x - pad, box.y + box.h + pad), corner(box.x + box.w + pad, box.y - pad), 9, amp, rand);
  return { a, b };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Per-mark draw durations and the stagger between consecutive marks. */
const DRAW_SEC: Record<DoodleMarkType, number> = {
  circle: 0.8,
  underline: 0.55,
  arrow: 0.85,
  cross: 0.5,
};
const MARK_STAGGER_SEC = 0.45;

const DEFAULT_TARGET: DoodleTarget = { x: 0.35, y: 0.36, w: 0.3, h: 0.2 };

export const DoodleMark: React.FC<DoodleMarkProps> = ({
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
  const baseF = frames(spec.delay ?? 0.15, fps);
  const staggerF = frames(MARK_STAGGER_SEC, fps);
  const strokeWidth = Math.max(3, height * 0.0042);

  return (
    <AbsoluteFill>
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {spec.marks.map((mark, i) => {
          const t = mark.target ?? DEFAULT_TARGET;
          const box: Box = {
            x: t.x * width,
            y: t.y * height,
            w: Math.max(8, t.w * width),
            h: Math.max(8, t.h * height),
          };

          // Stable per-mark seed → identical wobble on every frame/render.
          const seed = xfnv1a(
            `${i}:${mark.type}:${t.x.toFixed(4)}:${t.y.toFixed(4)}:${t.w.toFixed(4)}:${t.h.toFixed(4)}`,
          );
          const rand = mulberry32(seed);

          const p = enterProgress(
            frame,
            baseF + i * staggerF,
            frames(DRAW_SEC[mark.type], fps),
            EASE.inOut,
          );

          let strokes: { stroke: Stroke; p: number }[];
          if (mark.type === "circle") {
            strokes = [{ stroke: smoothStroke(circlePts(box, rand, height)), p }];
          } else if (mark.type === "underline") {
            strokes = [{ stroke: smoothStroke(underlinePts(box, rand, height)), p }];
          } else if (mark.type === "arrow") {
            const { shaft, wingA, wingB } = arrowPts(box, rand, width, availH, height);
            const shaftP = clamp01(p / 0.78);
            const wingP = clamp01((p - 0.7) / 0.3);
            strokes = [
              { stroke: smoothStroke(shaft), p: shaftP },
              { stroke: smoothStroke(wingA), p: wingP },
              { stroke: smoothStroke(wingB), p: wingP },
            ];
          } else {
            const { a, b } = crossPts(box, rand, height);
            strokes = [
              { stroke: smoothStroke(a), p: clamp01(p / 0.55) },
              { stroke: smoothStroke(b), p: clamp01((p - 0.45) / 0.55) },
            ];
          }

          // A whisper of rotation makes the mark feel placed by hand.
          const deg = (rand() - 0.5) * 3;
          const cx = box.x + box.w / 2;
          const cy = box.y + box.h / 2;
          const color = mark.color ?? accent;

          return (
            <g key={i} transform={`rotate(${r2(deg)} ${r2(cx)} ${r2(cy)})`}>
              {strokes.map((s, j) =>
                s.stroke.d ? (
                  <path
                    key={j}
                    d={s.stroke.d}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={s.stroke.length}
                    strokeDashoffset={(1 - s.p) * s.stroke.length}
                    opacity={0.92}
                  />
                ) : null,
              )}
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

export default DoodleMark;
