/**
 * AutoVideo — VoxCPM HTTP client
 *
 * Provides typed methods for interacting with the voxcpm2-api FastAPI server.
 * Endpoints (PRD §6.2):
 *   GET  /health              → { status: "ok" }
 *   POST /v1/voices           → { voice_id: string }
 *   POST /v1/speech           → WAV binary (48kHz)
 */

import { readFileSync } from "node:fs";

export interface VoxcpmClientOptions {
  /** Base URL of the voxcpm2-api server (e.g. "http://127.0.0.1:8000") */
  endpoint: string;
  /** Request timeout in ms (default 60000) */
  timeout?: number;
}

export interface SpeakOptions {
  text: string;
  voiceId: string;
  cfgValue: number;
  inferenceTimesteps: number;
  denoise: boolean;
  retryBadcase: boolean;
}

export class VoxcpmClient {
  private readonly endpoint: string;
  private readonly timeout: number;

  constructor(opts: VoxcpmClientOptions) {
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.timeout = opts.timeout ?? 60_000;
  }

  // ── Health check ───────────────────────────────────────────────────

  /**
   * Check if the voxcpm2-api server is reachable.
   * Returns true if the server responds with 200.
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
   * Register a reference WAV file and get a voice_id.
   * The voice_id is valid for the current server session only.
   * (PRD §6.2.2: re-register every stage run)
   */
  async registerVoice(wavPath: string): Promise<string> {
    const wavBytes = readFileSync(wavPath);
    const base64 = wavBytes.toString("base64");

    const res = await fetch(`${this.endpoint}/v1/voices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav_base64: base64 }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(
        `VoxCPM /v1/voices failed (${res.status}): ${text}`
      );
    }

    const data = (await res.json()) as { voice_id: string };
    if (!data.voice_id) {
      throw new Error("VoxCPM /v1/voices returned no voice_id");
    }
    return data.voice_id;
  }

  // ── Speech synthesis ───────────────────────────────────────────────

  /**
   * Synthesize speech for a single narration line.
   * Returns WAV audio buffer (48kHz).
   */
  async speak(opts: SpeakOptions, signal?: AbortSignal): Promise<Buffer> {
    const res = await fetch(`${this.endpoint}/v1/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: opts.text,
        voice_id: opts.voiceId,
        cfg_value: opts.cfgValue,
        inference_timesteps: opts.inferenceTimesteps,
        denoise: opts.denoise,
        retry_badcase: opts.retryBadcase,
      }),
      signal: signal ?? AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(
        `VoxCPM /v1/speech failed (${res.status}): ${text}`
      );
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
}