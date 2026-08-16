/**
 * AutoVideo — compile command snapshot & E2E tests
 *
 * Tests the full compile pipeline:
 *   project → meta → blocks → narration → assets → script.json
 *
 * PRD references: T1.5 acceptance criteria
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { compile, CompileError } from "../../src/cli/compile.js";

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(__dirname, "../fixtures/compile-test");
const FIXTURE_PROJECT = resolve(FIXTURES_DIR, "project.json");
const OUTPUT_BASE = resolve(__dirname, "../__compile_output__");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanupOutput() {
  if (existsSync(OUTPUT_BASE)) {
    rmSync(OUTPUT_BASE, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compile", () => {
  beforeEach(() => {
    cleanupOutput();
  });

  afterEach(() => {
    cleanupOutput();
  });

  // -------------------------------------------------------------------------
  // Snapshot test: fixture project (2 blocks + 1 image) → script.json stable
  // -------------------------------------------------------------------------

  it("should produce stable script.json snapshot for 2-block fixture with image", async () => {
    const outDir = resolve(OUTPUT_BASE, "snapshot-test");

    const result = await compile({
      projectPath: FIXTURE_PROJECT,
      outDir,
      verbose: false,
    });

    // Verify output directory was created
    expect(existsSync(result.outDir)).toBe(true);
    expect(existsSync(result.scriptPath)).toBe(true);

    // Read the generated script.json
    const scriptJson = readFileSync(result.scriptPath, "utf-8");
    const script = JSON.parse(scriptJson);

    // ---- Meta checks ----
    expect(script.meta.schemaVersion).toBe("1.0");
    expect(script.meta.title).toBe("Test Video");
    expect(script.meta.aspect).toBe("16:9");
    expect(script.meta.width).toBe(1920);
    expect(script.meta.height).toBe(1080);
    expect(script.meta.fps).toBe(30);
    expect(script.meta.theme).toBe("dark-code");
    expect(script.meta.subtitleSafeBottom).toBe(Math.floor(1080 * (50 / 1080)));

    // ---- Blocks checks ----
    expect(script.blocks).toHaveLength(2);

    // Block B01
    const b01 = script.blocks[0];
    expect(b01.id).toBe("B01");
    expect(b01.title).toBe("Introduction");
    expect(b01.enter).toBe("fade-up");
    expect(b01.exit).toBe("fade");
    expect(b01.visual.description).toContain("Hello World");
    expect(b01.narration.lines).toHaveLength(2);
    expect(b01.narration.lines[0].ttsText).toBe("这是一个测试视频的介绍");
    expect(b01.narration.lines[1].ttsText).toBe("欢迎来到 AutoVideo 的世界");
    expect(b01.narration.explicitDurationSec).toBe(8);

    // Block B02
    const b02 = script.blocks[1];
    expect(b02.id).toBe("B02");
    expect(b02.title).toBe("Architecture");
    expect(b02.enter).toBe("slide-left");
    expect(b02.exit).toBe("zoom-out");
    // The image path should have been replaced with assets/{hash}.png
    expect(b02.visual.description).toMatch(/assets\/[a-f0-9]+\.png/);
    expect(b02.visual.description).not.toContain("./assets/diagram.png");
    expect(b02.narration.lines).toHaveLength(2);

    // ---- Assets manifest ----
    // Should have one entry mapping the relative path to the hashed asset
    const assetKeys = Object.keys(script.assets);
    expect(assetKeys.length).toBe(1);
    // The key should be relative to project.json dir
    const assetKey = assetKeys[0];
    expect(assetKey).toBe("assets/diagram.png");
    // The value should be assets/{hash}.png
    expect(script.assets[assetKey]).toMatch(/^assets\/[a-f0-9]+\.png$/);

    // ---- Artifacts ----
    expect(script.artifacts.compiledAt).toBeDefined();
    expect(typeof script.artifacts.compiledAt).toBe("string");

    // ---- Snapshot: the structure (excluding timestamps) should be stable ----
    // Use a normalized version for snapshot (replace compiledAt with placeholder)
    const normalized = JSON.parse(scriptJson);
    normalized.artifacts.compiledAt = "<TIMESTAMP>";
    // The hashed asset path is deterministic based on file content
    expect(normalized).toMatchSnapshot();

    // ---- public/script.json should exist with same content ----
    const publicScriptPath = resolve(result.outDir, "public", "script.json");
    expect(existsSync(publicScriptPath)).toBe(true);
    const publicScriptJson = readFileSync(publicScriptPath, "utf-8");
    const publicScript = JSON.parse(publicScriptJson);
    // Same content (except we can't compare compiledAt directly since it's the same)
    expect(publicScript.meta).toEqual(script.meta);
    expect(publicScript.blocks).toEqual(script.blocks);
    expect(publicScript.assets).toEqual(script.assets);
  });

  // -------------------------------------------------------------------------
  // Narrative parsing: highlights
  // -------------------------------------------------------------------------

  it("should correctly parse **highlights** in narration", async () => {
    // Create a temporary project with highlights
    const tempDir = resolve(OUTPUT_BASE, "highlight-test");
    mkdirSync(tempDir, { recursive: true });

    // Copy B00.wav
    const wavSrc = readFileSync(resolve(FIXTURES_DIR, "B00.wav"));
    writeFileSync(resolve(tempDir, "B00.wav"), wavSrc);

    writeFileSync(
      resolve(tempDir, "project.json"),
      JSON.stringify({ meta: "./meta.md", blocks: ["./content.md"] }),
    );

    writeFileSync(
      resolve(tempDir, "meta.md"),
      [
        "--- meta ---",
        "title: Highlight Test",
        "aspect: 16:9",
        "---",
      ].join("\n"),
    );

    writeFileSync(
      resolve(tempDir, "content.md"),
      [
        ">>> Test Block #B01",
        "",
        "--- visual ---",
        "Simple text display",
        "",
        "--- narration ---",
        "这是**重要**的概念",
        "另一个\\*\\*字面量",
      ].join("\n"),
    );

    const outDir = resolve(OUTPUT_BASE, "highlight-out");
    const result = await compile({
      projectPath: resolve(tempDir, "project.json"),
      outDir,
    });

    const script = result.script;
    expect(script.blocks).toHaveLength(1);
    const lines = script.blocks[0].narration.lines;
    expect(lines).toHaveLength(2);

    // Line 1: "这是**重要**的概念"
    expect(lines[0].text).toBe("这是**重要**的概念");
    expect(lines[0].ttsText).toBe("这是重要的概念");
    expect(lines[0].highlights).toHaveLength(1);
    expect(lines[0].highlights[0]).toEqual({ start: 2, end: 4 });

    // Line 2: "另一个\*\*字面量"
    expect(lines[1].text).toBe("另一个\\*\\*字面量");
    expect(lines[1].ttsText).toBe("另一个**字面量");
    expect(lines[1].highlights).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Dry-run mode
  // -------------------------------------------------------------------------

  it("should not write files in dry-run mode", async () => {
    const outDir = resolve(OUTPUT_BASE, "dryrun-test");

    const result = await compile({
      projectPath: FIXTURE_PROJECT,
      outDir,
      dryRun: true,
    });

    // Should return the paths but not create files
    expect(result.outDir).toBeDefined();
    expect(result.scriptPath).toBeDefined();
    // The output directory should NOT exist (dry-run doesn't write)
    expect(existsSync(resolve(outDir, "script.json"))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Error: missing visual section
  // -------------------------------------------------------------------------

  it("should throw CompileError when a block is missing visual section", async () => {
    const tempDir = resolve(OUTPUT_BASE, "missing-visual-test");
    mkdirSync(tempDir, { recursive: true });

    const wavSrc = readFileSync(resolve(FIXTURES_DIR, "B00.wav"));
    writeFileSync(resolve(tempDir, "B00.wav"), wavSrc);

    writeFileSync(
      resolve(tempDir, "project.json"),
      JSON.stringify({ meta: "./meta.md", blocks: ["./content.md"] }),
    );

    writeFileSync(
      resolve(tempDir, "meta.md"),
      [
        "--- meta ---",
        "title: Missing Visual Test",
        "aspect: 16:9",
        "---",
      ].join("\n"),
    );

    writeFileSync(
      resolve(tempDir, "content.md"),
      [
        ">>> Test Block #B01",
        "",
        "--- narration ---",
        "Only narration, no visual",
      ].join("\n"),
    );

    const outDir = resolve(OUTPUT_BASE, "missing-visual-out");
    await expect(
      compile({
        projectPath: resolve(tempDir, "project.json"),
        outDir,
      }),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // slug: outDir defaults to ./build/{slug(title)}/
  // -------------------------------------------------------------------------

  it("should default outDir to ./build/{slug(title)}/ when not specified", async () => {
    const result = await compile({
      projectPath: FIXTURE_PROJECT,
      // No outDir specified — should use default ./build/{slug(title)}/
    });

    // The outDir should contain the slugified title
    expect(result.outDir).toContain("test-video");
    expect(result.outDir).toMatch(/build[\/\\]test-video[\/\\]?$/);

    // Clean up the default output
    if (existsSync(result.outDir)) {
      rmSync(result.outDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // subtitleSafeBottom calculation
  // -------------------------------------------------------------------------

  it("should compute subtitleSafeBottom as floor(height * 50/1080)", async () => {
    const result = await compile({
      projectPath: FIXTURE_PROJECT,
      outDir: resolve(OUTPUT_BASE, "safe-bottom-test"),
    });

    // 16:9 → 1920×1080, subtitleSafeBottom = floor(1080 * 50/1080) = 50
    expect(result.script.meta.subtitleSafeBottom).toBe(50);
  });

  // -------------------------------------------------------------------------
  // E2E: microgpt-compatible fixture
  // -------------------------------------------------------------------------

  it("should compile a microgpt-compatible fixture into valid script.json", async () => {
    // Create a fixture modeled on script-microgpt-part1-1.md
    const tempDir = resolve(OUTPUT_BASE, "microgpt-e2e");
    mkdirSync(tempDir, { recursive: true });

    const wavSrc = readFileSync(resolve(FIXTURES_DIR, "B00.wav"));
    writeFileSync(resolve(tempDir, "B00.wav"), wavSrc);

    writeFileSync(
      resolve(tempDir, "project.json"),
      JSON.stringify({
        meta: "./meta.md",
        blocks: ["./intro.md", "./part1.md"],
      }),
    );

    writeFileSync(
      resolve(tempDir, "meta.md"),
      [
        "--- meta ---",
        "title: 200 行手撕 GPT",
        "aspect: 16:9",
        "theme: dark-code",
        "fps: 30",
        "---",
      ].join("\n"),
    );

    writeFileSync(
      resolve(tempDir, "intro.md"),
      [
        ">>> GPT 是什么 #B01",
        "@enter: fade-up",
        "@duration: 8s",
        "",
        "--- visual ---",
        '屏幕中央显示大标题 "GPT = 下一个词预测器"，白色大字，渐显',
        "",
        "--- narration ---",
        "GPT 本质上就是一个下一个词预测器",
        "给它一串文字，它告诉你下一个最可能的词",
      ].join("\n"),
    );

    writeFileSync(
      resolve(tempDir, "part1.md"),
      [
        ">>> 下一个词预测器 #B02",
        "@enter: fade-up",
        "",
        "--- visual ---",
        '0s: 屏幕中央显示大标题 "GPT = ?"，带脉冲动画',
        '3s: 标题变为 "GPT = 下一个词预测器"',
        "6s: 左侧文本框显示 \"今天天气真\"，右侧概率条形图",
        '8s: "好" 弹出飞入文本末尾变成 "今天天气真好"',
        "",
        "--- narration ---",
        "我们有 \"今天天气真\" 这几个字的输入",
        "然后我们要预测下一个字",
        "按概率选最高的字拼上去",
      ].join("\n"),
    );

    const outDir = resolve(OUTPUT_BASE, "microgpt-out");
    const result = await compile({
      projectPath: resolve(tempDir, "project.json"),
      outDir,
    });

    const script = result.script;

    // Meta
    expect(script.meta.title).toBe("200 行手撕 GPT");
    expect(script.meta.schemaVersion).toBe("1.0");
    expect(script.meta.aspect).toBe("16:9");
    expect(script.meta.width).toBe(1920);
    expect(script.meta.height).toBe(1080);
    expect(script.meta.fps).toBe(30);
    expect(script.meta.theme).toBe("dark-code");
    expect(script.meta.subtitleSafeBottom).toBe(50);

    // Blocks
    expect(script.blocks).toHaveLength(2);

    expect(script.blocks[0].id).toBe("B01");
    expect(script.blocks[0].title).toBe("GPT 是什么");
    expect(script.blocks[0].enter).toBe("fade-up");
    expect(script.blocks[0].exit).toBe("fade");
    expect(script.blocks[0].narration.explicitDurationSec).toBe(8);

    expect(script.blocks[1].id).toBe("B02");
    expect(script.blocks[1].title).toBe("下一个词预测器");
    expect(script.blocks[1].narration.lines).toHaveLength(3);

    // Script file is valid JSON
    const scriptJson = readFileSync(result.scriptPath, "utf-8");
    const parsed = JSON.parse(scriptJson);
    expect(parsed.meta.title).toBe("200 行手撕 GPT");

    // public/script.json exists
    expect(existsSync(resolve(result.outDir, "public", "script.json"))).toBe(true);

    // artifacts
    expect(parsed.artifacts.compiledAt).toBeDefined();
  });
});