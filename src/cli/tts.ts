/**
 * AutoVideo — TTS command (Stage 2)
 *
 * PRD §6.2 — Generate audio + subtitle timings from narration.
 *
 * Flow:
 *   1. Validate script.json is CompiledScript readiness
 *   2. Start VoxCPM service (autoStart fallback)
 *   3. Register voiceRef → get voiceId
 *   4. Compute voiceRefHash / voxcpmModelVersion
 *   5. p-limit(voxcpm.concurrency) for line-level concurrency
 *   6. Per line: cache lookup → miss → client.speak() → put cache
 *   7. Block concatenation: concat all line WAVs + 200ms silence → public/audio/B**.wav
 *   8. Compute lineTimings and write back to script.json.blocks[].audio
 *   9. Failure: 3 retries (5s interval), then AbortController cancel
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import pLimit from "p-limit";
import { CacheStore, type AudioKey } from "../cache/store.js";
import { computeLineTimings, type LineTiming } from "../tts/timings.js";
import { VoxcpmClient } from "../tts/voxcpm-client.js";
import { ensureVoxcpmServer } from "../tts/voxcpm-server.js";
import {
  concatenateWavsWithGaps,
  getWavDurationSec,
} from "../tts/audio.js";
import {
  assertCompiledScript,
  type CompiledScript,
  type Script,
  type Block,
  type ProgressEvent,
} from "../types/script.js";
import type { AutoVideoConfig } from "../config/defaults.js";

// ── Error class ───────────────────────────────────────────────────────

export class TtsError extends Error {
  code: string;
  constructor(message: string, code = "ERR_TTS_FAILED") {
    super(message);
    this.name = "TtsError";
    this.code = code;
  }
}

// ── Options ───────────────────────────────────────────────────────────

export interface TtsOptions {
  /** Path to script.json */
  scriptPath: string;
  /** Fully merged configuration */
  config: AutoVideoConfig;
  /** Only process these block IDs (comma-separated parsed) */
  blockIds?: string[];
  /** Force cache miss for all/specified blocks */
  force?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Dry run — show plan but don't execute */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface TtsResult {
  /** The updated script with audio fields populated */
  script: Script;
  /** Number of cache hits */
  cacheHits: number;
  /** Number of TTS API calls made */
  apiCalls: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 5_000;
const SILENCE_GAP_MS = 200;

/**
 * Compute MD5 hash of a file's contents.
 */
function md5File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(buf).digest("hex");
}

/**
 * Compute the voxcpmModelVersion from model config.
 * Hashes the config.json (or falls back to directory mtime).
 */
function computeVoxcpmModelVersion(modelDir: string): string {
  const configPath = path.join(modelDir, "config.json");
  if (fs.existsSync(configPath)) {
    return md5File(configPath).slice(0, 16);
  }
  // Fallback: hash the directory listing
  try {
    const files = fs.readdirSync(modelDir).sort().join(",");
    return crypto.createHash("md5").update(files).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

/**
 * Write a WAV buffer to a temporary file and return its path.
 */
function writeTempWav(prefix: string, buffer: Buffer): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-tts-"));
  const wavPath = path.join(tmpDir, `${prefix}.wav`);
  fs.writeFileSync(wavPath, buffer);
  return wavPath;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ──────────────────────────────────────────────────────────────

/**
 * Execute the TTS stage.
 *
 * @throws TtsError on fatal errors
 */
export async function tts(opts: TtsOptions): Promise<TtsResult> {
  const { config, verbose = false, dryRun = false, force = false, onProgress, signal } = opts;
  const { voxcpm: voxcpmCfg, cache: cacheCfg } = config;

  const emit = (percent: number, step: string, blockId?: string) => {
    onProgress?.({ percent, step, stage: "tts", blockId });
  };

  emit(0, "开始语音合成");

  // Check abort before starting
  if (signal?.aborted) throw new TtsError("TTS cancelled", "ERR_CANCELLED");

  // ── Step 1: Load and validate script ──────────────────────────────

  const scriptRaw = JSON.parse(
    fs.readFileSync(opts.scriptPath, "utf-8")
  ) as unknown;
  assertCompiledScript(scriptRaw);
  const script = scriptRaw as unknown as Script;

  const scriptDir = path.resolve(path.dirname(opts.scriptPath));

  if (verbose) {
    console.log(`[tts] Loaded script: ${script.meta.title}`);
    console.log(`[tts] Blocks: ${script.blocks.length}`);
    console.log(`[tts] VoiceRef: ${script.meta.voiceRef}`);
  }

  // ── Filter blocks ─────────────────────────────────────────────────

  let blocks = script.blocks;
  if (opts.blockIds && opts.blockIds.length > 0) {
    const idSet = new Set(opts.blockIds);
    blocks = blocks.filter((b) => idSet.has(b.id));
    if (verbose) {
      console.log(`[tts] Processing blocks: ${blocks.map((b) => b.id).join(", ")}`);
    }
  }

  if (blocks.length === 0) {
    throw new TtsError("No blocks to process");
  }

  // ── Dry run ───────────────────────────────────────────────────────

  if (dryRun) {
    let totalLines = 0;
    for (const block of blocks) {
      totalLines += block.narration.lines.length;
    }
    console.log(
      `Would process ${blocks.length} block(s), ${totalLines} line(s) total\n` +
        `  Concurrency: ${voxcpmCfg.concurrency}\n` +
        `  Endpoint: ${voxcpmCfg.endpoint}\n` +
        `  Force: ${force}`
    );
    return { script, cacheHits: 0, apiCalls: 0 };
  }

  // ── Step 2: Ensure VoxCPM server is running ───────────────────────

  const client = new VoxcpmClient({ endpoint: voxcpmCfg.endpoint });

  try {
    await ensureVoxcpmServer(client, { endpoint: voxcpmCfg.endpoint }, verbose);
  } catch (err) {
    throw new TtsError(
      `VoxCPM server unavailable: ${err instanceof Error ? err.message : err}\n` +
        "Run `autovideo doctor` to check your setup.",
      "ERR_VOXCPM_OFFLINE"
    );
  }

  // ── Step 3: Register voiceRef ─────────────────────────────────────

  const voiceRefPath = script.meta.voiceRef;
  if (!fs.existsSync(voiceRefPath)) {
    throw new TtsError(
      `Voice reference file not found: ${voiceRefPath}\n` +
        "Ensure the file exists or update voiceRef in meta.md."
    );
  }

  let voiceId: string;
  try {
    voiceId = await client.registerVoice(voiceRefPath);
    if (verbose) console.log(`[tts] Registered voice: ${voiceId}`);
  } catch (err) {
    throw new TtsError(
      `Failed to register voice: ${err instanceof Error ? err.message : err}`,
      "ERR_VOXCPM_VOICE_REGISTER"
    );
  }

  // ── Step 4: Compute cache-related hashes ──────────────────────────

  const voiceRefHash = md5File(voiceRefPath);
  const voxcpmModelVersion = computeVoxcpmModelVersion(voxcpmCfg.modelDir);

  if (verbose) {
    console.log(`[tts] voiceRefHash: ${voiceRefHash.slice(0, 8)}...`);
    console.log(`[tts] voxcpmModelVersion: ${voxcpmModelVersion.slice(0, 8)}...`);
  }

  emit(10, "服务就绪，开始处理语音行");

  // ── Initialize cache store ────────────────────────────────────────

  const cacheStore = new CacheStore({
    cacheDir: cacheCfg.dir,
    maxSizeGB: cacheCfg.maxSizeGB,
    evictTrigger: cacheCfg.evictTrigger,
  });

  // Run eviction check before starting
  await cacheStore.evictIfOverLimit("tts");

  // ── Step 5–8: Process blocks with concurrency ─────────────────────

  const abortController = new AbortController();
  // Forward external signal cancellation to internal abort controller
  if (signal) {
    if (signal.aborted) {
      abortController.abort(signal.reason);
      throw new TtsError("TTS cancelled", "ERR_CANCELLED");
    }
    signal.addEventListener("abort", () => abortController.abort(signal.reason), { once: true });
  }
  let cacheHits = 0;
  let apiCalls = 0;
  const failedBlocks: { blockId: string; error: string }[] = [];

  // Create audio output directory
  const audioDir = path.resolve(scriptDir, "public/audio");
  fs.mkdirSync(audioDir, { recursive: true });

  // Flatten all lines across all blocks for concurrent processing
  interface LineTask {
    blockId: string;
    blockIndex: number;
    lineIndex: number;
    ttsText: string;
    cacheKey: AudioKey;
  }

  const tasks: LineTask[] = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    for (let li = 0; li < block.narration.lines.length; li++) {
      const line = block.narration.lines[li];
      const cacheKey: AudioKey = {
        ttsText: line.ttsText,
        voiceRefHash,
        cfgValue: voxcpmCfg.cfgValue,
        inferenceTimesteps: voxcpmCfg.inferenceTimesteps,
        denoise: voxcpmCfg.denoise,
        voxcpmModelVersion,
      };
      tasks.push({
        blockId: block.id,
        blockIndex: bi,
        lineIndex: li,
        ttsText: line.ttsText,
        cacheKey,
      });
    }
  }

  if (verbose) {
    console.log(`[tts] Total lines to process: ${tasks.length}`);
  }

  // Results storage: blockId → lineIndex → { wavPath, durationSec }
  const lineResults = new Map<string, Map<number, { wavPath: string; durationSec: number }>>();

  // Process a single line task
  async function processLine(task: LineTask): Promise<void> {
    if (abortController.signal.aborted) return;

    const { blockId, lineIndex, ttsText, cacheKey } = task;

    // Initialize results map for this block
    if (!lineResults.has(blockId)) {
      lineResults.set(blockId, new Map());
    }
    const blockResults = lineResults.get(blockId)!;

    // ── Cache lookup ─────────────────────────────────────────────
    if (!force) {
      try {
        const cached = await cacheStore.get("audio", cacheKey);
        if (cached) {
          const durationSec = getWavDurationSec(cached);
          blockResults.set(lineIndex, { wavPath: cached, durationSec });
          cacheHits++;
          if (verbose) {
            console.log(`[tts] Cache hit: ${blockId} line ${lineIndex}`);
          }
          return;
        }
      } catch (err) {
        if (verbose) {
          console.warn(
            `[tts] Cache lookup error for ${blockId} line ${lineIndex}: ${err}`
          );
        }
      }
    }

    // ── TTS API call with retry ──────────────────────────────────
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
      if (abortController.signal.aborted) return;

      try {
        const wavBuffer = await client.speak(
          {
            text: ttsText,
            voiceId,
            cfgValue: voxcpmCfg.cfgValue,
            inferenceTimesteps: voxcpmCfg.inferenceTimesteps,
            denoise: voxcpmCfg.denoise,
            retryBadcase: voxcpmCfg.retryBadcase,
          },
          abortController.signal
        );

        apiCalls++;

        // Write to temp file to get duration
        const tmpWav = writeTempWav(`${blockId}_L${lineIndex}`, wavBuffer);
        const durationSec = getWavDurationSec(tmpWav);

        // Store in cache
        const cachedPath = await cacheStore.put("audio", cacheKey, tmpWav, cacheKey);

        // Clean up temp file
        try {
          fs.unlinkSync(tmpWav);
          fs.rmdirSync(path.dirname(tmpWav));
        } catch { /* ignore */ }

        blockResults.set(lineIndex, { wavPath: cachedPath, durationSec });

        if (verbose) {
          console.log(
            `[tts] API call: ${blockId} line ${lineIndex} (${durationSec.toFixed(2)}s)`
          );
        }
        return; // Success
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (verbose) {
          console.warn(
            `[tts] Attempt ${attempt}/${RETRY_COUNT} failed for ${blockId} line ${lineIndex}: ${lastError.message}`
          );
        }
        if (attempt < RETRY_COUNT) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    // All retries exhausted — abort everything
    const errorMsg = lastError?.message ?? "unknown error";
    failedBlocks.push({ blockId, error: errorMsg });
    console.error(
      `[tts] FAILED: ${blockId} line ${lineIndex} after ${RETRY_COUNT} retries: ${errorMsg}`
    );
    abortController.abort();
    throw new TtsError(
      `TTS failed for ${blockId} line ${lineIndex}: ${errorMsg}`,
      "ERR_TTS_LINE_FAILED"
    );
  }

  // Execute all line tasks with concurrency limit
  const limit = pLimit(voxcpmCfg.concurrency);
  const promises = tasks.map((task) => limit(() => processLine(task)));

  try {
    await Promise.all(promises);
  } catch (err) {
    // One or more tasks failed — check if we should report
    if (failedBlocks.length > 0) {
      const blockList = failedBlocks
        .map((f) => `  ${f.blockId}: ${f.error}`)
        .join("\n");
      const resumeIds = [...new Set(failedBlocks.map((f) => f.blockId))].join(",");
      throw new TtsError(
        `TTS failed for ${failedBlocks.length} line(s)\n\n` +
          `Failed lines:\n${blockList}\n\n` +
          `Resume after fixing the issue:\n` +
          `  autovideo tts ${opts.scriptPath} --block ${resumeIds} --force`,
        "ERR_TTS_LINE_FAILED"
      );
    }
    throw err;
  }

  if (signal?.aborted) throw new TtsError("TTS cancelled", "ERR_CANCELLED");

  emit(60, "拼接语音片段");

  // ── Step 7: Concatenate line WAVs per block ───────────────────────

  for (const block of blocks) {
    const blockResults = lineResults.get(block.id);
    if (!blockResults) {
      throw new TtsError(`No audio results for block ${block.id}`);
    }

    // Verify all lines are present
    for (let li = 0; li < block.narration.lines.length; li++) {
      if (!blockResults.has(li)) {
        throw new TtsError(
          `Missing audio for block ${block.id} line ${li}`
        );
      }
    }

    // Collect line WAV paths in order
    const lineWavPaths: string[] = [];
    const lineDurationsSec: number[] = [];
    for (let li = 0; li < block.narration.lines.length; li++) {
      const result = blockResults.get(li)!;
      lineWavPaths.push(result.wavPath);
      lineDurationsSec.push(result.durationSec);
    }

    // Concatenate with 200ms gaps
    const outputPath = path.resolve(audioDir, `${block.id}.wav`);
    const totalDurationSec = concatenateWavsWithGaps(
      lineWavPaths,
      outputPath
    );

    // ── Step 8: Compute lineTimings ──────────────────────────────

    const lineTimings: LineTiming[] = computeLineTimings(lineDurationsSec);

    // Write audio field to block
    (block as any).audio = {
      wavPath: `public/audio/${block.id}.wav`,
      durationSec: totalDurationSec,
      lineTimings,
    };

    if (verbose) {
      console.log(
        `[tts] Block ${block.id}: ${totalDurationSec.toFixed(2)}s, ` +
          `${block.narration.lines.length} lines`
      );
    }
  }

  // ── Step 9: Update script.json ────────────────────────────────────

  script.artifacts.audioGeneratedAt = new Date().toISOString();

  const scriptJson = JSON.stringify(script, null, 2);
  fs.writeFileSync(opts.scriptPath, scriptJson, "utf-8");

  // Also update public/script.json if it exists
  const publicScriptPath = path.resolve(scriptDir, "public/script.json");
  if (fs.existsSync(publicScriptPath)) {
    fs.writeFileSync(publicScriptPath, scriptJson, "utf-8");
  }

  if (verbose) {
    console.log(
      `[tts] Complete: ${cacheHits} cache hits, ${apiCalls} API calls`
    );
  }

  emit(100, "语音合成完成");

  return { script, cacheHits, apiCalls };
}