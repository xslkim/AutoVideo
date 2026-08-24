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
 *   5. p-limit(provider concurrency) across blocks; lines within a block run
 *      sequentially as a continuation chain (prev line's audio = next line's
 *      prompt) to keep the cloned voice stable
 *   6. Per line: cache lookup (key includes predecessor's audio hash) →
 *      miss → client.speak() → QA gate (ffmpeg analysis, salted re-roll) →
 *      put cache
 *   7. Block concatenation: concat all line WAVs + punctuation-aware silence → public/audio/B**.wav
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
import { computeGapsMs } from "../tts/gaps.js";
import { createTtsProvider, TtsProviderError } from "../tts/provider.js";
import { analyzeLineAudio, type LineAudioReport } from "../tts/qa.js";
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
 * Strip ASCII parentheses from spoken text.
 *
 * Narration often mentions code identifiers like `apply()` — the engine
 * would read the parens aloud as "左括号/右括号". They carry no spoken
 * meaning, so they are removed before synthesis (the text inside stays).
 * Full-width （） are Chinese punctuation and are left untouched.
 * Subtitles always show the original ttsText; this only affects speech.
 */
export function stripCodeParens(text: string): string {
  return text.replace(/[()]/g, "");
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
 * Remove a temp WAV written by writeTempWav, together with its mkdtemp dir.
 */
function removeTempWav(wavPath: string): void {
  try {
    fs.unlinkSync(wavPath);
    fs.rmdirSync(path.dirname(wavPath));
  } catch { /* ignore */ }
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
  const { cache: cacheCfg } = config;
  // Engine-specific settings follow the selected provider: the concurrency
  // used to be read from the voxcpm section even under cosyvoice (whose
  // server serializes GPU generation, so it defaults to 1).
  const providerCfg = config.tts?.provider === "cosyvoice" ? config.cosyvoice : config.voxcpm;

  // Synthesis QA gate (src/tts/qa.ts): analyze each take, re-roll flagged
  // ones with a per-call salt. tts.qa.enabled === false skips it entirely.
  const qaEnabled = config.tts?.qa?.enabled !== false;
  const qaMaxRetries = config.tts?.qa?.maxRetries ?? 2;

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
        `  Concurrency: ${providerCfg.concurrency}\n` +
        `  Endpoint: ${providerCfg.endpoint}\n` +
        `  Force: ${force}`
    );
    return { script, cacheHits: 0, apiCalls: 0 };
  }

  // ── Step 2: Ensure the TTS engine is reachable ────────────────────

  const provider = createTtsProvider(config);

  try {
    await provider.ensureReady(verbose);
  } catch (err) {
    const detail = err instanceof TtsProviderError || err instanceof Error ? err.message : String(err);
    throw new TtsError(
      `TTS engine "${provider.name}" unavailable: ${detail}\n` +
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
    voiceId = await provider.registerVoice(voiceRefPath);
    if (verbose) console.log(`[tts] Registered voice: ${voiceId}`);
  } catch (err) {
    throw new TtsError(
      `Failed to register voice: ${err instanceof Error ? err.message : err}`,
      "ERR_VOXCPM_VOICE_REGISTER"
    );
  }

  // ── Step 4: Compute cache-related hashes ──────────────────────────

  const voiceRefHash = md5File(voiceRefPath);
  const providerParamsJson = JSON.stringify(provider.cacheDescriptor());

  if (verbose) {
    console.log(`[tts] provider: ${provider.name}`);
    console.log(`[tts] voiceRefHash: ${voiceRefHash.slice(0, 8)}...`);
    console.log(`[tts] providerParams: ${providerParamsJson}`);
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

  // Results storage: blockId → lineIndex → { wavPath, durationSec }
  const lineResults = new Map<string, Map<number, { wavPath: string; durationSec: number }>>();

  if (verbose) {
    const totalLines = blocks.reduce((n, b) => n + b.narration.lines.length, 0);
    console.log(`[tts] Total lines to process: ${totalLines}`);
  }

  /**
   * Process one block's lines SEQUENTIALLY.
   *
   * Lines are a continuation chain: line N is synthesized with line N-1's
   * audio as the prompt (VoxCPM2 ref_continuation mode), which keeps the
   * cloned voice stable across the block. A line's waveform therefore
   * depends on its predecessor — the cache key folds in the predecessor's
   * content hash (chainPrevHash), so re-generating any line correctly
   * invalidates the lines after it. Block level stays parallel via pLimit.
   */
  async function processBlock(block: Block): Promise<void> {
    const blockResults = new Map<number, { wavPath: string; durationSec: number }>();
    lineResults.set(block.id, blockResults);

    let prevWav: Buffer | undefined;
    let prevText: string | undefined;
    let prevHash: string | undefined;

    for (let li = 0; li < block.narration.lines.length; li++) {
      if (abortController.signal.aborted) return;

      const line = block.narration.lines[li];
      // dict.md rewrites reach the engine but never the subtitles;
      // ASCII parens (code identifiers like apply()) are not read aloud.
      const spoken = stripCodeParens(line.speakText ?? line.ttsText);
      const cacheKey: AudioKey = {
        ttsText: spoken,
        voiceRefHash,
        provider: provider.name,
        providerParamsJson,
        // chainPrevHash is always present: the block's first line pins the
        // "null" sentinel, later lines carry the predecessor's audio md5, and
        // providers that ignore the chain (usesChain=false) pin "null" for
        // every line.
        chainPrevHash: provider.usesChain ? (prevHash ?? "null") : "null",
      };

      // ── Cache lookup ────────────────────────────────────────────
      let wavPath: string | null = null;
      if (!force) {
        try {
          const cached = await cacheStore.get("audio", cacheKey);
          if (cached) {
            wavPath = cached;
            cacheHits++;
            if (verbose) {
              console.log(`[tts] Cache hit: ${block.id} line ${li}`);
            }
          }
        } catch (err) {
          if (verbose) {
            console.warn(
              `[tts] Cache lookup error for ${block.id} line ${li}: ${err}`
            );
          }
        }
      }

      // ── TTS API call with retry ─────────────────────────────────
      if (!wavPath) {
        let lastError: Error | null = null;
        let tmpWav: string | null = null;
        for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
          if (abortController.signal.aborted) return;

          try {
            const wavBuffer = await provider.speak(spoken, voiceId, {
              chain: { prevWav, prevText },
              signal: abortController.signal,
            });

            apiCalls++;

            // Write to a temp file; QA analysis and caching work on the file.
            tmpWav = writeTempWav(`${block.id}_L${li}`, wavBuffer);
            break; // Success
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (verbose) {
              console.warn(
                `[tts] Attempt ${attempt}/${RETRY_COUNT} failed for ${block.id} line ${li}: ${lastError.message}`
              );
            }
            if (attempt < RETRY_COUNT) {
              await sleep(RETRY_DELAY_MS);
            }
          }
        }

        if (!tmpWav) {
          // All retries exhausted — abort everything
          const errorMsg = lastError?.message ?? "unknown error";
          failedBlocks.push({ blockId: block.id, error: errorMsg });
          console.error(
            `[tts] FAILED: ${block.id} line ${li} after ${RETRY_COUNT} retries: ${errorMsg}`
          );
          abortController.abort();
          throw new TtsError(
            `TTS failed for ${block.id} line ${li}: ${errorMsg}`,
            "ERR_TTS_LINE_FAILED"
          );
        }

        // ── QA gate: analyze the take, re-roll flagged ones with salt ──
        // Runs after a successful synthesis, BEFORE the take enters the
        // cache (cache hits were already QA'd on their way in). Re-rolls
        // reuse the same cacheKey — the salt is a per-call override, not
        // part of the key — so the final put below overwrites any earlier
        // take. Independent of the HTTP retry loop: own counter, no sleep.
        let accepted = tmpWav;
        if (qaEnabled) {
          let bestPath = tmpWav;
          let bestReport: LineAudioReport = await analyzeLineAudio(tmpWav, spoken);
          for (let n = 1; !bestReport.pass && n <= qaMaxRetries; n++) {
            if (abortController.signal.aborted) return;
            const salt = `${providerCfg.seedSalt ?? ""}:qa:${n}`;
            try {
              const wavBuffer = await provider.speak(spoken, voiceId, {
                chain: { prevWav, prevText },
                salt,
                signal: abortController.signal,
              });
              apiCalls++;
              const rePath = writeTempWav(`${block.id}_L${li}_qa${n}`, wavBuffer);
              const report = await analyzeLineAudio(rePath, spoken);
              // A passing take scores 100, above any flagged take, so this
              // also prefers the first pass over a higher-scoring failure.
              if (report.score > bestReport.score) {
                removeTempWav(bestPath);
                bestPath = rePath;
                bestReport = report;
              } else {
                removeTempWav(rePath);
              }
            } catch (err) {
              // A re-roll that fails at HTTP level just burns its attempt;
              // the previous best take stays alive.
              if (verbose) {
                console.warn(
                  `[tts] QA re-roll ${n}/${qaMaxRetries} failed for ${block.id} line ${li}: ${err instanceof Error ? err.message : err}`
                );
              }
            }
          }
          if (bestReport.issues[0]?.startsWith("probe_error")) {
            // Every take (initial + re-rolls) is unreadable by ffprobe.
            // Caching it would brick the line permanently: the next run
            // cache-hits the same broken file and dies in getWavDurationSec
            // below. Never put — fail the line through the standard
            // failedBlocks path (same as exhausted HTTP retries).
            removeTempWav(bestPath);
            const errorMsg = `all takes unreadable: ${bestReport.issues.join(", ")}`;
            failedBlocks.push({ blockId: block.id, error: errorMsg });
            console.error(`[tts] FAILED: ${block.id} line ${li}: ${errorMsg}`);
            abortController.abort();
            throw new TtsError(
              `TTS failed for ${block.id} line ${li}: ${errorMsg}`,
              "ERR_TTS_LINE_FAILED"
            );
          }
          if (!bestReport.pass) {
            // Never abort on QA: accept the best-scoring take and warn.
            console.warn(
              `[tts] QA gate: ${block.id} line ${li} still flagged after ${qaMaxRetries} re-roll(s); ` +
                `accepting best take (score ${bestReport.score}): ${bestReport.issues.join(", ")}`
            );
          }
          accepted = bestPath;
        }

        // Store in cache
        const cachedPath = await cacheStore.put("audio", cacheKey, accepted, cacheKey);

        // Clean up temp file
        removeTempWav(accepted);

        wavPath = cachedPath;

        if (verbose) {
          console.log(
            `[tts] API call: ${block.id} line ${li} (${getWavDurationSec(cachedPath).toFixed(2)}s)`
          );
        }
      }

      const durationSec = getWavDurationSec(wavPath);
      blockResults.set(li, { wavPath, durationSec });

      // Advance the chain: this line's audio prompts the next line.
      prevWav = fs.readFileSync(wavPath);
      prevText = spoken;
      prevHash = crypto.createHash("md5").update(prevWav).digest("hex");
    }
  }

  // Blocks run in parallel; lines within a block are sequential (chained).
  const limit = pLimit(providerCfg.concurrency);
  const promises = blocks.map((block) => limit(() => processBlock(block)));

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

    // Pause length follows the punctuation each line ends with, so a comma
    // does not get the same beat as a full stop. The same gaps feed the
    // subtitle timings below — they must not diverge.
    const gapsMs = computeGapsMs(block.narration.lines.map((l) => l.ttsText));

    const outputPath = path.resolve(audioDir, `${block.id}.wav`);
    const totalDurationSec = concatenateWavsWithGaps(lineWavPaths, outputPath, {
      gapsSec: gapsMs.map((ms) => ms / 1000),
    });

    // ── Step 8: Compute lineTimings ──────────────────────────────

    const lineTimings: LineTiming[] = computeLineTimings(lineDurationsSec, gapsMs);

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