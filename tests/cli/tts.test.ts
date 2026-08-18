/**
 * T3.5 — TTS command acceptance tests
 *
 * Acceptance criteria:
 * - E2E (mock voxcpm-api): 2 blocks × 5 lines script runs to completion,
 *   script.json contains complete audio fields, public/audio/B01.wav exists
 * - Cache hit test: run twice, second time has 0 API calls
 * - Failure handling: retries work, abort controller cancels in-flight
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { tts, type TtsOptions } from "../../src/cli/tts.js";
import { gapAfterMs } from "../../src/tts/gaps.js";
import type { AutoVideoConfig } from "../../src/config/defaults.js";
import type { Script } from "../../src/types/script.js";

// ── Generate a valid minimal WAV buffer (48kHz, mono, 16-bit PCM) ──────

function generateWavBuffer(durationSec: number = 0.3, freqHz: number = 440): Buffer {
  const sampleRate = 48000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const headerSize = 44;
  const buf = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);

  // fmt chunk
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);             // PCM format
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  // Fill with a simple sine wave
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const val = Math.floor(Math.sin(2 * Math.PI * freqHz * t) * 8000);
    buf.writeInt16LE(val, 44 + i * 2);
  }

  return buf;
}

/**
 * Deterministic stand-in for real synthesis: the WAV depends on the text
 * AND the continuation prompt, mirroring the real engine where line N's
 * waveform is a function of line N-1's audio. This makes chain-invalidation
 * behavior testable.
 */
function wavForRequest(parsed: Record<string, unknown>): Buffer {
  const basis = `${parsed.text ?? ""}|${parsed.prev_wav_base64 ?? ""}`;
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) >>> 0;
  return generateWavBuffer(0.3, 220 + (h % 440));
}

// ── Mock VoxCPM server ──────────────────────────────────────────────────

function createMockServer(): Promise<{
  port: number;
  url: string;
  server: http.Server;
  speechCallCount: { value: number };
  voiceCallCount: { value: number };
  speechBodies: { value: Record<string, unknown>[] };
  setFailNextSpeech: (n: number) => void;
}> {
  const speechCallCount = { value: 0 };
  const voiceCallCount = { value: 0 };
  const speechBodies: { value: Record<string, unknown>[] } = { value: [] };
  let failNextSpeech = 0;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      const parsed = body ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};

      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (req.url === "/v1/voices") {
        voiceCallCount.value++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ voice_id: "v_test123" }));
        return;
      }

      if (req.url === "/v1/speech") {
        speechCallCount.value++;
        speechBodies.value.push(parsed);
        if (failNextSpeech > 0) {
          failNextSpeech--;
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "simulated failure" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(wavForRequest(parsed));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        resolve({
          port: addr.port,
          url: `http://127.0.0.1:${addr.port}`,
          server,
          speechCallCount,
          voiceCallCount,
          speechBodies,
          setFailNextSpeech: (n: number) => { failNextSpeech = n; },
        });
      } else {
        reject(new Error("Failed to start mock server"));
      }
    });
  });
}

// ── Test helpers ────────────────────────────────────────────────────────

function makeConfig(mockUrl: string, cacheDir: string): AutoVideoConfig {
  return {
    voxcpm: {
      endpoint: mockUrl,
      modelDir: "/nonexistent/model",
      autoStart: false,
      cfgValue: 2.0,
      inferenceTimesteps: 10,
      denoise: false,
      retryBadcase: true,
      concurrency: 4,
    },
    anthropic: {
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-6",
      promptCaching: true,
      maxRetries: 3,
      concurrency: 4,
    },
    render: {
      blockConcurrency: 4,
      framesConcurrencyPerBlock: null,
      browser: null,
      minHoldSec: 1.5,
      defaultEnterSec: 0.5,
      defaultExitSec: 0.3,
      loudnorm: {
        i: -16,
        tp: -1.5,
        lra: 11,
        twoPass: true,
        audioBitrate: "192k",
      },
    },
    cache: {
      dir: cacheDir,
      maxSizeGB: 20,
      evictTrigger: "stage-start" as const,
    },
  };
}

function makeTestScript(voiceRefPath: string): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "TTS Test",
      voiceRef: voiceRefPath,
      aspect: "16:9" as const,
      width: 1920,
      height: 1080,
      fps: 30,
      theme: "dark-code",
      subtitleSafeBottom: 162,
    },
    blocks: [
      {
        id: "B01",
        title: "Block One",
        enter: "fade" as const,
        exit: "fade" as const,
        visual: { description: "Test visual B01" },
        narration: {
          lines: [
            { text: "第一行内容，", ttsText: "第一行内容，", highlights: [] },
            { text: "第二行内容。", ttsText: "第二行内容。", highlights: [] },
            { text: "第三行内容：", ttsText: "第三行内容：", highlights: [] },
            { text: "第四行内容", ttsText: "第四行内容", highlights: [] },
            { text: "第五行内容。", ttsText: "第五行内容。", highlights: [] },
          ],
        },
      },
      {
        id: "B02",
        title: "Block Two",
        enter: "fade" as const,
        exit: "fade" as const,
        visual: { description: "Test visual B02" },
        narration: {
          lines: [
            { text: "第二块第一行", ttsText: "第二块第一行", highlights: [] },
            { text: "第二块第二行", ttsText: "第二块第二行", highlights: [] },
            { text: "第二块第三行", ttsText: "第二块第三行", highlights: [] },
            { text: "第二块第四行", ttsText: "第二块第四行", highlights: [] },
            { text: "第二块第五行", ttsText: "第二块第五行", highlights: [] },
          ],
        },
      },
    ],
    assets: {},
    artifacts: {
      compiledAt: "2026-01-01T00:00:00Z",
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("TTS command", () => {
  let mock: Awaited<ReturnType<typeof createMockServer>>;
  let tempDir: string;
  let voiceRefPath: string;
  let cacheDir: string;

  beforeAll(async () => {
    mock = await createMockServer();
  });

  afterAll(() => {
    mock.server.close();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-tts-test-"));
    cacheDir = path.join(tempDir, "cache");

    // Create a valid voiceRef WAV
    voiceRefPath = path.join(tempDir, "B00.wav");
    fs.writeFileSync(voiceRefPath, generateWavBuffer(1.0));

    // Reset counters
    mock.speechCallCount.value = 0;
    mock.voiceCallCount.value = 0;
    mock.speechBodies.value = [];
    mock.setFailNextSpeech(0);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeScript(script: Script): string {
    const scriptPath = path.join(tempDir, "script.json");
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), "utf-8");
    // Ensure public dir exists
    fs.mkdirSync(path.join(tempDir, "public"), { recursive: true });
    return scriptPath;
  }

  function makeOpts(scriptPath: string, overrides?: Partial<TtsOptions>): TtsOptions {
    return {
      scriptPath,
      config: makeConfig(mock.url, cacheDir),
      verbose: false,
      ...overrides,
    };
  }

  // ── E2E test ──────────────────────────────────────────────────────

  it("E2E: 2 blocks × 5 lines → complete audio fields + WAV files", async () => {
    const scriptPath = writeScript(makeTestScript(voiceRefPath));
    const result = await tts(makeOpts(scriptPath, { verbose: true }));

    // Check result counts
    expect(result.apiCalls).toBe(10); // 2 blocks × 5 lines
    expect(result.cacheHits).toBe(0);

    // Check script.json was updated with audio fields
    const updatedScript: Script = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));

    for (const block of updatedScript.blocks) {
      expect(block.audio).toBeDefined();
      expect(block.audio!.wavPath).toBe(`public/audio/${block.id}.wav`);
      expect(block.audio!.durationSec).toBeGreaterThan(0);
      expect(block.audio!.lineTimings).toHaveLength(5);

      // Verify lineTimings structure
      const timings = block.audio!.lineTimings;
      for (let i = 0; i < timings.length; i++) {
        expect(timings[i].lineIndex).toBe(i);
        expect(timings[i].startMs).toBeGreaterThanOrEqual(0);
        expect(timings[i].endMs).toBeGreaterThan(timings[i].startMs);
      }

      // The gap before each line is the one implied by the previous line's
      // trailing punctuation.
      for (let i = 1; i < timings.length; i++) {
        const gap = timings[i].startMs - timings[i - 1].endMs;
        expect(gap).toBe(gapAfterMs(block.narration.lines[i - 1].ttsText));
      }
    }

    // Check artifacts updated
    expect(updatedScript.artifacts.audioGeneratedAt).toBeDefined();

    // Check WAV files exist on disk
    const b01Path = path.resolve(tempDir, "public/audio/B01.wav");
    const b02Path = path.resolve(tempDir, "public/audio/B02.wav");
    expect(fs.existsSync(b01Path)).toBe(true);
    expect(fs.existsSync(b02Path)).toBe(true);

    // Verify WAV files are valid audio (have reasonable size)
    expect(fs.statSync(b01Path).size).toBeGreaterThan(44);
    expect(fs.statSync(b02Path).size).toBeGreaterThan(44);
  });

  // ── Cache hit test ────────────────────────────────────────────────

  it("Cache hit: second run on fresh script → 0 API calls", async () => {
    // First run
    const scriptPath1 = writeScript(makeTestScript(voiceRefPath));
    const result1 = await tts(makeOpts(scriptPath1));
    expect(result1.apiCalls).toBe(10);
    expect(result1.cacheHits).toBe(0);

    const firstRunApiCalls = mock.speechCallCount.value;
    expect(firstRunApiCalls).toBe(10);

    // Reset counter
    mock.speechCallCount.value = 0;

    // Second run with a fresh script (same content → same cache keys)
    const scriptPath2 = writeScript(makeTestScript(voiceRefPath));
    const result2 = await tts(makeOpts(scriptPath2));

    // All from cache — no new API calls
    expect(result2.apiCalls).toBe(0);
    expect(result2.cacheHits).toBe(10);
    expect(mock.speechCallCount.value).toBe(0);

    // WAV files still created
    expect(fs.existsSync(path.resolve(tempDir, "public/audio/B01.wav"))).toBe(true);
    expect(fs.existsSync(path.resolve(tempDir, "public/audio/B02.wav"))).toBe(true);

    // Script has correct audio fields
    const script2: Script = JSON.parse(fs.readFileSync(scriptPath2, "utf-8"));
    expect(script2.blocks[0].audio).toBeDefined();
    expect(script2.blocks[1].audio).toBeDefined();
  });

  // ── Block filter test ─────────────────────────────────────────────

  it("--block filter: only processes specified blocks", async () => {
    const scriptPath = writeScript(makeTestScript(voiceRefPath));
    const result = await tts(makeOpts(scriptPath, { blockIds: ["B02"] }));

    expect(result.apiCalls).toBe(5); // only B02's 5 lines

    const updatedScript: Script = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    expect(updatedScript.blocks[1].audio).toBeDefined(); // B02 has audio
    expect(updatedScript.blocks[0].audio).toBeUndefined(); // B01 untouched
  });

  // ── Dry run test ──────────────────────────────────────────────────

  it("dry run: shows plan without executing", async () => {
    const scriptPath = writeScript(makeTestScript(voiceRefPath));
    const result = await tts(makeOpts(scriptPath, { dryRun: true }));

    expect(result.apiCalls).toBe(0);
    expect(result.cacheHits).toBe(0);

    // No audio files created
    expect(fs.existsSync(path.resolve(tempDir, "public/audio/B01.wav"))).toBe(false);

    // Script not modified
    const script: Script = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    expect(script.blocks[0].audio).toBeUndefined();
  });

  // ── Missing voiceRef test ─────────────────────────────────────────

  it("throws on missing voiceRef file", async () => {
    const badScript = makeTestScript("/nonexistent/voice.wav");
    const scriptPath = writeScript(badScript);

    await expect(tts(makeOpts(scriptPath))).rejects.toThrow(/Voice reference file not found/);
  });

  // ── Empty blocks test ─────────────────────────────────────────────

  it("throws on no blocks", async () => {
    const emptyScript: Script = {
      meta: {
        schemaVersion: "1.0",
        title: "Empty",
        voiceRef: voiceRefPath,
        aspect: "16:9",
        width: 1920,
        height: 1080,
        fps: 30,
        theme: "dark-code",
        subtitleSafeBottom: 162,
      },
      blocks: [],
      assets: {},
      artifacts: { compiledAt: "2026-01-01T00:00:00Z" },
    };
    const scriptPath = writeScript(emptyScript);

    await expect(tts(makeOpts(scriptPath))).rejects.toThrow(/blocks array is empty/);
  });

  // ── Line chaining test ────────────────────────────────────────────

  it("chains lines within a block: line N carries line N-1 audio+text, first line has none", async () => {
    const scriptPath = writeScript(makeTestScript(voiceRefPath));
    await tts(makeOpts(scriptPath));

    const bodies = mock.speechBodies.value;
    expect(bodies).toHaveLength(10);

    const byText = new Map(bodies.map((b) => [b.text as string, b]));

    // First line of each block: no continuation prompt
    const b01First = byText.get("第一行内容，")!;
    const b02First = byText.get("第二块第一行")!;
    for (const first of [b01First, b02First]) {
      expect(first.prev_wav_base64).toBeUndefined();
      expect(first.prev_text).toBeUndefined();
    }

    // Later lines: carry the previous line's raw text and audio
    const b01Second = byText.get("第二行内容。")!;
    expect(b01Second.prev_text).toBe("第一行内容，");
    expect(typeof b01Second.prev_wav_base64).toBe("string");
    expect((b01Second.prev_wav_base64 as string).length).toBeGreaterThan(0);

    const b02Fifth = byText.get("第二块第五行")!;
    expect(b02Fifth.prev_text).toBe("第二块第四行");
    expect(typeof b02Fifth.prev_wav_base64).toBe("string");
  });

  // ── Chain invalidation test ───────────────────────────────────────

  it("chain invalidation: re-synthesizing a line busts the cache of later lines", async () => {
    // Run 1: populate cache
    const scriptPath1 = writeScript(makeTestScript(voiceRefPath));
    await tts(makeOpts(scriptPath1));
    expect(mock.speechCallCount.value).toBe(10);

    // Make the mock return different audio for B01 line 0 onwards
    mock.speechCallCount.value = 0;
    mock.speechBodies.value = [];

    // Run 2 with a script where B01 line 0 text changed — line 0 gets a new
    // (unchained) key → miss; every later B01 line's chainPrevHash changes →
    // miss. B02 is untouched → all hits.
    const script2 = makeTestScript(voiceRefPath);
    script2.blocks[0].narration.lines[0].ttsText = "改动后的第一行，";
    const scriptPath2 = writeScript(script2);
    const result = await tts(makeOpts(scriptPath2));

    // B01: all 5 lines re-synthesized (chain busted); B02: 5 cache hits
    expect(result.apiCalls).toBe(5);
    expect(result.cacheHits).toBe(5);
  });

  // ── Retry test ────────────────────────────────────────────────────

  it("retries on transient failures and eventually succeeds", async () => {
    // Make the first 2 speech calls fail, then succeed
    mock.setFailNextSpeech(2);

    const scriptPath = writeScript(makeTestScript(voiceRefPath));
    const result = await tts(makeOpts(scriptPath, { verbose: true }));

    // Should still complete — retries handle the 2 failures
    // Total API calls = 10 successful + 2 failed = 12
    expect(result.apiCalls).toBeGreaterThanOrEqual(10);
    expect(result.script.blocks[0].audio).toBeDefined();
    expect(result.script.blocks[1].audio).toBeDefined();
    expect(fs.existsSync(path.resolve(tempDir, "public/audio/B01.wav"))).toBe(true);
  }, 30_000); // longer timeout for retries (5s delay each)
});