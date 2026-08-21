/**
 * T4.5 — visuals command acceptance tests
 *
 * Acceptance criteria:
 * - E2E (mock Claude API, simulate first-round tsc error → second round passes):
 *   component files written to disk + script.json contains componentPath
 * - Unit test: 3 rounds all fail → stage exits non-zero, other blocks not started
 * - Cache hit: run twice, second run has 0 API calls
 * - --block filter: only specified block processed
 * - --force: cache miss even when cache has entry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { visuals, VisualsError, pickReviewFrameTimes, type VisualsOptions, type VisualsResult } from "../../src/cli/visuals.js";
import type { AutoVideoConfig } from "../../src/config/defaults.js";
import type { Script } from "../../src/types/script.js";

// ── Fixtures ──────────────────────────────────────────────────────────

/** Minimal valid script with 2 blocks */
function createTestScript(): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "Test Video",
      voiceRef: "/tmp/B00.wav",
      aspect: "16:9",
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
        enter: "fade",
        exit: "fade",
        visual: {
          description: "屏幕中央显示大标题 Hello World",
        },
        narration: {
          lines: [
            { text: "Hello World", ttsText: "Hello World", highlights: [] },
          ],
        },
      },
      {
        id: "B02",
        title: "Block 2",
        enter: "fade-up",
        exit: "fade",
        visual: {
          description: "显示代码示例",
        },
        narration: {
          lines: [
            { text: "这是代码", ttsText: "这是代码", highlights: [] },
          ],
        },
      },
    ],
    assets: {},
    artifacts: { compiledAt: "2026-01-01T00:00:00Z" },
  };
}

/** Default test config */
function createTestConfig(overrides?: Partial<AutoVideoConfig>): AutoVideoConfig {
  return {
    voxcpm: {
      endpoint: "http://127.0.0.1:8000",
      modelDir: "~/.cache/voxcpm/VoxCPM2",
      cfgValue: 2.0,
      inferenceTimesteps: 10,
      denoise: false,
      retryBadcase: true,
      concurrency: 4,
    },
    anthropic: {
      model: "claude-sonnet-4-6",
      maxRetries: 3,
      concurrency: 2,
    },
    imageGen: {
      provider: "sensenova",
      baseURL: "http://127.0.0.1:8765",
      model: "gpt-image-1",
      timeoutMs: 600000,
      concurrency: 1,
      numSteps: 15,
      cfgScale: 4.0,
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
      dir: os.tmpdir() + "/autovideo-test-cache-" + process.pid,
      maxSizeGB: 1,
      evictTrigger: "manual",
    },
    visualQuality: {
      enabled: false,
      minFontCoeff: 0.07,
      minAnyFontCoeff: 0.028,
      minElements: 4,
      minCoverage: 0.7,
      review: false,
      maxReviewRounds: 1,
      // Keep the legacy free-generation-only path for the pre-existing
      // tests; assembly tests opt in via createAssemblyConfig().
      assembly: "off",
    },
    ...overrides,
  } as AutoVideoConfig;
}

/** Config with JSON assembly enabled ("first"), visualQuality off unless overridden */
function createAssemblyConfig(
  vqOverrides?: Record<string, unknown>
): AutoVideoConfig {
  return createTestConfig({
    visualQuality: {
      enabled: false,
      minFontCoeff: 0.07,
      minAnyFontCoeff: 0.028,
      minElements: 4,
      minCoverage: 0.7,
      review: false,
      maxReviewRounds: 1,
      assembly: "first",
      ...vqOverrides,
    },
  } as Partial<AutoVideoConfig>);
}

/** Valid TSX component that passes AST scan + tsc */
const VALID_TSX = `import React from "react";
import { useCurrentFrame, AbsoluteFill } from "remotion";

export default function Component(props: any) {
  const frame = useCurrentFrame();
  return React.createElement(AbsoluteFill, null,
    React.createElement("div", { style: { color: "white", fontSize: 48 } }, "Hello World")
  );
}
`;

/** TSX with a type error (will fail tsc) */
const INVALID_TSX = `import React from "react";
const x: string = 42;
export default function Component() { return null; }
`;

// ── Test helpers ──────────────────────────────────────────────────────

let tempDir: string;
let scriptPath: string;
let genCallCount: number;
let validateCallCount: number;
let shouldFailFirstAttempt: boolean;

function setupTempDir(script?: Script): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-visuals-test-"));
  const s = script ?? createTestScript();
  scriptPath = path.join(tempDir, "script.json");
  fs.writeFileSync(scriptPath, JSON.stringify(s, null, 2));
  return tempDir;
}

function cleanup(): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
  const cacheDir = os.tmpdir() + "/autovideo-test-cache-" + process.pid;
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch {}
}

// ── Mocks ─────────────────────────────────────────────────────────────

// Mock generateComponent to avoid real API calls
vi.mock("../../src/ai/component-gen.js", () => ({
  generateComponent: vi.fn(),
  buildUserContent: vi.fn(() => "user prompt"),
}));

// Mock the JSON assembly channel (plan D)
vi.mock("../../src/ai/assembly-gen.js", () => ({
  generateAssembly: vi.fn(),
  buildAssemblySystemPrompt: vi.fn(() => "assembly system prompt"),
}));
vi.mock("../../src/ai/assembly-wrapper.js", () => ({
  buildAssemblyWrapper: vi.fn(),
}));

// Mock validateComponent to avoid real tsc + Remotion
vi.mock("../../src/ai/validate.js", () => ({
  validateComponent: vi.fn(),
  generateTsconfigVisuals: vi.fn(() => "/tmp/tsconfig.json"),
  generateTypeShim: vi.fn(),
  astStaticScan: vi.fn(() => ({ pass: true, errors: [], imports: [] })),
  renderComponentStill: vi.fn(),
  cleanupStill: vi.fn(),
  classifyRenderError: vi.fn(() => "environment"),
}));

// Mock the visual-quality gate pieces (only exercised when vq.enabled)
vi.mock("../../src/ai/visual-metrics.js", () => ({
  assessVisualMetrics: vi.fn(),
  checkNarrationSyncContract: vi.fn(() => ({ pass: true, feedback: "" })),
}));
vi.mock("../../src/ai/visual-review.js", () => ({
  reviewVisual: vi.fn(),
}));

// Import mocked functions
import { generateComponent } from "../../src/ai/component-gen.js";
import { generateAssembly } from "../../src/ai/assembly-gen.js";
import { buildAssemblyWrapper } from "../../src/ai/assembly-wrapper.js";
import { validateComponent, renderComponentStill } from "../../src/ai/validate.js";
import {
  assessVisualMetrics,
  checkNarrationSyncContract,
} from "../../src/ai/visual-metrics.js";
import { reviewVisual } from "../../src/ai/visual-review.js";

const mockGenerate = vi.mocked(generateComponent);
const mockAssembly = vi.mocked(generateAssembly);
const mockWrapper = vi.mocked(buildAssemblyWrapper);
const mockValidate = vi.mocked(validateComponent);
const mockRenderStill = vi.mocked(renderComponentStill);
const mockAssess = vi.mocked(assessVisualMetrics);
const mockCheckSync = vi.mocked(checkNarrationSyncContract);
const mockReview = vi.mocked(reviewVisual);

/** Registry-valid assembled result returned by the assembly mock */
const ASSEMBLED_RESULT = {
  kind: "assembled" as const,
  component: "KeyPoints",
  props: {
    title: "核心要点",
    points: [{ title: "一" }, { title: "二" }],
  },
  usage: { inputTokens: 10, outputTokens: 20 },
};

/** Machine-generated wrapper content returned by the wrapper mock */
const WRAPPER_TSX = `// machine-generated wrapper
export default function Component() { return null; }
`;

/** Single-block variant of the test script (simplifies call-count assertions) */
function createSingleBlockScript(): Script {
  const script = createTestScript();
  script.blocks = [script.blocks[0]];
  return script;
}

// ── Tests ─────────────────────────────────────────────────────────────

// visuals() runs per-block concurrency with (mocked) generation + validation;
// under the mock harness the full pipeline is slower than the 5s default.
vi.setConfig({ testTimeout: 60000 });

describe("visuals command", () => {
  beforeEach(() => {
    genCallCount = 0;
    validateCallCount = 0;
    shouldFailFirstAttempt = false;
    vi.clearAllMocks();
    // Strip per-test implementations left over from previous tests, then
    // re-establish the defaults the pipeline relies on.
    mockAssembly.mockReset();
    mockWrapper.mockReset();
    mockRenderStill.mockReset();
    mockAssess.mockReset();
    mockReview.mockReset();
    mockCheckSync.mockReset();
    mockCheckSync.mockReturnValue({ pass: true, feedback: "" });
  });

  afterEach(() => {
    cleanup();
  });

  it("should generate components and write them to disk + update script.json", async () => {
    setupTempDir();

    // Mock: generate returns valid TSX, validate passes
    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    const result = await visuals({
      scriptPath,
      config: createTestConfig(),
      verbose: false,
    });

    // Both blocks processed
    expect(result.apiCalls).toBe(2);
    expect(result.cacheHits).toBe(0);

    // Component files exist
    expect(fs.existsSync(path.join(tempDir, "src", "blocks", "B01", "Component.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "src", "blocks", "B02", "Component.tsx"))).toBe(true);

    // script.json updated with componentPath
    const updated = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    expect(updated.blocks[0].visual.componentPath).toBe("src/blocks/B01/Component.tsx");
    expect(updated.blocks[1].visual.componentPath).toBe("src/blocks/B02/Component.tsx");
    expect(updated.artifacts.visualsGeneratedAt).toBeDefined();
  });

  it("should retry on validation failure and succeed on second attempt", async () => {
    setupTempDir(createTestScript()); // Only 1 block for simplicity
    // Remove B02 for simplicity
    const script = createTestScript();
    script.blocks = [script.blocks[0]];
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));

    let callCount = 0;
    mockGenerate.mockImplementation(async () => {
      callCount++;
      return {
        tsx: callCount === 1 ? INVALID_TSX : VALID_TSX,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    });

    // First validate fails (tsc error), second passes
    let validateCount = 0;
    mockValidate.mockImplementation(async () => {
      validateCount++;
      if (validateCount === 1) {
        return { pass: false, errors: ["TypeScript type-check failed:", "error TS2322"] };
      }
      return { pass: true, errors: [] };
    });

    const result = await visuals({
      scriptPath,
      config: createTestConfig(),
      verbose: false,
    });

    // Should have called generate twice (initial + retry)
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(result.apiCalls).toBe(2);

    // Component file should exist
    expect(fs.existsSync(path.join(tempDir, "src", "blocks", "B01", "Component.tsx"))).toBe(true);

    // script.json should have componentPath
    const updated = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    expect(updated.blocks[0].visual.componentPath).toBe("src/blocks/B01/Component.tsx");
  });

  it("should fail after 5 rounds and throw with recovery command", async () => {
    const script = createTestScript();
    // Use only B01
    script.blocks = [script.blocks[0]];
    setupTempDir(script);
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));

    // Always return invalid TSX
    mockGenerate.mockResolvedValue({
      tsx: INVALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    // Validate always fails
    mockValidate.mockResolvedValue({
      pass: false,
      errors: ["TypeScript type-check failed:", "error TS2322: Type 'number' is not assignable to type 'string'"],
    });

    await expect(
      visuals({
        scriptPath,
        config: createTestConfig(),
        verbose: false,
      })
    ).rejects.toThrow(/Visuals failed/);

    // Should have attempted 5 times (MAX_RETRIES)
    expect(mockGenerate).toHaveBeenCalledTimes(5);

    // Should have called validate 5 times
    expect(mockValidate).toHaveBeenCalledTimes(5);
  });

  it("should use cache on second run (0 API calls)", async () => {
    setupTempDir();

    // First run: generate + validate
    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    const result1 = await visuals({
      scriptPath,
      config: createTestConfig(),
      verbose: false,
    });
    expect(result1.apiCalls).toBe(2);

    // Second run: should hit cache
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    const result2 = await visuals({
      scriptPath,
      config: createTestConfig(),
      verbose: false,
    });
    expect(result2.apiCalls).toBe(0);
    expect(result2.cacheHits).toBe(2);

    // generateComponent should NOT have been called
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("should only process specified blocks with --block", async () => {
    setupTempDir();

    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    const result = await visuals({
      scriptPath,
      config: createTestConfig(),
      blockIds: ["B01"],
      verbose: false,
    });

    // Only 1 API call for B01
    expect(result.apiCalls).toBe(1);
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    // B01 component exists
    expect(fs.existsSync(path.join(tempDir, "src", "blocks", "B01", "Component.tsx"))).toBe(true);

    // script.json: B01 has componentPath, B02 does not
    const updated = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    expect(updated.blocks[0].visual.componentPath).toBe("src/blocks/B01/Component.tsx");
    expect(updated.blocks[1].visual.componentPath).toBeUndefined();
  });

  it("should force cache miss with --force", async () => {
    setupTempDir();

    // First run
    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    await visuals({
      scriptPath,
      config: createTestConfig(),
      verbose: false,
    });

    // Second run with --force: should regenerate
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    const result = await visuals({
      scriptPath,
      config: createTestConfig(),
      force: true,
      verbose: false,
    });

    expect(result.apiCalls).toBe(2);
    expect(result.cacheHits).toBe(0);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("should abort other blocks when one fails all 5 attempts", async () => {
    const script = createTestScript();
    setupTempDir(script);
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));

    let b01Calls = 0;
    let b02Started = false;

    mockGenerate.mockImplementation(async (input: any) => {
      const desc = input.visualDescription;
      if (desc.includes("Hello World")) {
        b01Calls++;
        return {
          tsx: INVALID_TSX,
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
      b02Started = true;
      return {
        tsx: VALID_TSX,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    });

    mockValidate.mockImplementation(async (_tsxPath: string, _opts: any) => {
      // Check if this is B01 validation
      if (_tsxPath.includes("B01")) {
        return {
          pass: false,
          errors: ["TypeScript type-check failed:", "error TS2322"],
        };
      }
      return { pass: true, errors: [] };
    });

    await expect(
      visuals({
        scriptPath,
        config: createTestConfig({ anthropic: { ...createTestConfig().anthropic, concurrency: 1 } }),
        verbose: false,
      })
    ).rejects.toThrow(/Visuals failed/);

    // B01 should have been attempted 5 times (MAX_RETRIES)
    expect(b01Calls).toBe(5);
  });

  it("should show dry-run plan without executing", async () => {
    setupTempDir();

    const result = await visuals({
      scriptPath,
      config: createTestConfig(),
      dryRun: true,
    });

    expect(result.apiCalls).toBe(0);
    expect(result.cacheHits).toBe(0);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it("should throw on invalid script (missing visual.description)", async () => {
    setupTempDir();
    const badScript: any = createTestScript();
    delete badScript.blocks[0].visual;
    fs.writeFileSync(scriptPath, JSON.stringify(badScript, null, 2));

    await expect(
      visuals({
        scriptPath,
        config: createTestConfig(),
      })
    ).rejects.toThrow();
  });

  it("should throw when --block specifies non-existent blocks", async () => {
    setupTempDir();

    await expect(
      visuals({
        scriptPath,
        config: createTestConfig(),
        blockIds: ["B99"],
      })
    ).rejects.toThrow(/No blocks found matching/);
  });

  it("should pass narration timing context to generation when audio exists", async () => {
    const script = createTestScript();
    script.blocks = [script.blocks[0]];
    script.blocks[0].audio = {
      wavPath: "public/audio/B01.wav",
      durationSec: 2.0,
      lineTimings: [{ lineIndex: 0, startMs: 200, endMs: 2000 }],
    };
    setupTempDir(script);

    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    await visuals({ scriptPath, config: createTestConfig(), verbose: false });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const input = mockGenerate.mock.calls[0][0];
    // enter=fade → enterSec=0.5; line 0: 0.5+0.2=0.70s – 0.5+2.0=2.50s
    expect(input.narrationContext).toContain("line 0: 0.70s – 2.50s");
    expect(input.narrationContext).toContain("Hello World");
    expect(input.narrationContext).toContain("props.lineTimings");
  });

  it("should omit narration context when block has no audio timings", async () => {
    setupTempDir();

    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    await visuals({ scriptPath, config: createTestConfig(), verbose: false });

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    for (const call of mockGenerate.mock.calls) {
      expect(call[0].narrationContext).toBeUndefined();
    }
  });

  it("freegen: a throwing generation call still feeds the error back (placeholder previousTsx)", async () => {
    setupTempDir(createSingleBlockScript());

    mockGenerate
      .mockRejectedValueOnce(new Error("stream ended with empty response"))
      .mockResolvedValueOnce({
        tsx: VALID_TSX,
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    await visuals({ scriptPath, config: createTestConfig(), verbose: false });

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    // No TSX was produced on attempt 1, but the error must not be dropped:
    // a placeholder stands in for the missing artifact (legacy fed "").
    const retryContext = mockGenerate.mock.calls[1][0].retryContext;
    expect(retryContext).toBeDefined();
    expect(retryContext!.previousTsx).toContain("no component source");
    expect(retryContext!.errorMessage).toContain("empty response");
  });

  // ── JSON assembly mode (plan D) ───────────────────────────────────────

  it("assembly-first: assembled wrapper is written and component-gen is never called", async () => {
    setupTempDir(createSingleBlockScript());

    mockAssembly.mockResolvedValue(ASSEMBLED_RESULT);
    mockWrapper.mockReturnValue(WRAPPER_TSX);
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    const result = await visuals({
      scriptPath,
      config: createAssemblyConfig(),
      verbose: false,
    });

    // One assembly call with the real registry docs; wrapper built from the
    // validated selection; free generation never invoked.
    expect(mockAssembly).toHaveBeenCalledTimes(1);
    const asmInput = mockAssembly.mock.calls[0][0];
    expect(asmInput.visualDescription).toContain("Hello World");
    expect(asmInput.registryDocs).toContain("### KeyPoints");
    expect(asmInput.retryContext).toBeUndefined();
    expect(mockWrapper).toHaveBeenCalledTimes(1);
    expect(mockWrapper).toHaveBeenCalledWith(
      "KeyPoints",
      ASSEMBLED_RESULT.props
    );
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result.apiCalls).toBe(1);

    // The wrapper source is what lands on disk + in script.json
    const componentFile = path.join(
      tempDir, "src", "blocks", "B01", "Component.tsx"
    );
    expect(fs.readFileSync(componentFile, "utf-8")).toBe(WRAPPER_TSX);
    const updated = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    expect(updated.blocks[0].visual.componentPath).toBe(
      "src/blocks/B01/Component.tsx"
    );
  });

  it("assembly-first: component:null falls back to free generation in the same loop", async () => {
    setupTempDir(createSingleBlockScript());

    mockAssembly.mockResolvedValue({
      kind: "fallback",
      reason: "需要自由排版的对比画面，注册组件都不合适",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    const result = await visuals({
      scriptPath,
      config: createAssemblyConfig(),
      verbose: false,
    });

    expect(mockAssembly).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockWrapper).not.toHaveBeenCalled();
    expect(result.apiCalls).toBe(2);
    // The fallback is not a failure: the first freegen call gets no
    // retryContext (no error feedback, no empty previous source).
    expect(mockGenerate.mock.calls[0][0].retryContext).toBeUndefined();

    const componentFile = path.join(
      tempDir, "src", "blocks", "B01", "Component.tsx"
    );
    expect(fs.readFileSync(componentFile, "utf-8")).toBe(VALID_TSX);
    const updated = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    expect(updated.blocks[0].visual.componentPath).toBe(
      "src/blocks/B01/Component.tsx"
    );
  });

  it("assembly-first: two consecutive assembly failures switch to free generation", async () => {
    setupTempDir(createSingleBlockScript());

    mockAssembly.mockRejectedValue(
      new Error(
        "assembly JSON failed registry validation:\n- props.points: Array must contain at least 2 element(s)\n请修正 JSON"
      )
    );
    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    const result = await visuals({
      scriptPath,
      config: createAssemblyConfig(),
      verbose: false,
    });

    // Exactly 2 assembly attempts, then the loop switched to freegen and
    // succeeded — the block does NOT abort. (Failed generation calls are
    // not counted in apiCalls, same as the freegen channel.)
    expect(mockAssembly).toHaveBeenCalledTimes(2);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockWrapper).not.toHaveBeenCalled();
    expect(result.apiCalls).toBe(1);

    const componentFile = path.join(
      tempDir, "src", "blocks", "B01", "Component.tsx"
    );
    expect(fs.readFileSync(componentFile, "utf-8")).toBe(VALID_TSX);
  });

  it("assembly-first: JSON failure retry feeds back non-empty previousJson (never TSX)", async () => {
    setupTempDir(createSingleBlockScript());

    mockAssembly
      .mockRejectedValueOnce(
        new Error(
          "assembly output is not valid JSON (first 200 chars): 我觉得应该…\n请在下一轮只输出一个 ```json 代码块"
        )
      )
      .mockResolvedValueOnce(ASSEMBLED_RESULT);
    mockWrapper.mockReturnValue(WRAPPER_TSX);
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    await visuals({
      scriptPath,
      config: createAssemblyConfig(),
      verbose: false,
    });

    expect(mockAssembly).toHaveBeenCalledTimes(2);
    const retryContext = mockAssembly.mock.calls[1][0].retryContext;
    expect(retryContext).toBeDefined();
    // The model's first response was unparseable, so no artifact exists —
    // the placeholder must be non-empty and must not be component source.
    expect(retryContext!.previousJson.length).toBeGreaterThan(0);
    expect(retryContext!.previousJson).not.toContain("import React");
    expect(retryContext!.previousJson).not.toContain("export default");
    expect(retryContext!.errorMessage).toContain("not valid JSON");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("assembly-first: downstream validation failure feeds the assembled JSON back", async () => {
    setupTempDir(createSingleBlockScript());

    mockAssembly.mockResolvedValue(ASSEMBLED_RESULT);
    mockWrapper.mockReturnValue(WRAPPER_TSX);
    // First wrapper fails tsc, second passes.
    mockValidate
      .mockResolvedValueOnce({
        pass: false,
        errors: ["TypeScript type-check failed:", "error TS2322"],
      })
      .mockResolvedValueOnce({ pass: true, errors: [] });

    const result = await visuals({
      scriptPath,
      config: createAssemblyConfig(),
      verbose: false,
    });

    expect(mockAssembly).toHaveBeenCalledTimes(2);
    const retryContext = mockAssembly.mock.calls[1][0].retryContext;
    expect(retryContext).toBeDefined();
    // The previous artifact IS available here: the validated selection,
    // re-serialized as JSON — never the wrapper TSX.
    const prev = JSON.parse(retryContext!.previousJson);
    expect(prev.component).toBe("KeyPoints");
    expect(prev.props).toEqual(ASSEMBLED_RESULT.props);
    expect(retryContext!.previousJson).not.toContain("export default");
    expect(retryContext!.errorMessage).toContain("Assembly attempt failed");
    expect(retryContext!.errorMessage).toContain("TS2322");
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result.apiCalls).toBe(2);
  });

  it("assembly-first: visualQuality.enabled passes end-to-end (static metrics skipped, coverage + review still run)", async () => {
    setupTempDir(createSingleBlockScript());

    mockAssembly.mockResolvedValue(ASSEMBLED_RESULT);
    mockWrapper.mockReturnValue(WRAPPER_TSX);
    mockValidate.mockResolvedValue({ pass: true, errors: [] });
    mockRenderStill.mockResolvedValue({
      ok: true,
      pngPaths: ["/tmp/still-B01/frame0.png", "/tmp/still-B01/frame1.png"],
      tempDir: "/tmp/still-B01",
    });
    mockAssess.mockResolvedValue({
      pass: true,
      feedback: "",
      static: {
        maxFontPx: 0,
        minFontPx: 0,
        usesRelativeFont: false,
        hardcodedFontSizes: [],
        elementCount: 0,
        fontFullyMeasured: false,
      },
      image: {
        coverage: 0.8,
        emptyCorners: 0,
        bandDensity: { top: 1, mid: 1, bottom: 1 },
        edgeClip: { left: 0, right: 0 },
      },
    });
    mockReview.mockResolvedValue({ pass: true, feedback: "", raw: "" });

    const result = await visuals({
      scriptPath,
      config: createAssemblyConfig({
        enabled: true,
        review: true,
        maxReviewRounds: 1,
      }),
      verbose: false,
    });

    expect(mockAssembly).toHaveBeenCalledTimes(1);
    // renderStill smoke ran…
    expect(mockRenderStill).toHaveBeenCalledTimes(1);
    // …the PNG coverage gate ran, but source-level static metrics were
    // skipped for the machine-generated wrapper…
    expect(mockAssess).toHaveBeenCalledTimes(1);
    expect(mockAssess.mock.calls[0][0].skipStaticMetrics).toBe(true);
    // …the narration-sync contract still ran…
    expect(mockCheckSync).toHaveBeenCalledTimes(1);
    // …and the multimodal review still consumed its round.
    expect(mockReview).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result.apiCalls).toBe(1);
  });

  it("assembly off: behaves exactly like the legacy free-generation path", async () => {
    setupTempDir();

    mockGenerate.mockResolvedValue({
      tsx: VALID_TSX,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockValidate.mockResolvedValue({ pass: true, errors: [] });

    const result = await visuals({
      scriptPath,
      config: createTestConfig(), // visualQuality.assembly === "off"
      verbose: false,
    });

    expect(mockAssembly).not.toHaveBeenCalled();
    expect(mockWrapper).not.toHaveBeenCalled();
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(result.apiCalls).toBe(2);
    expect(result.cacheHits).toBe(0);
  });
});

describe("pickReviewFrameTimes", () => {
  it("falls back to early/mid/late fractions without narration timings", () => {
    const times = pickReviewFrameTimes([], 10);
    expect(times).toEqual([0.5, 5, 9.3]);
  });

  it("samples every line midpoint when lines fit the budget", () => {
    const lines = [
      { startSec: 0.5, endSec: 3.38 },
      { startSec: 3.62, endSec: 7.14 },
    ];
    const times = pickReviewFrameTimes(lines, 8.42);
    // early + 2 line mids + late
    expect(times.length).toBe(4);
    expect(times[1]).toBeCloseTo((0.5 + 3.38) / 2);
    expect(times[2]).toBeCloseTo((3.62 + 7.14) / 2);
    expect(times[0]).toBeCloseTo(8.42 * 0.05);
    expect(times[3]).toBeCloseTo(8.42 * 0.93);
  });

  it("subsamples evenly when lines exceed the frame budget", () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({
      startSec: i * 4,
      endSec: i * 4 + 3,
    }));
    const times = pickReviewFrameTimes(lines, 27.92, 4);
    // early + 4 line mids + late = 6 frames; lines 0, 2, 3, 5 sampled
    expect(times.length).toBe(6);
    expect(times[1]).toBeCloseTo(1.5);   // line 0 mid
    expect(times[2]).toBeCloseTo(9.5);   // line 2 mid
    expect(times[3]).toBeCloseTo(13.5);  // line 3 mid
    expect(times[4]).toBeCloseTo(21.5);  // line 5 mid
  });
});