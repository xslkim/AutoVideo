/**
 * CosyVoiceClient contract tests against a local mock HTTP server, mirroring
 * the mock style of tests/cli/tts.test.ts. Locks down the wire contract of
 * third_servers/cosyvoice-tts/server.py:
 *   GET  /health     → 200 when ready, 503 while the model loads
 *   POST /v1/voices  → { wav_base64, prompt_text } → { voice_id }
 *   POST /v1/speech  → { text, voice_id, seed_salt, normalize } → WAV bytes
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { CosyVoiceClient } from "../../src/tts/cosyvoice-client.js";

// ── Mock cosyvoice-tts server ───────────────────────────────────────────

function createMockServer(): Promise<{
  url: string;
  server: http.Server;
  voiceBodies: { value: Record<string, unknown>[] };
  speechBodies: { value: Record<string, unknown>[] };
  setHealthStatus: (code: number) => void;
}> {
  const voiceBodies: { value: Record<string, unknown>[] } = { value: [] };
  const speechBodies: { value: Record<string, unknown>[] } = { value: [] };
  let healthStatus = 200;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      const parsed = body ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};

      if (req.url === "/health") {
        res.writeHead(healthStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify(healthStatus === 200 ? { status: "ok" } : { detail: "model is still loading" }));
        return;
      }

      if (req.url === "/v1/voices") {
        voiceBodies.value.push(parsed);
        if (!parsed.prompt_text) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "prompt_text required" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ voice_id: "cosy_voice_1" }));
        return;
      }

      if (req.url === "/v1/speech") {
        speechBodies.value.push(parsed);
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(Buffer.from("RIFF-fake-wav"));
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
          url: `http://127.0.0.1:${addr.port}`,
          server,
          voiceBodies,
          speechBodies,
          setHealthStatus: (code: number) => { healthStatus = code; },
        });
      } else {
        reject(new Error("Failed to start mock server"));
      }
    });
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("CosyVoiceClient", () => {
  let mock: Awaited<ReturnType<typeof createMockServer>>;
  let client: CosyVoiceClient;
  let tempDir: string;
  let wavPath: string;

  beforeAll(async () => {
    mock = await createMockServer();
  });

  afterAll(() => {
    mock.server.close();
  });

  beforeEach(() => {
    client = new CosyVoiceClient({ endpoint: mock.url });
    mock.voiceBodies.value = [];
    mock.speechBodies.value = [];
    mock.setHealthStatus(200);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-cosy-client-"));
    wavPath = path.join(tempDir, "B00.wav");
    fs.writeFileSync(wavPath, Buffer.from("fake-wav-bytes"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports healthy when /health answers 200", async () => {
    expect(await client.isHealthy()).toBe(true);
  });

  it("reports unhealthy while the model is still loading (503)", async () => {
    mock.setHealthStatus(503);
    expect(await client.isHealthy()).toBe(false);
  });

  it("reports unhealthy when the server is unreachable", async () => {
    const down = new CosyVoiceClient({ endpoint: "http://127.0.0.1:1" });
    expect(await down.isHealthy()).toBe(false);
  });

  it("registerVoice sends wav_base64 + prompt_text and returns voice_id", async () => {
    const voiceId = await client.registerVoice(wavPath, "参考音频文本");
    expect(voiceId).toBe("cosy_voice_1");
    expect(mock.voiceBodies.value).toHaveLength(1);
    const body = mock.voiceBodies.value[0];
    expect(body.prompt_text).toBe("参考音频文本");
    expect(Buffer.from(String(body.wav_base64), "base64").toString()).toBe("fake-wav-bytes");
  });

  it("registerVoice throws on server error", async () => {
    // The mock answers 400 when prompt_text is missing; send one anyway but
    // point at a voice path the mock rejects by emptying prompt_text.
    await expect(client.registerVoice(wavPath, "")).rejects.toThrow(
      /\/v1\/voices failed \(400\)/,
    );
  });

  it("speak posts the cosy contract (no voxcpm-only fields) and returns WAV bytes", async () => {
    const wav = await client.speak({
      text: "你好 world",
      voiceId: "cosy_voice_1",
      normalize: true,
      seedSalt: "salt-1",
    });
    expect(wav.toString()).toBe("RIFF-fake-wav");
    expect(mock.speechBodies.value).toHaveLength(1);
    const body = mock.speechBodies.value[0];
    expect(body).toEqual({
      text: "你好 world",
      voice_id: "cosy_voice_1",
      seed_salt: "salt-1",
      normalize: true,
    });
  });

  it("speak defaults seed_salt to empty string", async () => {
    await client.speak({ text: "hi", voiceId: "v", normalize: false });
    expect(mock.speechBodies.value[0].seed_salt).toBe("");
    expect(mock.speechBodies.value[0].normalize).toBe(false);
  });
});
