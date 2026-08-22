/**
 * AutoVideo — Audio helpers for TTS stage
 *
 * Functions for:
 * - Getting WAV duration via ffprobe
 * - Measuring per-line mean volume (ffmpeg volumedetect)
 * - Concatenating WAV files with inter-line silence gaps, fading each seam
 *   and aligning per-line loudness to the block median (static gain)
 * - Generating silence WAV files
 */

import { execFileSync, spawnSync } from "node:child_process";

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
 * mean_volume (RMS, dBFS) of a WAV via one ffmpeg volumedetect pass.
 * Returns null when the level cannot be parsed.
 */
export function measureMeanVolumeDb(wavPath: string): number | null {
  const res = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", wavPath, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf-8", timeout: 30_000 }
  );
  const m = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(res.stderr ?? "");
  if (!m) return null;
  const db = parseFloat(m[1]);
  return Number.isFinite(db) ? db : null;
}

/**
 * mean_volume at or below this is treated as silence: excluded from the
 * loudness target and left ungained (boosting digital silence only raises
 * the noise floor).
 */
const SILENCE_MEAN_DB = -80;

/**
 * Per-line alignment gain is clamped to ±4 dB — a genuine outlier (whispered
 * or shouted line) should keep its character, not be cranked to the median.
 */
const MAX_LINE_GAIN_DB = 4;

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

  // Align per-line loudness to the block median. The engine's output level
  // drifts from line to line; a static per-line gain toward the median RMS
  // fixes that without dynaudnorm's time-varying window, which is unstable
  // on lines this short and audibly pumps. One volumedetect pass per line.
  const meanVolumesDb = lineWavPaths.map(measureMeanVolumeDb);
  const voicedDb = meanVolumesDb
    .filter((v): v is number => v !== null && v > SILENCE_MEAN_DB)
    .sort((a, b) => a - b);
  const targetDb = voicedDb.length > 0 ? voicedDb[Math.floor(voicedDb.length / 2)] : null;

  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];

  for (let i = 0; i < lineWavPaths.length; i++) {
    inputs.push("-i", lineWavPaths[i]);

    const duration = getWavDurationSec(lineWavPaths[i]);
    // Never fade more than a quarter of a very short line.
    const fade = Math.max(0, Math.min(fadeSec, duration / 4));

    const chain = ["aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono"];

    const meanDb = meanVolumesDb[i];
    if (targetDb !== null && meanDb !== null && meanDb > SILENCE_MEAN_DB) {
      const gainDb = Math.max(-MAX_LINE_GAIN_DB, Math.min(MAX_LINE_GAIN_DB, targetDb - meanDb));
      if (Math.abs(gainDb) >= 0.05) chain.push(`volume=${ff(gainDb)}dB`);
    }

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