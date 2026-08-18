/**
 * AutoVideo — Lip-sync module (MuseTalk client + FFmpeg helpers)
 *
 * Provides:
 * 1. generateLipsync()     — calls MuseTalk HTTP API to generate lip-synced video
 * 2. extractAudio()        — extracts WAV audio from video via FFmpeg
 * 3. padAudio()            — pads audio with leading/trailing silence to exact duration
 * 4. overlayLipsync()      — overlays lip-sync video as rounded-rect PiP via FFmpeg
 * 5. concatLipsyncVideos() — concatenates per-block lipsync videos into one
 */

import { spawn } from "node:child_process";
import { basename } from "node:path";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LipsyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LipsyncError";
  }
}

// ---------------------------------------------------------------------------
// MuseTalk client
// ---------------------------------------------------------------------------

export interface LipsyncOptions {
  /** Absolute path to avatar loop video (square mp4, e.g. 128x128) */
  avatarPath: string;
  /** Absolute path to full audio WAV */
  audioPath: string;
  /** Output path for lip-synced video mp4 */
  outputPath: string;
  /** Frame rate (default 30) */
  fps: number;
  /** MuseTalk service URL (e.g. "http://localhost:8001") */
  serviceUrl: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

const MUSETALK_TIMEOUT_MS = 1_800_000; // 30 minutes

/**
 * Call MuseTalk service to generate a lip-synced video.
 *
 * Uses Node.js http.request instead of fetch to avoid undici's UND_ERR_HEADERS_TIMEOUT,
 * which fires when MuseTalk takes longer than ~5 minutes before sending the response headers.
 *
 * Streams the mp4 response directly to disk — no large in-memory buffer.
 */
export async function generateLipsync(options: LipsyncOptions): Promise<void> {
  const {
    avatarPath,
    audioPath,
    outputPath,
    fps,
    serviceUrl,
    signal,
  } = options;

  const { readFile } = await import("node:fs/promises");
  const { createWriteStream } = await import("node:fs");
  const http = await import("node:http");
  const { pipeline } = await import("node:stream/promises");

  const avatarBuf = await readFile(avatarPath);
  const audioBuf = await readFile(audioPath);

  const boundary = `----FormBoundary${Date.now().toString(16)}`;

  const parts: Buffer[] = [];
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${basename(avatarPath)}"\r\nContent-Type: video/mp4\r\n\r\n`
  ));
  parts.push(avatarBuf);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${basename(audioPath)}"\r\nContent-Type: audio/wav\r\n\r\n`
  ));
  parts.push(audioBuf);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="fps"\r\n\r\n${fps}\r\n`
  ));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const parsed = new URL(`${serviceUrl.replace(/\/+$/, "")}/lipsync`);

  return new Promise<void>((resolve, reject) => {
    let timedOut = false;
    let aborted = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      req.destroy();
    }, MUSETALK_TIMEOUT_MS);

    const onExternalAbort = () => {
      aborted = true;
      req.destroy();
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        reject(new LipsyncError("MuseTalk request cancelled"));
        return;
      }
      signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", onExternalAbort);
    };

    const req = http.request({
      hostname: parsed.hostname,
      port: Number(parsed.port) || 80,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
      // No socket timeout — MuseTalk processing can take many minutes
    }, (res) => {
      cleanup();

      if ((res.statusCode ?? 0) >= 400) {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let errMsg = `MuseTalk returned ${res.statusCode}`;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString()) as { error?: string };
            if (parsed.error) errMsg = parsed.error;
          } catch {}
          reject(new LipsyncError(`MuseTalk failed: ${errMsg}`));
        });
        return;
      }

      // Stream response directly to output file (no in-memory buffer)
      const fileStream = createWriteStream(outputPath);
      pipeline(res, fileStream)
        .then(() => resolve())
        .catch((err) => {
          reject(new LipsyncError(`MuseTalk response stream failed: ${(err as Error).message}`));
        });
    });

    req.on("error", (err) => {
      cleanup();
      if (aborted) {
        reject(new LipsyncError("MuseTalk request cancelled"));
      } else if (timedOut) {
        reject(new LipsyncError("MuseTalk request timed out (30min)"));
      } else if ((err as any).code === "ECONNREFUSED") {
        reject(new LipsyncError(`MuseTalk service unavailable at ${serviceUrl}`));
      } else {
        reject(new LipsyncError(`MuseTalk request failed: ${err.message}`));
      }
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Audio extraction
// ---------------------------------------------------------------------------

/**
 * Extract full audio track from video as 16kHz mono WAV.
 *
 * ffmpeg -i videoPath -vn -acodec pcm_s16le -ar 16000 -ac 1 outputWavPath
 */
export async function extractAudio(
  videoPath: string,
  outputWavPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const args = [
    "-y",
    "-i", videoPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    outputWavPath,
  ];

  await runFfmpeg(args, signal);
}

// ---------------------------------------------------------------------------
// Audio padding
// ---------------------------------------------------------------------------

/**
 * Pad a WAV audio file to exactly `totalSec` duration by:
 *   - Adding `enterMs` milliseconds of silence at the start (for block enter animation)
 *   - Padding with silence at the end (for block exit animation)
 *
 * This ensures the per-block lipsync video matches the block's total duration
 * (enter + hold + exit), keeping lipsync in sync when overlaid on final.mp4.
 */
export async function padAudio(
  inputPath: string,
  outputPath: string,
  enterMs: number,
  totalSec: number,
  signal?: AbortSignal,
): Promise<void> {
  const afFilters: string[] = [];
  if (enterMs > 0) {
    afFilters.push(`adelay=${Math.round(enterMs)}:all=1`);
  }
  afFilters.push("apad");

  const args = [
    "-y",
    "-i", inputPath,
    "-af", afFilters.join(","),
    "-t", totalSec.toFixed(3),
    "-ar", "16000",
    "-ac", "1",
    outputPath,
  ];

  await runFfmpeg(args, signal);
}

// ---------------------------------------------------------------------------
// Lipsync video concat
// ---------------------------------------------------------------------------

/**
 * Concatenate per-block lipsync MP4 files (video-only, no audio) into one.
 *
 * Uses ffmpeg concat demuxer with stream copy — fast, no re-encoding.
 */
export async function concatLipsyncVideos(
  inputPaths: string[],
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const { writeFile, unlink } = await import("node:fs/promises");

  const listPath = outputPath + ".concat.txt";
  const lines = inputPaths.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`);
  await writeFile(listPath, lines.join("\n"), "utf-8");

  try {
    await runFfmpeg([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      outputPath,
    ], signal);
  } finally {
    try { await unlink(listPath); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Rounded-rect overlay
// ---------------------------------------------------------------------------

export interface OverlayOptions {
  /** PiP width in pixels (from uploaded avatar resolution) */
  width: number;
  /** PiP height in pixels (from uploaded avatar resolution) */
  height: number;
  /** Margin from edge in pixels (default 5) */
  margin: number;
  /** Corner radius in pixels (default 24) */
  radius: number;
  /** Position on screen */
  position: "bottom-left";
  /**
   * Re-encode settings for the composited output. The overlay filter forces a
   * full re-encode, so without explicit values ffmpeg falls back to its own
   * defaults (crf 23) and throws away the quality the Remotion pass produced.
   */
  encode?: {
    crf: number;
    x264Preset: string;
    pixelFormat: string;
    colorSpace: "bt709" | "bt2020-ncl" | "default";
  };
}

const DEFAULT_OVERLAY_ENCODE: NonNullable<OverlayOptions["encode"]> = {
  crf: 16,
  x264Preset: "medium",
  pixelFormat: "yuv420p",
  colorSpace: "bt709",
};

/** ffmpeg color tagging flags for a color space, empty for "default". */
function colorSpaceArgs(colorSpace: string): string[] {
  if (colorSpace === "bt709") {
    return ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
  }
  if (colorSpace === "bt2020-ncl") {
    return ["-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", "smpte2084"];
  }
  return [];
}

/**
 * Overlay lip-sync video as a rounded-rectangle picture-in-picture
 * on the main video.
 *
 * Uses FFmpeg geq filter to create a rounded-rect alpha mask, then overlays
 * at the specified position.
 */
export async function overlayLipsync(
  mainVideoPath: string,
  lipsyncVideoPath: string,
  outputPath: string,
  options: OverlayOptions,
  signal?: AbortSignal,
): Promise<void> {
  const { width, height, margin, radius, position } = options;
  const encode = { ...DEFAULT_OVERLAY_ENCODE, ...(options.encode ?? {}) };

  // Calculate overlay position
  let overlayPos: string;
  if (position === "bottom-left") {
    overlayPos = `${margin}:main_h-${height}-${margin}`;
  } else {
    overlayPos = `${margin}:main_h-${height}-${margin}`;
  }

  // Rounded-rect alpha mask via geq
  // R = radius, W = width, H = height
  const geqAlpha = [
    // Top-left corner
    `lt(X,${radius})*lt(Y,${radius})*gt(pow(X-${radius},2)+pow(Y-${radius},2),pow(${radius},2))`,
    // Top-right corner
    `gt(X,${width - radius})*lt(Y,${radius})*gt(pow(X-${width}+${radius},2)+pow(Y-${radius},2),pow(${radius},2))`,
    // Bottom-left corner
    `lt(X,${radius})*gt(Y,${height - radius})*gt(pow(X-${radius},2)+pow(Y-${height}+${radius},2),pow(${radius},2))`,
    // Bottom-right corner
    `gt(X,${width - radius})*gt(Y,${height - radius})*gt(pow(X-${width}+${radius},2)+pow(Y-${height}+${radius},2),pow(${radius},2))`,
  ].join("+");

  const filterComplex = [
    `[1:v]scale=${width}:${height}:flags=lanczos,format=yuva420p,geq=`,
    `lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':`,
    `a='if(${geqAlpha},0,255)'`,
    `[avatar];`,
    `[0:v][avatar]overlay=${overlayPos}:eof_action=endall`,
  ].join("");

  const args = [
    "-y",
    "-i", mainVideoPath,
    "-stream_loop", "-1",   // loop avatar from the beginning when it runs out
    "-i", lipsyncVideoPath,
    "-filter_complex", filterComplex,
    "-c:v", "libx264",
    "-crf", String(encode.crf),
    "-preset", encode.x264Preset,
    "-pix_fmt", encode.pixelFormat,
    ...colorSpaceArgs(encode.colorSpace),
    "-c:a", "copy",
    "-shortest",            // stop encoding when the main video ends
    outputPath,
  ];

  await runFfmpeg(args, signal);
}

// ---------------------------------------------------------------------------
// Video size probe
// ---------------------------------------------------------------------------

/**
 * Probe the width and height of a video file using ffprobe.
 */
export function probeVideoSize(videoPath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "json",
      videoPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });

    proc.on("error", (err) => {
      reject(new LipsyncError(`ffprobe failed to start: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new LipsyncError(`ffprobe exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { streams: { width: number; height: number }[] };
        const stream = parsed.streams?.[0];
        if (!stream?.width || !stream?.height) {
          reject(new LipsyncError("ffprobe: could not read video dimensions"));
          return;
        }
        resolve({ width: stream.width, height: stream.height });
      } catch {
        reject(new LipsyncError("ffprobe: failed to parse output"));
      }
    });
  });
}

/**
 * Probe a video file's container duration (seconds) using ffprobe.
 */
export function probeVideoDurationSec(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "json",
      videoPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });

    proc.on("error", (err) => {
      reject(new LipsyncError(`ffprobe failed to start: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new LipsyncError(`ffprobe exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
        const duration = Number(parsed.format?.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new LipsyncError("ffprobe: could not read video duration"));
          return;
        }
        resolve(duration);
      } catch {
        reject(new LipsyncError("ffprobe: failed to parse output"));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// FFmpeg runner
// ---------------------------------------------------------------------------

function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrOutput = "";
    proc.stderr?.on("data", (data: Buffer) => {
      stderrOutput += data.toString();
    });

    proc.on("error", (err) => {
      reject(new LipsyncError(`FFmpeg failed to start: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Extract last meaningful error line from stderr
        const lines = stderrOutput.trim().split("\n");
        const lastLine = lines[lines.length - 1] || `exit code ${code}`;
        reject(new LipsyncError(`FFmpeg exited with code ${code}: ${lastLine}`));
      }
    });

    if (signal) {
      const onAbort = () => {
        proc.kill("SIGKILL");
      };
      signal.addEventListener("abort", onAbort, { once: true });
      proc.on("close", () => {
        signal.removeEventListener("abort", onAbort);
      });
    }
  });
}
