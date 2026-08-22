/**
 * TtsProvider contract: chaining declaration and cache descriptor contents.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import {
  VoxcpmProvider,
  CosyVoiceProvider,
  createTtsProvider,
  resolveCosyVoicePromptText,
  TtsProviderError,
} from "../../src/tts/provider.js";
import { DEFAULT_CONFIG, TTS_PIPELINE_VERSION } from "../../src/config/defaults.js";

const voxCfg = { ...DEFAULT_CONFIG.voxcpm, modelDir: "/nonexistent/model" };

describe("VoxcpmProvider", () => {
  it("declares line chaining (usesChain)", () => {
    expect(new VoxcpmProvider(voxCfg).usesChain).toBe(true);
  });

  it("folds the post-processing pipeline version into the cache descriptor", () => {
    const descriptor = new VoxcpmProvider(voxCfg).cacheDescriptor();
    expect(descriptor.pipeline).toBe("2");
    expect(descriptor.pipeline).toBe(TTS_PIPELINE_VERSION);
  });

  it("omits seedSalt from the descriptor when unset (stable default key)", () => {
    const descriptor = new VoxcpmProvider({ ...voxCfg, seedSalt: "" }).cacheDescriptor();
    expect(descriptor).not.toHaveProperty("seedSalt");
  });

  it("includes seedSalt in the descriptor when configured", () => {
    const descriptor = new VoxcpmProvider({ ...voxCfg, seedSalt: "reroll" }).cacheDescriptor();
    expect(descriptor.seedSalt).toBe("reroll");
  });
});

describe("createTtsProvider", () => {
  it("builds the voxcpm provider by default", () => {
    const provider = createTtsProvider(DEFAULT_CONFIG);
    expect(provider.name).toBe("voxcpm");
    expect(provider.usesChain).toBe(true);
  });

  it("builds the cosyvoice provider when selected", () => {
    const provider = createTtsProvider({
      ...DEFAULT_CONFIG,
      tts: { provider: "cosyvoice" },
    });
    expect(provider.name).toBe("cosyvoice");
    expect(provider.usesChain).toBe(false);
  });

  it("rejects unknown provider names", () => {
    expect(() =>
      createTtsProvider({
        ...DEFAULT_CONFIG,
        tts: { provider: "nope" as "voxcpm" },
      }),
    ).toThrow(/Unknown TTS provider "nope"/);
  });
});

// ── CosyVoice ───────────────────────────────────────────────────────────

const md5 = (s: string) => crypto.createHash("md5").update(s, "utf-8").digest("hex");

/** Minimal mock of third_servers/cosyvoice-tts/server.py. */
function createCosyMockServer(): Promise<{
  url: string;
  server: http.Server;
  voiceBodies: { value: Record<string, unknown>[] };
  speechBodies: { value: Record<string, unknown>[] };
}> {
  const voiceBodies: { value: Record<string, unknown>[] } = { value: [] };
  const speechBodies: { value: Record<string, unknown>[] } = { value: [] };

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
        voiceBodies.value.push(parsed);
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
        resolve({ url: `http://127.0.0.1:${addr.port}`, server, voiceBodies, speechBodies });
      } else {
        reject(new Error("Failed to start mock server"));
      }
    });
  });
}

describe("CosyVoiceProvider", () => {
  let mock: Awaited<ReturnType<typeof createCosyMockServer>>;
  let tempDir: string;
  let wavPath: string;

  const cosyCfg = () => ({
    ...DEFAULT_CONFIG.cosyvoice,
    endpoint: mock.url,
    modelDir: "/nonexistent/model",
  });

  beforeAll(async () => {
    mock = await createCosyMockServer();
  });

  afterAll(() => {
    mock.server.close();
  });

  beforeEach(() => {
    mock.voiceBodies.value = [];
    mock.speechBodies.value = [];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-cosy-provider-"));
    wavPath = path.join(tempDir, "B00.wav");
    fs.writeFileSync(wavPath, Buffer.from("fake-wav-bytes"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("declares no line chaining (usesChain = false)", () => {
    expect(new CosyVoiceProvider(cosyCfg()).usesChain).toBe(false);
  });

  it("folds the post-processing pipeline version into the cache descriptor", () => {
    const descriptor = new CosyVoiceProvider(cosyCfg()).cacheDescriptor();
    expect(descriptor.pipeline).toBe(TTS_PIPELINE_VERSION);
  });

  it("omits seedSalt from the descriptor when unset (stable default key)", () => {
    const descriptor = new CosyVoiceProvider(cosyCfg()).cacheDescriptor();
    expect(descriptor).not.toHaveProperty("seedSalt");
  });

  it("includes seedSalt in the descriptor when configured", () => {
    const descriptor = new CosyVoiceProvider({ ...cosyCfg(), seedSalt: "reroll" }).cacheDescriptor();
    expect(descriptor.seedSalt).toBe("reroll");
  });

  it("registerVoice uploads the sidecar .txt transcript and folds its hash into the descriptor", async () => {
    fs.writeFileSync(path.join(tempDir, "B00.txt"), "旁白参考文本\n");
    const provider = new CosyVoiceProvider(cosyCfg());

    const voiceId = await provider.registerVoice(wavPath);
    expect(voiceId).toBe("cosy_voice_1");
    // trimmed before upload and hashing
    expect(mock.voiceBodies.value[0].prompt_text).toBe("旁白参考文本");
    expect(provider.cacheDescriptor().promptTextHash).toBe(md5("旁白参考文本"));
  });

  it("cosyvoice.referenceText config wins over the sidecar .txt", async () => {
    fs.writeFileSync(path.join(tempDir, "B00.txt"), "txt 文本");
    const provider = new CosyVoiceProvider({ ...cosyCfg(), referenceText: "配置文本" });

    await provider.registerVoice(wavPath);
    expect(mock.voiceBodies.value[0].prompt_text).toBe("配置文本");
    expect(provider.cacheDescriptor().promptTextHash).toBe(md5("配置文本"));
  });

  it("changing the reference text changes promptTextHash (cache invalidation)", async () => {
    const p1 = new CosyVoiceProvider({ ...cosyCfg(), referenceText: "文本 A" });
    await p1.registerVoice(wavPath);
    const p2 = new CosyVoiceProvider({ ...cosyCfg(), referenceText: "文本 B" });
    await p2.registerVoice(wavPath);
    expect(p1.cacheDescriptor().promptTextHash).not.toBe(
      p2.cacheDescriptor().promptTextHash,
    );
  });

  it("registerVoice throws an actionable error when no transcript is available", async () => {
    const provider = new CosyVoiceProvider(cosyCfg());
    await expect(provider.registerVoice(wavPath)).rejects.toThrow(TtsProviderError);
    await expect(provider.registerVoice(wavPath)).rejects.toThrow(
      /cosyvoice\.referenceText[\s\S]*B00\.txt/,
    );
    // Resolution fails before any HTTP call.
    expect(mock.voiceBodies.value).toHaveLength(0);
  });

  it("speak maps salt to seed_salt and ignores the chain", async () => {
    const provider = new CosyVoiceProvider({ ...cosyCfg(), seedSalt: "base" });
    const wav = await provider.speak("你好", "cosy_voice_1", {
      chain: { prevWav: Buffer.from("prev"), prevText: "上一行" },
      salt: "qa-reroll",
    });
    expect(wav.toString()).toBe("RIFF-fake-wav");
    const body = mock.speechBodies.value[0];
    expect(body.seed_salt).toBe("qa-reroll");
    expect(body).not.toHaveProperty("prev_wav_base64");
    expect(body).not.toHaveProperty("prev_text");
  });

  it("speak falls back to the configured seedSalt", async () => {
    const provider = new CosyVoiceProvider({ ...cosyCfg(), seedSalt: "base" });
    await provider.speak("你好", "cosy_voice_1");
    expect(mock.speechBodies.value[0].seed_salt).toBe("base");
  });
});

describe("resolveCosyVoicePromptText", () => {
  let tempDir: string;
  let wavPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-cosy-resolve-"));
    wavPath = path.join(tempDir, "B00.wav");
    fs.writeFileSync(wavPath, Buffer.from("fake-wav-bytes"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const cfg = DEFAULT_CONFIG.cosyvoice;

  it("prefers cosyvoice.referenceText over the sidecar .txt", () => {
    fs.writeFileSync(path.join(tempDir, "B00.txt"), "txt 文本");
    expect(
      resolveCosyVoicePromptText({ ...cfg, referenceText: "  配置文本  " }, wavPath),
    ).toBe("配置文本");
  });

  it("falls back to the same-named .txt next to the wav", () => {
    fs.writeFileSync(path.join(tempDir, "B00.txt"), "  txt 文本\n");
    expect(resolveCosyVoicePromptText(cfg, wavPath)).toBe("txt 文本");
  });

  it("treats an empty sidecar .txt as missing", () => {
    fs.writeFileSync(path.join(tempDir, "B00.txt"), "  \n");
    expect(() => resolveCosyVoicePromptText(cfg, wavPath)).toThrow(TtsProviderError);
  });

  it("throws with guidance covering both configuration methods", () => {
    expect(() => resolveCosyVoicePromptText(cfg, wavPath)).toThrow(
      /cosyvoice\.referenceText[\s\S]*\.txt/,
    );
  });
});
