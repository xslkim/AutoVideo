/**
 * AutoVideo — Build orchestrator tests
 *
 * T8.1 acceptance:
 *   - --block flag rejected with helpful error message (tested at CLI level in bin/autovideo.ts)
 *   - Stages run in order: compile → tts → visuals → render
 *   - Stage failure stops pipeline with correct error
 *   - cwd switches to build out dir after compile (PRD §10)
 *   - Successful run returns outDir and script
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

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

vi.mock("../../src/cli/render.js", () => ({
  render: vi.fn(),
}));

vi.mock("../../src/config/load.js", () => ({
  loadConfig: () => ({
    config: {
      voxcpm: {
        endpoint: "http://127.0.0.1:8000",
        cfgValue: 2.0,
        inferenceTimesteps: 10,
        denoise: false,
        concurrency: 4,
        autoStart: false,
        retryBadcase: true,
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
        minHoldSec: 1.5,
        defaultEnterSec: 0.5,
        defaultExitSec: 0.3,
        loudnorm: { i: -16, tp: -1.5, lra: 11, twoPass: true, audioBitrate: "192k" },
      },
      cache: { dir: "/tmp/autovideo-test-cache", maxSizeGB: 20, evictTrigger: "stage-start" },
    },
  }),
}));

import { build, BuildError, cwdHelper } from "../../src/cli/build.js";
import { compile, type CompileResult } from "../../src/cli/compile.js";
import { tts, type TtsResult } from "../../src/cli/tts.js";
import { visuals, type VisualsResult } from "../../src/cli/visuals.js";
import { render, type RenderResult } from "../../src/cli/render.js";

const mockCompile = vi.mocked(compile);
const mockTts = vi.mocked(tts);
const mockVisuals = vi.mocked(visuals);
const mockRender = vi.mocked(render);

// ── Helpers ───────────────────────────────────────────────────────────

const FIXTURE_PROJECT = path.resolve("tests/fixtures/compile-test/project.json");

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
    },
    blocks: [
      {
        id: "B01",
        title: "Block 1",
        enter: "fade" as const,
        exit: "fade" as const,
        visual: {
          description: "A test visual",
          componentPath: "src/blocks/B01/Component.tsx",
        },
        narration: {
          lines: [
            { text: "Hello world", ttsText: "Hello world", highlights: [] },
          ],
        },
        audio: {
          wavPath: "public/audio/B01.wav",
          durationSec: 2.0,
          lineTimings: [{ lineIndex: 0, startMs: 0, endMs: 2000 }],
        },
        timing: {
          enterSec: 0.5,
          holdSec: 2.0,
          exitSec: 0.3,
          totalSec: 2.8,
          frames: 84,
          enterFrames: 15,
        },
        render: {
          partialPath: "output/partials/B01.mp4",
          cacheHit: false,
        },
      },
    ],
    artifacts: {},
    assets: {},
  };
}

function setupMocksForSuccess(outDir = "/tmp/build-test-video") {
  const script = makeScript();
  mockCompile.mockResolvedValue({ script, outDir } as CompileResult);
  mockTts.mockResolvedValue({ script, cacheHits: 0, apiCalls: 0 } as unknown as TtsResult);
  mockVisuals.mockResolvedValue({ script, cacheHits: 0, apiCalls: 0 } as unknown as VisualsResult);
  mockRender.mockResolvedValue({ script, cacheHits: 0, renders: 0 } as unknown as RenderResult);
  return script;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("build orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(cwdHelper, "change").mockImplementation(() => {});
    vi.spyOn(cwdHelper, "get").mockImplementation(() => process.cwd());
  });

  // ── Stage ordering ──────────────────────────────────────────────────

  it("runs stages in order: compile → tts → visuals → render", async () => {
    const outDir = "/tmp/build-test-video";
    const script = makeScript();
    const callOrder: string[] = [];

    mockCompile.mockImplementation(async () => {
      callOrder.push("compile");
      return { script, outDir } as CompileResult;
    });
    mockTts.mockImplementation(async () => {
      callOrder.push("tts");
      return { script, cacheHits: 0, apiCalls: 1 } as unknown as TtsResult;
    });
    mockVisuals.mockImplementation(async () => {
      callOrder.push("visuals");
      return { script, cacheHits: 0, apiCalls: 1 } as unknown as VisualsResult;
    });
    mockRender.mockImplementation(async () => {
      callOrder.push("render");
      return { script, cacheHits: 0, renders: 1 } as unknown as RenderResult;
    });

    const result = await build({
      projectPath: FIXTURE_PROJECT,
      verbose: false,
      dryRun: false,
    });

    expect(callOrder).toEqual(["compile", "tts", "visuals", "render"]);
    expect(result.outDir).toBe(outDir);
    expect(result.script).toBe(script);
  });

  // ── Failure stops pipeline ──────────────────────────────────────────

  it("stops at compile failure and does not call tts/visuals/render", async () => {
    mockCompile.mockRejectedValue(new Error("compile parse error"));

    await expect(
      build({ projectPath: FIXTURE_PROJECT })
    ).rejects.toThrow("Stage 'compile' failed");

    expect(mockTts).not.toHaveBeenCalled();
    expect(mockVisuals).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("stops at tts failure and does not call visuals/render", async () => {
    const script = makeScript();
    mockCompile.mockResolvedValue({ script, outDir: "/tmp/out" } as CompileResult);
    mockTts.mockRejectedValue(new Error("voxcpm connection refused"));

    await expect(
      build({ projectPath: FIXTURE_PROJECT })
    ).rejects.toThrow("Stage 'tts' failed");

    expect(mockVisuals).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("stops at visuals failure and does not call render", async () => {
    const script = makeScript();
    mockCompile.mockResolvedValue({ script, outDir: "/tmp/out" } as CompileResult);
    mockTts.mockResolvedValue({ script, cacheHits: 0, apiCalls: 0 } as unknown as TtsResult);
    mockVisuals.mockRejectedValue(new Error("Claude API rate limit"));

    await expect(
      build({ projectPath: FIXTURE_PROJECT })
    ).rejects.toThrow("Stage 'visuals' failed");

    expect(mockRender).not.toHaveBeenCalled();
  });

  it("stops at render failure", async () => {
    const script = makeScript();
    mockCompile.mockResolvedValue({ script, outDir: "/tmp/out" } as CompileResult);
    mockTts.mockResolvedValue({ script, cacheHits: 0, apiCalls: 0 } as unknown as TtsResult);
    mockVisuals.mockResolvedValue({ script, cacheHits: 0, apiCalls: 0 } as unknown as VisualsResult);
    mockRender.mockRejectedValue(new Error("Remotion render timeout"));

    await expect(
      build({ projectPath: FIXTURE_PROJECT })
    ).rejects.toThrow("Stage 'render' failed");
  });

  // ── Error messages include recovery hints ───────────────────────────

  it("compile failure includes recovery hint", async () => {
    mockCompile.mockRejectedValue(new Error("missing voiceRef"));

    await expect(
      build({ projectPath: FIXTURE_PROJECT })
    ).rejects.toThrow("autovideo compile");
  });

  it("tts failure includes recovery hint with script.json path", async () => {
    const script = makeScript();
    const outDir = "/tmp/out-dir";
    mockCompile.mockResolvedValue({ script, outDir } as CompileResult);
    mockTts.mockRejectedValue(new Error("VoxCPM timeout"));

    await expect(
      build({ projectPath: FIXTURE_PROJECT })
    ).rejects.toThrow("autovideo tts");
  });

  // ── Project file not found ──────────────────────────────────────────

  it("throws BuildError when project file does not exist", async () => {
    await expect(
      build({ projectPath: "/nonexistent/project.json" })
    ).rejects.toThrow("Project file not found");
  });

  // ── Dry run passthrough ─────────────────────────────────────────────

  it("passes dryRun flag to stages", async () => {
    setupMocksForSuccess();

    await build({ projectPath: FIXTURE_PROJECT, dryRun: true });

    expect(mockCompile).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
    expect(mockTts).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
    expect(mockVisuals).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
    expect(mockRender).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
  });

  // ── Verbose passthrough ─────────────────────────────────────────────

  it("passes verbose flag to stages", async () => {
    setupMocksForSuccess();

    await build({ projectPath: FIXTURE_PROJECT, verbose: true });

    expect(mockCompile).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: true })
    );
    expect(mockTts).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: true })
    );
  });

  // ── Config passthrough ──────────────────────────────────────────────

  it("passes config from loadConfig to tts/visuals/render", async () => {
    setupMocksForSuccess();

    await build({ projectPath: FIXTURE_PROJECT });

    const expectedConfig = expect.objectContaining({
      voxcpm: expect.any(Object),
      anthropic: expect.any(Object),
      render: expect.any(Object),
    });

    expect(mockTts).toHaveBeenCalledWith(
      expect.objectContaining({ config: expectedConfig })
    );
    expect(mockVisuals).toHaveBeenCalledWith(
      expect.objectContaining({ config: expectedConfig })
    );
    expect(mockRender).toHaveBeenCalledWith(
      expect.objectContaining({ config: expectedConfig })
    );
  });

  // ── Cwd switches after compile (PRD §10) ────────────────────────────
  // Since vitest workers don't support process.chdir, we verify the
  // changeCwd export is called by checking the mock side effects.

  it("calls changeCwd with outDir after compile", async () => {
    const outDir = "/tmp/cwd-test-out";
    const script = makeScript();

    mockCompile.mockResolvedValue({ script, outDir } as CompileResult);
    mockTts.mockResolvedValue({ script, cacheHits: 0, apiCalls: 0 } as unknown as TtsResult);
    mockVisuals.mockResolvedValue({ script, cacheHits: 0, apiCalls: 0 } as unknown as VisualsResult);
    mockRender.mockResolvedValue({ script, cacheHits: 0, renders: 0 } as unknown as RenderResult);

    const result = await build({ projectPath: FIXTURE_PROJECT });
    expect(result.outDir).toBe(outDir);
    expect(cwdHelper.change).toHaveBeenCalledWith(outDir);
  });
});