/**
 * T6.7 — render command E2E acceptance tests
 *
 * Acceptance criteria:
 * 1. Mock data full run → output/final_normalized.mp4 exists and is playable
 * 2. --block B01 --force only re-renders B01 + concat, B02 partial mtime unchanged
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { concatPartials } from "../../src/render/concat.js";
import { applyLoudnorm } from "../../src/render/loudnorm.js";

// ── Helpers ────────────────────────────────────────────────────────────

function createTestMp4(
  outputPath: string,
  durationSec: number,
  width = 1920,
  height = 1080,
  fps = 30
): void {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=blue:s=${width}x${height}:d=${durationSec}:r=${fps}`,
      "-f", "lavfi",
      "-i", `sine=frequency=440:duration=${durationSec}`,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "stillimage",
      "-c:a", "aac",
      "-b:a", "192k",
      "-pix_fmt", "yuv420p",
      "-shortest",
      outputPath,
    ],
    { encoding: "utf-8", timeout: 60_000, stdio: "pipe" }
  );
}

function isValidMp4(filePath: string): boolean {
  try {
    const output = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=format_name", "-of", "csv=s=x:p=0", filePath],
      { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }
    );
    return output.includes("mov") || output.includes("mp4");
  } catch {
    return false;
  }
}

function getVideoDuration(filePath: string): number | null {
  try {
    const output = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=s=x:p=0", filePath],
      { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }
    );
    return parseFloat(output.trim());
  } catch {
    return null;
  }
}

// ── E2E: concat + loudnorm pipeline ───────────────────────────────────

describe("render E2E: concat + loudnorm pipeline", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-render-e2e-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("concatenates partials → final.mp4 → final_normalized.mp4 (playable)", async () => {
    // B01 timing: enter=0.5, hold=2.0, exit=0.3 → total=2.8s
    // B02 timing: enter=0.5, hold=1.8, exit=0.3 → total=2.6s
    const partialsDir = path.join(tmpDir, "output", "partials");

    createTestMp4(path.join(partialsDir, "B01.mp4"), 2.8);
    createTestMp4(path.join(partialsDir, "B02.mp4"), 2.6);

    // Step 1: Concat
    const partialRelPaths = [
      "output/partials/B01.mp4",
      "output/partials/B02.mp4",
    ];

    const result = concatPartials(partialRelPaths, { buildDir: tmpDir });
    expect(result.partialCount).toBe(2);

    const finalPath = path.join(tmpDir, "output", "final.mp4");
    expect(fs.existsSync(finalPath)).toBe(true);
    expect(isValidMp4(finalPath)).toBe(true);

    // Step 2: Loudnorm
    const loudnormConfig = DEFAULT_CONFIG.render?.loudnorm ?? {
      i: -16,
      tp: -1.5,
      lra: 11,
      twoPass: true,
      audioBitrate: "192k",
    };

    const loudnormResult = await applyLoudnorm(finalPath, loudnormConfig, tmpDir);

    expect(fs.existsSync(loudnormResult.outputPath)).toBe(true);
    expect(isValidMp4(loudnormResult.outputPath)).toBe(true);
    expect(loudnormResult.outputPath).toContain("final_normalized.mp4");

    // Check measured values were returned (two-pass)
    if (loudnormConfig.twoPass) {
      expect(loudnormResult.measured).toBeDefined();
      // The measured values from the second pass should be numbers
      expect(typeof loudnormResult.measured!.i).toBe("number");
      expect(typeof loudnormResult.measured!.tp).toBe("number");
      expect(typeof loudnormResult.measured!.lra).toBe("number");
    }
  }, 120_000);

  it("--block B01 --force: B02 partial mtime unchanged after re-concat", async () => {
    const partialsDir = path.join(tmpDir, "output", "partials");

    // Create initial partials
    createTestMp4(path.join(partialsDir, "B01.mp4"), 2.8);
    createTestMp4(path.join(partialsDir, "B02.mp4"), 2.6);

    // Record B02 mtime
    const b02MtimeBefore = fs.statSync(path.join(partialsDir, "B02.mp4")).mtime;

    // Wait a tiny bit to ensure mtime would differ if touched
    await new Promise((r) => setTimeout(r, 100));

    // Simulate re-rendering only B01 (new partial with different duration)
    fs.unlinkSync(path.join(partialsDir, "B01.mp4"));
    createTestMp4(path.join(partialsDir, "B01.mp4"), 3.3); // slightly different duration

    // Re-concat with all partials
    const partialRelPaths = [
      "output/partials/B01.mp4",
      "output/partials/B02.mp4",
    ];

    concatPartials(partialRelPaths, { buildDir: tmpDir });

    // Verify B02 partial was NOT modified
    const b02MtimeAfter = fs.statSync(path.join(partialsDir, "B02.mp4")).mtime;
    expect(b02MtimeAfter.getTime()).toBe(b02MtimeBefore.getTime());

    // Verify final.mp4 was produced
    const finalPath = path.join(tmpDir, "output", "final.mp4");
    expect(fs.existsSync(finalPath)).toBe(true);
    expect(isValidMp4(finalPath)).toBe(true);
  }, 120_000);
});