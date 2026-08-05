import { describe, it, expect } from "vitest";
import { gapAfterMs, computeGapsMs, GAP_MS } from "../../src/tts/gaps.js";
import { computeLineTimings } from "../../src/tts/timings.js";

describe("gapAfterMs", () => {
  it("gives a full beat after a sentence", () => {
    expect(gapAfterMs("这是第一句。")).toBe(GAP_MS.sentence);
    expect(gapAfterMs("What is bias?")).toBe(GAP_MS.sentence);
    expect(gapAfterMs("注意！")).toBe(GAP_MS.sentence);
  });

  it("barely pauses after a comma", () => {
    expect(gapAfterMs("首先，")).toBe(GAP_MS.comma);
    expect(gapAfterMs("零偏、噪声、")).toBe(GAP_MS.comma);
  });

  it("uses a medium pause for colons and semicolons", () => {
    expect(gapAfterMs("分三步：")).toBe(GAP_MS.clause);
    expect(gapAfterMs("第一步完成；")).toBe(GAP_MS.clause);
  });

  it("holds longest on an ellipsis or dash", () => {
    expect(gapAfterMs("然后……")).toBe(GAP_MS.trailing);
    expect(gapAfterMs("结果是——")).toBe(GAP_MS.trailing);
  });

  it("looks past closing quotes and brackets", () => {
    expect(gapAfterMs("他说“好的。”")).toBe(GAP_MS.sentence);
    expect(gapAfterMs("（见下图）")).toBe(GAP_MS.none);
  });

  it("falls back when there is no terminal punctuation", () => {
    expect(gapAfterMs("Allan 方差")).toBe(GAP_MS.none);
    expect(gapAfterMs("   ")).toBe(GAP_MS.none);
  });
});

describe("computeGapsMs", () => {
  it("never pauses after the last line", () => {
    const gaps = computeGapsMs(["先看标定，", "再看结果。"]);
    expect(gaps).toEqual([GAP_MS.comma, 0]);
  });

  it("returns one gap per line", () => {
    expect(computeGapsMs([])).toEqual([]);
    expect(computeGapsMs(["只有一行。"])).toEqual([0]);
  });
});

describe("computeLineTimings with per-line gaps", () => {
  it("offsets each line by its own gap", () => {
    const timings = computeLineTimings([1.0, 2.0, 0.5], [180, 380, 0]);
    expect(timings[0]).toEqual({ lineIndex: 0, startMs: 0, endMs: 1000 });
    expect(timings[1]).toEqual({ lineIndex: 1, startMs: 1180, endMs: 3180 });
    expect(timings[2]).toEqual({ lineIndex: 2, startMs: 3560, endMs: 4060 });
  });

  it("keeps the fixed 200ms behaviour when gaps are omitted", () => {
    const timings = computeLineTimings([1.0, 1.0]);
    expect(timings[1].startMs).toBe(1200);
  });
});
