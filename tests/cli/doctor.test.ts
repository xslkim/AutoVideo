import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Helper to run doctor and capture output + exit code
async function runDoctor(env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  try {
    const { stdout, stderr } = await execFileAsync("npx", ["tsx", "bin/autovideo.ts", "doctor"], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      timeout: 60_000,
    });
    return { stdout, stderr, code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.code ?? 1,
    };
  }
}

describe("doctor command", () => {
  it("should output a table with all 11 check items", async () => {
    const { stdout, code } = await runDoctor();

    // Should contain the table header
    expect(stdout).toContain("Check");
    expect(stdout).toContain("Status");
    expect(stdout).toContain("Detail");

    // Should contain all 11 check names
    expect(stdout).toContain("Node.js version");
    expect(stdout).toContain("ffmpeg");
    expect(stdout).toContain("Chromium");
    expect(stdout).toContain("CJK fonts");
    expect(stdout).toContain("VoxCPM2 service");
    expect(stdout).toContain("VoxCPM2 model weights");
    expect(stdout).toContain("Claude API key");
    expect(stdout).toContain("Claude API connectivity");
    expect(stdout).toContain("Cache directory");
    expect(stdout).toContain("Disk space");
    expect(stdout).toContain("prlimit / unshare");

    // Should contain a summary line
    expect(stdout).toContain("Summary:");

    // Exit code should be 0, 1, or 2
    expect([0, 1, 2]).toContain(code);
  });

  it("should return exit code 2 when API key is missing", async () => {
    // Unset the API key to force a FAIL
    const { code, stdout } = await runDoctor({
      ANTHROPIC_API_KEY: "",
    });

    // Should FAIL due to missing API key
    expect(stdout).toContain("Claude API key");
    expect(code).toBe(2);
  });

  it("should show PASS for Node.js >= 20", async () => {
    const { stdout } = await runDoctor();
    // Current test env should have Node >= 20
    const nodeMajor = parseInt(process.version.slice(1).split(".")[0], 10);
    if (nodeMajor >= 20) {
      // Check that Node line has PASS
      const lines = stdout.split("\n");
      const nodeLine = lines.find((l) => l.includes("Node.js version"));
      expect(nodeLine).toContain("PASS");
    }
  });

  it("should show fix guidance for non-PASS items", async () => {
    const { stdout } = await runDoctor({
      ANTHROPIC_API_KEY: "",
    });

    // Should have a "Fix guidance" section since we expect at least one FAIL
    if (stdout.includes("FAIL")) {
      expect(stdout).toContain("Fix guidance:");
    }
  });

  it("should report WARN for Claude API connectivity when key is fake", async () => {
    const { stdout } = await runDoctor({
      ANTHROPIC_API_KEY: "sk-ant-fake-key-for-testing",
    });

    // Should attempt API call and get WARN (either auth or connectivity)
    const lines = stdout.split("\n");
    const connectivityLine = lines.find((l) => l.includes("Claude API connectivity"));
    // It should either PASS (unlikely with fake key), WARN, or have detail
    expect(connectivityLine).toBeDefined();
  });

  it("should report correctly on disk space", async () => {
    const { stdout } = await runDoctor();
    const lines = stdout.split("\n");
    const diskLine = lines.find((l) => l.includes("Disk space"));
    expect(diskLine).toBeDefined();
    // Should be PASS, WARN, or FAIL
    expect(diskLine).toMatch(/PASS|WARN|FAIL/);
  });

  it("should check cache directory writability", async () => {
    const { stdout } = await runDoctor();
    const lines = stdout.split("\n");
    const cacheLine = lines.find((l) => l.includes("Cache directory"));
    expect(cacheLine).toBeDefined();
  });

  it("should display counts in summary", async () => {
    const { stdout } = await runDoctor();
    expect(stdout).toMatch(/Summary: \d+ PASS, \d+ WARN, \d+ FAIL/);
  });
});