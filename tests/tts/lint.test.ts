import { describe, it, expect } from "vitest";

import {
  lintPronunciation,
  suggestReading,
  formatPronunciationLint,
  lintDictReplacements,
  formatDictLint,
} from "../../src/tts/lint.js";
import { parsePronunciationDict } from "../../src/tts/pronounce.js";
import type { Block } from "../../src/types/script.js";

function blockWith(text: string): Block {
  return {
    id: "B01",
    title: "t",
    enter: "fade",
    exit: "fade",
    visualMode: "animation",
    visual: { description: "" },
    narration: { lines: [{ text, ttsText: text, highlights: [] }] },
  };
}

describe("suggestReading heuristics", () => {
  it("spells out ALL_CAPS acronyms", () => {
    expect(suggestReading("GGUF")).toBe("G G U F");
    expect(suggestReading("HTTP")).toBe("H T T P");
  });

  it("expands dotted file names", () => {
    expect(suggestReading("llama.cpp")).toBe("llama C plus plus");
    expect(suggestReading("index.ts")).toBe("index T S");
    expect(suggestReading("app.vue")).toBe("app view");
  });

  it("splits quantization strings", () => {
    expect(suggestReading("Q4_K_M")).toBe("Q 4 K M");
  });

  it("splits camelCase brands", () => {
    expect(suggestReading("PagedAttention")).toBe("Paged Attention");
    expect(suggestReading("TensorRT")).toBe("Tensor RT");
  });

  it("expands hyphenated compounds", () => {
    expect(suggestReading("TensorRT-LLM")).toBe("Tensor RT L L M");
  });

  it("returns undefined for proper nouns (needs LLM)", () => {
    expect(suggestReading("Georgi")).toBeUndefined();
  });
});

describe("lintPronunciation", () => {
  it("flags terms no rule covers", () => {
    const rules = parsePronunciationDict("GPU => G P U\n");
    const blocks = [blockWith("GPU 上跑 TensorRT 和 PagedAttention")];
    const findings = lintPronunciation(blocks, rules);
    const terms = findings.map((f) => f.term);
    expect(terms).toContain("TensorRT");
    expect(terms).toContain("PagedAttention");
    expect(terms).not.toContain("GPU");
  });

  it("skips plain English words that read fine", () => {
    const blocks = [blockWith("server 和 local 还有 model")];
    expect(lintPronunciation(blocks, [])).toEqual([]);
  });

  it("sorts by occurrence count, most frequent first", () => {
    const blocks = [
      blockWith("vLLM 和 vLLM 和 vLLM"),
      blockWith("PagedAttention 和 vLLM"),
    ];
    const findings = lintPronunciation(blocks, []);
    expect(findings[0].term).toBe("vLLM");
    expect(findings[0].occurrences).toBe(4);
  });

  it("marks multi-word proper nouns as needsLLM", () => {
    const blocks = [blockWith("Georgi Gerganov 发起了它")];
    const findings = lintPronunciation(blocks, []);
    const name = findings.find((f) => f.term === "Georgi Gerganov");
    expect(name?.needsLLM).toBe(true);
  });

  it("formatPronunciationLint renders null for empty findings", () => {
    expect(formatPronunciationLint([])).toBeNull();
  });
});

describe("lintDictReplacements", () => {
  it("flags an RHS containing digits", () => {
    const rules = parsePronunciationDict("FP16 => F P 16\n");
    const findings = lintDictReplacements(rules);
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("FP16");
    expect(findings[0].replacement).toBe("F P 16");
    expect(findings[0].line).toBe(1);
  });

  it("flags an RHS containing ':' or '.'", () => {
    const rules = parsePronunciationDict("宽高比 => 16 比 9\n阈值 => 0.1\n");
    const findings = lintDictReplacements(rules);
    // "16 比 9" is flagged for its digits, "0.1" for digits and the dot
    expect(findings.map((f) => f.pattern)).toEqual(["宽高比", "阈值"]);
  });

  it("flags a ':' in the RHS", () => {
    const rules = parsePronunciationDict("画幅 => 十六:九\n");
    expect(lintDictReplacements(rules).map((f) => f.pattern)).toEqual(["画幅"]);
  });

  it("ignores $1-style backreferences in regex replacements", () => {
    const rules = parsePronunciationDict(
      "/(\\d+)\\s?fps/gi => $1 帧每秒\n/([A-Z])(\\d)_([A-Z])\\b/g => $1 $2 $3\n",
    );
    expect(lintDictReplacements(rules)).toEqual([]);
  });

  it("still flags a regex RHS with literal digits beyond backreferences", () => {
    const rules = parsePronunciationDict("/(\\d+)\\s?fps/gi => $1 帧每秒 2 倍\n");
    expect(lintDictReplacements(rules)).toHaveLength(1);
  });

  it("accepts pure-text replacements", () => {
    const rules = parsePronunciationDict("GPU => G P U\nFP16 => F P 十六\n画幅 => 十六比九\n");
    expect(lintDictReplacements(rules)).toEqual([]);
  });

  it("accepts an empty rule set", () => {
    expect(lintDictReplacements([])).toEqual([]);
  });

  it("formatDictLint renders null for empty findings", () => {
    expect(formatDictLint([])).toBeNull();
  });

  it("formatDictLint explains the server-side normalize risk and the fix", () => {
    const rules = parsePronunciationDict("FP16 => F P 16\n");
    const report = formatDictLint(lintDictReplacements(rules));
    expect(report).not.toBeNull();
    expect(report).toContain("FP16 => F P 16");
    expect(report).toContain("normalize");
    expect(report).toContain("纯文字读法");
    expect(report).toContain("十六比九");
  });
});
