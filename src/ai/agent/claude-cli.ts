/**
 * ClaudeCliDriver — AgentDriver over the local `claude` CLI.
 *
 * Invokes `claude -p` in non-interactive print mode, reusing whatever
 * credentials are active via `claude login`. This avoids API-key setup.
 *
 * Image review relies on the CLI's Read tool: images are referenced by
 * absolute path in the prompt and the agent reads them from disk
 * (hence --dangerously-skip-permissions).
 */

import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import crypto from "node:crypto";
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
  "--output-format", "text",
];

function cancelledError(): Error {
  return Object.assign(new Error("Cancelled"), { code: "ERR_CANCELLED" });
}

/**
 * Spawn the CLI, feed `stdinContent` via stdin, and collect stdout.
 * Rejects on non-zero exit, spawn failure, or abort.
 */
function runCli(
  cliPath: string,
  args: string[],
  stdinContent: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(cliPath, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    proc.stdin.write(stdinContent, "utf-8");
    proc.stdin.end();

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        settle(() => resolve(stdout));
      } else {
        const detail = stderr.trim() || stdout.trim();
        settle(() =>
          reject(new Error(`claude CLI exited ${code}: ${detail.slice(0, 500)}`))
        );
      }
    });

    proc.on("error", (err: Error) => {
      settle(() => reject(new Error(`Failed to spawn claude: ${err.message}`)));
    });

    if (signal) {
      const onAbort = () => {
        proc.kill("SIGTERM");
        settle(() => reject(cancelledError()));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      proc.on("close", () => signal.removeEventListener("abort", onAbort));
    }
  });
}

export class ClaudeCliDriver implements AgentDriver {
  /** The CLI reads images from disk via its Read tool; it cannot report usage. */
  readonly capabilities: AgentCapabilities = { vision: true, usageReporting: false };

  constructor(private readonly config: AgentConfig) {}

  private get cliPath(): string {
    return this.config.cliPath || "claude";
  }

  async generateText(req: AgentTextRequest, signal?: AbortSignal): Promise<AgentResult> {
    if (signal?.aborted) throw cancelledError();

    // NOTE: we intentionally do NOT forward --model to the CLI.
    // The CLI picks its own default (typically the fastest available model).
    // Forcing a specific model via --model switches to a different backend that
    // can be orders of magnitude slower with large system prompts, causing the
    // invocation to hang until the server-side timeout kills it.
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
      const text = await runCli(this.cliPath, args, req.user, signal);
      return { text, usage: { inputTokens: 0, outputTokens: 0 } };
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

    const text = await runCli(this.cliPath, [...BASE_ARGS], prompt, signal);
    return { text, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
