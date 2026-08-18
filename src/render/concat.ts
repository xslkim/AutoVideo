/**
 * concat.ts — ffmpeg concat for partial MP4s
 *
 * T6.4: Validates partial MP4 consistency via ffprobe, writes concat.txt,
 * and runs ffmpeg concat with stream copy to produce final.mp4.
 *
 * @see PRD §6.4 step 6
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConcatOptions {
  /** Build output directory (cwd for all relative paths) */
  buildDir: string;
}

export interface ConcatResult {
  /** Path to the final.mp4 relative to buildDir */
  finalPath: string;
  /** Number of partials concatenated */
  partialCount: number;
}

/** Stream info extracted by ffprobe */
interface StreamInfo {
  codecName: string;
  width: number;
  height: number;
  rFrameRate: string;
  pixFmt: string;
  sampleAspectRatio: string;
  timeBase: string;
}

// ── ffprobe helpers ────────────────────────────────────────────────────────

/**
 * Probe a single video file and extract key stream properties.
 */
function probeVideoStreams(filePath: string): StreamInfo[] {
  const result = execFileSync(
    "ffprobe",
    [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-select_streams", "v",
      "-i", filePath,
    ],
    { encoding: "utf-8", timeout: 30_000 }
  );

  const info = JSON.parse(result);
  const streams: StreamInfo[] = [];

  for (const s of info?.streams ?? []) {
    streams.push({
      codecName: s.codec_name ?? "",
      width: s.width ?? 0,
      height: s.height ?? 0,
      rFrameRate: s.r_frame_rate ?? "",
      pixFmt: s.pix_fmt ?? "",
      sampleAspectRatio: s.sample_aspect_ratio ?? "",
      timeBase: s.time_base ?? "",
    });
  }

  return streams;
}

// ── validatePartials ───────────────────────────────────────────────────────

/**
 * Validate that all partial MP4s have consistent encoding parameters.
 *
 * Uses ffprobe to check codec, resolution, fps, pixel format, and SAR
 * across all partials. Reports an error with the specific mismatch if
 * any inconsistency is found.
 *
 * @param partialPaths - Array of absolute paths to partial MP4 files
 * @throws Error if any two partials have inconsistent parameters
 */
export function validatePartials(partialPaths: string[]): void {
  if (partialPaths.length === 0) {
    throw new Error("No partial MP4 files to validate");
  }

  // Probe the first file as the reference
  const refStreams = probeVideoStreams(partialPaths[0]);
  if (refStreams.length === 0) {
    throw new Error(
      `No video stream found in reference partial: ${partialPaths[0]}`
    );
  }
  const ref = refStreams[0];

  // Validate each subsequent file against the reference
  for (let i = 1; i < partialPaths.length; i++) {
    const streams = probeVideoStreams(partialPaths[i]);
    if (streams.length === 0) {
      throw new Error(
        `No video stream found in partial: ${partialPaths[i]}`
      );
    }
    const s = streams[0];

    const mismatches: string[] = [];

    if (s.codecName !== ref.codecName) {
      mismatches.push(`codec: expected ${ref.codecName}, got ${s.codecName}`);
    }
    if (s.width !== ref.width || s.height !== ref.height) {
      mismatches.push(
        `resolution: expected ${ref.width}x${ref.height}, got ${s.width}x${s.height}`
      );
    }
    if (s.rFrameRate !== ref.rFrameRate) {
      mismatches.push(`fps: expected ${ref.rFrameRate}, got ${s.rFrameRate}`);
    }
    if (s.pixFmt !== ref.pixFmt) {
      mismatches.push(
        `pixel format: expected ${ref.pixFmt}, got ${s.pixFmt}`
      );
    }
    if (s.sampleAspectRatio !== ref.sampleAspectRatio) {
      mismatches.push(
        `SAR: expected ${ref.sampleAspectRatio}, got ${s.sampleAspectRatio}`
      );
    }
    if (s.timeBase !== ref.timeBase) {
      // Mixed track timescales (e.g. 1/15360 html partials vs 1/90000
      // Remotion partials) silently corrupt segment timestamps under
      // concat stream-copy — the overlay pass then freezes on those blocks.
      mismatches.push(
        `time base: expected ${ref.timeBase}, got ${s.timeBase}`
      );
    }

    if (mismatches.length > 0) {
      throw new Error(
        `Partial ${path.basename(partialPaths[i])} has inconsistent encoding parameters:\n` +
          mismatches.map((m) => `  - ${m}`).join("\n") +
          `\n\nThis usually happens when Remotion version changed but old partials remain in cache.` +
          `\nRun: autovideo cache clean --type partial && autovideo render <script.json>`
      );
    }
  }
}

// ── concatPartials ─────────────────────────────────────────────────────────

/**
 * Concatenate partial MP4s into final.mp4 using ffmpeg stream copy.
 *
 * Steps (PRD §6.4 step 6):
 *   1. Write concat.txt listing all partial paths
 *   2. Run ffmpeg with -fflags +genpts -f concat -safe 0 -c copy
 *      -avoid_negative_ts make_zero to produce final.mp4
 *
 * Per PRD: cwd = buildDir/output/, concat.txt contains paths like
 * `file 'partials/B01.mp4'`, and ffmpeg output is `final.mp4`.
 *
 * @param partialRelPaths - Array of partial paths relative to buildDir
 *   (e.g. ["output/partials/B01.mp4", "output/partials/B02.mp4"])
 * @param options - Build directory info
 * @returns Result with final path and count
 */
export function concatPartials(
  partialRelPaths: string[],
  options: ConcatOptions
): ConcatResult {
  const { buildDir } = options;

  if (partialRelPaths.length === 0) {
    throw new Error("No partial MP4 files to concatenate");
  }

  const outputDir = path.join(buildDir, "output");
  fs.mkdirSync(outputDir, { recursive: true });

  // ── Step 1: Validate partials ─────────────────────────────────────────
  const absPartialPaths = partialRelPaths.map((p) =>
    path.resolve(buildDir, p)
  );

  // Verify all files exist
  for (const p of absPartialPaths) {
    if (!fs.existsSync(p)) {
      throw new Error(`Partial MP4 not found: ${p}`);
    }
  }

  validatePartials(absPartialPaths);

  // ── Step 2: Write concat.txt ──────────────────────────────────────────
  // Per PRD §6.4 step 6: cwd = output/, paths in concat.txt are relative to output/
  // e.g. "file 'partials/B01.mp4'"
  const concatTxtPath = path.join(outputDir, "concat.txt");
  const concatEntries = partialRelPaths.map((p) => {
    // Convert from buildDir-relative to outputDir-relative
    // "output/partials/B01.mp4" → "partials/B01.mp4"
    const outputRel = path.relative(outputDir, path.resolve(buildDir, p));
    return `file '${outputRel.replace(/\\/g, "/")}'`;
  });
  fs.writeFileSync(concatTxtPath, concatEntries.join("\n"), "utf-8");

  // ── Step 3: Run ffmpeg concat ─────────────────────────────────────────
  // Per PRD §6.4 step 6: cwd = output/
  const finalPath = path.join(outputDir, "final.mp4");

  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-fflags", "+genpts",
        "-f", "concat",
        "-safe", "0",
        "-i", "concat.txt",
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "final.mp4",
      ],
      {
        cwd: outputDir,
        encoding: "utf-8",
        timeout: 120_000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; message?: string };
    const stderr = execErr.stderr ?? execErr.message ?? String(err);
    throw new Error(
      `ffmpeg concat failed:\n${stderr}\n\n` +
        `To fix, try: autovideo cache clean --type partial && autovideo render <script.json>`
    );
  }

  // Verify output exists
  if (!fs.existsSync(finalPath)) {
    throw new Error(
      `ffmpeg concat completed but final.mp4 not found at: ${finalPath}`
    );
  }

  return {
    finalPath: "output/final.mp4",
    partialCount: partialRelPaths.length,
  };
}