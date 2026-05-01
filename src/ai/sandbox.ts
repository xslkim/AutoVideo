import { spawn, ChildProcess } from 'child_process';

/**
 * Environment variable whitelist per PRD §6.3.
 * Only these variables are passed to the sandboxed child process.
 */
const ENV_WHITELIST = [
  'PATH',
  'HOME',
  'LANG',
  'TMPDIR',
  'DISPLAY',
  'NODE_OPTIONS',
] as const;

export interface SandboxOptions {
  /** Working directory for the child process */
  cwd?: string;
  /** Timeout in milliseconds (default: 30_000) */
  timeout?: number;
  /** Memory limit in bytes for prlimit (e.g. 512 * 1024 * 1024 = 512MB) */
  memoryLimitBytes?: number;
  /** CPU time limit in seconds for prlimit */
  cpuLimitSec?: number;
  /** Whether to disable network via unshare -n (default: false) */
  disableNetwork?: boolean;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Build a filtered environment containing only whitelisted variables.
 */
function buildWhitelistedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_WHITELIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}

/**
 * Wrap the command with prlimit (and optionally unshare) for resource isolation.
 * Returns { cmd, args } where cmd/args are suitable for child_process.spawn.
 */
function wrapWithIsolation(
  cmd: string,
  args: string[],
  opts: SandboxOptions,
): { cmd: string; args: string[] } {
  const wrappedArgs: string[] = [];

  // Build prlimit prefix
  if (opts.memoryLimitBytes || opts.cpuLimitSec) {
    wrappedArgs.push('prlimit');
    if (opts.memoryLimitBytes) {
      wrappedArgs.push(`--as=${opts.memoryLimitBytes}`);
    }
    if (opts.cpuLimitSec) {
      wrappedArgs.push(`--cpu=${opts.cpuLimitSec}`);
    }
    wrappedArgs.push('--');
  }

  // Build unshare -n prefix for network isolation
  if (opts.disableNetwork) {
    wrappedArgs.push('unshare', '-n', '--');
  }

  // Append original command and args
  wrappedArgs.push(cmd, ...args);

  // If we have any wrapper, the first element becomes the command
  if (opts.memoryLimitBytes || opts.cpuLimitSec) {
    return { cmd: 'prlimit', args: wrappedArgs.slice(1) };
  }
  if (opts.disableNetwork) {
    return { cmd: 'unshare', args: wrappedArgs.slice(1) };
  }
  return { cmd, args };
}

/**
 * Run a command in an isolated subprocess with:
 * - Whitelisted environment variables only (PRD §6.3)
 * - Optional resource limits via prlimit (memory, CPU)
 * - Optional network isolation via unshare -n
 * - Timeout with SIGTERM → 5s grace → SIGKILL
 *
 * @param cmd - Command to execute
 * @param args - Arguments to pass to the command
 * @param opts - Sandbox options (timeout, limits, etc.)
 * @returns Promise resolving to { stdout, stderr, exitCode }
 */
export async function runIsolated(
  cmd: string,
  args: string[],
  opts: SandboxOptions = {},
): Promise<SandboxResult> {
  const {
    cwd = process.cwd(),
    timeout = 30_000,
    memoryLimitBytes,
    cpuLimitSec,
    disableNetwork = false,
  } = opts;

  const env = buildWhitelistedEnv();
  const { cmd: finalCmd, args: finalArgs } = wrapWithIsolation(cmd, args, {
    memoryLimitBytes,
    cpuLimitSec,
    disableNetwork,
  });

  return new Promise<SandboxResult>((resolve) => {
    const child: ChildProcess = spawn(finalCmd, finalArgs, {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const finalize = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode,
      });
    };

    // Timeout handling: SIGTERM → 5s grace → SIGKILL
    const timeoutHandle = setTimeout(() => {
      if (settled) return;

      // First try graceful SIGTERM
      try {
        child.kill('SIGTERM');
      } catch {
        // Process may have already exited
      }

      // If still alive after 5 seconds, SIGKILL
      killTimer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill('SIGKILL');
        } catch {
          // Process may have already exited
        }
      }, 5000);
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      finalize(code);
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      // Resolve with error info in stderr and non-zero exit code
      finalize(1);
    });
  });
}