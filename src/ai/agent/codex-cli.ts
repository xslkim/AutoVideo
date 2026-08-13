/**
 * CodexCliDriver — AgentDriver over the local `codex` CLI (OpenAI Codex).
 *
 * Invokes `codex exec` in non-interactive mode with a read-only sandbox.
 *
 * Model/provider selection:
 * - No baseURL configured → codex's own setup is used (ChatGPT login or
 *   providers defined in ~/.codex/config.toml); `-m` forwards the model.
 * - baseURL configured → a throwaway custom provider is injected via `-c`
 *   config overrides. Codex only speaks the OpenAI Responses API
 *   (`wire_api = "responses"`), so the endpoint must support it:
 *   DeepSeek does natively (https://api.deepseek.com); GLM must go through
 *   OpenRouter (https://openrouter.ai/api/v1, model z-ai/…) or a local
 *   translation proxy. The API key is never put on the command line — it is
 *   passed through a private env var referenced by the provider's env_key.
 *
 * Output: `--output-last-message <file>` writes exactly the final agent
 * message, which avoids parsing the session log on stdout. Codex prints no
 * machine-readable usage in this mode → usage is zeros.
 *
 * Images are attached with `-i <path>` (native multimodal input).
 */

import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import crypto from "node:crypto";
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

/** Provider id injected via -c overrides when baseURL is configured. */
const PROVIDER_ID = "autovideo";
/** Env var the injected provider reads its API key from. */
const API_KEY_ENV = "AUTOVIDEO_CODEX_API_KEY";

export class CodexCliDriver implements AgentDriver {
  readonly capabilities: AgentCapabilities = { vision: true, usageReporting: false };

  constructor(private readonly config: AgentConfig) {}

  private get cliPath(): string {
    return this.config.cliPath || "codex";
  }

  private get timeoutMs(): number {
    return this.config.cliTimeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  }

  /**
   * Common flags for one `codex exec` invocation. `lastMessageFile` receives
   * the final agent message; the caller owns (and deletes) the file.
   */
  private baseArgs(lastMessageFile: string): string[] {
    const args = [
      "exec",
      // Text/review generation must not touch the workspace.
      "--sandbox", "read-only",
      // The working directory (server cwd / build dir) is often not a git repo.
      "--skip-git-repo-check",
      "--output-last-message", lastMessageFile,
    ];
    if (this.config.model) {
      args.push("-m", this.config.model);
    }
    if (this.config.baseURL) {
      // -c values are parsed as TOML; unparseable values fall back to raw
      // strings, so URLs and names need no extra quoting.
      args.push("-c", `model_provider=${PROVIDER_ID}`);
      args.push("-c", `model_providers.${PROVIDER_ID}.name=${PROVIDER_ID}`);
      args.push("-c", `model_providers.${PROVIDER_ID}.base_url=${this.config.baseURL}`);
      args.push("-c", `model_providers.${PROVIDER_ID}.wire_api=responses`);
      if (this.config.apiKey) {
        args.push("-c", `model_providers.${PROVIDER_ID}.env_key=${API_KEY_ENV}`);
        args.push("-c", "preferred_auth_method=apikey");
      }
    }
    return args;
  }

  private env(): Record<string, string> | undefined {
    return this.config.baseURL && this.config.apiKey
      ? { [API_KEY_ENV]: this.config.apiKey }
      : undefined;
  }

  /**
   * The last-message file is the source of truth. An empty/missing file means
   * the run produced no agent message (auth failure, unknown model, …) —
   * surface stderr instead of returning an empty response.
   */
  private async run(args: string[], stdin: string, lastMessageFile: string, signal?: AbortSignal): Promise<AgentResult> {
    const res: RunCliResult = await runCli({
      cliPath: this.cliPath,
      args,
      stdin,
      timeoutMs: this.timeoutMs,
      signal,
      label: "codex",
      env: this.env(),
    });
    let text = "";
    try {
      text = readFileSync(lastMessageFile, "utf-8").trim();
    } catch {
      /* missing file — handled below */
    }
    if (!text) {
      const detail = stripAnsi(`${res.stderr}\n${res.stdout}`).trim().split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .slice(-8)
        .join(" | ");
      throw new Error(
        `codex CLI returned no output${detail ? `: ${detail.slice(0, 500)}` : ""}`
      );
    }
    return { text, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  private newLastMessageFile(): string {
    return join(os.tmpdir(), `autovideo-codex-${crypto.randomBytes(8).toString("hex")}.txt`);
  }

  async generateText(req: AgentTextRequest, signal?: AbortSignal): Promise<AgentResult> {
    if (signal?.aborted) throw cancelledError();

    // codex exec has no separate system-prompt channel; prepend it.
    const prompt = req.system
      ? `${req.system}\n\n---\n\n${req.user}`
      : req.user;

    const lastMessageFile = this.newLastMessageFile();
    // "-" reads the prompt from stdin (avoids argv length limits).
    const args = [...this.baseArgs(lastMessageFile), "-"];
    try {
      return await this.run(args, prompt, lastMessageFile, signal);
    } finally {
      try { unlinkSync(lastMessageFile); } catch { /* ignore */ }
    }
  }

  async reviewImages(req: AgentImageReviewRequest, signal?: AbortSignal): Promise<AgentResult> {
    if (signal?.aborted) throw cancelledError();

    const lastMessageFile = this.newLastMessageFile();
    const args = this.baseArgs(lastMessageFile);
    for (const img of req.images) {
      args.push("-i", img.path);
    }
    args.push("-");

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

    try {
      return await this.run(args, prompt, lastMessageFile, signal);
    } finally {
      try { unlinkSync(lastMessageFile); } catch { /* ignore */ }
    }
  }
}
