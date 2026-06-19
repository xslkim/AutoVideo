/**
 * Multimodal visual review (plan B).
 *
 * After the deterministic metrics (plan A) pass, optionally ask a multimodal
 * model to look at the rendered still and critique it like a design reviewer.
 * The model only judges the image and returns structured JSON — it never
 * writes code. Its suggestions are folded back into the generator's
 * retryContext to drive a quality-focused regeneration.
 *
 * Transport:
 *   - CLI mode (default here): spawn `claude -p` which reads the PNG via its
 *     Read tool (requires --dangerously-skip-permissions). Uses whatever model
 *     `claude login` / settings.json selects (opus, confirmed multimodal).
 *   - SDK mode: send the image as a base64 content block to the Messages API.
 */

import Anthropic from "@anthropic-ai/sdk";
import { resolveClaudeCredentials } from "../config/claude-settings.js";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

export interface VisualReviewConfig {
  useCLI?: boolean;
  cliPath?: string;
  // SDK mode credentials/model:
  apiKey?: string;
  baseURL?: string;
  model?: string;
  maxRetries?: number;
}

export interface VisualReviewResult {
  /** true → slide looks rich/well-composed; false → needs another pass */
  pass: boolean;
  /** Actionable feedback for the generator (empty when pass === true) */
  feedback: string;
  /** Raw model output, for logging/debugging */
  raw?: string;
}

interface VisualReviewInput {
  /** Absolute path to the rendered still PNG */
  pngPath: string;
  /** The intended visual description for this slide */
  visualDescription: string;
}

const REVIEW_INSTRUCTIONS = `You are a strict art director reviewing a single FULLSCREEN slide from an educational video.
You are given the rendered slide image and the intended description.

Judge ONLY visual quality, not factual correctness:
- Does the content fill the canvas, or does it float small in a large empty area?
- Are the title / key elements large and clearly the focal point?
- Is there clear visual hierarchy, grouping, and use of color/accent?
- Is the composition balanced (no big empty corners / dead bands)?
- Does it look polished and information-rich rather than bland and sparse?

Respond with ONLY a JSON object, no markdown fences, no extra prose:
{
  "pass": <true if the slide is visually rich and well-composed; false if it is sparse, simple, empty, or low quality>,
  "issues": [ "<short concrete problem>", ... ],
  "suggestions": [ "<short concrete fix the generator should apply>", ... ]
}
Be demanding: a centered title on a mostly empty background is NOT a pass.`;

/** Extract the first balanced JSON object from arbitrary model text. */
function extractJson(text: string): any | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Turn a parsed critique into a pass flag + generator feedback. */
function toResult(parsed: any, raw: string): VisualReviewResult {
  if (!parsed || typeof parsed.pass !== "boolean") {
    // Unparseable / malformed → don't block the pipeline.
    return { pass: true, feedback: "", raw };
  }
  if (parsed.pass) return { pass: true, feedback: "", raw };

  const issues: string[] = Array.isArray(parsed.issues) ? parsed.issues.map(String) : [];
  const suggestions: string[] = Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [];
  const lines = [
    "Visual review failed — 资深设计评审认为画面质量不足，请重写组件改进视觉表现：",
  ];
  if (issues.length) lines.push("问题：", ...issues.map((s, i) => `  ${i + 1}. ${s}`));
  if (suggestions.length) lines.push("建议：", ...suggestions.map((s, i) => `  ${i + 1}. ${s}`));
  lines.push("保持技术契约不变（默认导出、AnimationProps、仅 import react/remotion），只改进视觉密度、层次与构图。");
  return { pass: false, feedback: lines.join("\n"), raw };
}

// ---------------------------------------------------------------------------
// CLI transport
// ---------------------------------------------------------------------------

async function reviewViaCLI(
  input: VisualReviewInput,
  config: VisualReviewConfig,
  signal?: AbortSignal,
): Promise<VisualReviewResult> {
  const cliPath = config.cliPath || "claude";
  const prompt = [
    REVIEW_INSTRUCTIONS,
    "",
    `Read the image at: ${input.pngPath}`,
    `Intended description of the slide: ${input.visualDescription}`,
  ].join("\n");

  const args = [
    "-p",
    "--no-session-persistence",
    "--dangerously-skip-permissions",
    "--output-format", "text",
  ];

  const raw = await new Promise<string>((resolve, reject) => {
    const proc = spawn(cliPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    proc.stdin.write(prompt, "utf-8");
    proc.stdin.end();
    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("close", (code) => {
      if (code === 0) settle(() => resolve(stdout));
      else settle(() => reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 400)}`)));
    });
    proc.on("error", (err: Error) => settle(() => reject(new Error(`Failed to spawn claude: ${err.message}`))));

    if (signal) {
      const onAbort = () => {
        proc.kill("SIGTERM");
        settle(() => reject(Object.assign(new Error("Cancelled"), { code: "ERR_CANCELLED" })));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      proc.on("close", () => signal.removeEventListener("abort", onAbort));
    }
  });

  return toResult(extractJson(raw), raw);
}

// ---------------------------------------------------------------------------
// SDK transport
// ---------------------------------------------------------------------------

async function reviewViaSDK(
  input: VisualReviewInput,
  config: VisualReviewConfig,
  signal?: AbortSignal,
): Promise<VisualReviewResult> {
  let apiKey = config.apiKey;
  let baseURL = config.baseURL;
  let model = config.model || "claude-sonnet-4-6";
  if (!apiKey) {
    const creds = resolveClaudeCredentials();
    if (!creds) throw Object.assign(new Error("Claude credentials not found for visual review."), { code: "ERR_ANTHROPIC_KEY_MISSING" });
    apiKey = creds.authToken;
    baseURL = baseURL || creds.baseUrl;
    model = config.model || creds.model || "claude-sonnet-4-6";
  }

  const isOAuthToken = apiKey.startsWith("sk-ant-oat");
  const client = new Anthropic({
    apiKey,
    maxRetries: config.maxRetries ?? 3,
    baseURL,
    defaultHeaders: isOAuthToken
      ? { "anthropic-beta": "claude-code-20250219", "x-client-name": "claude-code", "x-client-version": "2.1.126" }
      : undefined,
  });

  const base64 = readFileSync(input.pngPath).toString("base64");
  const response = await client.messages.create(
    {
      model,
      max_tokens: 1024,
      system: REVIEW_INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
            { type: "text", text: `Intended description of the slide: ${input.visualDescription}` },
          ],
        },
      ],
    },
    { signal },
  );

  let text = "";
  for (const block of response.content) if (block.type === "text") text += block.text;
  return toResult(extractJson(text), text);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function reviewVisual(
  input: VisualReviewInput,
  config: VisualReviewConfig,
  signal?: AbortSignal,
): Promise<VisualReviewResult> {
  if (config.useCLI) return reviewViaCLI(input, config, signal);
  return reviewViaSDK(input, config, signal);
}
