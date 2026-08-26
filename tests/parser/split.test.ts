/**
 * Split-file block parser tests (visuals.md + narration.md)
 *
 * Covers:
 * - Normal split parsing and merge (directives, description, narration)
 * - Order follows the visuals file (narration order is irrelevant)
 * - Missing ID on a >>> header → error (no auto-numbering in split mode)
 * - Duplicate ID within one file → error
 * - ID set mismatch in both directions → error naming both files
 * - RawBlock.sourceFilePath points at the visuals file
 * - parseProjectBlocks: mixed legacy + split entries, legacy regression
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseVisualsFile,
  parseNarrationFile,
  parseSplitFiles,
} from "../../src/parser/split.js";
import {
  parseProjectBlocks,
  parseAndMergeBlocks,
  BlockError,
} from "../../src/parser/blocks.js";

describe("split-file parser", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-split-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePair(visuals: string, narration: string) {
    const visualPath = join(tmpDir, "visuals.md");
    const narrationPath = join(tmpDir, "narration.md");
    writeFileSync(visualPath, visuals);
    writeFileSync(narrationPath, narration);
    return { visualPath, narrationPath };
  }

  it("parses and merges a split pair into RawBlocks", () => {
    const { visualPath, narrationPath } = writePair(
      [
        ">>> Intro #B01",
        "@enter: fade-up",
        "@duration: 8s",
        "",
        '屏幕中央显示大标题 "Hello"',
        "",
        ">>> Diagram #B02",
        "@visual: image(./assets/diagram.png)",
        "",
        "显示架构图 ./assets/diagram.png",
      ].join("\n"),
      [
        ">>> Intro #B01",
        "这是**重要**的介绍",
        "第二句旁白",
        "",
        ">>> #B02",
        "架构图说明",
      ].join("\n"),
    );

    const blocks = parseSplitFiles(visualPath, narrationPath);

    expect(blocks).toHaveLength(2);

    const b01 = blocks[0];
    expect(b01.id).toBe("B01");
    expect(b01.title).toBe("Intro");
    expect(b01.enter).toBe("fade-up");
    expect(b01.explicitDurationSec).toBe(8);
    expect(b01.visualMode).toBe("animation");
    expect(b01.visualDescription).toContain("Hello");
    expect(b01.narrationLines).toHaveLength(2);
    expect(b01.narrationLines[0].ttsText).toBe("这是重要的介绍");
    expect(b01.narrationLines[0].highlights).toEqual([{ start: 2, end: 4 }]);
    expect(b01.sourceFilePath).toBe(visualPath);

    const b02 = blocks[1];
    expect(b02.id).toBe("B02");
    expect(b02.visualMode).toBe("image");
    expect(b02.imageSource).toBe("./assets/diagram.png");
    // Title can be omitted in the narration file (>>> #B02); the visuals
    // file title wins.
    expect(b02.title).toBe("Diagram");
    expect(b02.narrationLines).toHaveLength(1);
    expect(b02.sourceFilePath).toBe(visualPath);
  });

  it("treats every line after the first description line as description (including @-lines)", () => {
    const { visualPath, narrationPath } = writePair(
      [
        ">>> B #B01",
        "@enter: fade",
        "第一行描述",
        "@note 这一行虽然以 @ 开头但属于描述",
      ].join("\n"),
      [">>> #B01", "旁白"].join("\n"),
    );

    const blocks = parseSplitFiles(visualPath, narrationPath);
    expect(blocks[0].visualDescription).toBe(
      "第一行描述\n@note 这一行虽然以 @ 开头但属于描述",
    );
    expect(blocks[0].enter).toBe("fade");
  });

  it("orders blocks by the visuals file, ignoring narration file order", () => {
    const { visualPath, narrationPath } = writePair(
      [">>> One #B01", "描述一", ">>> Two #B02", "描述二"].join("\n"),
      // Narration file lists B02 first on purpose
      [">>> #B02", "旁白二", ">>> #B01", "旁白一"].join("\n"),
    );

    const blocks = parseSplitFiles(visualPath, narrationPath);
    expect(blocks.map((b) => b.id)).toEqual(["B01", "B02"]);
    expect(blocks[0].narrationLines[0].ttsText).toBe("旁白一");
    expect(blocks[1].narrationLines[0].ttsText).toBe("旁白二");
  });

  it("throws when a visuals block has no narration counterpart", () => {
    const { visualPath, narrationPath } = writePair(
      [">>> One #B01", "描述一", ">>> Three #B03", "描述三"].join("\n"),
      [">>> #B01", "旁白一"].join("\n"),
    );

    expect(() => parseSplitFiles(visualPath, narrationPath)).toThrow(BlockError);
    expect(() => parseSplitFiles(visualPath, narrationPath)).toThrow(
      `Block B03 has visuals in "${visualPath}" but no narration in "${narrationPath}"`,
    );
  });

  it("throws when a narration block has no visuals counterpart", () => {
    const { visualPath, narrationPath } = writePair(
      [">>> One #B01", "描述一"].join("\n"),
      [">>> #B01", "旁白一", ">>> #B02", "旁白二"].join("\n"),
    );

    expect(() => parseSplitFiles(visualPath, narrationPath)).toThrow(BlockError);
    expect(() => parseSplitFiles(visualPath, narrationPath)).toThrow(
      `Block B02 has narration in "${narrationPath}" but no visuals in "${visualPath}"`,
    );
  });

  it("throws on duplicate ID within the visuals file", () => {
    writeFileSync(
      join(tmpDir, "visuals.md"),
      [">>> One #B01", "描述一", ">>> Dup #B01", "描述二"].join("\n"),
    );
    expect(() => parseVisualsFile(join(tmpDir, "visuals.md"))).toThrow(
      /Duplicate block ID "B01" in ".*visuals\.md"/,
    );
  });

  it("throws on duplicate ID within the narration file", () => {
    writeFileSync(
      join(tmpDir, "narration.md"),
      [">>> #B01", "旁白一", ">>> #B01", "旁白二"].join("\n"),
    );
    expect(() => parseNarrationFile(join(tmpDir, "narration.md"))).toThrow(
      /Duplicate block ID "B01" in ".*narration\.md"/,
    );
  });

  it("throws when a visuals block header has no #Bxx ID", () => {
    writeFileSync(join(tmpDir, "visuals.md"), ">>> No ID here\n描述");
    expect(() => parseVisualsFile(join(tmpDir, "visuals.md"))).toThrow(
      /missing a #Bxx ID/,
    );
  });

  it("throws when a narration block header has no #Bxx ID", () => {
    writeFileSync(join(tmpDir, "narration.md"), ">>> No ID here\n旁白");
    expect(() => parseNarrationFile(join(tmpDir, "narration.md"))).toThrow(
      /missing a #Bxx ID/,
    );
  });

  it("throws when a visuals block has no description", () => {
    writeFileSync(
      join(tmpDir, "visuals.md"),
      [">>> One #B01", "@enter: fade", ""].join("\n"),
    );
    expect(() => parseVisualsFile(join(tmpDir, "visuals.md"))).toThrow(
      /has no visual description/,
    );
  });

  it("throws when a narration block has no narration lines", () => {
    writeFileSync(join(tmpDir, "narration.md"), [">>> #B01", ""].join("\n"));
    expect(() => parseNarrationFile(join(tmpDir, "narration.md"))).toThrow(
      /has no narration lines/,
    );
  });

  it("parseProjectBlocks handles mixed legacy + split entries in order", () => {
    // Legacy single-file block without explicit ID → auto-numbered
    writeFileSync(
      join(tmpDir, "legacy.md"),
      [
        ">>> Legacy Intro",
        "--- visual ---",
        "旧格式描述",
        "--- narration ---",
        "旧格式旁白",
      ].join("\n"),
    );
    const { visualPath, narrationPath } = writePair(
      [">>> Split #B05", "拆分描述"].join("\n"),
      [">>> #B05", "拆分旁白"].join("\n"),
    );

    const blocks = parseProjectBlocks([
      { kind: "single", path: join(tmpDir, "legacy.md") },
      { kind: "split", visualPath, narrationPath },
    ]);

    expect(blocks.map((b) => b.id)).toEqual(["B01", "B05"]);
    expect(blocks[0].narrationLines[0].ttsText).toBe("旧格式旁白");
    expect(blocks[1].sourceFilePath).toBe(visualPath);
  });

  it("parseProjectBlocks rejects ID conflicts between legacy and split entries", () => {
    writeFileSync(
      join(tmpDir, "legacy.md"),
      [
        ">>> Legacy #B01",
        "--- visual ---",
        "旧格式描述",
        "--- narration ---",
        "旧格式旁白",
      ].join("\n"),
    );
    const { visualPath, narrationPath } = writePair(
      [">>> Split #B01", "拆分描述"].join("\n"),
      [">>> #B01", "拆分旁白"].join("\n"),
    );

    expect(() =>
      parseProjectBlocks([
        { kind: "single", path: join(tmpDir, "legacy.md") },
        { kind: "split", visualPath, narrationPath },
      ]),
    ).toThrow(/Duplicate block ID "B01"/);
  });

  it("parseAndMergeBlocks legacy behavior is unchanged", () => {
    writeFileSync(
      join(tmpDir, "a.md"),
      [
        ">>> First",
        "--- visual ---",
        "描述一",
        "--- narration ---",
        "旁白一",
      ].join("\n"),
    );
    writeFileSync(
      join(tmpDir, "b.md"),
      [
        ">>> Second #B07",
        "--- visual ---",
        "描述二",
        "--- narration ---",
        "旁白二",
      ].join("\n"),
    );

    const blocks = parseAndMergeBlocks([
      join(tmpDir, "a.md"),
      join(tmpDir, "b.md"),
    ]);
    expect(blocks.map((b) => b.id)).toEqual(["B01", "B07"]);
  });
});
