/**
 * AutoVideo — Library design tokens
 *
 * Single source of truth for typography, spacing and motion timing used by
 * the prefab component library. Everything is derived from the frame size
 * (coefficients authored against 1080p) so components stay resolution-
 * independent — never hardcode pixel values outside these tables.
 *
 * Pure data + pure math only; safe to import from anywhere (no remotion
 * dependency on purpose, so unit tests stay lightweight).
 */

// ---------------------------------------------------------------------------
// Type scale — font sizes as a fraction of frame height
// ---------------------------------------------------------------------------

/**
 * Coefficients are multiplied by `height`. At 1080p this yields roughly:
 * display 112px · title 63px · subtitle 39px · body 29px · code 25px ·
 * caption 22px · label 18px.
 */
export const TYPE = {
  /** Hero title (TitleCard) */
  display: 0.104,
  /** Section heading above a content body */
  title: 0.058,
  /** Subtitle / lead paragraph under a title */
  subtitle: 0.036,
  /** Primary reading text (list items, node labels) */
  body: 0.027,
  /** Code lines — mono face, slightly tighter than body */
  code: 0.023,
  /** Secondary detail text under a body line */
  caption: 0.02,
  /** Small mono kickers, badges, line numbers */
  label: 0.017,
} as const;

export type TypeToken = keyof typeof TYPE;

/** Font size in px for a type token at the given frame height. */
export function typeSize(height: number, token: TypeToken): number {
  return Math.round(height * TYPE[token]);
}

// ---------------------------------------------------------------------------
// Spacing — 8px grid at 1080p, expressed in grid units
// ---------------------------------------------------------------------------

/** Grid pitch in px at the given frame height (8px @1080p). */
export function gridUnit(height: number): number {
  return height / 135;
}

/** `units` grid cells in px. Use for all gaps, paddings and offsets. */
export function space(height: number, units: number): number {
  return Math.round(gridUnit(height) * units);
}

// ---------------------------------------------------------------------------
// Layout — canonical content geometry, fractions of width / available height
// ---------------------------------------------------------------------------

/**
 * "Available height" is always `height - subtitleSafeBottom`: the bottom band
 * is reserved for the subtitle capsule and content must not enter it.
 */
export function availHeight(height: number, subtitleSafeBottom: number): number {
  return height - subtitleSafeBottom;
}

export const LAYOUT = {
  /** Outer side margin as a fraction of frame width (120px @1920) */
  marginXPct: 0.0625,
  /** Default top of the content column, fraction of available height */
  contentTopPct: 0.14,
  /** Where the optical centre of a hero block sits (slightly above middle) */
  heroCenterPct: 0.44,
  /** Max content measure for long text, fraction of frame width */
  measurePct: 0.72,
  /** Corner radius scale: card panels */
  radiusCardPct: 0.017,
  /** Corner radius scale: small chips / nodes */
  radiusChipPct: 0.009,
} as const;

// ---------------------------------------------------------------------------
// Motion timing — durations in *seconds*; convert with fps at the call site
// ---------------------------------------------------------------------------

export const DUR = {
  /** Micro beat: hairlines, ticks, badges */
  snapSec: 0.35,
  /** Standard element entrance */
  enterSec: 0.6,
  /** Large hero elements that should feel weighty */
  heroSec: 0.9,
  /** Default stagger step between siblings */
  staggerSec: 0.12,
  /** Tight stagger for dense lists (code lines) */
  staggerDenseSec: 0.05,
  /** Tail window reserved for reversed-stagger exits */
  exitSec: 0.5,
} as const;

/** Seconds → frames, rounded to the nearest whole frame. */
export function frames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}
