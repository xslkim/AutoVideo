/**
 * Tests for src/ai/component-gen.ts
 *
 * Acceptance criteria:
 * - Credentials missing → immediate error
 * - Successful response → {tsx, usage} correctly parsed
 * - Markdown fences are stripped from response
 * - Retry context is included in the user prompt
 * - Empty response → throws
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateComponent,
  buildUserContent,
  type AnthropicConfig,
  type ComponentGenInput,
} from "../../src/ai/component-gen";

// ---------------------------------------------------------------------------
// Default test fixtures
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AnthropicConfig = {
  model: "claude-sonnet-4-6",
  maxRetries: 3,
};

const DEFAULT_INPUT: ComponentGenInput = {
  visualDescription:
    '屏幕中央显示大标题 "GPT = 下一个词预测器"，白色大字，渐显',
  systemPrompt:
    "You are a React component generator. Generate components following the AnimationProps interface.",
};

const VALID_TSX =
  'export default function Component(props: any) { return <div>Hello</div>; }';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("component-gen", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // -----------------------------------------------------------------------
  // Credentials resolution
  // -----------------------------------------------------------------------

  it("throws immediately if credentials cannot be resolved", async () => {
    // Mock claude-settings to return null
    vi.doMock("../../src/config/claude-settings.js", () => ({
      resolveClaudeCredentials: () => null,
    }));

    const { generateComponent } = await import(
      "../../src/ai/component-gen"
    );

    await expect(
      generateComponent(DEFAULT_INPUT, DEFAULT_CONFIG)
    ).rejects.toThrow("Claude credentials not found");
  });

  // -----------------------------------------------------------------------
  // Response parsing
  // -----------------------------------------------------------------------

  it("returns tsx string from successful text response", async () => {
    vi.doMock("../../src/config/claude-settings.js", () => ({
      resolveClaudeCredentials: () => ({
        authToken: "test-token",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6",
      }),
    }));

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: VALID_TSX }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        };
      },
    }));

    const { generateComponent } = await import(
      "../../src/ai/component-gen"
    );

    const result = await generateComponent(DEFAULT_INPUT, DEFAULT_CONFIG);
    expect(result.tsx).toBe(VALID_TSX);
  });

  it("returns usage from response", async () => {
    vi.doMock("../../src/config/claude-settings.js", () => ({
      resolveClaudeCredentials: () => ({
        authToken: "test-token",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6",
      }),
    }));

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: VALID_TSX }],
            usage: { input_tokens: 500, output_tokens: 200 },
          }),
        };
      },
    }));

    const { generateComponent } = await import(
      "../../src/ai/component-gen"
    );

    const result = await generateComponent(DEFAULT_INPUT, DEFAULT_CONFIG);
    expect(result.usage.inputTokens).toBe(500);
    expect(result.usage.outputTokens).toBe(200);
  });

  // -----------------------------------------------------------------------
  // Markdown fence stripping
  // -----------------------------------------------------------------------

  it("strips markdown code fences from response", async () => {
    vi.doMock("../../src/config/claude-settings.js", () => ({
      resolveClaudeCredentials: () => ({
        authToken: "test-token",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6",
      }),
    }));

    const fencedTsx = "```tsx\n" + VALID_TSX + "\n```";
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: fencedTsx }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        };
      },
    }));

    const { generateComponent } = await import(
      "../../src/ai/component-gen"
    );

    const result = await generateComponent(DEFAULT_INPUT, DEFAULT_CONFIG);
    expect(result.tsx).toBe(VALID_TSX);
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("throws if response is empty", async () => {
    vi.doMock("../../src/config/claude-settings.js", () => ({
      resolveClaudeCredentials: () => ({
        authToken: "test-token",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6",
      }),
    }));

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "" }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        };
      },
    }));

    const { generateComponent } = await import(
      "../../src/ai/component-gen"
    );

    await expect(
      generateComponent(DEFAULT_INPUT, DEFAULT_CONFIG)
    ).rejects.toThrow("empty response");
  });

  // -----------------------------------------------------------------------
  // Retry context
  // -----------------------------------------------------------------------

  it("includes retry context in the user message", async () => {
    vi.doMock("../../src/config/claude-settings.js", () => ({
      resolveClaudeCredentials: () => ({
        authToken: "test-token",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6",
      }),
    }));

    let capturedMessages: any;
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockImplementation(async (args: any) => {
            capturedMessages = args.messages;
            return {
              content: [{ type: "text", text: VALID_TSX }],
              usage: { input_tokens: 100, output_tokens: 50 },
            };
          }),
        };
      },
    }));

    const { generateComponent } = await import(
      "../../src/ai/component-gen"
    );

    const retryInput: ComponentGenInput = {
      ...DEFAULT_INPUT,
      retryContext: {
        previousTsx: "export default () => <div>bad</div>",
        errorMessage: "TypeScript error: Cannot find name 'div'",
      },
    };

    await generateComponent(retryInput, DEFAULT_CONFIG);

    expect(capturedMessages).toHaveLength(1);
    expect(capturedMessages[0].role).toBe("user");
    const userText = capturedMessages[0].content;
    expect(userText).toContain("Previous attempt failed");
    expect(userText).toContain("Cannot find name 'div'");
    expect(userText).toContain("bad");
    expect(userText).toContain("fix the error");
  });

  // -----------------------------------------------------------------------
  // Config usage
  // -----------------------------------------------------------------------

  it("uses model from config when provided", async () => {
    vi.doMock("../../src/config/claude-settings.js", () => ({
      resolveClaudeCredentials: () => ({
        authToken: "test-token",
        baseUrl: "https://api.anthropic.com",
        model: "",
      }),
    }));

    let capturedModel: string;
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockImplementation(async (args: any) => {
            capturedModel = args.model;
            return {
              content: [{ type: "text", text: VALID_TSX }],
              usage: { input_tokens: 100, output_tokens: 50 },
            };
          }),
        };
      },
    }));

    const { generateComponent } = await import(
      "../../src/ai/component-gen"
    );

    await generateComponent(DEFAULT_INPUT, {
      ...DEFAULT_CONFIG,
      model: "claude-opus-4-0",
    });

    expect(capturedModel!).toBe("claude-opus-4-0");
  });

  it("uses model from credentials when config model is empty", async () => {
    vi.doMock("../../src/config/claude-settings.js", () => ({
      resolveClaudeCredentials: () => ({
        authToken: "test-token",
        baseUrl: "https://api.anthropic.com",
        model: "glm-5.1",
      }),
    }));

    let capturedModel: string;
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockImplementation(async (args: any) => {
            capturedModel = args.model;
            return {
              content: [{ type: "text", text: VALID_TSX }],
              usage: { input_tokens: 100, output_tokens: 50 },
            };
          }),
        };
      },
    }));

    const { generateComponent } = await import(
      "../../src/ai/component-gen"
    );

    await generateComponent(DEFAULT_INPUT, {
      ...DEFAULT_CONFIG,
      model: "",
    });

    expect(capturedModel!).toBe("glm-5.1");
  });

  // -----------------------------------------------------------------------
  // Unit tests for exported helpers
  // -----------------------------------------------------------------------

  describe("buildUserContent", () => {
    it("builds basic visual description without retry", () => {
      const result = buildUserContent(DEFAULT_INPUT);
      expect(result).toContain("GPT = 下一个词预测器");
      expect(result).toContain("ONLY the TSX source code");
    });

    it("appends retry context when provided", () => {
      const result = buildUserContent({
        ...DEFAULT_INPUT,
        retryContext: {
          previousTsx: "old tsx",
          errorMessage: "some error",
        },
      });
      expect(result).toContain("Previous attempt failed");
      expect(result).toContain("old tsx");
      expect(result).toContain("some error");
    });
  });
});
