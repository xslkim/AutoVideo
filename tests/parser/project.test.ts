/**
 * T1.1 Acceptance tests — project.json reader
 *
 * Covers:
 * - Valid project.json reads and resolves paths
 * - Missing project.json file → error
 * - Invalid JSON → error
 * - Missing `meta` field → error
 * - Missing `blocks` field → error
 * - Empty `blocks` array → error
 * - Non-string block entry → error
 * - Referenced meta file doesn't exist → error
 * - Referenced block file doesn't exist → error
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readProject, ProjectError } from "../../src/parser/project.js";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

describe("readProject", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-project-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads valid project.json and resolves all paths to absolute", () => {
    // Create meta.md
    writeFileSync(join(tmpDir, "meta.md"), "--- meta ---\ntitle: Test\n---");

    // Create block files
    writeFileSync(join(tmpDir, "intro.md"), "# Intro");
    writeFileSync(join(tmpDir, "part1.md"), "# Part 1");

    // Create project.json
    writeFileSync(
      join(tmpDir, "project.json"),
      JSON.stringify({
        meta: "./meta.md",
        blocks: ["./intro.md", "./part1.md"],
      }),
    );

    const result = readProject(join(tmpDir, "project.json"));

    expect(result.projectPath).toBe(join(tmpDir, "project.json"));
    expect(result.projectDir).toBe(tmpDir);
    expect(result.metaPath).toBe(join(tmpDir, "meta.md"));
    expect(result.blockPaths).toEqual([
      join(tmpDir, "intro.md"),
      join(tmpDir, "part1.md"),
    ]);

    // All paths should be absolute
    expect(result.metaPath.startsWith("/")).toBe(true);
    for (const bp of result.blockPaths) {
      expect(bp.startsWith("/")).toBe(true);
    }
  });

  it("resolves paths from subdirectory project.json", () => {
    const subDir = join(tmpDir, "sub");
    mkdirSync(subDir, { recursive: true });

    writeFileSync(join(subDir, "meta.md"), "--- meta ---\ntitle: Test\n---");
    writeFileSync(join(subDir, "block.md"), "# Block");
    writeFileSync(
      join(subDir, "project.json"),
      JSON.stringify({
        meta: "./meta.md",
        blocks: ["./block.md"],
      }),
    );

    const result = readProject(join(subDir, "project.json"));
    expect(result.metaPath).toBe(join(subDir, "meta.md"));
    expect(result.blockPaths).toEqual([join(subDir, "block.md")]);
  });

  // --- Error cases ---

  it("throws on missing project.json file", () => {
    expect(() => readProject("/nonexistent/project.json")).toThrow(ProjectError);
    expect(() => readProject("/nonexistent/project.json")).toThrow(
      /Project file not found/,
    );
  });

  it("throws on invalid JSON", () => {
    writeFileSync(join(tmpDir, "project.json"), "not json {{{");

    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(ProjectError);
    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(
      /Failed to read project.json/,
    );
  });

  it("throws on missing meta field", () => {
    writeFileSync(
      join(tmpDir, "project.json"),
      JSON.stringify({ blocks: ["./intro.md"] }),
    );

    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(ProjectError);
    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(
      /missing required string field "meta"/,
    );
  });

  it("throws on empty meta field", () => {
    writeFileSync(
      join(tmpDir, "project.json"),
      JSON.stringify({ meta: "  ", blocks: ["./intro.md"] }),
    );

    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(ProjectError);
    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(
      /missing required string field "meta"/,
    );
  });

  it("throws on missing blocks field", () => {
    writeFileSync(
      join(tmpDir, "project.json"),
      JSON.stringify({ meta: "./meta.md" }),
    );
    writeFileSync(join(tmpDir, "meta.md"), "--- meta ---\ntitle: Test\n---");

    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(ProjectError);
    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(
      /missing required array field "blocks"/,
    );
  });

  it("throws on empty blocks array", () => {
    writeFileSync(
      join(tmpDir, "project.json"),
      JSON.stringify({ meta: "./meta.md", blocks: [] }),
    );
    writeFileSync(join(tmpDir, "meta.md"), "--- meta ---\ntitle: Test\n---");

    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(ProjectError);
    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(
      /must be a non-empty array/,
    );
  });

  it("throws on non-string block entry", () => {
    writeFileSync(
      join(tmpDir, "project.json"),
      JSON.stringify({ meta: "./meta.md", blocks: [123] }),
    );
    writeFileSync(join(tmpDir, "meta.md"), "--- meta ---\ntitle: Test\n---");

    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(ProjectError);
    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(
      /blocks\[0\].*must be a non-empty string/,
    );
  });

  it("throws when meta file doesn't exist", () => {
    writeFileSync(
      join(tmpDir, "project.json"),
      JSON.stringify({ meta: "./nonexistent.md", blocks: ["./intro.md"] }),
    );
    writeFileSync(join(tmpDir, "intro.md"), "# Intro");

    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(ProjectError);
    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(
      /Meta file not found/,
    );
  });

  it("throws when block file doesn't exist", () => {
    writeFileSync(join(tmpDir, "meta.md"), "--- meta ---\ntitle: Test\n---");
    writeFileSync(
      join(tmpDir, "project.json"),
      JSON.stringify({
        meta: "./meta.md",
        blocks: ["./nonexistent.md"],
      }),
    );

    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(ProjectError);
    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(
      /Block file not found/,
    );
  });

  it("throws when project.json is an array", () => {
    writeFileSync(join(tmpDir, "project.json"), "[1, 2, 3]");

    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(ProjectError);
    expect(() => readProject(join(tmpDir, "project.json"))).toThrow(
      /must be a JSON object/,
    );
  });
});
