/**
 * AutoVideo — build command (Stage 6 / orchestrator)
 *
 * PRD §6.6 — One-command full pipeline: compile → tts → visuals → render
 *
 * Rules:
 *   - `--block` is NOT accepted (PRD §7: build does not accept --block;
 *     if present, error with hint to use step commands)
 *   - Sequential: compile → tts → visuals → render
 *   - Any stage failure → immediate exit with stderr passthrough
 *   - After compile produces script.json, cwd switches to build out dir (PRD §10)
 */

import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import type { Script } from "../types/script.js";
import { compile, type CompileOptions, type CompileResult } from "./compile.js";
import { tts, type TtsOptions, type TtsResult } from "./tts.js";
import { visuals, type VisualsOptions, type VisualsResult } from "./visuals.js";
import { render, type RenderOptions, type RenderResult } from "./render.js";
import { loadConfig } from "../config/load.js";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildError";
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Path to project.json */
  projectPath: string;
  /** Explicit output directory (from --out) */
  outDir?: string;
  /** Path to config file (from --config) */
  configPath?: string;
  /** --meta key=value overrides (raw strings) */
  metaArgs?: string[];
  /** Verbose logging */
  verbose?: boolean;
  /** Dry run mode */
  dryRun?: boolean;
}

export interface BuildResult {
  /** Final script after all stages */
  script: Script;
  /** Build output directory */
  outDir: string;
}

// ---------------------------------------------------------------------------
// Cwd helper (injectable for testing — vitest workers don't support chdir)
// ---------------------------------------------------------------------------

/**
 * Cwd helper object. Tests can replace the methods to avoid process.chdir
 * in vitest workers.
 */
export const cwdHelper = {
  change(dir: string): void {
    process.chdir(dir);
  },
  get(): string {
    return process.cwd();
  },
};

// ---------------------------------------------------------------------------
// build()
// ---------------------------------------------------------------------------

export async function build(options: BuildOptions): Promise<BuildResult> {
  const { projectPath, verbose = false, dryRun = false } = options;

  // Resolve project.json path
  const resolvedProject = resolve(cwdHelper.get(), projectPath);

  if (!existsSync(resolvedProject)) {
    throw new BuildError(`Project file not found: ${resolvedProject}`);
  }

  // Load configuration
  const { config } = loadConfig({
    configPath: options.configPath,
  });

  const stagePrefix = (stage: string) => `[build:${stage}]`;

  // ── Stage 1: compile ────────────────────────────────────────────────

  console.log(`${stagePrefix("compile")} Starting compile...`);
  const compileOpts: CompileOptions = {
    projectPath: resolvedProject,
    outDir: options.outDir,
    configPath: options.configPath,
    metaArgs: options.metaArgs,
    dryRun,
    verbose,
  };

  let compileResult: CompileResult;
  try {
    compileResult = await compile(compileOpts);
  } catch (err: any) {
    throw new BuildError(
      `Stage 'compile' failed: ${err.message || err}\n` +
      `Fix the issue and re-run: autovideo compile ${projectPath}`
    );
  }

  const { outDir, script: compiledScript } = compileResult;
  const scriptPath = join(outDir, "script.json");

  console.log(`${stagePrefix("compile")} Done → ${scriptPath}`);

  // ── Switch cwd to build out dir (PRD §10) ───────────────────────────
  cwdHelper.change(outDir);

  // ── Stage 2: tts ────────────────────────────────────────────────────

  console.log(`${stagePrefix("tts")} Starting tts...`);
  const ttsOpts: TtsOptions = {
    scriptPath,
    config,
    verbose,
    dryRun,
  };

  let ttsResult: TtsResult;
  try {
    ttsResult = await tts(ttsOpts);
  } catch (err: any) {
    throw new BuildError(
      `Stage 'tts' failed: ${err.message || err}\n` +
      `Fix the issue and re-run: autovideo tts ${scriptPath}`
    );
  }

  console.log(`${stagePrefix("tts")} Done (${ttsResult.cacheHits} cache hits, ${ttsResult.apiCalls} API calls)`);

  // ── Stage 3: visuals ────────────────────────────────────────────────

  console.log(`${stagePrefix("visuals")} Starting visuals...`);
  const visualsOpts: VisualsOptions = {
    scriptPath,
    config,
    verbose,
    dryRun,
  };

  let visualsResult: VisualsResult;
  try {
    visualsResult = await visuals(visualsOpts);
  } catch (err: any) {
    throw new BuildError(
      `Stage 'visuals' failed: ${err.message || err}\n` +
      `Fix the issue and re-run: autovideo visuals ${scriptPath}`
    );
  }

  console.log(`${stagePrefix("visuals")} Done (${visualsResult.cacheHits} cache hits, ${visualsResult.apiCalls} API calls)`);

  // ── Stage 4: render ─────────────────────────────────────────────────

  console.log(`${stagePrefix("render")} Starting render...`);
  const renderOpts: RenderOptions = {
    scriptPath,
    config,
    verbose,
    dryRun,
  };

  let renderResult: RenderResult;
  try {
    renderResult = await render(renderOpts);
  } catch (err: any) {
    throw new BuildError(
      `Stage 'render' failed: ${err.message || err}\n` +
      `Fix the issue and re-run: autovideo render ${scriptPath}`
    );
  }

  console.log(`${stagePrefix("render")} Done (${renderResult.cacheHits} cache hits, ${renderResult.renders} renders)`);

  console.log(`\n✓ Build complete: ${outDir}`);

  return {
    script: renderResult.script,
    outDir,
  };
}

// ---------------------------------------------------------------------------
// CLI command wrapper
// ---------------------------------------------------------------------------

export async function buildCommand(
  projectPath: string,
  opts: {
    out?: string;
    config?: string;
    cacheDir?: string;
    verbose?: boolean;
    dryRun?: boolean;
    meta?: string[];
  },
): Promise<void> {
  try {
    const result = await build({
      projectPath,
      outDir: opts.out,
      configPath: opts.config,
      verbose: opts.verbose,
      dryRun: opts.dryRun,
      metaArgs: opts.meta,
    });
    console.log(`\nBuild complete: ${result.outDir}`);
  } catch (err: any) {
    if (err instanceof BuildError) {
      console.error(`\n✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}