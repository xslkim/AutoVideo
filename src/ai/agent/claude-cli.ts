/**
 * ClaudeCliDriver — AgentDriver over the local `claude` CLI.
 *
 * Invokes `claude -p` in non-interactive print mode, reusing whatever
 * credentials are active via `claude login`. This avoids API-key setup.
 *
 * Output format is JSON (`--output-format json`) so real token usage can be
 * reported; if the output cannot be parsed as the expected result envelope,
 * the raw stdout is used as the response text (usage falls back to zeros).
 *
 * Image review relies on the CLI's Read tool: images are referenced by
 * absolute path in the prompt and the agent reads them from disk
 * (hence --dangerously-skip-permissions).
 */

import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { runCli, cancelledError, DEFAULT_CLI_TIMEOUT_MS } from "./cli-common.js";
import type {
  AgentCapabilities,
  AgentConfig,
  AgentDriver,
  AgentImageReviewRequest,
  AgentResult,
  AgentTextRequest,
} from "./types.js";

const BASE_ARGS = [
  "-p",
  "--no-session-persistence",
  "--dangerously-skip-permissions",
  "--output-format", "json",
];

/**
 * Parse the claude CLI JSON result envelope:
 *   {"type":"result","subtype":"success","result":"...","usage":{...},...}
 * Falls back to treating the raw output as plain text.
 */
function parseCliOutput(raw: string): AgentResult {
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      is_error?: boolean;
      result?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    if (parsed?.type === "result" && typeof parsed.result === "string") {
      if (parsed.is_error) {
        throw new Error(`claude CLI reported an error: ${parsed.result.slice(0, 500)}`);
      }
      const u = parsed.usage ?? {};
      return {
        text: parsed.result,
        usage: {
          inputTokens:
            (u.input_tokens ?? 0)
            + (u.cache_creation_input_tokens ?? 0)
            + (u.cache_read_input_tokens ?? 0),
          outputTokens: u.output_tokens ?? 0,
        },
      };
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("claude CLI reported")) throw err;
    // Not JSON — fall through to raw text
  }
  return { text: raw, usage: { inputTokens: 0, outputTokens: 0 } };
}

export class ClaudeCliDriver implements AgentDriver {
  readonly capabilities: AgentCapabilities = { vision: true, usageReporting: true };

  constructor(private readonly config: AgentConfig) {}

  private get cliPath(): string {
    return this.config.cliPath || "claude";
  }

  private get timeoutMs(): number {
    return this.config.cliTimeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  }

  async generateText(req: AgentTextRequest, signal?: AbortSignal): Promise<AgentResult> {
    if (signal?.aborted) throw cancelledError();

    // NOTE: we intentionally do NOT forward --model to the CLI.
    // The CLI picks its own default (typically the fastest available model).
    // Forcing a specific model via --model switches to a different backend that
    // can be orders of magnitude slower with large system prompts, causing the
    // invocation to hang until the timeout kills it.
    const args = [...BASE_ARGS];

    // Write system prompt to a temp file to avoid CLI argument length limits
    let tmpFile: string | undefined;
    if (req.system) {
      tmpFile = join(
        os.tmpdir(),
        `autovideo-sp-${crypto.randomBytes(8).toString("hex")}.txt`
      );
      writeFileSync(tmpFile, req.system, "utf-8");
      args.push("--system-prompt-file", tmpFile);
    }

    try {
      const res = await runCli({
        cliPath: this.cliPath,
        args,
        stdin: req.user,
        timeoutMs: this.timeoutMs,
        signal,
        label: "claude",
      });
      return parseCliOutput(res.stdout);
    } finally {
      if (tmpFile) {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    }
  }

  async reviewImages(req: AgentImageReviewRequest, signal?: AbortSignal): Promise<AgentResult> {
    if (signal?.aborted) throw cancelledError();

    const imageLines = req.images.map((img) =>
      img.caption ? `${img.caption}: ${img.path}` : `Read the image at: ${img.path}`
    );
    const prompt = [
      req.instructions,
      "",
      ...imageLines,
      ...(req.trailingText ? [req.trailingText] : []),
    ].join("\n");

    const res = await runCli({
      cliPath: this.cliPath,
      args: [...BASE_ARGS],
      stdin: prompt,
      timeoutMs: this.timeoutMs,
      signal,
      label: "claude",
    });
    return parseCliOutput(res.stdout);
  }
}
