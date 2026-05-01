/**
 * AutoVideo — VoxCPM server management
 *
 * Handles auto-starting the voxcpm2-api server when it's unreachable.
 * (PRD §6.2.1)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { VoxcpmClient } from "./voxcpm-client.js";

export interface VoxcpmServerOptions {
  endpoint: string;
  modelDir: string;
  autoStart: boolean;
  /** Working directory for the server process */
  cwd?: string;
}

/**
 * Attempt to start the VoxCPM server if it's not already running.
 * Returns true if the server is available (either already running or started).
 */
export async function ensureVoxcpmServer(
  client: VoxcpmClient,
  opts: VoxcpmServerOptions,
  verbose = false,
): Promise<{ started: boolean; process?: ChildProcess }> {
  // Check if already running
  const healthy = await client.isHealthy();
  if (healthy) {
    if (verbose) console.log("[tts] VoxCPM server already running");
    return { started: false };
  }

  if (!opts.autoStart) {
    throw new Error(
      "VoxCPM server is not reachable and autoStart is disabled. " +
        "Start it manually or run `autovideo doctor`."
    );
  }

  // Validate model directory
  const modelDir = isAbsolute(opts.modelDir)
    ? opts.modelDir
    : resolve(process.cwd(), opts.modelDir);

  if (!existsSync(modelDir)) {
    throw new Error(
      `VoxCPM model directory not found: ${modelDir}\n` +
        "Run `autovideo doctor` or download the model weights first."
    );
  }

  if (verbose) {
    console.log(`[tts] Starting VoxCPM server (model: ${modelDir})`);
  }

  // Start server process
  const serverProc = spawn(
    "python",
    ["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: opts.cwd ?? resolve(import.meta.dirname ?? ".", "../../tts-server"),
      stdio: "pipe",
      detached: false,
      env: {
        ...process.env,
        VOXCPM_MODEL_DIR: modelDir,
      },
    }
  );

  serverProc.on("error", (err) => {
    if (verbose) {
      console.error(`[tts] VoxCPM server process error: ${err.message}`);
    }
  });

  // Wait for the server to become healthy (up to 60 seconds)
  const maxWaitMs = 60_000;
  const intervalMs = 2_000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    await sleep(intervalMs);
    const ok = await client.isHealthy();
    if (ok) {
      if (verbose) {
        console.log(
          `[tts] VoxCPM server started in ${Date.now() - start}ms`
        );
      }
      return { started: true, process: serverProc };
    }
  }

  // Timeout — kill the process
  serverProc.kill("SIGTERM");
  throw new Error(
    `VoxCPM server failed to start within ${maxWaitMs / 1000}s. ` +
      "Run `autovideo doctor` to check your setup."
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}