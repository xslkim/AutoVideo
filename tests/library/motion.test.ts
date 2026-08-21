/**
 * Library motion/tokens pure-function tests.
 *
 * Everything in motion.ts and tokens.ts is frame-driven math, so it can be
 * exercised in plain node without a renderer.
 */

import { describe, it, expect } from "vitest";
import {
  activeIndexAt,
  breathe,
  clamp01,
  enterProgress,
  exitProgress,
  resolveBeatSchedule,
  staggerDelay,
  springIn,
} from "../../remotion/library/motion.js";
import { availHeight, frames, space, typeSize } from "../../remotion/library/tokens.js";

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

describe("tokens", () => {
  it("derives sizes from frame height (1080p reference values)", () => {
    expect(typeSize(1080, "display")).toBe(112);
    expect(typeSize(540, "display")).toBe(56); // scales with height
    expect(space(1080, 1)).toBe(8); // 8px grid at 1080p
    expect(space(2160, 1)).toBe(16);
  });

  it("availHeight reserves the subtitle band", () => {
    expect(availHeight(1080, 162)).toBe(918);
  });

  it("frames converts seconds via fps", () => {
    expect(frames(0.5, 30)).toBe(15);
    expect(frames(0.5, 60)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// motion — entrances
// ---------------------------------------------------------------------------

describe("motion entrances", () => {
  it("clamp01 bounds values", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it("enterProgress is clamped before delay and after settle", () => {
    expect(enterProgress(0, 10, 20)).toBe(0);
    expect(enterProgress(100, 10, 20)).toBe(1);
    const mid = enterProgress(20, 10, 20);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("staggerDelay spaces siblings by step", () => {
    expect(staggerDelay(0, 5, 10)).toBe(10);
    expect(staggerDelay(3, 5, 10)).toBe(25);
  });

  it("springIn starts at 0 and reaches 1 (gentle settles exactly)", () => {
    expect(springIn(0, 30, 10, "gentle")).toBe(0);
    expect(springIn(600, 30, 10, "gentle")).toBeCloseTo(1, 3);
  });

  it("breathe stays inside [min, max] and is deterministic per frame", () => {
    for (let f = 0; f < 200; f += 7) {
      const v = breathe(f, 30, { min: 0.2, max: 0.8 });
      expect(v).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(v).toBeLessThanOrEqual(0.8 + 1e-9);
      expect(breathe(f, 30, { min: 0.2, max: 0.8 })).toBe(v);
    }
  });
});

// ---------------------------------------------------------------------------
// motion — exits
// ---------------------------------------------------------------------------

describe("motion exits", () => {
  it("exitProgress is 0 during the hold and 1 at the end", () => {
    expect(exitProgress(0, 300, 0, 3, 30)).toBe(0);
    expect(exitProgress(300, 300, 2, 3, 30)).toBe(1);
  });

  it("later siblings start leaving before earlier ones (reversed stagger)", () => {
    // Sample mid-tail: item 2 (last in) must be further gone than item 0.
    const frame = 300 - 8;
    const first = exitProgress(frame, 300, 0, 3, 30);
    const last = exitProgress(frame, 300, 2, 3, 30);
    expect(last).toBeGreaterThan(first);
  });
});

// ---------------------------------------------------------------------------
// motion — narration beats
// ---------------------------------------------------------------------------

describe("beat schedule", () => {
  it("empty lineTimings degrades to uniform slots", () => {
    const s = resolveBeatSchedule([], 4, 12);
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual({ startSec: 0, endSec: 3 });
    expect(s[3]).toEqual({ startSec: 9, endSec: 12 });
  });

  it("spreads items evenly when line count and item count differ", () => {
    const s = resolveBeatSchedule(
      [
        { startSec: 1, endSec: 2 },
        { startSec: 2.5, endSec: 4 },
      ],
      3,
      10,
    );
    // 3 items over [1, 10]: slot = 3 — the beat walks every item.
    expect(s[0].startSec).toBe(1);
    expect(s[1].startSec).toBe(4);
    expect(s[2].startSec).toBe(7);
    expect(s[2].endSec).toBe(10);
  });

  it("activeIndexAt anchors on the last started beat and is -1 before it", () => {
    const s = resolveBeatSchedule(
      [
        { startSec: 1, endSec: 2 },
        { startSec: 3, endSec: 4 },
      ],
      2,
      10,
    );
    expect(activeIndexAt(s, 0.5)).toBe(-1);
    expect(activeIndexAt(s, 1.5)).toBe(0);
    expect(activeIndexAt(s, 2.5)).toBe(0); // silence gap keeps item 0 lit
    expect(activeIndexAt(s, 5)).toBe(1);
  });

  it("uniform fallback never goes static: beats advance over the block", () => {
    const s = resolveBeatSchedule([], 3, 9);
    expect(activeIndexAt(s, 0)).toBe(0);
    expect(activeIndexAt(s, 4)).toBe(1);
    expect(activeIndexAt(s, 8.9)).toBe(2);
  });
});
