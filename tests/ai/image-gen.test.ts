import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveImageGenProvider,
  isImageGenConfigured,
  imageGenHealthURL,
  generateImage,
  ImageGenError,
} from "../../src/ai/image-gen.js";
import type { Block } from "../../src/types/script.js";
import { CacheStore } from "../../src/cache/store.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("resolveImageGenProvider", () => {
  it("uses explicit provider when set", () => {
    expect(resolveImageGenProvider({ provider: "sensenova", model: "x", timeoutMs: 1, concurrency: 1 }))
      .toBe("sensenova");
    expect(resolveImageGenProvider({ provider: "openai", model: "x", timeoutMs: 1, concurrency: 1 }))
      .toBe("openai");
  });

  it("infers sensenova from port 8765", () => {
    expect(resolveImageGenProvider({
      baseURL: "http://127.0.0.1:8765",
      model: "x",
      timeoutMs: 1,
      concurrency: 1,
    })).toBe("sensenova");
  });

  it("defaults to openai for unknown URLs", () => {
    expect(resolveImageGenProvider({
      baseURL: "https://api.openai.com",
      model: "x",
      timeoutMs: 1,
      concurrency: 1,
    })).toBe("openai");
  });
});

describe("isImageGenConfigured", () => {
  it("sensenova does not require api key", () => {
    expect(isImageGenConfigured({
      provider: "sensenova",
      model: "x",
      timeoutMs: 1,
      concurrency: 1,
    })).toBe(true);
  });

  it("openai requires api key", () => {
    expect(isImageGenConfigured({
      provider: "openai",
      model: "x",
      timeoutMs: 1,
      concurrency: 1,
    })).toBe(false);
    expect(isImageGenConfigured({
      provider: "openai",
      apiKey: "sk-test",
      model: "x",
      timeoutMs: 1,
      concurrency: 1,
    })).toBe(true);
  });
});

describe("imageGenHealthURL", () => {
  it("returns sensenova health endpoint", () => {
    expect(imageGenHealthURL({
      provider: "sensenova",
      baseURL: "http://127.0.0.1:8765",
      model: "x",
      timeoutMs: 1,
      concurrency: 1,
    })).toBe("http://127.0.0.1:8765/api/health");
  });

  it("returns openai models endpoint when key present", () => {
    expect(imageGenHealthURL({
      provider: "openai",
      baseURL: "https://api.openai.com",
      apiKey: "sk-test",
      model: "gpt-image-1",
      timeoutMs: 1,
      concurrency: 1,
    })).toBe("https://api.openai.com/v1/models");
  });
});

describe("generateImage (sensenova)", () => {
  let tmpDir: string;
  let cacheDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-img-"));
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-cache-"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("calls /api/t2i and writes PNG", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => pngBytes.buffer.slice(
        pngBytes.byteOffset,
        pngBytes.byteOffset + pngBytes.byteLength,
      ),
    });

    const block: Block = {
      id: "B01",
      title: "Test",
      enter: "fade",
      exit: "fade",
      visualMode: "image",
      visual: { description: "A red apple on white background" },
      narration: { lines: [] },
    };

    const cacheStore = new CacheStore({ cacheDir, maxSizeGB: 1, evictTrigger: "manual" });

    const result = await generateImage(block, {
      config: {
        provider: "sensenova",
        baseURL: "http://127.0.0.1:8765",
        model: "gpt-image-1",
        timeoutMs: 30000,
        concurrency: 1,
        numSteps: 8,
        cfgScale: 4,
      },
      buildOutDir: tmpDir,
      meta: { aspect: "16:9", width: 1920, height: 1080 },
      cacheStore,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8765/api/t2i");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      prompt: "A red apple on white background",
      width: 1920,
      height: 1080,
      num_steps: 8,
      cfg_scale: 4,
    });
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    expect(result.cacheHit).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "public/images/B01.png"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src/blocks/B01/Component.tsx"))).toBe(true);
    expect(block.visual.imagePath).toBe("public/images/B01.png");
  });

  it("throws when openai mode has no api key", async () => {
    const block: Block = {
      id: "B01",
      title: "Test",
      enter: "fade",
      exit: "fade",
      visualMode: "image",
      visual: { description: "test" },
      narration: { lines: [] },
    };

    const cacheStore = new CacheStore({ cacheDir, maxSizeGB: 1, evictTrigger: "manual" });

    await expect(generateImage(block, {
      config: {
        provider: "openai",
        baseURL: "https://api.openai.com",
        model: "gpt-image-1",
        timeoutMs: 30000,
        concurrency: 1,
      },
      buildOutDir: tmpDir,
      meta: { aspect: "16:9", width: 1920, height: 1080 },
      cacheStore,
    })).rejects.toMatchObject({
      name: "ImageGenError",
      code: "ERR_IMAGE_GEN_KEY_MISSING",
    } satisfies Partial<ImageGenError>);
  });

  it("cache key includes numSteps/cfgScale for sensenova", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => pngBytes.buffer.slice(
        pngBytes.byteOffset,
        pngBytes.byteOffset + pngBytes.byteLength,
      ),
    });

    const block: Block = {
      id: "B02",
      title: "Cache test",
      enter: "fade",
      exit: "fade",
      visualMode: "image",
      visual: { description: "A blue cube on dark background" },
      narration: { lines: [] },
    };

    const cacheStore = new CacheStore({ cacheDir, maxSizeGB: 1, evictTrigger: "manual" });

    const first = await generateImage(block, {
      config: {
        provider: "sensenova",
        baseURL: "http://127.0.0.1:8765",
        model: "gpt-image-1",
        timeoutMs: 30000,
        concurrency: 1,
        numSteps: 8,
        cfgScale: 4,
      },
      buildOutDir: tmpDir,
      meta: { aspect: "16:9", width: 1920, height: 1080 },
      cacheStore,
    });
    expect(first.cacheHit).toBe(false);

    const second = await generateImage(block, {
      config: {
        provider: "sensenova",
        baseURL: "http://127.0.0.1:8765",
        model: "gpt-image-1",
        timeoutMs: 30000,
        concurrency: 1,
        numSteps: 12, // changed
        cfgScale: 6,  // changed
      },
      buildOutDir: tmpDir,
      meta: { aspect: "16:9", width: 1920, height: 1080 },
      cacheStore,
    });
    expect(second.cacheHit).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
