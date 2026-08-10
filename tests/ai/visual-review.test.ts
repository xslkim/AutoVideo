import { describe, it, expect } from "vitest";
import {
  extractJson,
  toResult,
  reviewInstructionsFor,
  reviewInstructions,
  narrationLineAt,
  frameCaption,
} from "../../src/ai/visual-review.js";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"pass": true}')).toEqual({ pass: true });
  });

  it("finds the first balanced object inside surrounding prose", () => {
    const text = 'Sure, here is my review:\n{"pass": false, "issues": ["a"]}\nHope that helps.';
    expect(extractJson(text)).toEqual({ pass: false, issues: ["a"] });
  });

  it("handles nested braces", () => {
    const text = '{"pass": false, "meta": {"nested": {"deep": 1}}}';
    expect(extractJson(text)).toEqual({ pass: false, meta: { nested: { deep: 1 } } });
  });

  it("returns null when there is no JSON object", () => {
    expect(extractJson("no json here")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extractJson("{not: valid}")).toBeNull();
  });
});

describe("toResult", () => {
  it("passes through malformed model output without blocking the pipeline", () => {
    expect(toResult(null, "garbage")).toEqual({ pass: true, feedback: "", raw: "garbage" });
    expect(toResult({ issues: [] }, "no pass field")).toEqual({
      pass: true,
      feedback: "",
      raw: "no pass field",
    });
  });

  it("returns an empty-feedback pass when the model approves", () => {
    const res = toResult({ pass: true }, "raw");
    expect(res).toEqual({ pass: true, feedback: "", raw: "raw" });
  });

  it("builds actionable feedback from issues and suggestions on failure", () => {
    const res = toResult(
      { pass: false, issues: ["画面太空"], suggestions: ["把标题放大"] },
      "raw",
    );
    expect(res.pass).toBe(false);
    expect(res.feedback).toContain("画面太空");
    expect(res.feedback).toContain("把标题放大");
    expect(res.feedback).toContain("动效编排");
  });

  it("tolerates a failing verdict with no issues/suggestions arrays", () => {
    const res = toResult({ pass: false }, "raw");
    expect(res.pass).toBe(false);
    expect(res.feedback.length).toBeGreaterThan(0);
  });
});

describe("reviewInstructionsFor", () => {
  it("uses the composition-only prompt for a single frame", () => {
    const instructions = reviewInstructionsFor(["/tmp/a.png"]);
    expect(instructions).not.toContain("Choreography");
    expect(instructions).toContain("art director");
  });

  it("uses the motion prompt once multiple frames are supplied", () => {
    const instructions = reviewInstructionsFor(["/tmp/a.png", "/tmp/b.png", "/tmp/c.png"]);
    expect(instructions).toContain("Choreography");
    expect(instructions).toContain("dead hold");
  });
});

const LINES = [
  { text: "开场白", startSec: 0.5, endSec: 3.0 },
  { text: "第一 结构", startSec: 3.2, endSec: 6.5 },
  { text: "第二 推理", startSec: 6.7, endSec: 10.0 },
];

describe("narrationLineAt", () => {
  it("finds the line containing t", () => {
    expect(narrationLineAt(LINES, 4.0)).toEqual({ index: 1, text: "第一 结构" });
  });

  it("attributes inter-line gaps to the previous line", () => {
    // 6.6s is inside the gap between line 1 (ends 6.5) and line 2 (starts 6.7)
    expect(narrationLineAt(LINES, 6.6)).toEqual({ index: 1, text: "第一 结构" });
  });

  it("returns undefined before the first line and for empty input", () => {
    expect(narrationLineAt(LINES, 0.1)).toBeUndefined();
    expect(narrationLineAt([], 5)).toBeUndefined();
    expect(narrationLineAt(undefined, 5)).toBeUndefined();
  });
});

describe("frameCaption", () => {
  it("annotates the frame with the narration line being spoken", () => {
    const cap = frameCaption(1, 6, 4.0, LINES);
    expect(cap).toContain("Frame 2/6");
    expect(cap).toContain("t=4.00s");
    expect(cap).toContain('narrator is saying line 1: "第一 结构"');
  });

  it("degrades gracefully without times or lines", () => {
    expect(frameCaption(0, 3, undefined, LINES)).toBe("Frame 1/3 (timeline order)");
    expect(frameCaption(0, 3, 1.0, undefined)).not.toContain("narrator");
  });
});

describe("reviewInstructions", () => {
  it("appends the sync section only when frames carry narration captions", () => {
    const withSync = reviewInstructions({
      pngPaths: ["/tmp/a.png", "/tmp/b.png"],
      visualDescription: "d",
      frameTimesSec: [1.0, 4.0],
      narrationLines: LINES,
    });
    expect(withSync).toContain("Narration sync");
    expect(withSync).toContain("SYNC FAILURE");

    const noTimes = reviewInstructions({
      pngPaths: ["/tmp/a.png", "/tmp/b.png"],
      visualDescription: "d",
      narrationLines: LINES,
    });
    expect(noTimes).not.toContain("Narration sync");

    const singleFrame = reviewInstructions({
      pngPaths: ["/tmp/a.png"],
      visualDescription: "d",
      frameTimesSec: [1.0],
      narrationLines: LINES,
    });
    expect(singleFrame).not.toContain("Narration sync");
  });
});
