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
import { CosyVoiceClient } from "./cosyvoice-client.js";
import { TTS_PIPELINE_VERSION, type AutoVideoConfig } from "../config/defaults.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface TtsProvider {
  /** Stable identifier, folded into the audio cache key */
  readonly name: string;

  /**
   * Whether the engine consumes the line continuation chain (`SpeakChain`).
   * Drives the cache key: chained providers fold the predecessor's audio hash
   * into every line after the first; unchained providers pin "null".
   */
  readonly usesChain: boolean;

  /** Verify the engine is reachable; throw an actionable error if not. */
  ensureReady(verbose?: boolean): Promise<void>;

  /**
   * Register a reference recording and return a handle for `speak`.
   * Engines without voice cloning may return a constant.
   */
  registerVoice(wavPath: string): Promise<string>;

  /**
   * Synthesize one narration line; resolves to WAV bytes.
   *
   * `options.salt` overrides the configured seed salt for this call only
   * (QA re-roll); being per-call, it is NOT folded into cacheDescriptor.
   */
  speak(
    text: string,
    voiceId: string,
    options?: {
      chain?: SpeakChain;
      salt?: string;
      signal?: AbortSignal;
    },
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
 * Version marker for local model weights, derived from config.json (or the
 * directory listing when that file is absent).
 */
function computeModelVersion(modelDir: string): string {
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
  readonly usesChain = true;

  private readonly client: VoxcpmClient;
  private readonly cfg: AutoVideoConfig["voxcpm"];
  private readonly modelVersion: string;

  constructor(cfg: AutoVideoConfig["voxcpm"]) {
    this.cfg = cfg;
    this.client = new VoxcpmClient({ endpoint: cfg.endpoint });
    this.modelVersion = computeModelVersion(cfg.modelDir);
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
    options?: {
      chain?: SpeakChain;
      salt?: string;
      signal?: AbortSignal;
    },
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
        prevWav: options?.chain?.prevWav,
        prevText: options?.chain?.prevText,
        seedSalt: options?.salt ?? this.cfg.seedSalt ?? "",
      },
      options?.signal,
    );
  }

  cacheDescriptor(): Record<string, string | number | boolean> {
    return {
      cfgValue: this.cfg.cfgValue,
      inferenceTimesteps: this.cfg.inferenceTimesteps,
      denoise: this.cfg.denoise,
      normalize: this.cfg.normalize,
      modelVersion: this.modelVersion,
      // Post-processing pipeline version (server clip-guard + client-side
      // per-line gain alignment): bumping it invalidates old audio once.
      pipeline: TTS_PIPELINE_VERSION,
      // Only fold the salt into the cache key when set — the empty default
      // keeps providerParamsJson byte-identical to pre-salt cache entries.
      ...(this.cfg.seedSalt ? { seedSalt: this.cfg.seedSalt } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// CosyVoice
// ---------------------------------------------------------------------------

/**
 * Resolve the reference transcript CosyVoice zero-shot cloning needs, in
 * priority order:
 *   1. `cosyvoice.referenceText` in the config
 *   2. a same-named `.txt` file next to the voiceRef wav (B00.wav → B00.txt)
 * Throws an actionable error when neither exists.
 */
export function resolveCosyVoicePromptText(
  cfg: AutoVideoConfig["cosyvoice"],
  wavPath: string,
): string {
  const fromConfig = cfg.referenceText?.trim();
  if (fromConfig) return fromConfig;

  const sidecar = path.join(
    path.dirname(wavPath),
    path.basename(wavPath, path.extname(wavPath)) + ".txt",
  );
  if (fs.existsSync(sidecar)) {
    const text = fs.readFileSync(sidecar, "utf-8").trim();
    if (text) return text;
  }

  throw new TtsProviderError(
    `CosyVoice zero-shot cloning requires the transcript of the reference wav, ` +
      `but none was found for "${wavPath}". Provide it in one of two ways:\n` +
      `  1. set cosyvoice.referenceText in autovideo.config.json, or\n` +
      `  2. place a same-named .txt file next to the voiceRef wav ("${sidecar}").`,
  );
}

export class CosyVoiceProvider implements TtsProvider {
  readonly name = "cosyvoice";
  // Every line is synthesized with the SAME registered voiceRef as zero-shot
  // prompt — the engine never consumes the line continuation chain.
  readonly usesChain = false;

  private readonly client: CosyVoiceClient;
  private readonly cfg: AutoVideoConfig["cosyvoice"];
  private readonly modelVersion: string;
  /** md5 of the resolved prompt_text, captured at registerVoice time. */
  private promptTextHash?: string;

  constructor(cfg: AutoVideoConfig["cosyvoice"]) {
    this.cfg = cfg;
    this.client = new CosyVoiceClient({ endpoint: cfg.endpoint });
    this.modelVersion = computeModelVersion(cfg.modelDir);
  }

  async ensureReady(verbose = false): Promise<void> {
    const healthy = await this.client.isHealthy();
    if (!healthy) {
      throw new TtsProviderError(
        `CosyVoice server is not reachable (or its model is still loading) at ${this.cfg.endpoint}.\n` +
          "Start it first — see third_servers/cosyvoice-tts/README.md, or run `autovideo doctor`.",
      );
    }
    if (verbose) {
      console.log(`[tts] CosyVoice server reachable at ${this.cfg.endpoint}`);
    }
  }

  async registerVoice(wavPath: string): Promise<string> {
    // Resolution throws before any HTTP call when no transcript is available.
    const promptText = resolveCosyVoicePromptText(this.cfg, wavPath);
    this.promptTextHash = crypto
      .createHash("md5")
      .update(promptText, "utf-8")
      .digest("hex");
    return this.client.registerVoice(wavPath, promptText);
  }

  speak(
    text: string,
    voiceId: string,
    options?: {
      chain?: SpeakChain;
      salt?: string;
      signal?: AbortSignal;
    },
  ): Promise<Buffer> {
    // options.chain is deliberately ignored (usesChain = false).
    return this.client.speak(
      {
        text,
        voiceId,
        normalize: this.cfg.normalize,
        seedSalt: options?.salt ?? this.cfg.seedSalt ?? "",
      },
      options?.signal,
    );
  }

  cacheDescriptor(): Record<string, string | number | boolean> {
    return {
      normalize: this.cfg.normalize,
      modelVersion: this.modelVersion,
      // Post-processing pipeline version (server clip-guard + client-side
      // per-line gain alignment): bumping it invalidates old audio once.
      pipeline: TTS_PIPELINE_VERSION,
      // The resolved reference transcript shapes the generated audio, so its
      // hash must join the cache key — editing the .txt / referenceText then
      // re-synthesizes instead of silently reusing stale audio. Captured by
      // registerVoice, which the TTS stage always runs before building keys.
      // ORDERING CONTRACT: cacheDescriptor() must be called AFTER
      // registerVoice() — before it, promptTextHash is unset and the key
      // silently misses the field.
      ...(this.promptTextHash ? { promptTextHash: this.promptTextHash } : {}),
      // Only fold the salt into the cache key when set — the empty default
      // keeps providerParamsJson stable.
      ...(this.cfg.seedSalt ? { seedSalt: this.cfg.seedSalt } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type TtsProviderName = "voxcpm" | "cosyvoice";

/** Build the provider selected by `config.tts.provider` (default: voxcpm). */
export function createTtsProvider(config: AutoVideoConfig): TtsProvider {
  const name = config.tts?.provider ?? "voxcpm";
  switch (name) {
    case "voxcpm":
      return new VoxcpmProvider(config.voxcpm);
    case "cosyvoice":
      return new CosyVoiceProvider(config.cosyvoice);
    default:
      throw new TtsProviderError(
        `Unknown TTS provider "${name}". Supported: voxcpm, cosyvoice`,
      );
  }
}
