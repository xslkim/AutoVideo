/**
 * KimiCliDriver — AgentDriver over the local `kimi` CLI (Kimi Code CLI).
 *
 * Invokes `kimi -p` in non-interactive print mode, reusing whatever
 * credentials are active via `kimi login`. This avoids API-key setup.
 *
 * - Options must precede `-p`: commander consumes the token right after
 *   `-p` as the prompt, so `--output-format` / `-m` go first and the
 *   prompt is always the last argument.
 * - Output format is NDJSON (`--output-format stream-json`); the final
 *   answer is the last `{"role":"assistant","content":...}` line. Tool-call
 *   messages carry `tool_calls` instead of `content` and are skipped.
 *   If no line parses, raw stdout is used as the response text.
 * - The default text renderer decorates markdown (bullet prefixes, indent)
 *   which would corrupt extracted TSX — hence stream-json, which carries
 *   the raw content string.
 * - Image review relies on the CLI's own file tools: images are referenced
 *   by absolute path in the prompt and the agent reads them from disk
 *   (print mode auto-approves read-only tool calls; `--yolo` cannot be
 *   combined with `-p`).
 * - stream-json output carries no token usage → usage is zeros.
 */

import {
  runCli,
  stripAnsi,
  cancelledError,
  DEFAULT_CLI_TIMEOUT_MS,
  type RunCliResult,
} from "./cli-common.js";
import type {
  AgentCapabilities,
  AgentConfig,
  AgentDriver,
  AgentImageReviewRequest,
  AgentResult,
  AgentTextRequest,
} from "./types.js";

/**
 * Parse kimi's stream-json NDJSON output: the final answer is the last
 * assistant message with a string `content`. Falls back to raw stdout when
 * nothing parses (e.g. an older CLI without stream-json).
 */
function parseStreamJson(raw: string): string {
  let text = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const msg = JSON.parse(trimmed) as {
        role?: string;
        content?: unknown;
        tool_calls?: unknown;
      };
      if (msg.role === "assistant" && typeof msg.content === "string") {
        text = msg.content;
      }
    } catch {
      // Not JSON — ignore; the raw-text fallback below covers it.
    }
  }
  return text || raw.trim();
}

/** Empty output means the call failed (auth, model, …) — surface stderr. */
function toAgentResult(res: RunCliResult): AgentResult {
  const text = parseStreamJson(res.stdout);
  if (!text) {
    const detail = stripAnsi(res.stderr).trim().split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join(" | ");
    throw new Error(
      `kimi CLI returned no output${detail ? `: ${detail.slice(0, 500)}` : ""}`
    );
  }
  return { text, usage: { inputTokens: 0, outputTokens: 0 } };
}

export class KimiCliDriver implements AgentDriver {
  readonly capabilities: AgentCapabilities = { vision: true, usageReporting: false };

  constructor(private readonly config: AgentConfig) {}

  private get cliPath(): string {
    return this.config.cliPath || "kimi";
  }

  private get timeoutMs(): number {
    return this.config.cliTimeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  }

  private baseArgs(): string[] {
    const args = ["--output-format", "stream-json"];
    if (this.config.model) {
      args.push("-m", this.config.model);
    }
    return args;
  }

  async generateText(req: AgentTextRequest, signal?: AbortSignal): Promise<AgentResult> {
    if (signal?.aborted) throw cancelledError();

    // kimi -p has no separate system-prompt channel in print mode;
    // prepend it to the message with a clear separator.
    const prompt = req.system
      ? `${req.system}\n\n---\n\n${req.user}`
      : req.user;

    const res = await runCli({
      cliPath: this.cliPath,
      args: [...this.baseArgs(), "-p", prompt],
      stdin: "",
      timeoutMs: this.timeoutMs,
      signal,
      label: "kimi",
    });
    return toAgentResult(res);
  }

  async reviewImages(req: AgentImageReviewRequest, signal?: AbortSignal): Promise<AgentResult> {
    if (signal?.aborted) throw cancelledError();

    // Images are read from disk by the agent's own tools (ReadMediaFile).
    const imageLines = req.images.map((img) =>
      img.caption
        ? `${img.caption}: ${img.path}`
        : `Read the image at: ${img.path}`
    );
    const prompt = [
      req.instructions,
      "",
      ...imageLines,
      ...(req.trailingText ? [req.trailingText] : []),
    ].join("\n");

    const res = await runCli({
      cliPath: this.cliPath,
      args: [...this.baseArgs(), "-p", prompt],
      stdin: "",
      timeoutMs: this.timeoutMs,
      signal,
      label: "kimi",
    });
    return toAgentResult(res);
  }
}
