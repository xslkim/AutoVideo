/**
 * AutoVideo v2 — Rect utilities
 * Converts normalized [0,1] rect to CSS positioning.
 */

export interface Rect {
  x: number;  // 0–1
  y: number;  // 0–1
  w: number;  // 0–1
  h: number;  // 0–1
}

/** Convert normalized Rect to absolute CSS properties (percentages) */
export function rectToCss(rect: Rect): React.CSSProperties {
  return {
    position: 'absolute',
    left:   `${rect.x * 100}%`,
    top:    `${rect.y * 100}%`,
    width:  `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
    overflow: 'hidden',
  };
}

/** Convert normalized Rect to pixel values given resolution */
export function rectToPx(rect: Rect, resW: number, resH: number) {
  return {
    x: rect.x * resW,
    y: rect.y * resH,
    w: rect.w * resW,
    h: rect.h * resH,
  };
}

/** Center a rect within another rect */
export function centerWithin(outer: Rect, innerW: number, innerH: number): Rect {
  return {
    x: outer.x + (outer.w - innerW) / 2,
    y: outer.y + (outer.h - innerH) / 2,
    w: innerW,
    h: innerH,
  };
}

/** Inset a rect by a fraction */
export function inset(rect: Rect, fraction: number): Rect {
  return {
    x: rect.x + rect.w * fraction,
    y: rect.y + rect.h * fraction,
    w: rect.w * (1 - 2 * fraction),
    h: rect.h * (1 - 2 * fraction),
  };
}
