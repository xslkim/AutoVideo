import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { initCommand } from "../../src/cli/init";
import { loadPronunciationDict } from "../../src/tts/pronounce";
import * as os from "os";

describe("init command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-init-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should create project directory with all template files", async () => {
    const target = path.join(tmpDir, "my-project");
    await initCommand(target);

    // Verify all expected files exist
    expect(fs.existsSync(path.join(target, "project.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, "meta.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, "visuals.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, "narration.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, "hero.png"))).toBe(true);
    expect(fs.existsSync(path.join(target, "autovideo.config.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, "dict.md"))).toBe(true);
  });

  it("should ship a dict.md that parses to zero active rules", async () => {
    const target = path.join(tmpDir, "dict-project");
    await initCommand(target);

    // Every example is commented out, so a fresh project behaves exactly as if
    // the dictionary were absent.
    expect(loadPronunciationDict(target)).toEqual([]);
  });

  it("should create target directory if it doesn't exist", async () => {
    const target = path.join(tmpDir, "new", "nested", "project");
    await initCommand(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(path.join(target, "project.json"))).toBe(true);
  });

  it("should error if target directory exists and is non-empty", async () => {
    const target = path.join(tmpDir, "existing");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "some-file.txt"), "hello");

    await expect(initCommand(target)).rejects.toThrow(/already exists and is not empty/);
  });

  it("should succeed if target directory exists but is empty", async () => {
    const target = path.join(tmpDir, "empty-dir");
    fs.mkdirSync(target);

    await initCommand(target);
    expect(fs.existsSync(path.join(target, "project.json"))).toBe(true);
  });

  it("should have valid project.json", async () => {
    const target = path.join(tmpDir, "project");
    await initCommand(target);

    const project = JSON.parse(
      fs.readFileSync(path.join(target, "project.json"), "utf-8")
    );
    expect(project.meta).toBe("./meta.md");
    expect(project.blocks).toEqual([
      { visual: "./visuals.md", narration: "./narration.md" },
    ]);
  });

  it("should have valid meta.md with required fields", async () => {
    const target = path.join(tmpDir, "project");
    await initCommand(target);

    const meta = fs.readFileSync(path.join(target, "meta.md"), "utf-8");
    expect(meta).toContain("--- meta ---");
    expect(meta).toContain("title:");
    expect(meta).toContain("aspect:");
    expect(meta).toContain("theme:");
    expect(meta).toContain("fps:");
  });

  it("should have visuals.md and narration.md in split format", async () => {
    const target = path.join(tmpDir, "project");
    await initCommand(target);

    const visuals = fs.readFileSync(path.join(target, "visuals.md"), "utf-8");
    const narration = fs.readFileSync(path.join(target, "narration.md"), "utf-8");
    expect(visuals).toContain(">>>");
    expect(visuals).toContain("./hero.png");
    expect(visuals).not.toContain("--- visual ---");
    expect(narration).toContain(">>>");
    expect(narration).not.toContain("--- narration ---");
  });

  it("should have README.md with instructions", async () => {
    const target = path.join(tmpDir, "project");
    await initCommand(target);

    const readme = fs.readFileSync(path.join(target, "README.md"), "utf-8");
    expect(readme).toContain("B00.wav");
    expect(readme).toContain("doctor");
    expect(readme).toContain("build");
  });

  it("should have valid autovideo.config.json", async () => {
    const target = path.join(tmpDir, "project");
    await initCommand(target);

    const config = JSON.parse(
      fs.readFileSync(path.join(target, "autovideo.config.json"), "utf-8")
    );
    expect(config.voxcpm).toBeDefined();
    expect(config.anthropic).toBeDefined();
    expect(config.render).toBeDefined();
    expect(config.cache).toBeDefined();
  });

  it("should copy hero.png as a valid PNG", async () => {
    const target = path.join(tmpDir, "project");
    await initCommand(target);

    const heroPath = path.join(target, "hero.png");
    expect(fs.existsSync(heroPath)).toBe(true);

    const buf = fs.readFileSync(heroPath);
    // PNG magic bytes
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // 'P'
    expect(buf[2]).toBe(0x4e); // 'N'
    expect(buf[3]).toBe(0x47); // 'G'
  });

  it("should not overwrite files in a second init (error on non-empty)", async () => {
    const target = path.join(tmpDir, "project");
    await initCommand(target);

    // Try init again into same dir — should fail
    await expect(initCommand(target)).rejects.toThrow(/already exists and is not empty/);
  });
});