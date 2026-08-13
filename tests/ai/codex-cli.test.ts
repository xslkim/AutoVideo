import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CodexCliDriver } from "../../src/ai/agent/codex-cli.js";

/**
 * A fake `codex` binary that records argv / stdin / the API-key env var to
 * files, then writes a canned response into the --output-last-message file —
 * so the driver's argument construction and output handling can be asserted
 * without a real codex install.
 */
let dir: string;
let fakeCodex: string;
let argsFile: string;
let stdinFile: string;
let keyFile: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
  argsFile = path.join(dir, "args.txt");
  stdinFile = path.join(dir, "stdin.txt");
  keyFile = path.join(dir, "key.txt");
  fakeCodex = path.join(dir, "codex");
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${argsFile}"
cat > "${stdinFile}"
echo "\${AUTOVIDEO_CODEX_API_KEY:-}" > "${keyFile}"
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then out="$a"; fi
  prev="$a"
done
if [ -n "$out" ] && [ "\${CODEX_TEST_EMPTY:-}" != "1" ]; then
  echo "fake codex response" > "$out"
fi
if [ "\${CODEX_TEST_EMPTY:-}" = "1" ]; then
  echo "stream error: unexpected status 401" >&2
fi
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

describe("CodexCliDriver", () => {
  it("runs codex exec with sandbox, model flag and stdin prompt", async () => {
    const driver = new CodexCliDriver({ cliPath: fakeCodex, model: "deepseek-chat" });
    const res = await driver.generateText({
      system: "You are a poet.",
      user: "Write one line.",
      maxTokens: 100,
    });

    expect(res.text).toBe("fake codex response");
    const args = readArgs();
    expect(args[0]).toBe("exec");
    expect(args).toContain("--sandbox");
    expect(args).toContain("read-only");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("-m");
    expect(args[args.indexOf("-m") + 1]).toBe("deepseek-chat");
    expect(args[args.length - 1]).toBe("-");
    // No baseURL → no custom provider injection
    expect(args.join(" ")).not.toContain("model_provider=");

    const stdin = fs.readFileSync(stdinFile, "utf-8");
    expect(stdin).toContain("You are a poet.");
    expect(stdin).toContain("Write one line.");
  });

  it("injects a custom Responses-API provider and passes the key via env", async () => {
    const driver = new CodexCliDriver({
      cliPath: fakeCodex,
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-test-123",
    });
    await driver.generateText({ user: "hi", maxTokens: 10 });

    const args = readArgs();
    expect(args).toContain("model_provider=autovideo");
    expect(args).toContain("model_providers.autovideo.base_url=https://api.deepseek.com");
    expect(args).toContain("model_providers.autovideo.wire_api=responses");
    expect(args).toContain("model_providers.autovideo.env_key=AUTOVIDEO_CODEX_API_KEY");
    expect(args).toContain("preferred_auth_method=apikey");
    // Key travels via env, never on the command line
    expect(args.join(" ")).not.toContain("sk-test-123");
    expect(fs.readFileSync(keyFile, "utf-8").trim()).toBe("sk-test-123");
  });

  it("attaches review images with -i and mentions captions in the prompt", async () => {
    const driver = new CodexCliDriver({ cliPath: fakeCodex });
    const res = await driver.reviewImages({
      instructions: "Review these frames.",
      images: [
        { path: "/tmp/frame-0.png", caption: "t=1s" },
        { path: "/tmp/frame-1.png" },
      ],
      trailingText: "Intended: a title slide",
      maxTokens: 100,
    });

    expect(res.text).toBe("fake codex response");
    const args = readArgs();
    const iIndices = args.map((a, idx) => (a === "-i" ? idx : -1)).filter((i) => i >= 0);
    expect(iIndices).toHaveLength(2);
    expect(args[iIndices[0] + 1]).toBe("/tmp/frame-0.png");
    expect(args[iIndices[1] + 1]).toBe("/tmp/frame-1.png");

    const stdin = fs.readFileSync(stdinFile, "utf-8");
    expect(stdin).toContain("t=1s");
    expect(stdin).toContain("Intended: a title slide");
  });

  it("fails with stderr detail when codex produces no last message", async () => {
    process.env.CODEX_TEST_EMPTY = "1";
    try {
      const driver = new CodexCliDriver({ cliPath: fakeCodex });
      await expect(
        driver.generateText({ user: "hi", maxTokens: 10 }),
      ).rejects.toThrow(/codex CLI returned no output.*401/);
    } finally {
      delete process.env.CODEX_TEST_EMPTY;
    }
  });
});
