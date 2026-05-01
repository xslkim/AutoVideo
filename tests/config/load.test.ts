/**
 * T0.3 Acceptance tests — Configuration loader
 *
 * Covers:
 * - --meta dotted.key=val → error
 * - --meta title=foo → type inference (string)
 * - --meta fps=60 → type inference (number)
 * - --meta auto-infer boolean
 * - Config merge priority: CLI > --config file > project-root config > defaults
 * - Path expansion: ~ → homedir
 * - --cache-dir override
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadConfig,
  parseMetaArgs,
  getDefaultConfig,
  type MetaOverrides,
} from "../../src/config/load.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir, tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// --meta parsing
// ---------------------------------------------------------------------------

describe("parseMetaArgs", () => {
  it("--meta title=foo → string type inference", () => {
    const result = parseMetaArgs(["title=foo"]);
    expect(result.title).toBe("foo");
    expect(typeof result.title).toBe("string");
  });

  it("--meta fps=60 → number type inference", () => {
    const result = parseMetaArgs(["fps=60"]);
    expect(result.fps).toBe(60);
    expect(typeof result.fps).toBe("number");
  });

  it("--meta fps=29.97 → float type inference", () => {
    const result = parseMetaArgs(["fps=29.97"]);
    expect(result.fps).toBeCloseTo(29.97);
    expect(typeof result.fps).toBe("number");
  });

  it("--meta auto-infers boolean true/false", () => {
    const result = parseMetaArgs(["theme=dark-code"]);
    // theme is just a string, not boolean — but test with hypothetical
    // Actually test with known meta field and value "true"
    const boolResult = parseMetaArgs(["title=true"]);
    expect(boolResult.title).toBe(true);
    expect(typeof boolResult.title).toBe("boolean");

    const boolResult2 = parseMetaArgs(["title=false"]);
    expect(boolResult2.title).toBe(false);
    expect(typeof boolResult2.title).toBe("boolean");
  });

  it("--meta value that cannot be inferred stays string", () => {
    const result = parseMetaArgs(["title=hello world"]);
    expect(result.title).toBe("hello world");
    expect(typeof result.title).toBe("string");
  });

  it("--meta dotted.key=val → error", () => {
    expect(() => parseMetaArgs(["render.blockConcurrency=8"])).toThrow(
      /dot notation is not supported/,
    );
  });

  it("--meta with nested dot like voxcpm.endpoint → error", () => {
    expect(() => parseMetaArgs(["voxcpm.endpoint=http://localhost:9000"])).toThrow(
      /dot notation is not supported/,
    );
  });

  it("--meta unknown field → error", () => {
    expect(() => parseMetaArgs(["unknownField=value"])).toThrow(
      /Unknown --meta field/,
    );
  });

  it("multiple --meta args all parsed", () => {
    const result = parseMetaArgs(["title=My Video", "fps=30", "aspect=16:9"]);
    expect(result.title).toBe("My Video");
    expect(result.fps).toBe(30);
    expect(result.aspect).toBe("16:9");
  });

  it("missing = sign → error", () => {
    expect(() => parseMetaArgs(["title"])).toThrow(/Invalid --meta format/);
  });

  it("--meta with negative number", () => {
    // Not a typical meta field value but tests type inference
    const result = parseMetaArgs(["title=-5"]);
    expect(result.title).toBe(-5);
    expect(typeof result.title).toBe("number");
  });

  it("--meta slug field is allowed", () => {
    const result = parseMetaArgs(["slug=my-video"]);
    expect(result.slug).toBe("my-video");
  });

  it("empty value is valid string", () => {
    const result = parseMetaArgs(["title="]);
    expect(result.title).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Config merge priority
// ---------------------------------------------------------------------------

describe("loadConfig — merge priority", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-config-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config files or CLI flags", () => {
    const { config } = loadConfig({ projectRoot: tmpDir });
    // Should match defaults (with paths expanded)
    expect(config.voxcpm.cfgValue).toBe(DEFAULT_CONFIG.voxcpm.cfgValue);
    expect(config.voxcpm.concurrency).toBe(DEFAULT_CONFIG.voxcpm.concurrency);
    expect(config.anthropic.model).toBe(DEFAULT_CONFIG.anthropic.model);
    expect(config.render.blockConcurrency).toBe(DEFAULT_CONFIG.render.blockConcurrency);
    expect(config.render.loudnorm.i).toBe(DEFAULT_CONFIG.render.loudnorm.i);
    expect(config.cache.maxSizeGB).toBe(DEFAULT_CONFIG.cache.maxSizeGB);
  });

  it("project-root autovideo.config.json overrides defaults", () => {
    // Write a project-root config
    const rootConfig = {
      voxcpm: { cfgValue: 3.0, concurrency: 8 },
      render: { blockConcurrency: 2 },
    };
    writeFileSync(
      join(tmpDir, "autovideo.config.json"),
      JSON.stringify(rootConfig),
    );

    const { config } = loadConfig({ projectRoot: tmpDir });
    expect(config.voxcpm.cfgValue).toBe(3.0);
    expect(config.voxcpm.concurrency).toBe(8);
    // Other voxcpm fields should keep defaults
    expect(config.voxcpm.endpoint).toBe(DEFAULT_CONFIG.voxcpm.endpoint);
    expect(config.voxcpm.inferenceTimesteps).toBe(DEFAULT_CONFIG.voxcpm.inferenceTimesteps);
    // render override
    expect(config.render.blockConcurrency).toBe(2);
    // Other render fields keep defaults
    expect(config.render.minHoldSec).toBe(DEFAULT_CONFIG.render.minHoldSec);
  });

  it("--config FILE overrides project-root config", () => {
    // Project-root config
    writeFileSync(
      join(tmpDir, "autovideo.config.json"),
      JSON.stringify({ voxcpm: { cfgValue: 3.0 } }),
    );

    // Explicit config file
    const explicitConfigPath = join(tmpDir, "custom.config.json");
    writeFileSync(
      explicitConfigPath,
      JSON.stringify({ voxcpm: { cfgValue: 5.0 } }),
    );

    const { config } = loadConfig({
      projectRoot: tmpDir,
      configPath: explicitConfigPath,
    });
    // --config should win over project-root
    expect(config.voxcpm.cfgValue).toBe(5.0);
  });

  it("--cache-dir overrides all other cache.dir settings", () => {
    // Project-root config sets cache.dir
    writeFileSync(
      join(tmpDir, "autovideo.config.json"),
      JSON.stringify({ cache: { dir: "/some/other/path" } }),
    );

    const { config } = loadConfig({
      projectRoot: tmpDir,
      cacheDir: "/my/custom/cache",
    });
    expect(config.cache.dir).toBe("/my/custom/cache");
  });

  it("deep merge preserves nested fields not overridden", () => {
    writeFileSync(
      join(tmpDir, "autovideo.config.json"),
      JSON.stringify({ render: { loudnorm: { i: -20 } } }),
    );

    const { config } = loadConfig({ projectRoot: tmpDir });
    // Overridden
    expect(config.render.loudnorm.i).toBe(-20);
    // Preserved from defaults
    expect(config.render.loudnorm.tp).toBe(DEFAULT_CONFIG.render.loudnorm.tp);
    expect(config.render.loudnorm.lra).toBe(DEFAULT_CONFIG.render.loudnorm.lra);
    expect(config.render.loudnorm.audioBitrate).toBe(DEFAULT_CONFIG.render.loudnorm.audioBitrate);
    // Other render fields preserved
    expect(config.render.blockConcurrency).toBe(DEFAULT_CONFIG.render.blockConcurrency);
  });
});

// ---------------------------------------------------------------------------
// Path expansion
// ---------------------------------------------------------------------------

describe("loadConfig — path expansion", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-path-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("~ in cache.dir is expanded to homedir", () => {
    // Defaults have ~ in cache.dir; loadConfig expands it
    const { config } = loadConfig({ projectRoot: tmpDir });
    expect(config.cache.dir).not.toContain("~");
    expect(config.cache.dir.startsWith("/")).toBe(true);
  });

  it("~ in voxcpm.modelDir is expanded to homedir", () => {
    const { config } = loadConfig({ projectRoot: tmpDir });
    expect(config.voxcpm.modelDir).not.toContain("~");
    expect(config.voxcpm.modelDir.startsWith("/")).toBe(true);
  });

  it("relative --cache-dir is resolved relative to cwd", () => {
    const { config } = loadConfig({ cacheDir: "./my-cache", projectRoot: tmpDir });
    expect(isAbsolute(config.cache.dir)).toBe(true);
    expect(config.cache.dir.endsWith("my-cache")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Meta overrides returned separately
// ---------------------------------------------------------------------------

describe("loadConfig — meta overrides", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-meta-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("no --meta args → empty metaOverrides", () => {
    const { metaOverrides } = loadConfig({ projectRoot: tmpDir });
    expect(Object.keys(metaOverrides)).toHaveLength(0);
  });

  it("--meta args are parsed and returned", () => {
    const { metaOverrides } = loadConfig({
      projectRoot: tmpDir,
      metaArgs: ["title=Test Video", "fps=60"],
    });
    expect(metaOverrides.title).toBe("Test Video");
    expect(metaOverrides.fps).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// getDefaultConfig
// ---------------------------------------------------------------------------

describe("getDefaultConfig", () => {
  it("returns defaults with expanded paths", () => {
    const config = getDefaultConfig();
    expect(config.cache.dir).not.toContain("~");
    expect(config.voxcpm.modelDir).not.toContain("~");
    expect(config.anthropic.model).toBe("claude-sonnet-4-6");
    expect(config.render.loudnorm.i).toBe(-16);
  });

  it("returns a fresh copy (mutation safe)", () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    a.cache.maxSizeGB = 999;
    expect(b.cache.maxSizeGB).toBe(DEFAULT_CONFIG.cache.maxSizeGB);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("loadConfig — error cases", () => {
  it("--config FILE that does not exist → throws", () => {
    expect(() =>
      loadConfig({ configPath: "/nonexistent/path/config.json" }),
    ).toThrow(/Config file not found/);
  });

  it("invalid JSON in project-root config → throws", () => {
    const tmpDir = resolve(tmpdir(), `autovideo-test-err-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "autovideo.config.json"),
      "this is not json {{{",
    );
    expect(() => loadConfig({ projectRoot: tmpDir })).toThrow(/Failed to read config file/);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Priority full integration test
// ---------------------------------------------------------------------------

describe("loadConfig — full priority integration", () => {
  const tmpDir = resolve(tmpdir(), `autovideo-test-prio-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("priority: --cache-dir > --config > root config > defaults", () => {
    // Root config
    writeFileSync(
      join(tmpDir, "autovideo.config.json"),
      JSON.stringify({
        cache: { dir: "/from-root-config", maxSizeGB: 50 },
        voxcpm: { concurrency: 6 },
      }),
    );

    // --config file
    const explicitConfigPath = join(tmpDir, "explicit.config.json");
    writeFileSync(
      explicitConfigPath,
      JSON.stringify({
        cache: { dir: "/from-explicit-config" },
        voxcpm: { concurrency: 12 },
      }),
    );

    const { config } = loadConfig({
      projectRoot: tmpDir,
      configPath: explicitConfigPath,
      cacheDir: "/from-cli-cache-dir",
    });

    // --cache-dir wins
    expect(config.cache.dir).toBe("/from-cli-cache-dir");
    // maxSizeGB from explicit config (root config set 50, explicit didn't set → stays 50 via root)
    // Actually root config merged first (50), then explicit merged (no maxSizeGB → kept 50)
    expect(config.cache.maxSizeGB).toBe(50);
    // voxcpm.concurrency: explicit config wins over root config
    expect(config.voxcpm.concurrency).toBe(12);
  });
});

/**
 * Helper to check if a path is absolute (cross-platform).
 */
function isAbsolute(p: string): boolean {
  return p.startsWith("/");
}
