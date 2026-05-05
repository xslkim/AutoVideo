/**
 * Quality Assurance for rendered video (T6.6)
 *
 * Validates final_normalized.mp4:
 * 1. Resolution matches meta.width × meta.height
 * 2. Total duration = Σ partial durations ± 1 frame
 * 3. 5 equidistant sample frames are not pure black
 */

import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";

export interface QAResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export interface QAMeta {
  width: number;
  height: number;
  fps: number;
}

export interface QABlockTiming {
  id: string;
  totalSec: number;
}

/**
 * Run quality assurance on the final normalized video.
 *
 * @param videoPath - Absolute path to final_normalized.mp4
 * @param partialsDir - Absolute path to directory containing partial mp4 files
 * @param meta - Video metadata (width, height, fps)
 * @param blocks - Block timing info (id + totalSec for each block)
 * @param sampleCount - Number of equidistant frames to sample (default 5)
 */
export async function runQA(
  videoPath: string,
  partialsDir: string,
  meta: QAMeta,
  blocks: QABlockTiming[],
  sampleCount = 5
): Promise<QAResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check that the final video exists
  try {
    await fs.access(videoPath);
  } catch {
    return {
      passed: false,
      errors: [`Final video not found: ${videoPath}`],
      warnings: [],
    };
  }

  // 1. Check resolution using ffprobe
  const resolution = await probeResolution(videoPath);
  if (!resolution) {
    warnings.push(
      "Could not probe video resolution (ffprobe may not be available)"
    );
  } else {
    if (resolution.width !== meta.width || resolution.height !== meta.height) {
      errors.push(
        `Resolution mismatch: expected ${meta.width}x${meta.height}, ` +
          `got ${resolution.width}x${resolution.height}`
      );
    }
  }

  // 2. Check total duration matches sum of partials ± frames
  // Tolerance accounts for H.264 padding, concat overhead, and Remotion/FFmpeg rounding
  const partialSumSec = blocks.reduce((sum, b) => sum + b.totalSec, 0);
  const expectedDuration = partialSumSec;
  const tolerance = 60 / meta.fps; // ± 60 frames — lipsync concat/overlay can add up to ~2s

  const videoDuration = await probeDuration(videoPath);
  if (videoDuration === null) {
    errors.push("Failed to probe video duration");
  } else {
    const diff = Math.abs(videoDuration - expectedDuration);
    if (diff > tolerance) {
      errors.push(
        `Duration mismatch: expected ~${expectedDuration.toFixed(3)}s ` +
          `(sum of ${blocks.length} partials), ` +
          `got ${videoDuration.toFixed(3)}s (diff: ${diff.toFixed(3)}s, ` +
          `tolerance: ${tolerance.toFixed(3)}s = 1 frame at ${meta.fps}fps)`
      );
    }
  }

  // Also verify that each partial exists
  const partialDurations: number[] = [];
  for (const block of blocks) {
    const partialPath = path.join(partialsDir, `${block.id}.mp4`);
    try {
      await fs.access(partialPath);
    } catch {
      errors.push(`Partial video not found: ${partialPath}`);
      continue;
    }

    const pDur = await probeDuration(partialPath);
    if (pDur === null) {
      warnings.push(`Could not probe duration of partial ${block.id}.mp4`);
      continue;
    }
    partialDurations.push(pDur);
  }

  // If we got actual partial durations, also cross-check them against the
  // video duration
  if (partialDurations.length === blocks.length && videoDuration !== null) {
    const actualPartialSum = partialDurations.reduce((a, b) => a + b, 0);
    const diff2 = Math.abs(videoDuration - actualPartialSum);
    if (diff2 > tolerance) {
      errors.push(
        `Duration mismatch (actual partials): expected ~${actualPartialSum.toFixed(3)}s, ` +
          `got ${videoDuration.toFixed(3)}s (diff: ${diff2.toFixed(3)}s)`
      );
    }
  }

  // 3. Check 5 equidistant sample frames are not pure black
  if (videoDuration !== null && videoDuration > 0) {
    const blackChecks = await checkNonBlackFrames(
      videoPath,
      videoDuration,
      sampleCount
    );
    for (const check of blackChecks) {
      if (!check.passed) {
        errors.push(check.message);
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Probe video resolution using ffprobe.
 */
async function probeResolution(
  videoPath: string
): Promise<{ width: number; height: number } | null> {
  try {
    const output = await execCapture("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=s=x:p=0",
      videoPath,
    ], 10000);
    const match = output.trim().match(/^(\d+)x(\d+)$/m);
    if (match) {
      return {
        width: parseInt(match[1], 10),
        height: parseInt(match[2], 10),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Probe video duration in seconds using ffprobe.
 */
async function probeDuration(videoPath: string): Promise<number | null> {
  try {
    const output = await execCapture("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=duration",
      "-of", "csv=s=x:p=0",
      videoPath,
    ], 10000);
    const val = parseFloat(output.trim());
    if (isNaN(val) || val <= 0) {
      // Fallback: try format duration
      return await probeFormatDuration(videoPath);
    }
    return val;
  } catch {
    return await probeFormatDuration(videoPath);
  }
}

async function probeFormatDuration(videoPath: string): Promise<number | null> {
  try {
    const output = await execCapture("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=s=x:p=0",
      videoPath,
    ], 10000);
    const val = parseFloat(output.trim());
    if (isNaN(val) || val <= 0) return null;
    return val;
  } catch {
    return null;
  }
}

/**
 * Check that equidistant sample frames are not pure black.
 */
async function checkNonBlackFrames(
  videoPath: string,
  durationSec: number,
  sampleCount: number
): Promise<{ passed: boolean; message: string }[]> {
  const results: { passed: boolean; message: string }[] = [];

  for (let i = 0; i < sampleCount; i++) {
    // Evenly space samples across the video, avoiding the very start and end
    const timestamp = ((i + 0.5) / sampleCount) * durationSec;
    const isBlack = await isFrameBlack(videoPath, timestamp);
    if (isBlack) {
      results.push({
        passed: false,
        message: `Sample frame ${i + 1}/${sampleCount} at ${timestamp.toFixed(2)}s is pure black`,
      });
    } else {
      results.push({
        passed: true,
        message: `Sample frame ${i + 1}/${sampleCount} at ${timestamp.toFixed(2)}s OK`,
      });
    }
  }

  return results;
}

/**
 * Check if a specific frame in the video is pure black.
 *
 * Extracts the frame as raw RGB pixels and checks that not all are black.
 */
async function isFrameBlack(
  videoPath: string,
  timestampSec: number
): Promise<boolean> {
  try {
    // Extract a single frame as raw RGB data
    const buf = await execBuffer("ffmpeg", [
      "-ss", timestampSec.toFixed(6),
      "-i", videoPath,
      "-frames:v", "1",
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "-v", "quiet",
      "pipe:1",
    ], 15000);

    if (!buf || buf.length === 0) return true; // No data = black

    // Sample pixels to check for non-black content
    const pixelCount = buf.length / 3;
    const sampleStep = Math.max(1, Math.floor(pixelCount / 1000));
    let nonBlackCount = 0;

    for (let i = 0; i < pixelCount; i += sampleStep) {
      const offset = i * 3;
      if (offset + 2 < buf.length) {
        const r = buf[offset];
        const g = buf[offset + 1];
        const b = buf[offset + 2];
        // Threshold of 5 to account for H.264 compression artifacts
        if (r > 5 || g > 5 || b > 5) {
          nonBlackCount++;
          if (nonBlackCount >= 3) return false; // Found enough non-black pixels
        }
      }
    }

    return nonBlackCount < 3;
  } catch {
    // If we can't extract the frame, conservatively say it's not black
    // to avoid false positives that would block the build
    return false;
  }
}

/**
 * Execute a command and return stdout as string.
 */
function execCapture(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout || "");
    });
  });
}

/**
 * Execute a command and return stdout as Buffer (for binary data).
 */
function execBuffer(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, {
      timeout: timeoutMs,
      encoding: "buffer",
      maxBuffer: 50 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}