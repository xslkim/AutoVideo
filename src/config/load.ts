/**
 * AutoVideo — Configuration loader
 *
 * Merges configuration from (lowest → highest priority):
 *   1. Built-in defaults (DEFAULT_CONFIG)
 *   2. Project-root autovideo.config.json (optional)
 *   3. --config FILE (explicit config file)
 *   4. CLI flags: --cache-dir, --meta key=value
 *
 * Paths with ~ are expanded to os.homedir().
 * Relative paths are resolved relative to cwd.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_CONFIG, type AutoVideoConfig } from "./defaults.js";

// ---------------------------------------------------------------------------
// Top-level meta fields allowed by --meta (PRD §7 + §3.4)
// ---------------------------------------------------------------------------

const META_FIELDS = new Set([
  "title",
  "voiceRef",
  "aspect",
  "theme",
  "fps",
  "slug",
]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Expand ~ to homedir and resolve relative paths against cwd.
 */
function expandPath(p: string): string {
  const expanded = p.startsWith("~")
    ? p.replace(/^~/, homedir())
    : p;
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

/**
 * Recursively merge `source` into `target`.
 * - Arrays are replaced (not concatenated).
 * - null / undefined in source means "keep target value".
 * - Non-null primitives in source overwrite target.
 */
function deepMerge<T>(target: T, source: Record<string, unknown>): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (source[key] === undefined || source[key] === null) {
      // Keep target value
      continue;
    }
    if (
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      source[key] !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key]) &&
      result[key] !== null
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// --meta parser
// ---------------------------------------------------------------------------

export interface MetaOverrides {
  [key: string]: string | number | boolean;
}

/**
 * Parse --meta key=value pairs from CLI args.
 *
 * Rules (PRD §7):
 * - Only top-level meta fields are allowed (title, voiceRef, aspect, theme, fps, slug).
 * - Dot notation (dotted.key) is NOT allowed → throws error.
 * - Type inference: string / number / boolean auto-inferred.
 *   Cannot be inferred → treated as string.
 *
 * @param args - Array of "--meta key=value" strings from CLI
 * @returns Parsed key-value map with inferred types
 * @throws Error if dot notation is used or field is not a recognized meta field
 */
export function parseMetaArgs(args: string[]): MetaOverrides {
  const result: MetaOverrides = {};

  for (const arg of args) {
    // arg is expected to be "key=value"
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid --meta format: "${arg}". Expected key=value`);
    }
    const key = arg.substring(0, eqIndex);
    const rawValue = arg.substring(eqIndex + 1);

    // Reject dot notation (PRD §7: only top-level meta fields)
    if (key.includes(".")) {
      throw new Error(
        `Invalid --meta key "${key}": dot notation is not supported. ` +
          `Only top-level meta fields are allowed: ${[...META_FIELDS].join(", ")}`,
      );
    }

    // Check field is a recognized meta field
    if (!META_FIELDS.has(key)) {
      throw new Error(
        `Unknown --meta field "${key}". ` +
          `Allowed fields: ${[...META_FIELDS].join(", ")}`,
      );
    }

    // Type inference
    result[key] = inferType(rawValue);
  }

  return result;
}

/**
 * Infer the type of a raw CLI value string.
 */
function inferType(rawValue: string): string | number | boolean {
  // Boolean
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;

  // Number (integer or float)
  if (/^-?\d+$/.test(rawValue)) return parseInt(rawValue, 10);
  if (/^-?\d+\.\d+$/.test(rawValue)) return parseFloat(rawValue);

  // String fallback
  return rawValue;
}

// ---------------------------------------------------------------------------
// Read config file
// ---------------------------------------------------------------------------

function readConfigFile(filePath: string): Record<string, unknown> | null {
  const resolved = expandPath(filePath);
  if (!existsSync(resolved)) {
    return null;
  }
  try {
    const raw = readFileSync(resolved, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config file "${resolved}": ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Expand all path-like values in config
// ---------------------------------------------------------------------------

/**
 * Expand ~ in known path fields within the config.
 */
function expandConfigPaths(config: AutoVideoConfig): AutoVideoConfig {
  const result = structuredClone(config);

  // cache.dir supports ~
  if (typeof result.cache.dir === "string") {
    result.cache.dir = expandPath(result.cache.dir);
  }

  // voxcpm.modelDir supports ~
  if (typeof result.voxcpm.modelDir === "string") {
    result.voxcpm.modelDir = expandPath(result.voxcpm.modelDir);
  }

  // cosyvoice.modelDir supports ~
  if (typeof result.cosyvoice.modelDir === "string") {
    result.cosyvoice.modelDir = expandPath(result.cosyvoice.modelDir);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

export interface LoadConfigOptions {
  /**
   * Path to explicit config file (from --config FILE).
   * Highest file-based priority.
   */
  configPath?: string;

  /**
   * Override cache directory (from --cache-dir).
   * Highest priority for cache.dir.
   */
  cacheDir?: string;

  /**
   * --meta key=value pairs (raw strings, unparsed).
   * These are for meta field overrides, NOT part of AutoVideoConfig.
   * They are parsed and returned separately via `metaOverrides`.
   */
  metaArgs?: string[];

  /**
   * Project root directory to look for autovideo.config.json.
   * Defaults to cwd.
   */
  projectRoot?: string;
}

export interface LoadConfigResult {
  /** Fully merged and path-expanded configuration */
  config: AutoVideoConfig;
  /** Parsed --meta overrides (for compile stage to apply to meta.md fields) */
  metaOverrides: MetaOverrides;
}

/**
 * Load and merge configuration from all sources.
 *
 * Priority (high → low):
 *   CLI flags (--cache-dir) > --config FILE > project-root autovideo.config.json > defaults
 *
 * --meta args are parsed separately and returned as `metaOverrides`
 * (they override meta.md fields, not autovideo.config.json fields).
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadConfigResult {
  const { configPath, cacheDir, metaArgs, projectRoot } = options;

  // 1. Start with defaults
  let config: AutoVideoConfig = structuredClone(DEFAULT_CONFIG);

  // 2. Merge project-root autovideo.config.json (if exists)
  const root = projectRoot ?? process.cwd();
  const rootConfigFile = resolve(root, "autovideo.config.json");
  const rootConfig = readConfigFile(rootConfigFile);
  if (rootConfig) {
    config = deepMerge(config, rootConfig);
  }

  // 3. Merge --config FILE (higher priority than root config)
  if (configPath) {
    const explicitConfig = readConfigFile(configPath);
    if (explicitConfig) {
      config = deepMerge(config, explicitConfig);
    } else {
      throw new Error(`Config file not found: ${expandPath(configPath)}`);
    }
  }

  // 4. Apply --cache-dir override (highest priority for cache.dir)
  if (cacheDir) {
    config.cache.dir = expandPath(cacheDir);
  }

  // 5. Expand all paths (~ → homedir, relative → absolute)
  config = expandConfigPaths(config);

  // 6. Parse --meta args (separate from config; returned as overrides)
  const metaOverrides = metaArgs ? parseMetaArgs(metaArgs) : {};

  return { config, metaOverrides };
}

/**
 * Get the default configuration (with paths expanded).
 * Convenience function for cases that need defaults without any file/CLI overrides.
 */
export function getDefaultConfig(): AutoVideoConfig {
  return expandConfigPaths(structuredClone(DEFAULT_CONFIG));
}
