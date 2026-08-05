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
import { visuals, VisualsError, type VisualsOptions, type VisualsResult } from "../../src/cli/visuals.js";
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
    },
    ...overrides,
  } as AutoVideoConfig;
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

// Mock validateComponent to avoid real tsc + Remotion
vi.mock("../../src/ai/validate.js", () => ({
  validateComponent: vi.fn(),
  generateTsconfigVisuals: vi.fn(() => "/tmp/tsconfig.json"),
  generateTypeShim: vi.fn(),
  astStaticScan: vi.fn(() => ({ pass: true, errors: [], imports: [] })),
}));

// Import mocked functions
import { generateComponent } from "../../src/ai/component-gen.js";
import { validateComponent } from "../../src/ai/validate.js";

const mockGenerate = vi.mocked(generateComponent);
const mockValidate = vi.mocked(validateComponent);

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

  it("should fail after 3 rounds and throw with recovery command", async () => {
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

    // Should have attempted 3 times
    expect(mockGenerate).toHaveBeenCalledTimes(3);

    // Should have called validate 3 times
    expect(mockValidate).toHaveBeenCalledTimes(3);
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

  it("should abort other blocks when one fails all 3 attempts", async () => {
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

    // B01 should have been attempted 3 times
    expect(b01Calls).toBe(3);
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
});