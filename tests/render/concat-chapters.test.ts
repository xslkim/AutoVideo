/**
 * Tests for src/render/concat.ts — chapter metadata (ffmetadata → MP4 chapters)
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  chaptersFromBlocks,
  buildFfmetadata,
  concatPartials,
} from "../../src/render/concat.js";

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
function generateTestMp4(outputPath: string, durSec = 0.5): void {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=black:s=640x360:d=${durSec}:r=30`,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      "-an",
      outputPath,
    ],
    { encoding: "utf-8", timeout: 30_000 }
  );
}

/** Read MP4 chapters via ffprobe */
function probeChapters(filePath: string): { start: number; end: number; title: string }[] {
  const out = execFileSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_chapters", filePath],
    { encoding: "utf-8", timeout: 10_000 }
  );
  const info = JSON.parse(out);
  return (info?.chapters ?? []).map((c: any) => ({
    start: Number(c.start),
    end: Number(c.end),
    title: c?.tags?.title ?? "",
  }));
}

const ffmpegAvailable = hasFfmpeg();

// ── chaptersFromBlocks ─────────────────────────────────────────────────────

describe("chaptersFromBlocks", () => {
  it("lays blocks end to end using timing.totalSec", () => {
    const chapters = chaptersFromBlocks([
      { title: "开场", timing: { totalSec: 4 } },
      { title: "原理", timing: { totalSec: 8.5 } },
      { title: "总结", timing: { totalSec: 3 } },
    ]);
    expect(chapters).toEqual([
      { title: "开场", startSec: 0, endSec: 4 },
      { title: "原理", startSec: 4, endSec: 12.5 },
      { title: "总结", startSec: 12.5, endSec: 15.5 },
    ]);
  });

  it("applies offsetSec to every chapter (title-card lead-in)", () => {
    const chapters = chaptersFromBlocks(
      [{ title: "开场", timing: { totalSec: 2 } }],
      { offsetSec: 1 / 30 }
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0].startSec).toBeCloseTo(1 / 30, 6);
    expect(chapters[0].endSec).toBeCloseTo(2 + 1 / 30, 6);
  });

  it("stops at the first block without timing", () => {
    const chapters = chaptersFromBlocks([
      { title: "开场", timing: { totalSec: 2 } },
      { title: "未渲染块" },
      { title: "总结", timing: { totalSec: 3 } },
    ]);
    expect(chapters).toEqual([{ title: "开场", startSec: 0, endSec: 2 }]);
  });

  it("returns [] for empty input", () => {
    expect(chaptersFromBlocks([])).toEqual([]);
  });

  it("falls back to a numbered title when block title is blank", () => {
    const chapters = chaptersFromBlocks([{ title: "  ", timing: { totalSec: 2 } }]);
    expect(chapters[0].title).toBe("第 1 章");
  });
});

// ── buildFfmetadata ────────────────────────────────────────────────────────

describe("buildFfmetadata", () => {
  it("emits FFMETADATA1 header and 1/1000 chapter blocks", () => {
    const text = buildFfmetadata([
      { title: "开场", startSec: 0, endSec: 4.2 },
      { title: "总结", startSec: 4.2, endSec: 7 },
    ]);
    expect(text.startsWith(";FFMETADATA1\n")).toBe(true);
    expect(text).toContain("[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=4200\ntitle=开场");
    expect(text).toContain("START=4200\nEND=7000\ntitle=总结");
  });

  it("escapes ffmetadata special characters in titles", () => {
    const text = buildFfmetadata([
      { title: "a=b;c#d\\e", startSec: 0, endSec: 1 },
    ]);
    expect(text).toContain("title=a\\=b\\;c\\#d\\\\e");
  });

  it("clamps negative starts and end < start", () => {
    const text = buildFfmetadata([{ title: "x", startSec: -1, endSec: -2 }]);
    expect(text).toContain("START=0\nEND=0");
  });
});

// ── concatPartials chapter embedding (ffmpeg integration) ────────────────

describe("concatPartials chapters", () => {
  function setupPartials(tmpDir: string): string[] {
    const partialsDir = path.join(tmpDir, "output", "partials");
    fs.mkdirSync(partialsDir, { recursive: true });
    generateTestMp4(path.join(partialsDir, "B01.mp4"), 0.5);
    generateTestMp4(path.join(partialsDir, "B02.mp4"), 0.5);
    return ["output/partials/B01.mp4", "output/partials/B02.mp4"];
  }

  const CHAPTERS = [
    { title: "开场白", startSec: 0, endSec: 0.5 },
    { title: "正文 第二节", startSec: 0.5, endSec: 1 },
  ];

  it.runIf(ffmpegAvailable)(
    "embeds chapters into final.mp4 and reports chapterCount",
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
      try {
        const result = concatPartials(setupPartials(tmpDir), {
          buildDir: tmpDir,
          chapters: CHAPTERS,
        });
        expect(result.chapterCount).toBe(2);

        // ffmetadata file persisted next to concat.txt
        const ffmeta = fs.readFileSync(
          path.join(tmpDir, "output", "chapters.ffmeta"),
          "utf-8"
        );
        expect(ffmeta).toContain("title=开场白");

        // Chapters actually landed in the MP4 container
        const chapters = probeChapters(path.join(tmpDir, "output", "final.mp4"));
        expect(chapters).toHaveLength(2);
        expect(chapters[0]).toMatchObject({ start: 0, end: 500, title: "开场白" });
        expect(chapters[1]).toMatchObject({ start: 500, end: 1000, title: "正文 第二节" });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it.runIf(ffmpegAvailable)(
    "skips chapter embedding when writeChapters is false",
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
      try {
        const result = concatPartials(setupPartials(tmpDir), {
          buildDir: tmpDir,
          chapters: CHAPTERS,
          writeChapters: false,
        });
        expect(result.chapterCount).toBe(0);
        expect(
          fs.existsSync(path.join(tmpDir, "output", "chapters.ffmeta"))
        ).toBe(false);
        expect(
          probeChapters(path.join(tmpDir, "output", "final.mp4"))
        ).toHaveLength(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it.runIf(ffmpegAvailable)(
    "AUTOVIDEO_CHAPTERS=0 env var disables chapter embedding",
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-test-"));
      const prev = process.env.AUTOVIDEO_CHAPTERS;
      process.env.AUTOVIDEO_CHAPTERS = "0";
      try {
        const result = concatPartials(setupPartials(tmpDir), {
          buildDir: tmpDir,
          chapters: CHAPTERS,
        });
        expect(result.chapterCount).toBe(0);
        expect(
          probeChapters(path.join(tmpDir, "output", "final.mp4"))
        ).toHaveLength(0);
      } finally {
        if (prev === undefined) delete process.env.AUTOVIDEO_CHAPTERS;
        else process.env.AUTOVIDEO_CHAPTERS = prev;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
});
