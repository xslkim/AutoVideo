/**
 * sync-runtime tests — Remotion runtime copy into the build dir (idempotent,
 * library included) + deterministic computeLibraryHash.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  syncRemotionRuntime,
  computeLibraryHash,
  NO_LIBRARY_HASH,
} from "../../src/render/sync-runtime.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUNTIME_FILES = [
  "remotion/VideoComposition.tsx",
  "remotion/engine/block-frame.tsx",
  "remotion/engine/theme.ts",
  "remotion/engine/types.ts",
  "remotion/components/SubtitleOverlay.tsx",
];

let tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Fixture repo root with sentinel runtime files and a component library. */
function makeFixtureRepo(opts: { withLibrary?: boolean } = {}): string {
  const { withLibrary = true } = opts;
  const repo = makeTempDir("autovideo-sync-repo-");
  const files: Record<string, string> = {
    "remotion/VideoComposition.tsx": "// VideoComposition fixture\n",
    "remotion/engine/block-frame.tsx": "// block-frame fixture\n",
    "remotion/engine/theme.ts": "// theme fixture\n",
    "remotion/engine/types.ts": "// types fixture\n",
    "remotion/components/SubtitleOverlay.tsx": "// SubtitleOverlay fixture\n",
  };
  if (withLibrary) {
    files["remotion/library/tokens.ts"] = "export const tokens = 1;\n";
    files["remotion/library/components/KeyPoints.tsx"] =
      "export const KeyPoints = () => null;\n";
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return repo;
}

/** Write a component library directly into a build dir. */
function writeLibrary(buildDir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(buildDir, "remotion", "library", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** Snapshot every file under dir as { relativePath: content }. */
function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (cur: string) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out[path.relative(dir, abs)] = fs.readFileSync(abs, "utf-8");
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncRemotionRuntime", () => {
  beforeEach(() => {
    // Keep test output clean; the skip-log test re-inspects the spy.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it("copies the real repo runtime files into the build dir (default repoRoot)", () => {
    const buildDir = makeTempDir("autovideo-sync-build-");
    const repoRoot = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../..",
    );

    syncRemotionRuntime(buildDir);

    for (const rel of RUNTIME_FILES) {
      const dest = path.join(buildDir, rel);
      expect(fs.existsSync(dest), rel).toBe(true);
      expect(fs.readFileSync(dest, "utf-8"), rel).toBe(
        fs.readFileSync(path.join(repoRoot, rel), "utf-8"),
      );
    }
  });

  it("copies the component library recursively and completely", () => {
    const repo = makeFixtureRepo();
    const buildDir = makeTempDir("autovideo-sync-build-");

    syncRemotionRuntime(buildDir, { repoRoot: repo });

    for (const rel of [
      ...RUNTIME_FILES,
      "remotion/library/tokens.ts",
      "remotion/library/components/KeyPoints.tsx",
    ]) {
      const dest = path.join(buildDir, rel);
      expect(fs.existsSync(dest), rel).toBe(true);
      expect(fs.readFileSync(dest, "utf-8"), rel).toBe(
        fs.readFileSync(path.join(repo, rel), "utf-8"),
      );
    }
  });

  it("is idempotent — a second call leaves the tree identical", () => {
    const repo = makeFixtureRepo();
    const buildDir = makeTempDir("autovideo-sync-build-");

    syncRemotionRuntime(buildDir, { repoRoot: repo });
    const first = snapshotTree(buildDir);
    syncRemotionRuntime(buildDir, { repoRoot: repo });
    const second = snapshotTree(buildDir);

    expect(second).toEqual(first);
  });

  it("skips a missing remotion/library without throwing and logs the skip", () => {
    const repo = makeFixtureRepo({ withLibrary: false });
    const buildDir = makeTempDir("autovideo-sync-build-");

    expect(() =>
      syncRemotionRuntime(buildDir, { repoRoot: repo }),
    ).not.toThrow();

    // Engine files are still copied.
    for (const rel of RUNTIME_FILES) {
      expect(fs.existsSync(path.join(buildDir, rel)), rel).toBe(true);
    }
    expect(fs.existsSync(path.join(buildDir, "remotion", "library"))).toBe(false);

    const logged = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(logged).toContain("remotion/library");
  });
});

describe("computeLibraryHash", () => {
  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it("returns the fixed constant when the library is missing", () => {
    const buildDir = makeTempDir("autovideo-hash-build-");
    expect(computeLibraryHash(buildDir)).toBe(NO_LIBRARY_HASH);
  });

  it("is deterministic — identical library contents give identical hashes", () => {
    const files = {
      "tokens.ts": "export const tokens = 1;\n",
      "components/KeyPoints.tsx": "export const KeyPoints = () => null;\n",
    };
    const buildA = makeTempDir("autovideo-hash-a-");
    const buildB = makeTempDir("autovideo-hash-b-");
    writeLibrary(buildA, files);
    writeLibrary(buildB, files);

    const hashA = computeLibraryHash(buildA);
    expect(hashA).toMatch(/^[0-9a-f]{32}$/);
    expect(computeLibraryHash(buildB)).toBe(hashA);
    // Stable across repeated calls on the same dir.
    expect(computeLibraryHash(buildA)).toBe(hashA);
  });

  it("changes when any library file content changes", () => {
    const buildDir = makeTempDir("autovideo-hash-build-");
    writeLibrary(buildDir, { "tokens.ts": "export const tokens = 1;\n" });
    const before = computeLibraryHash(buildDir);

    writeLibrary(buildDir, { "tokens.ts": "export const tokens = 2;\n" });
    expect(computeLibraryHash(buildDir)).not.toBe(before);
  });

  it("changes when a library file is added", () => {
    const buildDir = makeTempDir("autovideo-hash-build-");
    writeLibrary(buildDir, { "tokens.ts": "export const tokens = 1;\n" });
    const before = computeLibraryHash(buildDir);

    writeLibrary(buildDir, { "motion.ts": "export const motion = 1;\n" });
    expect(computeLibraryHash(buildDir)).not.toBe(before);
  });
});
