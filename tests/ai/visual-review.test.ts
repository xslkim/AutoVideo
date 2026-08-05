import { describe, it, expect } from "vitest";
import { extractJson, toResult, reviewInstructionsFor } from "../../src/ai/visual-review.js";

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
