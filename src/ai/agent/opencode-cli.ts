/**
 * OpencodeCliDriver — AgentDriver over the local `opencode` CLI.
 *
 * Invokes `opencode run` in non-interactive mode. Credentials and providers
 * are whatever the user configured in opencode (`opencode auth login`).
 *
 * - Prompt goes in via stdin (opencode reads piped stdin as the message).
 * - Model is forwarded with `-m provider/model` when configured.
 * - Images are attached with `-f <path>`, so review does not depend on
 *   filesystem tool permissions.
 * - With a non-TTY stdout, opencode prints only the response text to stdout
 *   (progress/decorations go to stderr), so stdout is used as-is.
 * - opencode's default text output carries no token usage → usage is zeros.
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
 * opencode prints errors (auth failure, unsupported model, …) to stderr and
 * still exits 0, leaving stdout empty. Treat empty stdout as a failure and
 * surface the stderr detail instead of returning an empty response.
 */
function toAgentResult(res: RunCliResult): AgentResult {
  const text = res.stdout.trim();
  if (!text) {
    const detail = stripAnsi(res.stderr).trim().split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join(" | ");
    throw new Error(
      `opencode CLI returned no output${detail ? `: ${detail.slice(0, 500)}` : ""}`
    );
  }
  return { text, usage: { inputTokens: 0, outputTokens: 0 } };
}

export class OpencodeCliDriver implements AgentDriver {
  readonly capabilities: AgentCapabilities = { vision: true, usageReporting: false };

  constructor(private readonly config: AgentConfig) {}

  private get cliPath(): string {
    return this.config.cliPath || "opencode";
  }

  private get timeoutMs(): number {
    return this.config.cliTimeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  }

  private baseArgs(): string[] {
    const args = ["run"];
    if (this.config.model) {
      args.push("-m", this.config.model);
    }
    return args;
  }

  async generateText(req: AgentTextRequest, signal?: AbortSignal): Promise<AgentResult> {
    if (signal?.aborted) throw cancelledError();

    // opencode has no separate system-prompt channel in run mode;
    // prepend it to the message with a clear separator.
    const prompt = req.system
      ? `${req.system}\n\n---\n\n${req.user}`
      : req.user;

    const res = await runCli({
      cliPath: this.cliPath,
      args: this.baseArgs(),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
      signal,
      label: "opencode",
    });
    return toAgentResult(res);
  }

  async reviewImages(req: AgentImageReviewRequest, signal?: AbortSignal): Promise<AgentResult> {
    if (signal?.aborted) throw cancelledError();

    const args = this.baseArgs();
    for (const img of req.images) {
      args.push("-f", img.path);
    }

    const imageLines = req.images.map((img, i) =>
      img.caption
        ? `${img.caption}: attached image #${i + 1}`
        : `Review the attached image #${i + 1}.`
    );
    const prompt = [
      req.instructions,
      "",
      ...imageLines,
      ...(req.trailingText ? [req.trailingText] : []),
    ].join("\n");

    const res = await runCli({
      cliPath: this.cliPath,
      args,
      stdin: prompt,
      timeoutMs: this.timeoutMs,
      signal,
      label: "opencode",
    });
    return toAgentResult(res);
  }
}
