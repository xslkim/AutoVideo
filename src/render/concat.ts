/**
 * concat.ts — ffmpeg concat for partial MP4s
 *
 * T6.4: Validates partial MP4 consistency via ffprobe, writes concat.txt,
 * and runs ffmpeg concat with stream copy to produce final.mp4.
 *
 * Packaging upgrade: when chapter data is supplied, an ffmetadata file is
 * generated and merged into final.mp4 in the same pass
 * (`-map_metadata 1 -map_chapters 1`), so platforms like YouTube / B站
 * auto-segment the upload. Enabled by default; disable with the
 * `writeChapters: false` option or the `AUTOVIDEO_CHAPTERS=0` env var.
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
  /**
   * Chapter markers to embed into final.mp4 (ffmetadata → MP4 chapters),
   * computed from script.json block titles + cumulative timings.
   * Omit or pass an empty array to skip chapter embedding.
   */
  chapters?: ChapterSpec[];
  /**
   * Set false to skip chapter embedding even when `chapters` is provided.
   * Default true; the `AUTOVIDEO_CHAPTERS=0|false|off` env var always wins.
   */
  writeChapters?: boolean;
}

export interface ConcatResult {
  /** Path to the final.mp4 relative to buildDir */
  finalPath: string;
  /** Number of partials concatenated */
  partialCount: number;
  /** Number of chapters embedded into final.mp4 (0 when none) */
  chapterCount: number;
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

// ── Chapter metadata (ffmetadata) ──────────────────────────────────────────

/**
 * One chapter marker on the final.mp4 timeline. Pure data — callers compute
 * start/end from script.json (see chaptersFromBlocks).
 */
export interface ChapterSpec {
  /** Chapter title shown by players / platforms (YouTube 分段, B站 章节). */
  title: string;
  /** Chapter start in seconds on the final.mp4 timeline. */
  startSec: number;
  /** Chapter end in seconds on the final.mp4 timeline. */
  endSec: number;
}

/**
 * Derive chapter markers from script.json blocks: each block becomes one
 * chapter, laid end to end in array order using `timing.totalSec`.
 *
 * `offsetSec` shifts every chapter forward — pass `1 / meta.fps` when the
 * concat list leads with the 1-frame title-card segment so markers land on
 * block boundaries exactly.
 *
 * Blocks without timing make everything after them unpositionable, so the
 * walk stops at the first one (chapters collected so far are kept).
 */
export function chaptersFromBlocks(
  blocks: readonly { title: string; timing?: { totalSec: number } }[],
  opts: { offsetSec?: number } = {},
): ChapterSpec[] {
  const chapters: ChapterSpec[] = [];
  let cursor = opts.offsetSec ?? 0;
  for (const block of blocks) {
    const total = block.timing?.totalSec;
    if (total === undefined || !(total > 0)) break;
    chapters.push({
      title: block.title.trim() || `第 ${chapters.length + 1} 章`,
      startSec: cursor,
      endSec: cursor + total,
    });
    cursor += total;
  }
  return chapters;
}

/** Escape `=`, `;`, `#`, `\` and newlines per the ffmetadata spec. */
function escapeFfmetaValue(value: string): string {
  return value.replace(/[=;#\\\n]/g, (ch) => `\\${ch === "\n" ? "n" : ch}`);
}

/**
 * Render chapters as an ffmetadata file body (`;FFMETADATA1` + CHAPTER
 * blocks, 1/1000 timebase as expected by players).
 */
export function buildFfmetadata(chapters: ChapterSpec[]): string {
  const lines = [";FFMETADATA1"];
  for (const ch of chapters) {
    const startMs = Math.max(0, Math.round(ch.startSec * 1000));
    const endMs = Math.max(startMs, Math.round(ch.endSec * 1000));
    lines.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${startMs}`,
      `END=${endMs}`,
      `title=${escapeFfmetaValue(ch.title)}`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Chapter embedding is on by default; option or env var can turn it off. */
function chaptersEnabled(options: ConcatOptions): boolean {
  if (options.writeChapters === false) return false;
  const env = process.env.AUTOVIDEO_CHAPTERS;
  if (env !== undefined && /^\s*(0|false|off|no)\s*$/i.test(env)) return false;
  return true;
}

// ── concatPartials ─────────────────────────────────────────────────────────

/**
 * Concatenate partial MP4s into final.mp4 using ffmpeg stream copy.
 *
 * Steps (PRD §6.4 step 6):
 *   1. Write concat.txt listing all partial paths
 *   2. When `options.chapters` is non-empty (and not disabled via
 *      `writeChapters: false` / `AUTOVIDEO_CHAPTERS=0`), write
 *      chapters.ffmeta next to it
 *   3. Run ffmpeg with -fflags +genpts -f concat -safe 0 -c copy
 *      -avoid_negative_ts make_zero (plus -f ffmetadata -i chapters.ffmeta
 *      -map_metadata 1 -map_chapters 1 when chapters exist) to produce
 *      final.mp4
 *
 * Per PRD: cwd = buildDir/output/, concat.txt contains paths like
 * `file 'partials/B01.mp4'`, and ffmpeg output is `final.mp4`.
 *
 * @param partialRelPaths - Array of partial paths relative to buildDir
 *   (e.g. ["output/partials/B01.mp4", "output/partials/B02.mp4"])
 * @param options - Build directory info + optional chapter markers
 * @returns Result with final path, partial count and embedded chapter count
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

  // ── Step 2.5: Write chapter metadata (ffmetadata) ─────────────────────
  // Chapters ride along in the same ffmpeg pass: the ffmetadata file becomes
  // input 1 and its chapters are mapped onto the output. Platforms reading
  // MP4 chapters (YouTube, B站) then auto-segment the upload.
  const chapters =
    options.chapters && chaptersEnabled(options) ? options.chapters : [];
  let chapterInputArgs: string[] = [];
  if (chapters.length > 0) {
    const ffmetaPath = path.join(outputDir, "chapters.ffmeta");
    fs.writeFileSync(ffmetaPath, buildFfmetadata(chapters), "utf-8");
    chapterInputArgs = [
      "-f", "ffmetadata",
      "-i", "chapters.ffmeta",
      "-map_metadata", "1",
      "-map_chapters", "1",
    ];
  }

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
        ...chapterInputArgs,
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
    chapterCount: chapters.length,
  };
}