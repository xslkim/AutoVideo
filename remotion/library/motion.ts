/**
 * AutoVideo — Library motion primitives
 *
 * Thin, pure wrappers around remotion's spring/interpolate. Everything here
 * is frame-driven: pass the current frame (and fps) in, get numbers out.
 * No hooks, no wall-clock time, no side effects — safe to call during render
 * and to unit-test in plain node.
 */

import { Easing, interpolate, spring } from "remotion";
import type { LineTimingSec } from "../engine/types.js";
// Value imports stay extensionless: the Remotion webpack config has no
// extensionAlias, so "./tokens.js" would not resolve at bundle time.
import { DUR, frames } from "./tokens";

// ---------------------------------------------------------------------------
// Easing curves
// ---------------------------------------------------------------------------

export const EASE = {
  /** Fast start, gentle settle — how things arriving on screen should move. */
  enter: Easing.out(Easing.cubic),
  /** Slow start, accelerating away — how things leaving should move. */
  exit: Easing.in(Easing.cubic),
  /** Symmetric — for emphasis pulses and draw-on strokes. */
  inOut: Easing.inOut(Easing.cubic),
} as const;

// ---------------------------------------------------------------------------
// Spring presets
// ---------------------------------------------------------------------------

export const SPRINGS = {
  /** Slow, overshoot-free — large panels and hero blocks. */
  gentle: { damping: 200 },
  /** Crisp with a whisper of overshoot — list rows, nodes, bars. */
  snappy: { damping: 26, stiffness: 170, mass: 0.9 },
  /** Playful pop — badges, ticks, small decorations. */
  pop: { damping: 13, stiffness: 240, mass: 0.8 },
} as const;

export type SpringPreset = keyof typeof SPRINGS;

// ---------------------------------------------------------------------------
// Entrance / stagger
// ---------------------------------------------------------------------------

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Eased 0→1 progress of an element that starts entering at `delayFrames`
 * and settles `durFrames` later. Clamped on both ends.
 */
export function enterProgress(
  frame: number,
  delayFrames: number,
  durFrames: number,
  easing: (t: number) => number = EASE.enter,
): number {
  return interpolate(frame - delayFrames, [0, Math.max(1, durFrames)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
}

/**
 * Spring entrance: 0 before `delayFrames`, →1 afterwards with the preset's
 * character (snappy/pop overshoot slightly past 1 — scale transforms love
 * this, opacity must be clamped by the caller).
 */
export function springIn(
  frame: number,
  fps: number,
  delayFrames = 0,
  preset: SpringPreset = "snappy",
): number {
  return spring({
    frame: frame - delayFrames,
    fps,
    config: SPRINGS[preset],
  });
}

/** Frame at which sibling `index` of a staggered group starts moving. */
export function staggerDelay(
  index: number,
  stepFrames: number,
  baseFrames = 0,
): number {
  return baseFrames + index * stepFrames;
}

/** Convenience: staggered spring entrance for sibling `index`. */
export function staggeredSpring(
  frame: number,
  fps: number,
  index: number,
  opts: { stepSec?: number; baseSec?: number; preset?: SpringPreset } = {},
): number {
  const step = frames(opts.stepSec ?? DUR.staggerSec, fps);
  const base = frames(opts.baseSec ?? 0, fps);
  return springIn(frame, fps, staggerDelay(index, step, base), opts.preset ?? "snappy");
}

// ---------------------------------------------------------------------------
// Idle micro-motion
// ---------------------------------------------------------------------------

/**
 * Breathing oscillation in [min, max], driven purely by frame count.
 * `phase` staggers multiple breathers so they don't pulse in lockstep.
 */
export function breathe(
  frame: number,
  fps: number,
  opts: { periodSec?: number; min?: number; max?: number; phase?: number } = {},
): number {
  const period = (opts.periodSec ?? 2.4) * fps;
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const phase = opts.phase ?? 0;
  const t = Math.sin(((frame + phase * period) / period) * Math.PI * 2) * 0.5 + 0.5;
  return min + (max - min) * t;
}

// ---------------------------------------------------------------------------
// Exit — reversed stagger (last in, first out)
// ---------------------------------------------------------------------------

/**
 * Per-item exit progress, 0 = fully held, 1 = fully gone. Items leave in
 * reverse entrance order inside the last `tailSec` of the block. BlockFrame
 * already fades the whole frame; use this only for internal collapse
 * (slides, scale-downs) when a component wants a staged goodbye.
 */
export function exitProgress(
  frame: number,
  durationInFrames: number,
  index: number,
  count: number,
  fps: number,
  tailSec: number = DUR.exitSec,
): number {
  const tailFrames = frames(tailSec, fps);
  const step = count > 1 ? tailFrames * 0.5 / (count - 1) : 0;
  // Reverse order: the last sibling starts leaving first.
  const start = durationInFrames - tailFrames + (count - 1 - index) * step;
  const dur = Math.max(1, tailFrames * 0.5);
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.exit,
  });
}

// ---------------------------------------------------------------------------
// Narration-driven beats
// ---------------------------------------------------------------------------

export interface BeatWindow {
  startSec: number;
  endSec: number;
}

/**
 * Map narration line timings onto `count` visual items.
 *
 * - Empty timings (no audio yet): the block duration is split evenly so the
 *   component still animates at a steady rhythm.
 * - One line per item: item i owns line i's window exactly.
 * - Mismatched counts (e.g. 3 narration lines over 8 code lines): items are
 *   spread evenly from the first line's start to the block end, so the beat
 *   still walks through every item instead of clamping onto the last line.
 */
export function resolveBeatSchedule(
  lineTimings: LineTimingSec[],
  count: number,
  durationSec: number,
): BeatWindow[] {
  if (count <= 0) return [];

  if (lineTimings.length === 0) {
    const slot = durationSec / count;
    return Array.from({ length: count }, (_, i) => ({
      startSec: i * slot,
      endSec: (i + 1) * slot,
    }));
  }

  if (lineTimings.length === count) {
    return lineTimings.map((line, i) => ({
      startSec: line.startSec,
      endSec: i === count - 1 ? durationSec : lineTimings[i + 1].startSec,
    }));
  }

  const firstStart = lineTimings[0].startSec;
  const span = Math.max(durationSec - firstStart, 0);
  const slot = span / count;
  return Array.from({ length: count }, (_, i) => ({
    startSec: firstStart + i * slot,
    endSec: i === count - 1 ? durationSec : firstStart + (i + 1) * slot,
  }));
}

/**
 * Index of the beat active at `tSec`, anchored on the last window that has
 * started (so highlights survive silence gaps between narration lines).
 * Returns -1 before the first beat.
 */
export function activeIndexAt(schedule: BeatWindow[], tSec: number): number {
  let active = -1;
  for (let i = 0; i < schedule.length; i++) {
    if (tSec >= schedule[i].startSec) active = i;
    else break;
  }
  return active;
}

// ---------------------------------------------------------------------------
// Modern animation presets (2026 refresh)
// ---------------------------------------------------------------------------
//
// Style resolvers behind the newer BlockFrame enter/exit presets
// ("blur-in" / "mask-reveal" / "zoom-settle" / "slide-mask"). Each takes a
// `visibility` value — 0 = fully hidden, 1 = fully settled — that the caller
// has already eased (enter: eased progress; exit: 1 - eased progress), so one
// resolver serves both phases and every exit is the exact mirror of its
// entrance. Same contract as everything above: pure, frame-driven, no hooks.

/** CSS fragment returned by the modern preset resolvers. */
export interface PresetStyle {
  opacity?: number;
  transform?: string;
  filter?: string;
  clipPath?: string;
}

/** Reveal-edge travel direction for `maskRevealStyle`. */
export type MaskRevealDirection = "up" | "left";

/** Entry side for `slideMaskStyle`. */
export type SlideMaskDirection = "left" | "right";

function roundTo(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * blur-in — the block comes into focus out of a 12px haze while fading in.
 * Reads as a focus pull, not a wipe; exit defocuses the same way.
 */
export function blurInStyle(visibility: number): PresetStyle {
  const v = clamp01(visibility);
  return {
    opacity: v,
    filter: `blur(${roundTo(interpolate(v, [0, 1], [12, 0]), 2)}px)`,
  };
}

/**
 * mask-reveal — content is uncovered by a sweeping clip edge instead of
 * fading: "up" travels bottom-to-top, "left" travels left-to-right. Pixels
 * under the edge are already final — no opacity, no drift.
 */
export function maskRevealStyle(
  visibility: number,
  direction: MaskRevealDirection = "up",
): PresetStyle {
  const hidden = roundTo((1 - clamp01(visibility)) * 100, 2);
  return {
    clipPath:
      direction === "up"
        ? `inset(${hidden}% 0% 0% 0%)`
        : `inset(0% ${hidden}% 0% 0%)`,
  };
}

/**
 * zoom-settle — a gentle landing: scale 1.06 → 1 while a light 6px blur
 * converges. Opacity ramps over the first 60% so the tail of the move reads
 * as pure settling. The exit mirrors it as a soft lift-off.
 */
export function zoomSettleStyle(visibility: number): PresetStyle {
  const v = clamp01(visibility);
  return {
    opacity: interpolate(v, [0, 0.6], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    transform: `scale(${roundTo(interpolate(v, [0, 1], [1.06, 1]), 4)})`,
    filter: `blur(${roundTo(interpolate(v, [0, 1], [6, 0]), 2)}px)`,
  };
}

/**
 * slide-mask — compound move: the block glides 48px horizontally while a
 * clip edge sweeps the same axis, so it appears to slide out from under a
 * mask. "left" enters from the left (default), "right" from the right.
 */
export function slideMaskStyle(
  visibility: number,
  direction: SlideMaskDirection = "left",
): PresetStyle {
  const v = clamp01(visibility);
  const offset = roundTo(interpolate(v, [0, 1], [48, 0]), 2);
  const hidden = roundTo((1 - v) * 100, 2);
  return direction === "left"
    ? {
        transform: `translateX(${-offset}px)`,
        clipPath: `inset(0% ${hidden}% 0% 0%)`,
      }
    : {
        transform: `translateX(${offset}px)`,
        clipPath: `inset(0% 0% 0% ${hidden}%)`,
      };
}
