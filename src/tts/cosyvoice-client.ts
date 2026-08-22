/**
 * AutoVideo — CosyVoice HTTP client
 *
 * Provides typed methods for interacting with the cosyvoice-tts FastAPI server
 * (third_servers/cosyvoice-tts/server.py). Endpoints:
 *   GET  /health              → { status: "ok" } (503 while the model loads)
 *   POST /v1/voices           → { voice_id: string }  (md5 of the wav; idempotent)
 *   POST /v1/speech           → WAV binary (48kHz)
 *
 * Unlike VoxCPM, CosyVoice zero-shot cloning requires the reference wav's
 * transcript (`prompt_text`); voices without one fail synthesis with 400.
 */

import { readFileSync } from "node:fs";

export interface CosyVoiceClientOptions {
  /** Base URL of the cosyvoice-tts server (e.g. "http://127.0.0.1:8002") */
  endpoint: string;
  /** Request timeout in ms (default 60000) */
  timeout?: number;
}

export interface CosyVoiceSpeakOptions {
  text: string;
  voiceId: string;
  /**
   * Run the engine's text normalization (numbers, symbols). The server always
   * applies CJK↔ASCII boundary spacing regardless of this flag.
   */
  normalize: boolean;
  /** Folded into the server-side deterministic seed; change to re-roll takes. */
  seedSalt?: string;
}

export class CosyVoiceClient {
  private readonly endpoint: string;
  private readonly timeout: number;

  constructor(opts: CosyVoiceClientOptions) {
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.timeout = opts.timeout ?? 60_000;
  }

  // ── Health check ───────────────────────────────────────────────────

  /**
   * Check if the cosyvoice-tts server is reachable AND the model has finished
   * loading (the server answers 503 while loading / after a load failure).
   */
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

  // ── Register voice ─────────────────────────────────────────────────

  /**
   * Register a reference WAV file together with its transcript and get a
   * voice_id. The voice_id is the wav's content fingerprint, so re-registering
   * is idempotent; a later call may attach/replace prompt_text.
   */
  async registerVoice(wavPath: string, promptText: string): Promise<string> {
    const wavBytes = readFileSync(wavPath);
    const base64 = wavBytes.toString("base64");

    const res = await fetch(`${this.endpoint}/v1/voices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav_base64: base64, prompt_text: promptText }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(
        `CosyVoice /v1/voices failed (${res.status}): ${text}`
      );
    }

    const data = (await res.json()) as { voice_id: string };
    if (!data.voice_id) {
      throw new Error("CosyVoice /v1/voices returned no voice_id");
    }
    return data.voice_id;
  }

  // ── Speech synthesis ───────────────────────────────────────────────

  /**
   * Synthesize speech for a single narration line (zero-shot with the
   * registered voice as prompt — no line chaining).
   * Returns WAV audio buffer (48kHz).
   */
  async speak(opts: CosyVoiceSpeakOptions, signal?: AbortSignal): Promise<Buffer> {
    const res = await fetch(`${this.endpoint}/v1/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: opts.text,
        voice_id: opts.voiceId,
        seed_salt: opts.seedSalt ?? "",
        normalize: opts.normalize,
      }),
      // The stage always passes its own signal, so `signal ?? timeout` would
      // disable the timeout entirely — a hung GPU server would stall the
      // stage forever. Compose both: caller cancellation OR client timeout.
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)])
        : AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(
        `CosyVoice /v1/speech failed (${res.status}): ${text}`
      );
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
}
