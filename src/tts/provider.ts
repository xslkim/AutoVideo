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
   *
   * `options.instruct` is the per-line emotion/style instruction (CosyVoice3
   * instruct, IndexTTS emotion description). Same per-call contract as
   * `salt`: callers that vary it per line must fold it into their own cache
   * key — cacheDescriptor() only covers the configured default.
   */
  speak(
    text: string,
    voiceId: string,
    options?: {
      chain?: SpeakChain;
      salt?: string;
      instruct?: string;
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

/**
 * Optional CosyVoice fields pending their addition to `CosyVoiceConfig` in
 * src/config/defaults.ts (see docs/upgrade-2026/integration/tts-emotion.md).
 * Read structurally so this provider works today without touching the shared
 * config schema.
 */
interface CosyVoiceInstructExtension {
  /**
   * CosyVoice3 instruct: natural-language emotion/style instruction applied
   * to every line (e.g. "请耐心讲解" / "请非常轻快地说"). Per-line overrides
   * arrive via `speak` options.instruct. Env fallback: COSYVOICE_INSTRUCT.
   */
  instruct?: string;
}

/**
 * Resolve the default instruct for a CosyVoice provider, in priority order:
 *   1. `cosyvoice.instruct` in the config (pending src/config schema addition)
 *   2. the COSYVOICE_INSTRUCT environment variable
 * Empty string / unset → the server's COSYVOICE_INSTRUCT_PREFIX default.
 */
export function resolveCosyVoiceInstruct(
  cfg: AutoVideoConfig["cosyvoice"],
): string | undefined {
  const fromConfig = (cfg as CosyVoiceInstructExtension).instruct?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.COSYVOICE_INSTRUCT?.trim();
  return fromEnv || undefined;
}

export class CosyVoiceProvider implements TtsProvider {
  readonly name = "cosyvoice";
  // Every line is synthesized with the SAME registered voiceRef as zero-shot
  // prompt — the engine never consumes the line continuation chain.
  readonly usesChain = false;

  private readonly client: CosyVoiceClient;
  private readonly cfg: AutoVideoConfig["cosyvoice"];
  private readonly modelVersion: string;
  private readonly defaultInstruct?: string;
  /** md5 of the resolved prompt_text, captured at registerVoice time. */
  private promptTextHash?: string;

  constructor(cfg: AutoVideoConfig["cosyvoice"]) {
    this.cfg = cfg;
    this.client = new CosyVoiceClient({ endpoint: cfg.endpoint });
    this.modelVersion = computeModelVersion(cfg.modelDir);
    this.defaultInstruct = resolveCosyVoiceInstruct(cfg);
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
      instruct?: string;
      signal?: AbortSignal;
    },
  ): Promise<Buffer> {
    // options.chain is deliberately ignored (usesChain = false).
    return this.client.speak(
      {
        text,
        voiceId,
        normalize: this.cfg.normalize,
        speed: this.cfg.speed ?? 1.0,
        seedSalt: options?.salt ?? this.cfg.seedSalt ?? "",
        instruct: options?.instruct ?? this.defaultInstruct,
      },
      options?.signal,
    );
  }

  cacheDescriptor(): Record<string, string | number | boolean> {
    return {
      normalize: this.cfg.normalize,
      modelVersion: this.modelVersion,
      // Speed changes the produced audio — fold it in only when non-default
      // so existing 1.0 cache entries stay byte-identical.
      ...((this.cfg.speed ?? 1.0) !== 1.0 ? { speed: this.cfg.speed! } : {}),
      // The configured default instruct shapes every take; per-call
      // overrides (options.instruct) are the caller's cache-key
      // responsibility, like salt.
      ...(this.defaultInstruct ? { instruct: this.defaultInstruct } : {}),
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
// IndexTTS (IndexTTS-2.5)
// ---------------------------------------------------------------------------

/**
 * IndexTTS-2.5 engine settings. The matching `indextts` section of
 * autovideo.config.json is pending its src/config schema addition (see
 * docs/upgrade-2026/integration/tts-emotion.md); until then every field
 * falls back to an INDEXTTS_* environment variable, then to the defaults.
 */
export interface IndexTtsConfig {
  /** indextts-tts service endpoint */
  endpoint: string;
  /** IndexTTS-2.5 model weights directory (used for cache-key versioning) */
  modelDir: string;
  /**
   * Default natural-language emotion description (e.g. "平静耐心地讲解").
   * Per-line overrides arrive via `speak` options.instruct. When set, it
   * joins the audio cache key — changing it re-synthesizes everything.
   */
  emotion?: string;
  /**
   * Speaking-rate factor (1.0 = model default, >1 = faster). When set
   * (!= 1.0), it joins the audio cache key.
   */
  durationFactor?: number;
  /** Folded into the server-side deterministic seed; change to re-roll takes. */
  seedSalt?: string;
  /** Max concurrent TTS lines (the server serializes GPU generation; keep 1) */
  concurrency: number;
}

/**
 * Resolve the effective IndexTTS config: `config.indextts` over INDEXTTS_*
 * env vars over defaults.
 */
export function resolveIndexTtsConfig(config: AutoVideoConfig): IndexTtsConfig {
  const section: Partial<IndexTtsConfig> = config.indextts ?? {};
  const envFactor = Number(process.env.INDEXTTS_DURATION_FACTOR);
  return {
    endpoint:
      section.endpoint ?? process.env.INDEXTTS_ENDPOINT ?? "http://127.0.0.1:8004",
    modelDir: section.modelDir ?? process.env.INDEXTTS_MODEL_DIR ?? "",
    emotion: section.emotion ?? process.env.INDEXTTS_EMOTION ?? undefined,
    durationFactor:
      section.durationFactor ??
      (Number.isFinite(envFactor) && envFactor > 0 ? envFactor : undefined),
    seedSalt: section.seedSalt ?? process.env.INDEXTTS_SEED_SALT ?? "",
    concurrency: section.concurrency ?? 1,
  };
}

/**
 * Minimal HTTP client for the indextts-tts FastAPI server
 * (third_servers/indextts-tts/server.py). Same endpoint surface as
 * CosyVoiceClient, minus prompt_text (IndexTTS cloning needs no reference
 * transcript), plus emotion / duration_factor on /v1/speech.
 */
class IndexTtsClient {
  private readonly endpoint: string;
  private readonly timeout: number;

  constructor(opts: { endpoint: string; timeout?: number }) {
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.timeout = opts.timeout ?? 60_000;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Register a reference WAV; voice_id is the wav fingerprint (idempotent). */
  async registerVoice(wavPath: string): Promise<string> {
    const wavBytes = fs.readFileSync(wavPath);
    const res = await fetch(`${this.endpoint}/v1/voices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav_base64: wavBytes.toString("base64") }),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`IndexTTS /v1/voices failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as { voice_id: string };
    if (!data.voice_id) {
      throw new Error("IndexTTS /v1/voices returned no voice_id");
    }
    return data.voice_id;
  }

  async speak(
    opts: {
      text: string;
      voiceId: string;
      seedSalt?: string;
      emotion?: string;
      durationFactor?: number;
    },
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const res = await fetch(`${this.endpoint}/v1/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: opts.text,
        voice_id: opts.voiceId,
        seed_salt: opts.seedSalt ?? "",
        ...(opts.emotion ? { emotion: opts.emotion } : {}),
        ...(opts.durationFactor !== undefined && opts.durationFactor !== 1.0
          ? { duration_factor: opts.durationFactor }
          : {}),
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)])
        : AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`IndexTTS /v1/speech failed (${res.status}): ${text}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
}

export class IndexTtsProvider implements TtsProvider {
  readonly name = "indextts";
  // Same consistency strategy as CosyVoice: one registered voiceRef as the
  // cloning prompt for every line, no continuation chain.
  readonly usesChain = false;

  private readonly client: IndexTtsClient;
  private readonly cfg: IndexTtsConfig;
  private readonly modelVersion: string;

  constructor(cfg: IndexTtsConfig) {
    this.cfg = cfg;
    this.client = new IndexTtsClient({ endpoint: cfg.endpoint });
    this.modelVersion = cfg.modelDir ? computeModelVersion(cfg.modelDir) : "unconfigured";
  }

  async ensureReady(verbose = false): Promise<void> {
    const healthy = await this.client.isHealthy();
    if (!healthy) {
      throw new TtsProviderError(
        `IndexTTS server is not reachable (or its model is still loading) at ${this.cfg.endpoint}.\n` +
          "Start it first — see third_servers/indextts-tts/README.md, or run `autovideo doctor`.",
      );
    }
    if (verbose) {
      console.log(`[tts] IndexTTS server reachable at ${this.cfg.endpoint}`);
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
      instruct?: string;
      signal?: AbortSignal;
    },
  ): Promise<Buffer> {
    return this.client.speak(
      {
        text,
        voiceId,
        seedSalt: options?.salt ?? this.cfg.seedSalt ?? "",
        // The shared per-call instruct slot carries the emotion description
        // for this engine.
        emotion: options?.instruct ?? this.cfg.emotion,
        durationFactor: this.cfg.durationFactor,
      },
      options?.signal,
    );
  }

  cacheDescriptor(): Record<string, string | number | boolean> {
    return {
      modelVersion: this.modelVersion,
      pipeline: TTS_PIPELINE_VERSION,
      ...(this.cfg.emotion ? { emotion: this.cfg.emotion } : {}),
      ...(this.cfg.durationFactor !== undefined && this.cfg.durationFactor !== 1.0
        ? { durationFactor: this.cfg.durationFactor }
        : {}),
      ...(this.cfg.seedSalt ? { seedSalt: this.cfg.seedSalt } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type TtsProviderName = "voxcpm" | "cosyvoice" | "indextts";

/** Build the provider selected by `config.tts.provider` (default: voxcpm). */
export function createTtsProvider(config: AutoVideoConfig): TtsProvider {
  const name: TtsProviderName = config.tts?.provider ?? "voxcpm";
  switch (name) {
    case "voxcpm":
      return new VoxcpmProvider(config.voxcpm);
    case "cosyvoice":
      return new CosyVoiceProvider(config.cosyvoice);
    case "indextts":
      return new IndexTtsProvider(resolveIndexTtsConfig(config));
    default:
      throw new TtsProviderError(
        `Unknown TTS provider "${name}". Supported: voxcpm, cosyvoice, indextts`,
      );
  }
}

/**
 * The selected provider's engine section, shaped for the TTS stage's
 * dry-run display and QA salt base (endpoint / concurrency / seedSalt).
 */
export function resolveProviderSection(
  config: AutoVideoConfig,
): { endpoint: string; concurrency: number; seedSalt?: string } {
  const name: TtsProviderName = config.tts?.provider ?? "voxcpm";
  switch (name) {
    case "cosyvoice":
      return config.cosyvoice;
    case "indextts":
      return resolveIndexTtsConfig(config);
    default:
      return config.voxcpm;
  }
}
