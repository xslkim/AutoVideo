/**
 * Tests for src/render/concat.ts — T6.4 ffmpeg concat
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { validatePartials, concatPartials } from "../../src/render/concat.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Check if ffmpeg is available */
function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

/** Generate a tiny test MP4 using ffmpeg */
function generateTestMp4(outputPath: string, width = 640, height = 360): void {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=black:s=${width}x${height}:d=0.5:r=30`,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      "-an",
      outputPath,
    ],
    { encoding: "utf-8", timeout: 30_000 }
  );
}

const ffmpegAvailable = hasFfmpeg();

// ── Tests ──────────────────────────────────────────────────────────────────

describe("validatePartials", () => {
  it("should throw on empty array", () => {
    expect(() => validatePartials([])).toThrow("No partial MP4 files");
  });

  it("should throw on non-existent file", () => {
    expect(() =>
      validatePartials(["/tmp/nonexistent_test_file.mp4"])
    ).toThrow();
  });

  it.runIf(ffmpegAvailable)(
    "should pass for consistent partials",
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
      try {
        const p1 = path.join(tmpDir, "B01.mp4");
        const p2 = path.join(tmpDir, "B02.mp4");
        generateTestMp4(p1);
        generateTestMp4(p2);

        // Should not throw
        expect(() => validatePartials([p1, p2])).not.toThrow();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it.runIf(ffmpegAvailable)(
    "should fail for inconsistent resolution",
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
      try {
        const p1 = path.join(tmpDir, "B01.mp4");
        const p2 = path.join(tmpDir, "B02.mp4");
        generateTestMp4(p1, 640, 360);
        generateTestMp4(p2, 320, 240);

        expect(() => validatePartials([p1, p2])).toThrow(/inconsistent/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
});

describe("concatPartials", () => {
  it("should throw on empty array", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
    try {
      expect(() =>
        concatPartials([], { buildDir: tmpDir })
      ).toThrow("No partial MP4 files");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it.runIf(ffmpegAvailable)(
    "should concat 2 partials into final.mp4",
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
      try {
        // Create the expected directory structure
        const partialsDir = path.join(tmpDir, "output", "partials");
        fs.mkdirSync(partialsDir, { recursive: true });

        const p1 = path.join(partialsDir, "B01.mp4");
        const p2 = path.join(partialsDir, "B02.mp4");
        generateTestMp4(p1);
        generateTestMp4(p2);

        const result = concatPartials(
          ["output/partials/B01.mp4", "output/partials/B02.mp4"],
          { buildDir: tmpDir }
        );

        expect(result.partialCount).toBe(2);
        expect(result.finalPath).toBe("output/final.mp4");

        // Verify final.mp4 exists
        const finalAbs = path.join(tmpDir, "output", "final.mp4");
        expect(fs.existsSync(finalAbs)).toBe(true);

        // Verify it's a valid MP4 (has non-zero size)
        const stat = fs.statSync(finalAbs);
        expect(stat.size).toBeGreaterThan(0);

        // Verify with ffprobe that the output is playable
        const probeResult = execFileSync(
          "ffprobe",
          ["-v", "quiet", "-print_format", "json", "-show_format", "-i", finalAbs],
          { encoding: "utf-8", timeout: 10_000 }
        );
        const info = JSON.parse(probeResult);
        const duration = parseFloat(info?.format?.duration ?? "0");
        expect(duration).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it.runIf(ffmpegAvailable)(
    "should write concat.txt correctly",
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
      try {
        const partialsDir = path.join(tmpDir, "output", "partials");
        fs.mkdirSync(partialsDir, { recursive: true });

        const p1 = path.join(partialsDir, "B01.mp4");
        const p2 = path.join(partialsDir, "B02.mp4");
        generateTestMp4(p1);
        generateTestMp4(p2);

        concatPartials(
          ["output/partials/B01.mp4", "output/partials/B02.mp4"],
          { buildDir: tmpDir }
        );

        // Check concat.txt content — paths should be relative to output/
        const concatTxt = path.join(tmpDir, "output", "concat.txt");
        expect(fs.existsSync(concatTxt)).toBe(true);
        const content = fs.readFileSync(concatTxt, "utf-8");
        expect(content).toContain("file 'partials/B01.mp4'");
        expect(content).toContain("file 'partials/B02.mp4'");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it("should throw for missing partial file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
    try {
      expect(() =>
        concatPartials(
          ["output/partials/B01.mp4", "output/partials/B99.mp4"],
          { buildDir: tmpDir }
        )
      ).toThrow(/not found/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});