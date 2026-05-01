/**
 * AutoVideo — Audio helpers for TTS stage
 *
 * Functions for:
 * - Getting WAV duration via ffprobe
 * - Concatenating WAV files with inter-line silence gaps
 * - Generating silence WAV files
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Get the duration of a WAV file in seconds using ffprobe.
 */
export function getWavDurationSec(wavPath: string): number {
  const result = execFileSync(
    "ffprobe",
    [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-i", wavPath,
    ],
    { encoding: "utf-8", timeout: 10_000 }
  );

  const info = JSON.parse(result);
  const duration = parseFloat(info?.format?.duration);
  if (isNaN(duration) || duration <= 0) {
    throw new Error(`Could not determine duration of ${wavPath}`);
  }
  return duration;
}

/**
 * Write a silent WAV file of the given duration.
 * Format: 48kHz, mono, 16-bit PCM (matching VoxCPM output).
 */
export function generateSilenceWav(
  durationSec: number,
  outputPath: string
): void {
  execFileSync(
    "ffmpeg",
    [
      "-f", "lavfi",
      "-i", `anullsrc=r=48000:cl=mono`,
      "-t", String(durationSec),
      "-acodec", "pcm_s16le",
      "-y",
      outputPath,
    ],
    { encoding: "utf-8", timeout: 10_000 }
  );
}

/**
 * Concatenate an array of WAV buffers into a single WAV file.
 * Each WAV is followed by 200ms of silence (except the last one).
 *
 * This uses ffmpeg concat demuxer for reliable concatenation.
 *
 * @param lineWavPaths - Array of absolute paths to line WAV files
 * @param outputPath - Where to write the concatenated output
 * @param gapSec - Silence gap between lines in seconds (default 0.2)
 * @returns Duration of the output WAV in seconds
 */
export function concatenateWavsWithGaps(
  lineWavPaths: string[],
  outputPath: string,
  gapSec = 0.2
): number {
  if (lineWavPaths.length === 0) {
    throw new Error("No WAV files to concatenate");
  }

  const outDir = dirname(outputPath);

  // Generate a silence file for gaps
  const silencePath = resolve(outDir, ".silence_gap.wav");
  generateSilenceWav(gapSec, silencePath);

  try {
    // Build concat list: line1 + silence + line2 + silence + ... + lineN
    const concatParts: string[] = [];
    for (let i = 0; i < lineWavPaths.length; i++) {
      concatParts.push(`file '${lineWavPaths[i]}'`);
      if (i < lineWavPaths.length - 1) {
        concatParts.push(`file '${silencePath}'`);
      }
    }

    const concatListPath = resolve(outDir, ".concat_list.txt");
    writeFileSync(concatListPath, concatParts.join("\n") + "\n", "utf-8");

    try {
      execFileSync(
        "ffmpeg",
        [
          "-f", "concat",
          "-safe", "0",
          "-i", concatListPath,
          "-acodec", "pcm_s16le",
          "-ar", "48000",
          "-ac", "1",
          "-y",
          outputPath,
        ],
        { encoding: "utf-8", timeout: 60_000 }
      );
    } finally {
      // Clean up concat list
      try { unlinkSync(concatListPath); } catch { /* ignore */ }
    }
  } finally {
    // Clean up silence file
    try { unlinkSync(silencePath); } catch { /* ignore */ }
  }

  return getWavDurationSec(outputPath);
}