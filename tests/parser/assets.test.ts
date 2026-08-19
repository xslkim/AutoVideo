/**
 * T1.4 Acceptance tests — Asset hash copy & inline
 *
 * Covers:
 * - Same filename in different directories → different hash keys in manifest
 * - Same file referenced by multiple blocks → deduplicated in assets
 * - Code reference without "第 X-Y 行" annotation → no inline, only hash copy
 * - Code reference with line range → inlined with context ±5 lines
 * - Image path replacement in visual description
 * - MD5 hash computed correctly (first 8 chars)
 * - Missing referenced file → error
 * - Path resolution relative to source .md file directory
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  processAssets,
  computeFileHash,
  parseLineRange,
  inlineCodeSnippet,
  isCodeFile,
  LOCAL_PATH_REGEX,
  stripVisualComments,
  AssetError,
  type BlockForAssets,
} from "../../src/parser/assets.js";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

describe("LOCAL_PATH_REGEX", () => {
  it("matches ./relative/path.png", () => {
    const text = "显示图片 ./assets/arch.png，居中展示";
    const matches = [...text.matchAll(new RegExp(LOCAL_PATH_REGEX.source, "gm"))];
    expect(matches).toHaveLength(1);
    expect(matches[0][2]).toBe("./assets/arch.png");
  });

  it("matches ../parent/path.jpg", () => {
    const text = "引用 ../images/diagram.jpg 做展示";
    const matches = [...text.matchAll(new RegExp(LOCAL_PATH_REGEX.source, "gm"))];
    expect(matches).toHaveLength(1);
    expect(matches[0][2]).toBe("../images/diagram.jpg");
  });

  it("matches path at start of string", () => {
    const text = "./assets/arch.png 居中展示";
    const matches = [...text.matchAll(new RegExp(LOCAL_PATH_REGEX.source, "gm"))];
    expect(matches).toHaveLength(1);
    expect(matches[0][2]).toBe("./assets/arch.png");
  });

  it("does not match bare filenames without ./ or ../", () => {
    const text = "引用 arch.png 做展示";
    const matches = [...text.matchAll(new RegExp(LOCAL_PATH_REGEX.source, "gm"))];
    expect(matches).toHaveLength(0);
  });

  it("matches multiple paths in one description", () => {
    const text = "显示 ./a.png 和 ../b.jpg 两张图";
    const matches = [...text.matchAll(new RegExp(LOCAL_PATH_REGEX.source, "gm"))];
    expect(matches).toHaveLength(2);
    expect(matches[0][2]).toBe("./a.png");
    expect(matches[1][2]).toBe("../b.jpg");
  });

  it("does not swallow text after full-width colon (e.g. camchain.yaml)", () => {
    const text =
      "（预渲染图 ./assets/B18.png：camchain.yaml 结构与 intrinsics 解读。源文件 assets/B18.html。）";
    const matches = [...text.matchAll(new RegExp(LOCAL_PATH_REGEX.source, "gm"))];
    expect(matches).toHaveLength(1);
    expect(matches[0][2]).toBe("./assets/B18.png");
  });
});

describe("computeFileHash", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-hash-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns first 8 hex chars of MD5", () => {
    const filePath = join(tmpDir, "test.txt");
    const content = "hello world";
    writeFileSync(filePath, content);

    const expectedHash = createHash("md5").update(content).digest("hex").substring(0, 8);
    const result = computeFileHash(filePath);

    expect(result).toBe(expectedHash);
    expect(result).toHaveLength(8);
  });

  it("different content produces different hash", () => {
    const file1 = join(tmpDir, "file1.txt");
    const file2 = join(tmpDir, "file2.txt");
    writeFileSync(file1, "content A");
    writeFileSync(file2, "content B");

    expect(computeFileHash(file1)).not.toBe(computeFileHash(file2));
  });

  it("same content produces same hash", () => {
    const file1 = join(tmpDir, "same1.txt");
    const file2 = join(tmpDir, "same2.txt");
    writeFileSync(file1, "identical content");
    writeFileSync(file2, "identical content");

    expect(computeFileHash(file1)).toBe(computeFileHash(file2));
  });
});

describe("isCodeFile", () => {
  it("returns true for .py", () => expect(isCodeFile(".py")).toBe(true));
  it("returns true for .ts", () => expect(isCodeFile(".ts")).toBe(true));
  it("returns true for .js", () => expect(isCodeFile(".js")).toBe(true));
  it("returns true for .PY (case insensitive)", () => expect(isCodeFile(".PY")).toBe(true));
  it("returns false for .png", () => expect(isCodeFile(".png")).toBe(false));
  it("returns false for .jpg", () => expect(isCodeFile(".jpg")).toBe(false));
});

describe("parseLineRange", () => {
  it("parses 第 30-50 行", () => {
    const result = parseLineRange("代码 microgpt.py 第 30-50 行");
    expect(result).toEqual([30, 50]);
  });

  it("parses 第30行 (single line)", () => {
    const result = parseLineRange("代码 microgpt.py 第30行");
    expect(result).toEqual([30, 30]);
  });

  it("parses lines 30-50", () => {
    const result = parseLineRange("source.py lines 30-50");
    expect(result).toEqual([30, 50]);
  });

  it("parses line 30 (single)", () => {
    const result = parseLineRange("source.py line 30");
    expect(result).toEqual([30, 30]);
  });

  it("returns null when no line range present", () => {
    const result = parseLineRange("代码编辑器风格界面");
    expect(result).toBeNull();
  });

  it("parses 行 30-50", () => {
    const result = parseLineRange("microgpt.py 行 30-50");
    expect(result).toEqual([30, 50]);
  });
});

describe("inlineCodeSnippet", () => {
  it("wraps specified lines + context in code fence", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");

    // Request lines 10-12, context ±5 = lines 5-17
    const result = inlineCodeSnippet(content, 10, 12, ".py");

    expect(result).toContain("```py");
    expect(result).toContain("line 5");
    expect(result).toContain("line 17");
    expect(result).not.toContain("line 4");
    expect(result).not.toContain("line 18");
  });

  it("clamps at start of file", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");

    // Request lines 2-3, context ±5 = start clamped to line 1
    const result = inlineCodeSnippet(content, 2, 3, ".ts");

    expect(result).toContain("```ts");
    expect(result).toContain("line 1");
    expect(result).toContain("line 8");
  });

  it("clamps at end of file", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");

    // Request lines 18-19, context ±5 = end clamped to line 20
    const result = inlineCodeSnippet(content, 18, 19, ".js");

    expect(result).toContain("```js");
    expect(result).toContain("line 13");
    expect(result).toContain("line 20");
  });
});

describe("stripVisualComments", () => {
  it("removes paired comments, keeps other content", () => {
    const text = "前文<!-- ./scratch-plugin/cordis.yml 仅文档参考 -->后文";
    expect(stripVisualComments(text)).toBe("前文后文");
  });

  it("removes multi-line comments", () => {
    const text = "标题\n<!--\n命令示例：--patch ./a/b.yml\n-->\n正文";
    expect(stripVisualComments(text)).toBe("标题\n\n正文");
  });

  it("strips unclosed comment to end of string", () => {
    expect(stripVisualComments("正文 <!-- ./a/b.yml")).toBe("正文 ");
  });

  it("leaves text without comments untouched", () => {
    expect(stripVisualComments("./assets/arch.png 展示")).toBe("./assets/arch.png 展示");
  });
});

describe("processAssets", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-assets-${Date.now()}`);
  const projectDir = tmpDir;
  const buildOutDir = join(tmpDir, "build");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(buildOutDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("copies image and replaces path in description", () => {
    // Create an image file
    const imgDir = join(projectDir, "assets");
    mkdirSync(imgDir, { recursive: true });
    const imgPath = join(imgDir, "arch.png");
    writeFileSync(imgPath, "fake png content");

    const hash = createHash("md5").update("fake png content").digest("hex").substring(0, 8);
    const expectedHashName = `assets/${hash}.png`;

    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "显示图片 ./assets/arch.png，居中展示",
        sourceFilePath: join(projectDir, "intro.md"),
      },
    ];

    const result = processAssets(blocks, projectDir, buildOutDir);

    // Description should have path replaced
    expect(result.blocks[0].visualDescription).toContain(expectedHashName);
    expect(result.blocks[0].visualDescription).not.toContain("./assets/arch.png");

    // Asset should be copied to build output
    const destPath = resolve(buildOutDir, "public", expectedHashName);
    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath, "utf-8")).toBe("fake png content");

    // Assets manifest should have the correct entry
    const relKey = "assets/arch.png"; // relative to projectDir
    expect(result.assets[relKey]).toBe(expectedHashName);
  });

  it("same filename in different directories → different hash keys", () => {
    // Create two directories with same-named but different content files
    const dir1 = join(projectDir, "intro");
    const dir2 = join(projectDir, "part1");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    writeFileSync(join(dir1, "diagram.png"), "content from intro");
    writeFileSync(join(dir2, "diagram.png"), "content from part1");

    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "显示 ./intro/diagram.png",
        sourceFilePath: join(projectDir, "intro.md"),
      },
      {
        id: "B02",
        visualDescription: "显示 ./part1/diagram.png",
        sourceFilePath: join(projectDir, "part1.md"),
      },
    ];

    const result = processAssets(blocks, projectDir, buildOutDir);

    // Two different keys in assets manifest
    const keys = Object.keys(result.assets);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("intro/diagram.png");
    expect(keys).toContain("part1/diagram.png");

    // Different hash values
    expect(result.assets["intro/diagram.png"]).not.toBe(result.assets["part1/diagram.png"]);
  });

  it("same file referenced by multiple blocks → deduplicated in assets", () => {
    const imgDir = join(projectDir, "shared");
    mkdirSync(imgDir, { recursive: true });
    writeFileSync(join(imgDir, "common.png"), "shared content");

    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "显示 ./shared/common.png",
        sourceFilePath: join(projectDir, "intro.md"),
      },
      {
        id: "B02",
        visualDescription: "再次显示 ./shared/common.png 做对比",
        sourceFilePath: join(projectDir, "part1.md"),
      },
      {
        id: "B03",
        visualDescription: "第三块也用 ./shared/common.png",
        sourceFilePath: join(projectDir, "part2.md"),
      },
    ];

    const result = processAssets(blocks, projectDir, buildOutDir);

    // Only one entry in assets manifest
    const keys = Object.keys(result.assets);
    expect(keys).toHaveLength(1);
    expect(keys).toContain("shared/common.png");

    // All blocks should reference the same hash name
    const hashName = result.assets["shared/common.png"];
    for (const block of result.blocks) {
      expect(block.visualDescription).toContain(hashName);
    }

    // Only one copy of the file should exist
    const destPath = resolve(buildOutDir, "public", hashName);
    expect(existsSync(destPath)).toBe(true);
  });

  it("code reference without line range → no inline, only hash copy", () => {
    const codeDir = join(projectDir, "src");
    mkdirSync(codeDir, { recursive: true });
    const codePath = join(codeDir, "microgpt.py");
    writeFileSync(codePath, Array.from({ length: 100 }, (_, i) => `# line ${i + 1}`).join("\n"));

    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "代码编辑器风格界面，展示 Python 代码文件 ./src/microgpt.py",
        sourceFilePath: join(projectDir, "intro.md"),
      },
    ];

    const result = processAssets(blocks, projectDir, buildOutDir);

    // Should not contain inlined code (no line range specified)
    expect(result.blocks[0].visualDescription).not.toContain("```py");

    // But the file should still be hash-copied
    const keys = Object.keys(result.assets);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("src/microgpt.py");
    expect(result.assets[keys[0]]).toMatch(/^assets\/[a-f0-9]{8}\.py$/);

    // File should be copied
    const destPath = resolve(buildOutDir, "public", result.assets[keys[0]]);
    expect(existsSync(destPath)).toBe(true);
  });

  it("code reference with line range → inlined with context", () => {
    const codeDir = join(projectDir, "src");
    mkdirSync(codeDir, { recursive: true });
    const codePath = join(codeDir, "microgpt.py");
    const codeLines = Array.from({ length: 100 }, (_, i) => `# line ${i + 1}`);
    writeFileSync(codePath, codeLines.join("\n"));

    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "代码编辑器风格界面，展示 Python 代码，文件 ./src/microgpt.py 第 30-35 行",
        sourceFilePath: join(projectDir, "intro.md"),
      },
    ];

    const result = processAssets(blocks, projectDir, buildOutDir);

    // Should contain inlined code with context ±5 lines
    const desc = result.blocks[0].visualDescription;
    expect(desc).toContain("```py");
    // Lines 25-40 (30-5=25 to 35+5=40)
    expect(desc).toContain("# line 25");
    expect(desc).toContain("# line 40");
    expect(desc).not.toContain("# line 24");
    expect(desc).not.toContain("# line 41");

    // File should also be hash-copied
    const keys = Object.keys(result.assets);
    expect(keys).toHaveLength(1);
  });

  it("resolves paths relative to source .md file directory", () => {
    // project.json is in tmpDir/project/
    // intro.md is in tmpDir/project/content/
    // image is in tmpDir/project/content/images/
    const projDir = join(tmpDir, "project");
    const contentDir = join(projDir, "content");
    const imagesDir = join(contentDir, "images");
    mkdirSync(imagesDir, { recursive: true });
    mkdirSync(join(buildOutDir, "public"), { recursive: true });

    writeFileSync(join(imagesDir, "photo.png"), "photo data");

    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "显示图片 ./images/photo.png",
        // Source file is in content/, so ./images/ resolves to content/images/
        sourceFilePath: join(contentDir, "intro.md"),
      },
    ];

    const result = processAssets(blocks, projDir, buildOutDir);

    // Key should be relative to projectDir
    const keys = Object.keys(result.assets);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("content/images/photo.png");
  });

  it("resolves ../ paths correctly", () => {
    const subDir = join(projectDir, "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(projectDir, "top.png"), "top level image");

    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "显示图片 ../top.png",
        sourceFilePath: join(subDir, "block.md"),
      },
    ];

    const result = processAssets(blocks, projectDir, buildOutDir);

    const keys = Object.keys(result.assets);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("top.png");
    expect(result.assets["top.png"]).toMatch(/^assets\/[a-f0-9]{8}\.png$/);
  });

  it("throws on missing referenced file", () => {
    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "显示图片 ./nonexistent.png",
        sourceFilePath: join(projectDir, "intro.md"),
      },
    ];

    expect(() => processAssets(blocks, projectDir, buildOutDir)).toThrow(AssetError);
    expect(() => processAssets(blocks, projectDir, buildOutDir)).toThrow(
      /referenced file not found/,
    );
  });

  it("handles block with no file references", () => {
    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "屏幕中央显示大标题 \"GPT = 下一个词预测器\"",
        sourceFilePath: join(projectDir, "intro.md"),
      },
    ];

    const result = processAssets(blocks, projectDir, buildOutDir);

    expect(result.blocks[0].visualDescription).toBe(
      "屏幕中央显示大标题 \"GPT = 下一个词预测器\"",
    );
    expect(Object.keys(result.assets)).toHaveLength(0);
  });

  it("handles multiple paths in a single description", () => {
    mkdirSync(join(projectDir, "a"), { recursive: true });
    mkdirSync(join(projectDir, "b"), { recursive: true });
    writeFileSync(join(projectDir, "a", "img1.png"), "image 1");
    writeFileSync(join(projectDir, "b", "img2.jpg"), "image 2");

    const blocks: BlockForAssets[] = [
      {
        id: "B01",
        visualDescription: "左侧显示 ./a/img1.png，右侧显示 ./b/img2.jpg",
        sourceFilePath: join(projectDir, "intro.md"),
      },
    ];

    const result = processAssets(blocks, projectDir, buildOutDir);

    expect(Object.keys(result.assets)).toHaveLength(2);
    expect(result.assets["a/img1.png"]).toMatch(/^assets\/[a-f0-9]{8}\.png$/);
    expect(result.assets["b/img2.jpg"]).toMatch(/^assets\/[a-f0-9]{8}\.jpg$/);

    // Both paths should be replaced in description
    const desc = result.blocks[0].visualDescription;
    expect(desc).not.toContain("./a/img1.png");
    expect(desc).not.toContain("./b/img2.jpg");
  });
});