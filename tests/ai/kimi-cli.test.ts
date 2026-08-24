import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KimiCliDriver } from "../../src/ai/agent/kimi-cli.js";

/**
 * A fake `kimi` binary that records argv / stdin to files, then prints a
 * canned stream-json (NDJSON) transcript — so the driver's argument
 * construction and output parsing can be asserted without a real kimi
 * install.
 */
let dir: string;
let fakeKimi: string;
let argsFile: string;
let stdinFile: string;
let promptFile: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-test-"));
  argsFile = path.join(dir, "args.txt");
  stdinFile = path.join(dir, "stdin.txt");
  promptFile = path.join(dir, "prompt.txt");
  fakeKimi = path.join(dir, "kimi");
  fs.writeFileSync(
    fakeKimi,
    `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${argsFile}"
# The prompt (last arg) contains newlines — record it separately.
printf '%s' "\${@: -1}" > "${promptFile}"
cat > "${stdinFile}"
if [ "\${KIMI_TEST_EMPTY:-}" = "1" ]; then
  echo "error: unauthorized" >&2
  exit 0
fi
echo '{"role":"meta","type":"system.version","version":"0.38.0"}'
echo '{"role":"assistant","tool_calls":[{"type":"function","id":"t1","function":{"name":"Read","arguments":"{}"}}]}'
echo '{"role":"tool","tool_call_id":"t1","content":"noise"}'
echo '{"role":"assistant","content":"fake kimi response"}'
echo '{"role":"meta","type":"session.resume_hint","session_id":"s"}'
`,
    { mode: 0o755 },
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function readArgs(): string[] {
  return fs.readFileSync(argsFile, "utf-8").trim().split("\n");
}

function readPrompt(): string {
  return fs.readFileSync(promptFile, "utf-8");
}

describe("KimiCliDriver", () => {
  it("runs kimi -p with stream-json, prompt as the last argument", async () => {
    const driver = new KimiCliDriver({ cliPath: fakeKimi, model: "kimi-k3" });
    const res = await driver.generateText({
      system: "You are a poet.",
      user: "Write one line.",
      maxTokens: 100,
    });

    expect(res.text).toBe("fake kimi response");
    const args = readArgs();
    // Options precede -p; the combined prompt is the final argument.
    expect(args[0]).toBe("--output-format");
    expect(args[1]).toBe("stream-json");
    expect(args[2]).toBe("-m");
    expect(args[3]).toBe("kimi-k3");
    expect(args[4]).toBe("-p");
    const prompt = readPrompt();
    expect(prompt).toContain("You are a poet.");
    expect(prompt).toContain("Write one line.");
  });

  it("omits -m when no model is configured", async () => {
    const driver = new KimiCliDriver({ cliPath: fakeKimi });
    await driver.generateText({ user: "hi", maxTokens: 10 });
    expect(readArgs()).not.toContain("-m");
  });

  it("references review images by absolute path in the prompt", async () => {
    const driver = new KimiCliDriver({ cliPath: fakeKimi });
    const res = await driver.reviewImages({
      instructions: "Review these frames.",
      images: [
        { path: "/tmp/frame-0.png", caption: "t=1s" },
        { path: "/tmp/frame-1.png" },
      ],
      trailingText: "Intended: a title slide",
      maxTokens: 100,
    });

    expect(res.text).toBe("fake kimi response");
    const prompt = readPrompt();
    expect(prompt).toContain("Review these frames.");
    expect(prompt).toContain("t=1s: /tmp/frame-0.png");
    expect(prompt).toContain("/tmp/frame-1.png");
    expect(prompt).toContain("Intended: a title slide");
  });

  it("fails with stderr detail when kimi produces no output", async () => {
    process.env.KIMI_TEST_EMPTY = "1";
    try {
      const driver = new KimiCliDriver({ cliPath: fakeKimi });
      await expect(
        driver.generateText({ user: "hi", maxTokens: 10 }),
      ).rejects.toThrow(/kimi CLI returned no output.*unauthorized/);
    } finally {
      delete process.env.KIMI_TEST_EMPTY;
    }
  });
});
