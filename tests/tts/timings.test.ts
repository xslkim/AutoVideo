import { describe, it, expect } from "vitest";
import { computeLineTimings } from "../../src/tts/timings";

describe("computeLineTimings", () => {
  it("acceptance test: 3 lines [1.0s, 0.5s, 2.0s]", () => {
    const durations = [1.0, 0.5, 2.0];
    const timings = computeLineTimings(durations);

    expect(timings).toEqual([
      { lineIndex: 0, startMs: 0, endMs: 1000 },
      { lineIndex: 1, startMs: 1200, endMs: 1700 },
      { lineIndex: 2, startMs: 1900, endMs: 3900 },
    ]);
  });

  it("empty array returns empty timings", () => {
    expect(computeLineTimings([])).toEqual([]);
  });

  it("single line has startMs=0", () => {
    const timings = computeLineTimings([3.5]);
    expect(timings).toEqual([
      { lineIndex: 0, startMs: 0, endMs: 3500 },
    ]);
  });

  it("works with fractional second values", () => {
    const timings = computeLineTimings([0.8, 1.2, 0.3]);
    // Line 0: start=0,     end=800
    // Line 1: start=1000,  end=2200
    // Line 2: start=2400,  end=2700
    expect(timings).toEqual([
      { lineIndex: 0, startMs: 0, endMs: 800 },
      { lineIndex: 1, startMs: 1000, endMs: 2200 },
      { lineIndex: 2, startMs: 2400, endMs: 2700 },
    ]);
  });

  it("each line's endMs equals startMs + durationMs", () => {
    const durations = [2.0, 1.5, 0.5, 3.0];
    const timings = computeLineTimings(durations);

    for (let i = 0; i < durations.length; i++) {
      expect(timings[i].lineIndex).toBe(i);
      expect(timings[i].endMs - timings[i].startMs).toBeCloseTo(
        durations[i] * 1000,
        6
      );
    }
  });

  it("respects 200ms gap between consecutive lines", () => {
    const durations = [1.0, 1.0, 1.0];
    const timings = computeLineTimings(durations);

    // Line 0 ends at 1000, Line 1 starts at 1200 → gap = 200
    expect(timings[1].startMs - timings[0].endMs).toBe(200);
    expect(timings[2].startMs - timings[1].endMs).toBe(200);
  });
});