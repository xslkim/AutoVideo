/**
 * AutoVideo — quick-build orchestrator tests
 *
 * 覆盖：
 *   - 阶段顺序 compile → tts → quickVisuals → render（visuals 不被调用）
 *   - render 收到快速编码参数覆盖（crf 30 / veryfast）
 *   - 快速目录 script.json meta 被改写（skipLipsync=true，无 avatarRef/avatarRadius）
 *   - 默认输出目录 = 正常构建目录加 -quick 后缀
 *   - 阶段失败中断
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("../../src/cli/compile.js", () => ({
  compile: vi.fn(),
}));

vi.mock("../../src/cli/tts.js", () => ({
  tts: vi.fn(),
}));

vi.mock("../../src/cli/visuals.js", () => ({
  visuals: vi.fn(),
}));

vi.mock("../../src/cli/quick-visuals.js", () => ({
  quickVisuals: vi.fn(),
}));

vi.mock("../../src/cli/render.js", () => ({
  render: vi.fn(),
}));

vi.mock("../../src/config/load.js", () => ({
  loadConfig: () => ({
    config: {
      voxcpm: { endpoint: "http://127.0.0.1:8000" },
      anthropic: { model: "claude-sonnet-4-6" },
      render: {
        blockConcurrency: 4,
        framesConcurrencyPerBlock: null,
        minHoldSec: 1.5,
        defaultEnterSec: 0.5,
        defaultExitSec: 0.3,
        loudnorm: { i: -16, tp: -1.5, lra: 11, twoPass: true, audioBitrate: "192k" },
      },
      cache: { dir: "/tmp/autovideo-test-cache", maxSizeGB: 20, evictTrigger: "stage-start" },
    },
  }),
}));

vi.mock("../../src/parser/project.js", () => ({
  readProject: () => ({
    projectPath: path.resolve("tests/fixtures/compile-test/project.json"),
    projectDir: "/tmp/quick-test-project",
    metaPath: "/tmp/quick-test-project/meta.md",
    blockPaths: [],
  }),
}));

vi.mock("../../src/parser/meta.js", () => ({
  readMeta: () => ({ title: "Test Video", slug: "test-video" }),
}));

import { quickBuild, QuickBuildError } from "../../src/cli/quick.js";
import { compile, type CompileResult } from "../../src/cli/compile.js";
import { tts, type TtsResult } from "../../src/cli/tts.js";
import { visuals } from "../../src/cli/visuals.js";
import { quickVisuals, type QuickVisualsResult } from "../../src/cli/quick-visuals.js";
import { render, type RenderResult } from "../../src/cli/render.js";

const mockCompile = vi.mocked(compile);
const mockTts = vi.mocked(tts);
const mockVisuals = vi.mocked(visuals);
const mockQuickVisuals = vi.mocked(quickVisuals);
const mockRender = vi.mocked(render);

// ── Helpers ─────────────────────────────────────────────────────────────

const FIXTURE_PROJECT = path.resolve("tests/fixtures/compile-test/project.json");

let tmpDir: string;
let scriptPath: string;

function makeScript() {
  return {
    meta: {
      schemaVersion: "1.0" as const,
      title: "Test Video",
      voiceRef: "/tmp/B00.wav",
      aspect: "16:9" as const,
      width: 1920,
      height: 1080,
      fps: 30,
      theme: "dark-code",
      subtitleSafeBottom: 162,
      avatarRef: "/tmp/avatar.mp4",
      avatarRadius: 24,
      skipLipsync: false,
    },
    blocks: [],
    artifacts: {},
    assets: {},
  };
}

function setupMocksForSuccess() {
  const script = makeScript();
  // compile 返回真实的临时目录；script.json 已在 beforeEach 写入
  mockCompile.mockResolvedValue({ script, outDir: tmpDir, scriptPath } as CompileResult);
  mockTts.mockResolvedValue({ script, cacheHits: 0, apiCalls: 0 } as unknown as TtsResult);
  mockQuickVisuals.mockResolvedValue({
    script,
    placeholders: 1,
    skipped: 0,
  } as QuickVisualsResult);
  mockRender.mockResolvedValue({ script, cacheHits: 0, renders: 0 } as unknown as RenderResult);
  return script;
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quick-build-test-"));
  scriptPath = path.join(tmpDir, "script.json");
  // 快速目录 script.json（含 avatar meta，等待 quickBuild 改写）
  fs.writeFileSync(scriptPath, JSON.stringify(makeScript(), null, 2), "utf-8");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("quickBuild orchestrator", () => {
  it("runs stages in order: compile → tts → quickVisuals → render (visuals never called)", async () => {
    const script = makeScript();
    const callOrder: string[] = [];

    mockCompile.mockImplementation(async () => {
      callOrder.push("compile");
      return { script, outDir: tmpDir, scriptPath } as CompileResult;
    });
    mockTts.mockImplementation(async () => {
      callOrder.push("tts");
      return { script, cacheHits: 0, apiCalls: 1 } as unknown as TtsResult;
    });
    mockQuickVisuals.mockImplementation(async () => {
      callOrder.push("quickVisuals");
      return { script, placeholders: 1, skipped: 0 } as QuickVisualsResult;
    });
    mockRender.mockImplementation(async () => {
      callOrder.push("render");
      return { script, cacheHits: 0, renders: 1 } as unknown as RenderResult;
    });

    const result = await quickBuild({ projectPath: FIXTURE_PROJECT });

    expect(callOrder).toEqual(["compile", "tts", "quickVisuals", "render"]);
    expect(mockVisuals).not.toHaveBeenCalled();
    expect(result.outDir).toBe(tmpDir);
  });

  it("compiles into the -quick output directory by default", async () => {
    setupMocksForSuccess();

    await quickBuild({ projectPath: FIXTURE_PROJECT });

    expect(mockCompile).toHaveBeenCalledWith(
      expect.objectContaining({
        outDir: path.join("/tmp/quick-test-project", "build", "test-video-quick"),
      }),
    );
  });

  it("passes quick encoding overrides to render config", async () => {
    setupMocksForSuccess();

    await quickBuild({ projectPath: FIXTURE_PROJECT });

    const renderConfig = mockRender.mock.calls[0][0].config as any;
    expect(renderConfig.render.quality.crf).toBe(30);
    expect(renderConfig.render.quality.x264Preset).toBe("veryfast");
    // 其余 quality 字段来自 DEFAULT_QUALITY 合并
    expect(renderConfig.render.quality.imageFormat).toBeDefined();
    expect(renderConfig.render.quality.pixelFormat).toBeDefined();

    // tts 拿到的是未覆盖的原 config
    const ttsConfig = mockTts.mock.calls[0][0].config as any;
    expect(ttsConfig.render.quality).toBeUndefined();
  });

  it("rewrites script.json meta: skipLipsync=true, avatar fields removed", async () => {
    setupMocksForSuccess();

    await quickBuild({ projectPath: FIXTURE_PROJECT });

    const written = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    expect(written.meta.skipLipsync).toBe(true);
    expect(written.meta.avatarRef).toBeUndefined();
    expect(written.meta.avatarRadius).toBeUndefined();

    // render 拿到的是改写后的 script.json 路径
    expect(mockRender).toHaveBeenCalledWith(
      expect.objectContaining({ scriptPath }),
    );
  });

  it("stops at tts failure and does not call quickVisuals/render", async () => {
    const script = makeScript();
    mockCompile.mockResolvedValue({ script, outDir: tmpDir, scriptPath } as CompileResult);
    mockTts.mockRejectedValue(new Error("voxcpm connection refused"));

    await expect(quickBuild({ projectPath: FIXTURE_PROJECT })).rejects.toThrow(
      "Stage 'tts' failed",
    );

    expect(mockQuickVisuals).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("stops at quick-visuals failure and does not call render", async () => {
    const script = makeScript();
    mockCompile.mockResolvedValue({ script, outDir: tmpDir, scriptPath } as CompileResult);
    mockTts.mockResolvedValue({ script, cacheHits: 0, apiCalls: 0 } as unknown as TtsResult);
    mockQuickVisuals.mockRejectedValue(new Error("disk full"));

    await expect(quickBuild({ projectPath: FIXTURE_PROJECT })).rejects.toThrow(
      "Stage 'quick-visuals' failed",
    );

    expect(mockRender).not.toHaveBeenCalled();
  });

  it("stops at render failure", async () => {
    setupMocksForSuccess();
    mockRender.mockRejectedValue(new Error("Remotion render timeout"));

    await expect(quickBuild({ projectPath: FIXTURE_PROJECT })).rejects.toThrow(
      "Stage 'render' failed",
    );
  });

  it("throws QuickBuildError when project file does not exist", async () => {
    await expect(quickBuild({ projectPath: "/nonexistent/project.json" })).rejects.toThrow(
      QuickBuildError,
    );
  });

  it("passes dryRun flag to all stages", async () => {
    setupMocksForSuccess();

    await quickBuild({ projectPath: FIXTURE_PROJECT, dryRun: true });

    for (const mock of [mockCompile, mockTts, mockQuickVisuals, mockRender]) {
      expect(mock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    }
  });
});
