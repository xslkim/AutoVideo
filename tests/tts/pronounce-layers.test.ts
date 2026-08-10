import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadPronunciationDicts,
  applyPronunciation,
  parsePronunciationDict,
} from "../../src/tts/pronounce.js";

describe("loadPronunciationDicts — layered dictionaries", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "autovideo-dict-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("loads only the project dict when no globals exist", () => {
    const proj = join(root, "proj");
    mkdirSync(proj);
    writeFileSync(join(proj, "dict.md"), "Foo => 富\n");
    const rules = loadPronunciationDicts(proj);
    expect(rules.map((r) => r.pattern)).toEqual(["Foo"]);
  });

  it("merges a repo-level dict.global.md found by walking up", () => {
    writeFileSync(join(root, "dict.global.md"), "Bar => 吧\n");
    const proj = join(root, "a", "b");
    mkdirSync(proj, { recursive: true });
    const rules = loadPronunciationDicts(proj);
    expect(rules.map((r) => r.pattern)).toEqual(["Bar"]);
  });

  it("project literal overrides a repo literal with the same pattern", () => {
    writeFileSync(join(root, "dict.global.md"), "GPU => G P U\n");
    const proj = join(root, "proj");
    mkdirSync(proj);
    writeFileSync(join(proj, "dict.md"), "GPU => 显卡\n");
    const rules = loadPronunciationDicts(proj);
    expect(applyPronunciation("GPU", rules)).toBe("显卡");
  });

  it("repo rules apply when the project doesn't mention the term", () => {
    writeFileSync(join(root, "dict.global.md"), "GPU => G P U\n");
    const proj = join(root, "proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "dict.md"), "Foo => 富\n");
    const rules = loadPronunciationDicts(proj);
    expect(applyPronunciation("GPU 和 Foo", rules)).toBe("G P U 和 富");
  });

  it("keeps literals sorted longest-first after merging", () => {
    writeFileSync(join(root, "dict.global.md"), "KV => K V\n");
    const proj = join(root, "proj");
    mkdirSync(proj);
    writeFileSync(join(proj, "dict.md"), "KV Cache => K V cache\n");
    const rules = loadPronunciationDicts(proj);
    expect(applyPronunciation("KV Cache 和 KV", rules)).toBe("K V cache 和 K V");
  });
});

describe("structural regex rules from dict.global.md", () => {
  const rules = parsePronunciationDict(`
/([A-Za-z][A-Za-z0-9]*)\\.cpp\\b/gi  => $1 C plus plus
/([A-Za-z])(\\d)_([A-Z])_([A-Z])\\b/g => $1 $2 $3 $4
/(\\d+)\\s?fps/gi => $1 帧每秒
GPU => G P U
`);

  it("rewrites dotted file names", () => {
    expect(applyPronunciation("为什么偏偏选 llama.cpp", rules)).toBe("为什么偏偏选 llama C plus plus");
  });

  it("rewrites quantization strings", () => {
    expect(applyPronunciation("Q4_K_M 量化", rules)).toBe("Q 4 K M 量化");
  });

  it("rewrites fps units", () => {
    expect(applyPronunciation("30fps", rules)).toBe("30 帧每秒");
  });

  it("file-name regex fires before the shorter literal could", () => {
    // 'GPU' literal must not stop the .cpp rule; both apply in one pass
    expect(applyPronunciation("GPU 上跑 app.cpp", rules)).toBe("G P U 上跑 app C plus plus");
  });
});
