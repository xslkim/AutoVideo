/**
 * Tests for src/ai/assembly-gen.ts
 *
 * Acceptance criteria (mocked AgentDriver, no real API calls):
 * - Valid fenced JSON → { kind: "assembled", component, props }
 * - {"component": null, reason} → { kind: "fallback", reason }
 * - Unparseable output / schema-violating JSON → throws, and the error
 *   text carries "fix it next round" guidance for the retry loop
 * - retryContext is folded into the user message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the driver factory — assembly-gen only uses createAgentDriver
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ generateText: vi.fn() }));

vi.mock("../../src/ai/agent/index.js", () => ({
  createAgentDriver: () => ({
    capabilities: { vision: false, usageReporting: true },
    generateText: mocks.generateText,
    reviewImages: vi.fn(),
  }),
}));

import {
  generateAssembly,
  buildAssemblySystemPrompt,
  buildAssemblyUserContent,
  type AssemblyGenInput,
} from "../../src/ai/assembly-gen.js";
import type { AnthropicConfig } from "../../src/ai/component-gen.js";

const DEFAULT_CONFIG: AnthropicConfig = {
  model: "test-model",
  maxRetries: 0,
};

const DEFAULT_INPUT: AssemblyGenInput = {
  visualDescription: "列表展示三个核心要点，旁白讲到哪条就高亮哪条",
  registryDocs: "### KeyPoints\n…registry docs…",
};

const VALID_KEYPOINTS_JSON = JSON.stringify({
  component: "KeyPoints",
  props: {
    title: "核心要点",
    points: [{ title: "一" }, { title: "二" }, { title: "三" }],
  },
});

function mockModelText(text: string, usage = { inputTokens: 10, outputTokens: 20 }) {
  mocks.generateText.mockResolvedValue({ text, usage });
}

beforeEach(() => {
  mocks.generateText.mockReset();
});

// ---------------------------------------------------------------------------
// Happy path — assembled
// ---------------------------------------------------------------------------

describe("generateAssembly — assembled", () => {
  it("returns the validated component + props from a fenced JSON block", async () => {
    mockModelText("```json\n" + VALID_KEYPOINTS_JSON + "\n```");
    const result = await generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG);
    expect(result.kind).toBe("assembled");
    if (result.kind === "assembled") {
      expect(result.component).toBe("KeyPoints");
      expect(result.props).toEqual({
        title: "核心要点",
        points: [{ title: "一" }, { title: "二" }, { title: "三" }],
      });
    }
  });

  it("parses bare JSON without fences too", async () => {
    mockModelText(VALID_KEYPOINTS_JSON);
    const result = await generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG);
    expect(result.kind).toBe("assembled");
  });

  it("strips unknown props keys via the registry schema", async () => {
    mockModelText(
      JSON.stringify({
        component: "TitleCard",
        props: { title: "片头", hallucinated: true },
      })
    );
    const result = await generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG);
    expect(result.kind).toBe("assembled");
    if (result.kind === "assembled") {
      expect(result.props).toEqual({ title: "片头" });
    }
  });

  it("passes usage through", async () => {
    mockModelText(VALID_KEYPOINTS_JSON, { inputTokens: 111, outputTokens: 222 });
    const result = await generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG);
    expect(result.usage).toEqual({ inputTokens: 111, outputTokens: 222 });
  });

  it("sends the registry docs in the system prompt", async () => {
    mockModelText(VALID_KEYPOINTS_JSON);
    await generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG);
    const req = mocks.generateText.mock.calls[0][0];
    expect(req.system).toContain(DEFAULT_INPUT.registryDocs);
    expect(req.user).toContain(DEFAULT_INPUT.visualDescription);
  });
});

// ---------------------------------------------------------------------------
// Fallback — component: null
// ---------------------------------------------------------------------------

describe("generateAssembly — fallback", () => {
  it("returns kind fallback with the model's reason", async () => {
    mockModelText(
      '```json\n{"component": null, "reason": "需要自由排版的对比画面，注册组件都不合适"}\n```'
    );
    const result = await generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG);
    expect(result.kind).toBe("fallback");
    if (result.kind === "fallback") {
      expect(result.reason).toContain("注册组件都不合适");
    }
  });
});

// ---------------------------------------------------------------------------
// Failures — thrown errors must carry next-round guidance
// ---------------------------------------------------------------------------

describe("generateAssembly — failures", () => {
  it("throws with correction guidance when the output is not JSON", async () => {
    mockModelText("我觉得应该用 KeyPoints 组件……（没有输出 JSON）");
    await expect(
      generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG)
    ).rejects.toThrow(/not valid JSON/);
    await expect(
      generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG)
    ).rejects.toThrow(/请在下一轮只输出一个/);
  });

  it("throws on empty responses", async () => {
    mockModelText("");
    await expect(
      generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG)
    ).rejects.toThrow(/empty response/);
  });

  it("throws with field paths + guidance when the JSON fails validation", async () => {
    mockModelText('```json\n{"component": "KeyPoints", "props": {"points": []}}\n```');
    let error: Error | null = null;
    try {
      await generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG);
    } catch (err) {
      error = err as Error;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toContain("failed registry validation");
    expect(error!.message).toContain("props.points");
    expect(error!.message).toContain("请修正 JSON");
  });

  it("throws on unregistered component names and lists valid ones", async () => {
    mockModelText('{"component": "PieChart", "props": {}}');
    await expect(
      generateAssembly(DEFAULT_INPUT, DEFAULT_CONFIG)
    ).rejects.toThrow(/unknown component "PieChart"/);
  });
});

// ---------------------------------------------------------------------------
// Retry context
// ---------------------------------------------------------------------------

describe("generateAssembly — retry context", () => {
  it("folds the previous JSON + error into the user message", async () => {
    mockModelText(VALID_KEYPOINTS_JSON);
    await generateAssembly(
      {
        ...DEFAULT_INPUT,
        retryContext: {
          previousJson: '{"component": "PieChart"}',
          errorMessage: 'unknown component "PieChart"',
        },
      },
      DEFAULT_CONFIG
    );
    const req = mocks.generateText.mock.calls[0][0];
    expect(req.user).toContain("Previous assembly JSON failed validation");
    expect(req.user).toContain('{"component": "PieChart"}');
    expect(req.user).toContain('unknown component "PieChart"');
    expect(req.user).toContain("Fix the JSON");
  });
});

// ---------------------------------------------------------------------------
// Pure prompt builders
// ---------------------------------------------------------------------------

describe("prompt builders", () => {
  it("system prompt states the contract and embeds the registry docs", () => {
    const prompt = buildAssemblySystemPrompt("### TitleCard\n…");
    expect(prompt).toContain("visual orchestrator");
    expect(prompt).toContain("### TitleCard");
    expect(prompt).toContain('"component": null');
    expect(prompt).toContain("2–6");
  });

  it("user content includes narration context when provided", () => {
    const user = buildAssemblyUserContent({
      ...DEFAULT_INPUT,
      narrationContext: "旁白：第一条……",
    });
    expect(user).toContain("旁白：第一条……");
    expect(user).toContain("Return ONLY");
  });
});
