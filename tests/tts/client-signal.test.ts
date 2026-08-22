/**
 * Speak-timeout composition tests for both TTS clients.
 *
 * tts.ts always passes its stage AbortSignal into speak(), so a bare
 * `signal ?? AbortSignal.timeout(...)` would disable the client timeout
 * entirely — a hung GPU server would stall the stage forever. Both clients
 * must compose the caller's cancellation WITH the client timeout
 * (AbortSignal.any), and must still honor an externally aborted signal.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { CosyVoiceClient } from "../../src/tts/cosyvoice-client.js";
import { VoxcpmClient } from "../../src/tts/voxcpm-client.js";

// ── Mock server: /v1/speech answers only after 5s (a "hung GPU") ───────

const SERVER_DELAY_MS = 5_000;

function createHangingServer(): Promise<{ url: string; server: http.Server }> {
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/speech") {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(Buffer.from("RIFF-late"));
      }, SERVER_DELAY_MS);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        resolve({ url: `http://127.0.0.1:${addr.port}`, server });
      } else {
        reject(new Error("Failed to start mock server"));
      }
    });
  });
}

describe("TTS client timeout composition", () => {
  let mock: { url: string; server: http.Server };

  beforeAll(async () => {
    mock = await createHangingServer();
  });

  afterAll(() => {
    mock.server.close();
  });

  it("cosyvoice: client timeout fires even when the caller passes a live signal", async () => {
    const client = new CosyVoiceClient({ endpoint: mock.url, timeout: 100 });
    // A live external signal that will not fire within the test — with the
    // old `signal ?? timeout` shape it would suppress the timeout entirely.
    const external = new AbortController().signal;
    const start = Date.now();
    await expect(
      client.speak({ text: "hi", voiceId: "v", normalize: false }, external)
    ).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(SERVER_DELAY_MS);
  });

  it("voxcpm: client timeout fires even when the caller passes a live signal", async () => {
    const client = new VoxcpmClient({ endpoint: mock.url, timeout: 100 });
    const external = new AbortController().signal;
    const start = Date.now();
    await expect(
      client.speak(
        {
          text: "hi",
          voiceId: "v",
          cfgValue: 2.0,
          inferenceTimesteps: 10,
          denoise: false,
          retryBadcase: true,
          normalize: false,
        },
        external
      )
    ).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(SERVER_DELAY_MS);
  });

  it("external cancellation still wins over the composite signal", async () => {
    const client = new CosyVoiceClient({ endpoint: mock.url, timeout: 60_000 });
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    await expect(
      client.speak({ text: "hi", voiceId: "v", normalize: false }, controller.signal)
    ).rejects.toThrow();
    // Aborted before any server work — nowhere near the client timeout.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("no caller signal: the plain timeout branch still applies", async () => {
    const client = new CosyVoiceClient({ endpoint: mock.url, timeout: 100 });
    const start = Date.now();
    await expect(
      client.speak({ text: "hi", voiceId: "v", normalize: false })
    ).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(SERVER_DELAY_MS);
  });
});
