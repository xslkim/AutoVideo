/**
 * T1.1 Acceptance tests — meta.md parser
 *
 * Covers:
 * - Valid meta.md parsing
 * - Missing `--- meta ---` segment → error
 * - Missing closing `---` → error
 * - Missing required `title` field → error
 * - voiceRef defaults to ./B00.wav relative to meta.md directory
 * - voiceRef file not found → error (with helpful message for default)
 * - CLI override takes precedence over meta.md values
 * - aspect → width × height resolution
 * - Invalid aspect ratio → error
 * - Invalid fps → error
 * - Comments and blank lines in meta segment
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readMeta,
  readMetaWithDimensions,
  aspectToDimensions,
  extractMetaSegment,
  parseMetaKvLines,
  MetaError,
  type MetaOverrides,
} from "../../src/parser/meta.js";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

// We need a real WAV file for voiceRef validation; use the project's B00.wav
const FIXTURE_WAV = resolve(process.cwd(), "B00.wav");

describe("extractMetaSegment", () => {
  it("extracts content between --- meta --- delimiters", () => {
    const content = `--- meta ---
title: 200 行手撕 GPT
aspect: 16:9
---`;
    const segment = extractMetaSegment(content);
    expect(segment).toContain("title: 200 行手撕 GPT");
    expect(segment).toContain("aspect: 16:9");
  });

  it("throws when no --- meta --- found", () => {
    const content = `title: something\naspect: 16:9`;
    expect(() => extractMetaSegment(content)).toThrow(MetaError);
    expect(() => extractMetaSegment(content)).toThrow(
      /must contain a "--- meta ---" segment/,
    );
  });

  it("throws when no closing --- found", () => {
    const content = `--- meta ---\ntitle: Test\naspect: 16:9`;
    expect(() => extractMetaSegment(content)).toThrow(MetaError);
    expect(() => extractMetaSegment(content)).toThrow(/missing closing "---"/);
  });

  it("handles leading content before --- meta ---", () => {
    const content = `Some intro text
--- meta ---
title: Test
---`;
    const segment = extractMetaSegment(content);
    expect(segment.trim()).toBe("title: Test");
  });

  it("handles trailing content after closing ---", () => {
    const content = `--- meta ---
title: Test
---
Some trailing content`;
    const segment = extractMetaSegment(content);
    expect(segment.trim()).toBe("title: Test");
  });
});

describe("parseMetaKvLines", () => {
  it("parses key: value lines", () => {
    const map = parseMetaKvLines("title: My Video\nfps: 60");
    expect(map.get("title")).toBe("My Video");
    expect(map.get("fps")).toBe("60");
  });

  it("skips empty lines", () => {
    const map = parseMetaKvLines("title: Test\n\nfps: 30");
    expect(map.get("title")).toBe("Test");
    expect(map.get("fps")).toBe("30");
  });

  it("skips comment lines", () => {
    const map = parseMetaKvLines("title: Test\n# comment\nfps: 30");
    expect(map.size).toBe(2);
  });

  it("throws on line without colon", () => {
    expect(() => parseMetaKvLines("no colon here")).toThrow(MetaError);
    expect(() => parseMetaKvLines("no colon here")).toThrow(/missing ":"/);
  });

  it("handles values with colons", () => {
    const map = parseMetaKvLines("aspect: 16:9");
    expect(map.get("aspect")).toBe("16:9");
  });

  it("throws on empty key", () => {
    expect(() => parseMetaKvLines(": value")).toThrow(MetaError);
    expect(() => parseMetaKvLines(": value")).toThrow(/empty key/);
  });
});

describe("readMeta", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-meta-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    // Copy B00.wav fixture to tmpDir for tests that need voiceRef
    copyFileSync(FIXTURE_WAV, join(tmpDir, "B00.wav"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses valid meta.md with all fields", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: 200 行手撕 GPT
voiceRef: ./B00.wav
aspect: 16:9
theme: dark-code
fps: 30
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"));

    expect(meta.title).toBe("200 行手撕 GPT");
    expect(meta.aspect).toBe("16:9");
    expect(meta.theme).toBe("dark-code");
    expect(meta.fps).toBe(30);
    expect(meta.voiceRef).toBe(join(tmpDir, "B00.wav"));
  });

  it("parses minimal meta.md (title only, all else defaults)", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Minimal
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"));

    expect(meta.title).toBe("Minimal");
    expect(meta.aspect).toBe("16:9");
    expect(meta.theme).toBe("dark-code");
    expect(meta.fps).toBe(30);
    // voiceRef defaults to ./B00.wav relative to meta.md directory
    expect(meta.voiceRef).toBe(join(tmpDir, "B00.wav"));
  });

  // --- voiceRef default ---

  it("voiceRef defaults to ./B00.wav relative to meta.md directory", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"));
    expect(meta.voiceRef).toBe(join(tmpDir, "B00.wav"));
  });

  it("voiceRef resolves custom path relative to meta.md directory", () => {
    // Create subdirectory with voice file
    const voiceDir = join(tmpDir, "voice");
    mkdirSync(voiceDir, { recursive: true });
    copyFileSync(FIXTURE_WAV, join(voiceDir, "my-voice.wav"));

    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
voiceRef: ./voice/my-voice.wav
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"));
    expect(meta.voiceRef).toBe(join(tmpDir, "voice", "my-voice.wav"));
  });

  // --- voiceRef file not found ---

  it("throws on missing default voiceRef file with helpful message", () => {
    // Create a separate directory without B00.wav
    const noVoiceDir = join(tmpDir, "no-voice");
    mkdirSync(noVoiceDir, { recursive: true });

    writeFileSync(
      join(noVoiceDir, "meta.md"),
      `--- meta ---
title: No Voice
---`,
    );

    expect(() => readMeta(join(noVoiceDir, "meta.md"))).toThrow(MetaError);
    expect(() => readMeta(join(noVoiceDir, "meta.md"))).toThrow(
      /Default voice reference file not found/,
    );
  });

  it("throws on missing custom voiceRef file", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
voiceRef: ./nonexistent.wav
---`,
    );

    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(MetaError);
    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(
      /voiceRef file not found/,
    );
  });

  // --- Missing required fields ---

  it("throws on missing title", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
aspect: 16:9
---`,
    );

    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(MetaError);
    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(
      /missing required field "title"/,
    );
  });

  it("throws on empty title", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title:
---`,
    );

    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(MetaError);
    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(
      /missing required field "title"/,
    );
  });

  // --- Invalid values ---

  it("throws on invalid aspect ratio", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
aspect: 4:3
---`,
    );

    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(MetaError);
    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(
      /Invalid aspect "4:3"/,
    );
  });

  it("throws on invalid fps (zero)", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
fps: 0
---`,
    );

    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(MetaError);
    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(/Invalid fps/);
  });

  it("throws on invalid fps (negative)", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
fps: -10
---`,
    );

    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(MetaError);
    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(/Invalid fps/);
  });

  it("throws on invalid fps (string)", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
fps: abc
---`,
    );

    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(MetaError);
    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(/Invalid fps/);
  });

  // --- CLI override ---

  it("CLI override applies to title", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Original
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"), { title: "Override" });
    expect(meta.title).toBe("Override");
  });

  it("CLI override applies to aspect", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
aspect: 16:9
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"), { aspect: "9:16" });
    expect(meta.aspect).toBe("9:16");
  });

  it("CLI override applies to fps", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
fps: 30
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"), { fps: 60 });
    expect(meta.fps).toBe(60);
  });

  it("CLI override applies to voiceRef", () => {
    // Create alternative voice file
    copyFileSync(FIXTURE_WAV, join(tmpDir, "custom-voice.wav"));

    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"), {
      voiceRef: "./custom-voice.wav",
    });
    expect(meta.voiceRef).toBe(join(tmpDir, "custom-voice.wav"));
  });

  it("CLI override takes precedence over meta.md value", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Original
theme: light
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"), {
      title: "Overridden",
      theme: "dark-code",
    });
    expect(meta.title).toBe("Overridden");
    expect(meta.theme).toBe("dark-code");
  });

  it("CLI override can set slug", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"), { slug: "my-video" });
    expect(meta.slug).toBe("my-video");
  });

  // --- slug from meta.md ---

  it("reads slug from meta.md", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
slug: my-custom-slug
---`,
    );

    const meta = readMeta(join(tmpDir, "meta.md"));
    expect(meta.slug).toBe("my-custom-slug");
  });

  // --- Missing meta.md file ---

  it("throws on missing meta.md file", () => {
    expect(() => readMeta(join(tmpDir, "nonexistent.md"))).toThrow(MetaError);
    expect(() => readMeta(join(tmpDir, "nonexistent.md"))).toThrow(
      /Meta file not found/,
    );
  });

  // --- No meta segment ---

  it("throws when file has no --- meta --- segment", () => {
    writeFileSync(join(tmpDir, "meta.md"), "Just some random text");

    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(MetaError);
    expect(() => readMeta(join(tmpDir, "meta.md"))).toThrow(
      /must contain a "--- meta ---" segment/,
    );
  });
});

describe("aspectToDimensions", () => {
  it("16:9 → 1920×1080", () => {
    const { width, height } = aspectToDimensions("16:9");
    expect(width).toBe(1920);
    expect(height).toBe(1080);
  });

  it("9:16 → 1080×1920", () => {
    const { width, height } = aspectToDimensions("9:16");
    expect(width).toBe(1080);
    expect(height).toBe(1920);
  });

  it("1:1 → 1080×1080", () => {
    const { width, height } = aspectToDimensions("1:1");
    expect(width).toBe(1080);
    expect(height).toBe(1080);
  });
});

describe("readMetaWithDimensions", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-meta-dims-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    copyFileSync(FIXTURE_WAV, join(tmpDir, "B00.wav"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("computes width/height from aspect 16:9", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
aspect: 16:9
---`,
    );

    const meta = readMetaWithDimensions(join(tmpDir, "meta.md"));
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
  });

  it("computes width/height from aspect 9:16", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
aspect: 9:16
---`,
    );

    const meta = readMetaWithDimensions(join(tmpDir, "meta.md"));
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it("computes width/height from aspect 1:1", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
aspect: 1:1
---`,
    );

    const meta = readMetaWithDimensions(join(tmpDir, "meta.md"));
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
  });

  it("CLI override changes aspect and dimensions", () => {
    writeFileSync(
      join(tmpDir, "meta.md"),
      `--- meta ---
title: Test
aspect: 16:9
---`,
    );

    const meta = readMetaWithDimensions(join(tmpDir, "meta.md"), {
      aspect: "1:1",
    });
    expect(meta.aspect).toBe("1:1");
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
  });
});
