import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { preview, PreviewError } from "../../src/cli/preview.js";
import type { Script } from "../../src/types/script.js";

/**
 * Minimal script fixture for preview CLI tests.
 */
function makeTestScript(overrides?: Partial<Script>): Script {
  return {
    meta: {
      schemaVersion: "1.0",
      title: "Test Video",
      voiceRef: "/tmp/B00.wav",
      aspect: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      theme: "dark-code",
      subtitleSafeBottom: 162,
    },
    blocks: [
      {
        id: "B01",
        title: "Intro",
        enter: "fade",
        exit: "fade",
        visual: {
          description: "Title screen",
          componentPath: "src/blocks/B01/Component.tsx",
        },
        narration: {
          lines: [
            {
              text: "Hello world",
              ttsText: "Hello world",
              highlights: [],
            },
          ],
          explicitDurationSec: 5,
        },
      },
      {
        id: "B02",
        title: "Part 1",
        enter: "fade-up",
        exit: "fade",
        visual: {
          description: "Code display",
        },
        narration: {
          lines: [
            {
              text: "This is **important**",
              ttsText: "This is important",
              highlights: [{ start: 8, end: 17 }],
            },
          ],
          explicitDurationSec: 8,
        },
      },
    ],
    artifacts: {},
    assets: {},
    ...overrides,
  };
}

describe("preview CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autovideo-preview-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeScript(script: Script): string {
    const scriptPath = path.join(tmpDir, "script.json");
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), "utf-8");

    // Create public dir and minimal files expected by Remotion
    const publicDir = path.join(tmpDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });

    return scriptPath;
  }

  it("should throw PreviewError for missing script.json", async () => {
    await expect(
      preview({ scriptPath: "/nonexistent/script.json" }),
    ).rejects.toThrow(PreviewError);
  });

  it("should throw PreviewError for script with no blocks", async () => {
    const scriptPath = writeScript(makeTestScript({ blocks: [] }));
    await expect(
      preview({ scriptPath }),
    ).rejects.toThrow("no blocks");
  });

  it("should throw PreviewError for script missing meta", async () => {
    const scriptPath = writeScript({} as any);
    await expect(
      preview({ scriptPath }),
    ).rejects.toThrow("missing meta");
  });

  it("should throw PreviewError for invalid block ID", async () => {
    const scriptPath = writeScript(makeTestScript());
    await expect(
      preview({ scriptPath, blockIds: ["B99"] }),
    ).rejects.toThrow("Block not found: B99");
  });

  it("should generate remotion-root-preview.tsx in build dir", async () => {
    const scriptPath = writeScript(makeTestScript());
    const previewRootPath = path.join(tmpDir, "remotion-root-preview.tsx");

    // We can't actually start Studio in tests (it requires a browser),
    // but we can test the file generation by verifying the preview root exists
    // after calling preview (it will fail at spawn stage, which is fine).
    // Instead, test the generation directly:

    // Test via the internal function by checking file existence after a failed spawn
    try {
      await preview({ scriptPath, port: 19999 });
    } catch (err: any) {
      // The spawn will fail in test env, but files should be generated
      // It's OK if this throws - we check file generation below
    }

    // Check that the preview root was generated
    expect(fs.existsSync(previewRootPath)).toBe(true);

    // Check content has both compositions
    const content = fs.readFileSync(previewRootPath, "utf-8");
    expect(content).toContain('id="B01"');
    expect(content).toContain('id="B02"');
    expect(content).toContain("registerRoot");
    expect(content).toContain("BlockComposition");
  });

  it("should copy Remotion engine files into build dir", async () => {
    const scriptPath = writeScript(makeTestScript());

    try {
      await preview({ scriptPath, port: 19998 });
    } catch {
      // Spawn will fail, but files should be copied
    }

    // Check that Remotion files were copied
    expect(fs.existsSync(path.join(tmpDir, "remotion", "VideoComposition.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "remotion", "engine", "block-frame.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "remotion", "engine", "theme.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "remotion", "components", "SubtitleOverlay.tsx"))).toBe(true);
  });

  it("should update public/script.json", async () => {
    const script = makeTestScript();
    const scriptPath = writeScript(script);

    try {
      await preview({ scriptPath, port: 19997 });
    } catch {
      // Spawn will fail
    }

    const publicScriptPath = path.join(tmpDir, "public", "script.json");
    expect(fs.existsSync(publicScriptPath)).toBe(true);
    const publicScript = JSON.parse(fs.readFileSync(publicScriptPath, "utf-8"));
    expect(publicScript.meta.title).toBe("Test Video");
    expect(publicScript.blocks).toHaveLength(2);
  });

  it("should generate preview root with local import paths", async () => {
    const scriptPath = writeScript(makeTestScript());

    try {
      await preview({ scriptPath, port: 19996 });
    } catch {
      // Spawn will fail
    }

    const previewRootPath = path.join(tmpDir, "remotion-root-preview.tsx");
    const content = fs.readFileSync(previewRootPath, "utf-8");

    // Should use local import path (relative to build dir)
    expect(content).toContain("from './remotion/VideoComposition'");
    // Should NOT use the repo-root relative path
    expect(content).not.toContain("../../remotion/VideoComposition");
  });
});