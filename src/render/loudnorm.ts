/**
 * loudnorm.ts — ffmpeg loudnorm two-pass normalization
 *
 * T6.5: Applies EBU R128 loudness normalization to final.mp4
 * producing final_normalized.mp4.
 *
 * Two-pass approach (PRD §6.4 step 7):
 *   Pass 1: Analyze loudness → extract measured_I, measured_TP, measured_LRA, measured_thresh, target_offset
 *   Pass 2: Apply normalization with measured values → re-encode audio only, video stream copy
 *
 * @see PRD §6.4 step 7
 */

import { execFile } from "node:child_process";
import path from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface LoudnormConfig {
  /** Integrated loudness target (LUFS) */
  i: number;
  /** True peak ceiling (dBTP) */
  tp: number;
  /** Loudness range (LU) */
  lra: number;
  /** Use two-pass loudnorm (more accurate) */
  twoPass: boolean;
  /** Audio bitrate for second pass re-encode */
  audioBitrate: string;
}

export interface LoudnormResult {
  /** Path to the output file relative to buildDir */
  outputPath: string;
  /** Measured loudness values from first pass (only if twoPass) */
  measured?: {
    i: number;
    tp: number;
    lra: number;
    thresh: number;
    targetOffset: number;
  };
}

interface MeasuredValues {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Execute a command and return stdout + stderr.
 */
function execAsync(
  cmd: string,
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        encoding: "utf-8",
        cwd: options?.cwd,
        timeout: options?.timeout ?? 120_000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${cmd} ${args.join(" ")} failed:\n${stderr || error.message}`
            )
          );
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

/**
 * Parse measured loudnorm values from ffmpeg stderr JSON output.
 */
function parseMeasuredValues(stderr: string): MeasuredValues {
  // ffmpeg prints the loudnorm JSON to stderr, surrounded by optional text
  // The JSON block looks like:
  // {
  //   "input_i" : "-16.01",
  //   "input_tp" : "-1.42",
  //   ...
  // }
  const jsonMatch = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?"target_offset"[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error(
      `Could not parse loudnorm measured values from ffmpeg stderr.\n` +
      `stderr tail:\n${stderr.slice(-2000)}`
    );
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(
      `Failed to JSON.parse loudnorm output:\n${jsonMatch[0].slice(0, 500)}`
    );
  }

  return {
    input_i: parsed["input_i"],
    input_tp: parsed["input_tp"],
    input_lra: parsed["input_lra"],
    input_thresh: parsed["input_thresh"],
    target_offset: parsed["target_offset"],
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Apply loudness normalization to final.mp4 → final_normalized.mp4.
 *
 * @param finalPath - Absolute path to the input final.mp4
 * @param config - Loudnorm configuration
 * @param buildDir - Build output directory (cwd for relative paths)
 * @returns Result with output path and optional measured values
 */
export async function applyLoudnorm(
  finalPath: string,
  config: LoudnormConfig,
  buildDir: string
): Promise<LoudnormResult> {
  const outputFileName = "final_normalized.mp4";
  const outputPath = path.join(path.dirname(finalPath), outputFileName);

  if (config.twoPass) {
    // ── Pass 1: Analyze ──────────────────────────────────────────────────
    const pass1Filter = `loudnorm=I=${config.i}:TP=${config.tp}:LRA=${config.lra}:print_format=json`;

    const pass1 = await execAsync("ffmpeg", [
      "-y",
      "-i", finalPath,
      "-af", pass1Filter,
      "-f", "null",
      "-",
    ], { cwd: buildDir });

    const measured = parseMeasuredValues(pass1.stderr);

    // ── Pass 2: Apply with measured values ───────────────────────────────
    const pass2Filter = [
      `loudnorm=I=${config.i}:TP=${config.tp}:LRA=${config.lra}`,
      `measured_I=${measured.input_i}`,
      `measured_TP=${measured.input_tp}`,
      `measured_LRA=${measured.input_lra}`,
      `measured_thresh=${measured.input_thresh}`,
      `offset=${measured.target_offset}`,
      `linear=true`,
    ].join(":");

    await execAsync("ffmpeg", [
      "-y",
      "-i", finalPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", config.audioBitrate,
      "-af", pass2Filter,
      outputPath,
    ], { cwd: buildDir });

    return {
      outputPath,
      measured: {
        i: parseFloat(measured.input_i),
        tp: parseFloat(measured.input_tp),
        lra: parseFloat(measured.input_lra),
        thresh: parseFloat(measured.input_thresh),
        targetOffset: parseFloat(measured.target_offset),
      },
    };
  } else {
    // ── Single pass ──────────────────────────────────────────────────────
    const filter = `loudnorm=I=${config.i}:TP=${config.tp}:LRA=${config.lra}`;

    await execAsync("ffmpeg", [
      "-y",
      "-i", finalPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", config.audioBitrate,
      "-af", filter,
      outputPath,
    ], { cwd: buildDir });

    return { outputPath };
  }
}