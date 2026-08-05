/**
 * AutoVideo — Audio helpers for TTS stage
 *
 * Functions for:
 * - Getting WAV duration via ffprobe
 * - Concatenating WAV files with inter-line silence gaps
 * - Generating silence WAV files
 */

import { execFileSync } from "node:child_process";

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
 * Fade applied at both ends of every line before stitching.
 *
 * Synthesized lines rarely start or end exactly at zero amplitude, and a hard
 * splice on a non-zero sample is an audible click on every line boundary.
 * Twelve milliseconds is short enough to be inaudible as a fade and long
 * enough to kill the discontinuity.
 */
const SEAM_FADE_SEC = 0.012;

export interface ConcatOptions {
  /**
   * Silence after each line, in seconds. Index i is the gap following line i;
   * the entry for the last line is ignored. Falls back to `gapSec`.
   */
  gapsSec?: number[];
  /** Uniform gap used when `gapsSec` is absent. */
  gapSec?: number;
  /** Boundary fade length in seconds; 0 disables it. */
  fadeSec?: number;
}

/** Format a number for an ffmpeg filter argument (no exponent notation). */
function ff(n: number): string {
  return n.toFixed(4);
}

/**
 * Concatenate line WAVs into a single block WAV, inserting silence between
 * lines and fading each seam.
 *
 * Gaps must match whatever was handed to `computeLineTimings`, or the
 * subtitles drift away from the voice.
 *
 * @returns Duration of the output WAV in seconds
 */
export function concatenateWavsWithGaps(
  lineWavPaths: string[],
  outputPath: string,
  options: ConcatOptions = {}
): number {
  if (lineWavPaths.length === 0) {
    throw new Error("No WAV files to concatenate");
  }

  const { gapsSec, gapSec = 0.2, fadeSec = SEAM_FADE_SEC } = options;
  const last = lineWavPaths.length - 1;

  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];

  for (let i = 0; i < lineWavPaths.length; i++) {
    inputs.push("-i", lineWavPaths[i]);

    const duration = getWavDurationSec(lineWavPaths[i]);
    // Never fade more than a quarter of a very short line.
    const fade = Math.max(0, Math.min(fadeSec, duration / 4));

    const chain = ["aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono"];
    if (fade > 0) {
      chain.push(`afade=t=in:st=0:d=${ff(fade)}`);
      chain.push(`afade=t=out:st=${ff(Math.max(0, duration - fade))}:d=${ff(fade)}`);
    }

    const gap = i === last ? 0 : (gapsSec?.[i] ?? gapSec);
    if (gap > 0) chain.push(`apad=pad_dur=${ff(gap)}`);

    filters.push(`[${i}:a]${chain.join(",")}[a${i}]`);
    labels.push(`[a${i}]`);
  }

  filters.push(`${labels.join("")}concat=n=${lineWavPaths.length}:v=0:a=1[out]`);

  execFileSync(
    "ffmpeg",
    [
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "[out]",
      "-acodec", "pcm_s16le",
      "-ar", "48000",
      "-ac", "1",
      "-y",
      outputPath,
    ],
    { encoding: "utf-8", timeout: 120_000 }
  );

  return getWavDurationSec(outputPath);
}