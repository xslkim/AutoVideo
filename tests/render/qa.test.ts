import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { runQA, QAResult, QAMeta, QABlockTiming } from "../../src/render/qa";
import os from "os";

function execAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Create a black mp4 of given duration and resolution using ffmpeg */
async function createBlackMp4(
  filePath: string,
  width: number,
  height: number,
  durationSec: number,
  fps: number
): Promise<void> {
  await execAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:d=${durationSec}:r=${fps}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-t",
    durationSec.toString(),
    filePath,
  ]);
}

/** Create a non-black (white) mp4 of given duration and resolution */
async function createWhiteMp4(
  filePath: string,
  width: number,
  height: number,
  durationSec: number,
  fps: number
): Promise<void> {
  await execAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=white:s=${width}x${height}:d=${durationSec}:r=${fps}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-t",
    durationSec.toString(),
    filePath,
  ]);
}

/** Create a colored mp4 with text overlay (definitely non-black) */
async function createColoredMp4(
  filePath: string,
  width: number,
  height: number,
  durationSec: number,
  fps: number
): Promise<void> {
  await execAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x336699:s=${width}x${height}:d=${durationSec}:r=${fps}`,
    "-vf",
    `drawtext=text='TEST':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-t",
    durationSec.toString(),
    filePath,
  ]);
}

describe("QA (quality assurance)", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "autovideo-qa-test-"));
  });

  afterAll(async () => {
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const defaultMeta: QAMeta = { width: 1920, height: 1080, fps: 30 };
  const defaultBlocks: QABlockTiming[] = [
    { id: "B01", totalSec: 3 },
    { id: "B02", totalSec: 4 },
  ];

  it("should pass for a valid non-black video with matching resolution and duration", async () => {
    const videoPath = path.join(tmpDir, "valid-final.mp4");
    const partialsDir = path.join(tmpDir, "valid-partials");
    await fs.mkdir(partialsDir, { recursive: true });

    // Create partial mp4 files
    await createColoredMp4(
      path.join(partialsDir, "B01.mp4"),
      1920, 1080, 3, 30
    );
    await createColoredMp4(
      path.join(partialsDir, "B02.mp4"),
      1920, 1080, 4, 30
    );

    // Create a concatenated final video (just combine the two)
    const concatFile = path.join(tmpDir, "valid-concat.txt");
    await fs.writeFile(
      concatFile,
      `file '${partialsDir}/B01.mp4'\nfile '${partialsDir}/B02.mp4'\n`
    );
    await execAsync("ffmpeg", [
      "-y",
      "-f", "concat", "-safe", "0",
      "-i", concatFile,
      "-c", "copy",
      videoPath,
    ]);

    const result = await runQA(videoPath, partialsDir, defaultMeta, defaultBlocks);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should fail for a black-frame video", async () => {
    const videoPath = path.join(tmpDir, "black-final.mp4");
    const partialsDir = path.join(tmpDir, "black-partials");
    await fs.mkdir(partialsDir, { recursive: true });

    // Create black partials
    await createBlackMp4(
      path.join(partialsDir, "B01.mp4"),
      1920, 1080, 3, 30
    );
    await createBlackMp4(
      path.join(partialsDir, "B02.mp4"),
      1920, 1080, 4, 30
    );

    // Concatenate to make the final video (all black)
    const concatFile = path.join(tmpDir, "black-concat.txt");
    await fs.writeFile(
      concatFile,
      `file '${partialsDir}/B01.mp4'\nfile '${partialsDir}/B02.mp4'\n`
    );
    await execAsync("ffmpeg", [
      "-y",
      "-f", "concat", "-safe", "0",
      "-i", concatFile,
      "-c", "copy",
      videoPath,
    ]);

    const result = await runQA(videoPath, partialsDir, defaultMeta, defaultBlocks);

    expect(result.passed).toBe(false);
    // At least one error should mention "black"
    const blackErrors = result.errors.filter(
      (e) => e.toLowerCase().includes("black")
    );
    expect(blackErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("should fail when resolution does not match", async () => {
    const videoPath = path.join(tmpDir, "res-mismatch.mp4");
    const partialsDir = path.join(tmpDir, "res-mismatch-partials");
    await fs.mkdir(partialsDir, { recursive: true });

    // Create video at wrong resolution (1280x720 instead of 1920x1080)
    await createColoredMp4(videoPath, 1280, 720, 7, 30);

    // Create matching partials (also wrong res but we test the final video)
    await createColoredMp4(
      path.join(partialsDir, "B01.mp4"),
      1280, 720, 3, 30
    );
    await createColoredMp4(
      path.join(partialsDir, "B02.mp4"),
      1280, 720, 4, 30
    );

    const result = await runQA(videoPath, partialsDir, defaultMeta, defaultBlocks);

    expect(result.passed).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Resolution mismatch"))
    ).toBe(true);
  });

  it("should fail when video file does not exist", async () => {
    const videoPath = path.join(tmpDir, "nonexistent.mp4");
    const partialsDir = path.join(tmpDir, "noexist-partials");
    await fs.mkdir(partialsDir, { recursive: true });

    const result = await runQA(videoPath, partialsDir, defaultMeta, defaultBlocks);

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("not found");
  });

  it("should fail when partial files are missing", async () => {
    const videoPath = path.join(tmpDir, "missing-partials.mp4");
    const partialsDir = path.join(tmpDir, "empty-partials");
    await fs.mkdir(partialsDir, { recursive: true });

    // Create a valid-looking video
    await createColoredMp4(videoPath, 1920, 1080, 7, 30);

    const result = await runQA(videoPath, partialsDir, defaultMeta, defaultBlocks);

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("not found"))).toBe(true);
  });

  it("should pass duration check within 1-frame tolerance", async () => {
    const videoPath = path.join(tmpDir, "duration-ok.mp4");
    const partialsDir = path.join(tmpDir, "duration-ok-partials");
    await fs.mkdir(partialsDir, { recursive: true });

    // Create partials with known durations
    await createColoredMp4(
      path.join(partialsDir, "B01.mp4"),
      1920, 1080, 2, 30
    );
    await createColoredMp4(
      path.join(partialsDir, "B02.mp4"),
      1920, 1080, 3, 30
    );

    // Concatenate them
    const concatFile = path.join(tmpDir, "duration-ok-concat.txt");
    await fs.writeFile(
      concatFile,
      `file '${partialsDir}/B01.mp4'\nfile '${partialsDir}/B02.mp4'\n`
    );
    await execAsync("ffmpeg", [
      "-y",
      "-f", "concat", "-safe", "0",
      "-i", concatFile,
      "-c", "copy",
      videoPath,
    ]);

    const blocks: QABlockTiming[] = [
      { id: "B01", totalSec: 2 },
      { id: "B02", totalSec: 3 },
    ];

    const result = await runQA(videoPath, partialsDir, defaultMeta, blocks);

    // Duration should match (within tolerance)
    expect(result.errors.some((e) => e.includes("Duration mismatch"))).toBe(false);
  });
});