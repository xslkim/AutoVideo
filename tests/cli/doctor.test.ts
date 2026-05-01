import { describe, it, expect, vi, beforeEach } from "vitest";
import { doctorAction } from "../../src/cli/doctor.js";

describe("doctor command", () => {
  it("should output a table with all 11 check items", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };

    try {
      await doctorAction();
    } finally {
      console.log = origLog;
    }

    const stdout = logs.join("\n");

    expect(stdout).toContain("Check");
    expect(stdout).toContain("Status");
    expect(stdout).toContain("Detail");

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

    expect(stdout).toContain("Summary:");
  });

  it("should return exit code 2 when API key is missing", async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };

    let code: number;
    try {
      code = await doctorAction();
    } finally {
      console.log = origLog;
      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
    }

    const stdout = logs.join("\n");
    expect(stdout).toContain("Claude API key");
    expect(code).toBe(2);
  });

  it("should show PASS for Node.js >= 20", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };

    try {
      await doctorAction();
    } finally {
      console.log = origLog;
    }

    const stdout = logs.join("\n");
    const nodeMajor = parseInt(process.version.slice(1).split(".")[0], 10);
    if (nodeMajor >= 20) {
      const lines = stdout.split("\n");
      const nodeLine = lines.find((l) => l.includes("Node.js version"));
      expect(nodeLine).toContain("PASS");
    }
  });

  it("should report correctly on disk space", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };

    try {
      await doctorAction();
    } finally {
      console.log = origLog;
    }

    const stdout = logs.join("\n");
    const lines = stdout.split("\n");
    const diskLine = lines.find((l) => l.includes("Disk space"));
    expect(diskLine).toBeDefined();
    expect(diskLine).toMatch(/PASS|WARN|FAIL/);
  });

  it("should check cache directory writability", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };

    try {
      await doctorAction();
    } finally {
      console.log = origLog;
    }

    const stdout = logs.join("\n");
    const lines = stdout.split("\n");
    const cacheLine = lines.find((l) => l.includes("Cache directory"));
    expect(cacheLine).toBeDefined();
  });

  it("should display counts in summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };

    try {
      await doctorAction();
    } finally {
      console.log = origLog;
    }

    const stdout = logs.join("\n");
    expect(stdout).toMatch(/Summary: \d+ PASS, \d+ WARN, \d+ FAIL/);
  });
});
