/**
 * AutoVideo — Lip-sync module (MuseTalk client + FFmpeg helpers)
 *
 * Provides:
 * 1. generateLipsync() — calls MuseTalk HTTP API to generate lip-synced video
 * 2. extractAudio()    — extracts WAV audio from video via FFmpeg
 * 3. overlayLipsync()  — overlays lip-sync video as rounded-rect PiP via FFmpeg
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
  /** Absolute path to avatar loop video (192x192, 30fps, mp4) */
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

const MUSETALK_TIMEOUT_MS = 600_000; // 10 minutes

/**
 * Call MuseTalk service to generate a lip-synced video.
 *
 * Sends avatar video + audio via multipart/form-data, receives mp4 binary back.
 * The output video has no audio track and matches the audio duration.
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

  const url = `${serviceUrl.replace(/\/+$/, "")}/lipsync`;

  // Build multipart/form-data manually to avoid external dependency
  const boundary = `----FormBoundary${Date.now().toString(16)}`;

  const { readFile } = await import("node:fs/promises");

  const avatarBuf = await readFile(avatarPath);
  const audioBuf = await readFile(audioPath);

  // Build multipart/form-data manually
  const parts: Buffer[] = [];

  // video part
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${basename(avatarPath)}"\r\nContent-Type: video/mp4\r\n\r\n`
  ));
  parts.push(avatarBuf);
  parts.push(Buffer.from("\r\n"));

  // audio part
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${basename(audioPath)}"\r\nContent-Type: audio/wav\r\n\r\n`
  ));
  parts.push(audioBuf);
  parts.push(Buffer.from("\r\n"));

  // fps part
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="fps"\r\n\r\n${fps}\r\n`
  ));

  // closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  // Create abort controller linked to both timeout and external signal
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), MUSETALK_TIMEOUT_MS);

  // Link external signal
  let externalAbortHandler: (() => void) | undefined;
  if (signal) {
    externalAbortHandler = () => timeoutController.abort();
    signal.addEventListener("abort", externalAbortHandler, { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      let errorMsg = `MuseTalk returned ${response.status}`;
      try {
        const errBody = await response.json() as { error?: string };
        if (errBody.error) errorMsg = errBody.error;
      } catch {
        // Non-JSON error response
      }
      throw new LipsyncError(`MuseTalk failed: ${errorMsg}`);
    }

    // Write response body (mp4 binary) to output path
    const { writeFile } = await import("node:fs/promises");
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(outputPath, buffer);
  } catch (err) {
    if (err instanceof LipsyncError) throw err;

    if ((err as any)?.code === "ECONNREFUSED" || (err as any)?.cause?.code === "ECONNREFUSED") {
      throw new LipsyncError(`MuseTalk service unavailable at ${serviceUrl}`);
    }
    if ((err as any)?.name === "AbortError") {
      if (signal?.aborted) {
        throw new LipsyncError("MuseTalk request cancelled");
      }
      throw new LipsyncError("MuseTalk request timed out (10min)");
    }
    throw new LipsyncError(`MuseTalk request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeoutId);
    if (externalAbortHandler && signal) {
      signal.removeEventListener("abort", externalAbortHandler);
    }
  }
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
// Rounded-rect overlay
// ---------------------------------------------------------------------------

export interface OverlayOptions {
  /** PiP size in pixels (default 192) */
  size: number;
  /** Margin from edge in pixels (default 5) */
  margin: number;
  /** Corner radius in pixels (default 16) */
  radius: number;
  /** Position on screen */
  position: "bottom-left";
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
  const { size, margin, radius, position } = options;

  // Calculate overlay position
  let overlayPos: string;
  if (position === "bottom-left") {
    overlayPos = `${margin}:main_h-${size}-${margin}`;
  } else {
    overlayPos = `${margin}:main_h-${size}-${margin}`;
  }

  // Rounded-rect alpha mask via geq
  // R = radius, W = size, H = size
  const geqAlpha = [
    // Top-left corner
    `lt(X,${radius})*lt(Y,${radius})*gt(pow(X-${radius},2)+pow(Y-${radius},2),pow(${radius},2))`,
    // Top-right corner
    `gt(X,${size - radius})*lt(Y,${radius})*gt(pow(X-${size}+${radius},2)+pow(Y-${radius},2),pow(${radius},2))`,
    // Bottom-left corner
    `lt(X,${radius})*gt(Y,${size - radius})*gt(pow(X-${radius},2)+pow(Y-${size}+${radius},2),pow(${radius},2))`,
    // Bottom-right corner
    `gt(X,${size - radius})*gt(Y,${size - radius})*gt(pow(X-${size}+${radius},2)+pow(Y-${size}+${radius},2),pow(${radius},2))`,
  ].join("+");

  const filterComplex = [
    `[1:v]format=yuva420p,geq=`,
    `lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':`,
    `a='if(${geqAlpha},0,255)'`,
    `[avatar];`,
    `[0:v][avatar]overlay=${overlayPos}:shortest=1`,
  ].join("");

  const args = [
    "-y",
    "-i", mainVideoPath,
    "-i", lipsyncVideoPath,
    "-filter_complex", filterComplex,
    "-c:a", "copy",
    outputPath,
  ];

  await runFfmpeg(args, signal);
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
