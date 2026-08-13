/**
 * Shared helpers for CLI-based agent drivers (claude / opencode).
 */

import { spawn } from "node:child_process";

/** Default timeout for a single CLI invocation (10 min). A hung CLI process
 *  would otherwise block the single-threaded task queue indefinitely. */
export const DEFAULT_CLI_TIMEOUT_MS = 600_000;

export function cancelledError(): Error {
  return Object.assign(new Error("Cancelled"), { code: "ERR_CANCELLED" });
}

export interface RunCliOptions {
  /** Binary path or name (resolved via PATH) */
  cliPath: string;
  args: string[];
  /** Prompt content fed via stdin */
  stdin: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Short name used in error messages (e.g. "claude", "opencode") */
  label: string;
  /** Extra environment variables merged over process.env (e.g. API keys). */
  env?: Record<string, string>;
}

export interface RunCliResult {
  stdout: string;
  /** Some CLIs (opencode) print errors here while still exiting 0. */
  stderr: string;
}

/** Strip ANSI color/style escapes so stderr is readable in error messages. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Spawn a CLI, feed stdin, and collect stdout + stderr.
 * Rejects on non-zero exit, spawn failure, timeout, or abort.
 */
export function runCli(opts: RunCliOptions): Promise<RunCliResult> {
  const { cliPath, args, stdin, timeoutMs, signal, label } = opts;

  return new Promise<RunCliResult>((resolve, reject) => {
    const proc = spawn(cliPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      settle(() =>
        reject(
          Object.assign(
            new Error(`${label} CLI timed out after ${Math.round(timeoutMs / 1000)}s`),
            { code: "ERR_CLI_TIMEOUT" },
          ),
        ),
      );
    }, timeoutMs);

    proc.stdin.write(stdin, "utf-8");
    proc.stdin.end();

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        settle(() => resolve({ stdout, stderr }));
      } else {
        const detail = stripAnsi(stderr.trim() || stdout.trim());
        settle(() =>
          reject(new Error(`${label} CLI exited ${code}: ${detail.slice(0, 500)}`))
        );
      }
    });

    proc.on("error", (err: Error) => {
      settle(() => reject(new Error(`Failed to spawn ${label}: ${err.message}`)));
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

/**
 * Quick availability probe: run `<cli> --version` with a short timeout.
 * Used by doctor / connectivity tests for CLI providers.
 */
export function checkCliVersion(
  cliPath: string,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; latencyMs?: number; message?: string }> {
  const start = Date.now();
  return runCli({
    cliPath,
    args: ["--version"],
    stdin: "",
    timeoutMs,
    label: cliPath,
  })
    .then((res) => ({
      ok: true,
      latencyMs: Date.now() - start,
      message: res.stdout.trim().slice(0, 100),
    }))
    .catch((err: unknown) => ({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }));
}
