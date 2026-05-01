import { describe, it, expect } from 'vitest';
import { runIsolated } from '../../src/ai/sandbox.js';

describe('runIsolated', () => {
  it('should run a simple command and return stdout', async () => {
    const result = await runIsolated('echo', ['hello world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
  });

  it('should capture stderr', async () => {
    // Use a command that writes to stderr: `echo msg >&2` in bash
    const result = await runIsolated('bash', ['-c', 'echo error_msg >&2']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('error_msg');
  });

  it('should return non-zero exit code for failing commands', async () => {
    const result = await runIsolated('bash', ['-c', 'exit 42']);
    expect(result.exitCode).toBe(42);
  });

  it('should whitelist only allowed env vars and strip sensitive ones', async () => {
    // Set a sensitive env var in the current process (for test purposes)
    // The child process should NOT see it because runIsolated builds a clean env
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret-key-12345';

    try {
      // Use printenv to check if ANTHROPIC_API_KEY is visible in child
      const result = await runIsolated('printenv', ['ANTHROPIC_API_KEY']);
      // printenv exits 0 if var is set, 1 if not set
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout.trim()).toBe('');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('should pass through whitelisted PATH env var', async () => {
    const result = await runIsolated('printenv', ['PATH']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(process.env.PATH);
  });

  it('should pass through whitelisted HOME env var', async () => {
    const result = await runIsolated('printenv', ['HOME']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(process.env.HOME);
  });

  it('should kill a process that exceeds the timeout (SIGTERM → SIGKILL)', async () => {
    // Run a sleep command with a very short timeout
    const result = await runIsolated('sleep', ['60'], { timeout: 500 });
    // Process should be killed, exit code should be non-zero (SIGTERM = 143 or SIGKILL = 137)
    expect(result.exitCode).not.toBe(0);
    // On Linux, killed by signal gives exit code = 128 + signal_number
    // SIGTERM = 15 → 143, SIGKILL = 9 → 137
    const isSignalExit = result.exitCode === 137 || result.exitCode === 143 || result.exitCode === null;
    expect(isSignalExit || result.exitCode! < 0).toBe(true);
  });

  it('should support cwd option', async () => {
    const result = await runIsolated('pwd', [], { cwd: '/tmp' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('/tmp');
  });

  it('should disable network when disableNetwork is true (unshare -n)', async () => {
    // curl to a known address should fail in a network-isolated process
    // Use a short timeout for the curl itself so it doesn't hang
    const result = await runIsolated(
      'curl',
      ['--connect-timeout', '2', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://1.1.1.1'],
      {
        disableNetwork: true,
        timeout: 10_000,
      },
    );
    // curl should fail (non-zero exit code) because network is disabled
    expect(result.exitCode).not.toBe(0);
  });

  it('should allow network by default (no unshare)', async () => {
    // This test just checks that without disableNetwork, the process runs normally
    // We don't want to depend on external network in CI, so we just check
    // that the command executes without error when not isolated
    const result = await runIsolated('echo', ['network ok']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('network ok');
  });

  it('should handle non-existent commands gracefully', async () => {
    const result = await runIsolated('nonexistent_command_that_does_not_exist_12345', []);
    expect(result.exitCode).not.toBe(0);
  });
});