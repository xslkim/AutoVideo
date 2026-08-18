/**
 * AutoVideo — TTS provider abstraction
 *
 * The TTS stage used to talk to VoxCPM directly. Swapping engines (for a model
 * with stronger Chinese/English code-switching, for instance) meant editing the
 * stage itself, and — more dangerously — would have silently reused cached
 * audio produced by the old engine.
 *
 * A provider owns three things: how to reach the engine, how to synthesize a
 * line, and which of its settings belong in the audio cache key.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { VoxcpmClient } from "./voxcpm-client.js";
import { ensureVoxcpmServer } from "./voxcpm-server.js";
import type { AutoVideoConfig } from "../config/defaults.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface TtsProvider {
  /** Stable identifier, folded into the audio cache key */
  readonly name: string;

  /** Verify the engine is reachable; throw an actionable error if not. */
  ensureReady(verbose?: boolean): Promise<void>;

  /**
   * Register a reference recording and return a handle for `speak`.
   * Engines without voice cloning may return a constant.
   */
  registerVoice(wavPath: string): Promise<string>;

  /** Synthesize one narration line; resolves to WAV bytes. */
  speak(
    text: string,
    voiceId: string,
    chain?: SpeakChain,
    signal?: AbortSignal,
  ): Promise<Buffer>;

  /**
   * Settings that change the produced audio. Everything returned here goes
   * into the cache key, so a provider must list every knob it actually uses.
   */
  cacheDescriptor(): Record<string, string | number | boolean>;
}

export class TtsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsProviderError";
  }
}

/**
 * Continuation context for line-level voice chaining: the previous line's
 * synthesized audio + its raw text, used by the engine as a continuation
 * prompt so every line of a block keeps the same voice.
 */
export interface SpeakChain {
  prevWav?: Buffer;
  prevText?: string;
}

// ---------------------------------------------------------------------------
// VoxCPM
// ---------------------------------------------------------------------------

/**
 * Version marker for the local VoxCPM weights, derived from config.json (or
 * the directory listing when that file is absent).
 */
function computeVoxcpmModelVersion(modelDir: string): string {
  const configPath = path.join(modelDir, "config.json");
  if (fs.existsSync(configPath)) {
    const buf = fs.readFileSync(configPath);
    return crypto.createHash("md5").update(buf).digest("hex").slice(0, 16);
  }
  try {
    const files = fs.readdirSync(modelDir).sort().join(",");
    return crypto.createHash("md5").update(files).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

export class VoxcpmProvider implements TtsProvider {
  readonly name = "voxcpm";

  private readonly client: VoxcpmClient;
  private readonly cfg: AutoVideoConfig["voxcpm"];
  private readonly modelVersion: string;

  constructor(cfg: AutoVideoConfig["voxcpm"]) {
    this.cfg = cfg;
    this.client = new VoxcpmClient({ endpoint: cfg.endpoint });
    this.modelVersion = computeVoxcpmModelVersion(cfg.modelDir);
  }

  async ensureReady(verbose = false): Promise<void> {
    try {
      await ensureVoxcpmServer(this.client, { endpoint: this.cfg.endpoint }, verbose);
    } catch (err) {
      throw new TtsProviderError(err instanceof Error ? err.message : String(err));
    }
  }

  registerVoice(wavPath: string): Promise<string> {
    return this.client.registerVoice(wavPath);
  }

  speak(
    text: string,
    voiceId: string,
    chain?: SpeakChain,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return this.client.speak(
      {
        text,
        voiceId,
        cfgValue: this.cfg.cfgValue,
        inferenceTimesteps: this.cfg.inferenceTimesteps,
        denoise: this.cfg.denoise,
        retryBadcase: this.cfg.retryBadcase,
        normalize: this.cfg.normalize,
        prevWav: chain?.prevWav,
        prevText: chain?.prevText,
        seedSalt: this.cfg.seedSalt ?? "",
      },
      signal,
    );
  }

  cacheDescriptor(): Record<string, string | number | boolean> {
    return {
      cfgValue: this.cfg.cfgValue,
      inferenceTimesteps: this.cfg.inferenceTimesteps,
      denoise: this.cfg.denoise,
      normalize: this.cfg.normalize,
      modelVersion: this.modelVersion,
      // Only fold the salt into the cache key when set — the empty default
      // keeps providerParamsJson byte-identical to pre-salt cache entries.
      ...(this.cfg.seedSalt ? { seedSalt: this.cfg.seedSalt } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type TtsProviderName = "voxcpm";

/** Build the provider selected by `config.tts.provider` (default: voxcpm). */
export function createTtsProvider(config: AutoVideoConfig): TtsProvider {
  const name = config.tts?.provider ?? "voxcpm";
  switch (name) {
    case "voxcpm":
      return new VoxcpmProvider(config.voxcpm);
    default:
      throw new TtsProviderError(
        `Unknown TTS provider "${name}". Supported: voxcpm`,
      );
  }
}
