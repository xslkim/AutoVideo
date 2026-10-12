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

// ---------------------------------------------------------------------------
// Elevation — shadow scale, offset/blur as coefficients of frame height
// ---------------------------------------------------------------------------

/**
 * Dark-theme discipline: separate layers by value contrast and 1px hairlines
 * first; shadows are the last resort. `flat` and `raised` cover nearly every
 * case — `overlay` is reserved for true floating layers (popover, tooltip).
 * Never stack two elevated layers on one screen, never elevate everything
 * (the "every card floats" AI cliché).
 *
 * Coefficients × height, so shadows scale with resolution like the type
 * scale. 1080p yields roughly: raised 2px/11px blur · overlay 6px/24px blur.
 */
export const ELEVATION = {
  /** Default: no shadow — tone + hairline separation only. */
  flat: { offsetY: 0, blur: 0, alpha: 0 },
  /** Raised card/panel: a barely-there lift off the background. */
  raised: { offsetY: 0.002, blur: 0.01, alpha: 0.35 },
  /** Floating overlay — the maximum elevation this system allows. */
  overlay: { offsetY: 0.006, blur: 0.022, alpha: 0.45 },
} as const;

export type ElevationLevel = keyof typeof ELEVATION;

/** CSS box-shadow for an elevation level at the given frame height. */
export function elevation(height: number, level: ElevationLevel): string {
  const e = ELEVATION[level];
  if (e.alpha === 0) return "none";
  const y = Math.round(height * e.offsetY);
  const blur = Math.round(height * e.blur);
  return `0 ${y}px ${blur}px rgba(0, 0, 0, ${e.alpha})`;
}

// ---------------------------------------------------------------------------
// Gradients — brand gradient pairs for small-area accents
// ---------------------------------------------------------------------------

/**
 * Canonical gradient pairs anchored to the dark-code palette. Legal uses:
 * progress fills, key-number strokes, path glows, chart fills — together
 * ≤ ~10% of the frame. Two hard bans: never a full-screen gradient
 * background wash, never a blue→purple sweep (the "AI default" cliché).
 */
export const GRADIENTS = {
  /** Primary brand sweep: accent blue → cyan. */
  brand: { from: "#58a6ff", to: "#39d2c0", angleDeg: 120 },
  /** Warm emphasis for key numbers / positive deltas. */
  ember: { from: "#f0883e", to: "#d29922", angleDeg: 120 },
  /** Success sweep — pairs with the success semantic colour. */
  success: { from: "#3fb950", to: "#2ea043", angleDeg: 120 },
  /** Depth wash for ambient background tints (opacity ≤ 0.08 only). */
  depth: { from: "#1f6feb", to: "#0d1117", angleDeg: 160 },
} as const;

export type GradientToken = keyof typeof GRADIENTS;

/** CSS linear-gradient string for a gradient token. */
export function gradient(token: GradientToken): string {
  const g = GRADIENTS[token];
  return `linear-gradient(${g.angleDeg}deg, ${g.from}, ${g.to})`;
}

// ---------------------------------------------------------------------------
// Stagger — sibling-cadence presets (seconds; convert with frames())
// ---------------------------------------------------------------------------

/**
 * Rhythmic spacing between sibling entrances. Pick by material density and
 * hand `stepSec` to staggeredSpring() / staggerDelay(); `baseSec` shifts the
 * whole group so ≥ 3 groups never share a downbeat. `normal`/`dense` mirror
 * the DUR stagger constants — the presets exist so a component can name a
 * cadence instead of hand-tuning numbers.
 */
export const STAGGER = {
  /** Default list / node cadence. */
  normal: { stepSec: DUR.staggerSec, baseSec: 0 },
  /** Dense material — code lines, table rows, tick marks. */
  dense: { stepSec: DUR.staggerDenseSec, baseSec: 0 },
  /** Hero beats — few large elements with weighty spacing. */
  hero: { stepSec: 0.22, baseSec: 0.1 },
  /** Percussive cascade — badges/ticks popping in after a parent lands. */
  cascade: { stepSec: 0.08, baseSec: 0.05 },
} as const;

export type StaggerToken = keyof typeof STAGGER;
