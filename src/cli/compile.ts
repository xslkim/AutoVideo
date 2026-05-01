/**
 * AutoVideo — compile command
 *
 * Assembles the full compile pipeline:
 *   project → meta → blocks → narration → assets → script.json
 *
 * PRD references: §6.1 (Stage 1 — compile), §7 (--out, --meta, --config)
 */

import {
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import Ajv from "ajv";
import schema from "../../schemas/script.schema.json" with { type: "json" };

import { readProject, type ResolvedProject } from "../parser/project.js";
import { readMetaWithDimensions, type ResolvedMeta } from "../parser/meta.js";
import { parseAndMergeBlocks, type RawBlock } from "../parser/blocks.js";
import { processAssets, type AssetProcessResult } from "../parser/assets.js";
import { resolveOutDir, slugify } from "../utils/slugify.js";
import { loadConfig, type MetaOverrides } from "../config/load.js";

import type {
  Script,
  Block,
  CompiledScript,
} from "../types/script.js";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}

// ---------------------------------------------------------------------------
// Compile options
// ---------------------------------------------------------------------------

export interface CompileOptions {
  /** Path to project.json */
  projectPath: string;
  /** Explicit output directory (from --out) */
  outDir?: string;
  /** Path to config file (from --config) */
  configPath?: string;
  /** --meta key=value overrides (raw strings) */
  metaArgs?: string[];
  /** Dry run mode — show what would happen without executing */
  dryRun?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Compile result
// ---------------------------------------------------------------------------

export interface CompileResult {
  /** Absolute path to the output directory */
  outDir: string;
  /** Absolute path to the generated script.json */
  scriptPath: string;
  /** The compiled script object */
  script: CompiledScript;
}

// ---------------------------------------------------------------------------
// JSON Schema validation
// ---------------------------------------------------------------------------

const ajv = new Ajv({ strict: false });
const validate = ajv.compile(schema);

// ---------------------------------------------------------------------------
// Main compile function
// ---------------------------------------------------------------------------

/**
 * Run the compile pipeline: project → meta → blocks → narration → assets → script.json
 *
 * Steps per PRD §6.1:
 * 1. Read project.json, resolve paths
 * 2. Parse meta.md with CLI overrides
 * 3. Read and merge content .md files
 * 4. Parse directives, visual/narration sections, narration lines
 * 5. Compute subtitleSafeBottom
 * 6. Process assets (hash, copy, path replacement)
 * 7. Validate with JSON Schema
 * 8. Write script.json + public/script.json
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  const { projectPath, outDir: explicitOut, configPath, metaArgs, dryRun, verbose } = options;

  // Load config (for meta overrides parsing)
  const { metaOverrides } = loadConfig({
    configPath,
    metaArgs,
    projectRoot: dirname(resolve(projectPath)),
  });

  const log = verbose ? (msg: string) => console.error(`[compile] ${msg}`) : () => {};

  // Step 1: Read project.json
  log(`Reading project: ${projectPath}`);
  const project = readProject(projectPath);

  // Step 2: Parse meta.md with CLI overrides
  log(`Reading meta: ${project.metaPath}`);
  const meta = readMetaWithDimensions(project.metaPath, metaOverrides);

  // Compute subtitleSafeBottom = floor(height * 0.15) per PRD §6.1 step 7
  const subtitleSafeBottom = Math.floor(meta.height * 0.15);

  // Resolve output directory
  const outDir = resolveOutDir(explicitOut, meta.title, meta.slug);
  const absOutDir = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);

  log(`Output directory: ${absOutDir}`);

  if (dryRun) {
    console.log("Would compile:");
    console.log(`  Project: ${project.projectPath}`);
    console.log(`  Meta: ${project.metaPath}`);
    console.log(`  Blocks: ${project.blockPaths.length} file(s)`);
    console.log(`  Title: ${meta.title}`);
    console.log(`  Aspect: ${meta.aspect} (${meta.width}×${meta.height})`);
    console.log(`  FPS: ${meta.fps}`);
    console.log(`  Theme: ${meta.theme}`);
    console.log(`  subtitleSafeBottom: ${subtitleSafeBottom}`);
    console.log(`  Output: ${absOutDir}`);
    return {
      outDir: absOutDir,
      scriptPath: resolve(absOutDir, "script.json"),
      script: {} as CompiledScript, // No actual compilation in dry-run
    };
  }

  // Step 3-4: Parse and merge blocks from content files
  log(`Parsing ${project.blockPaths.length} block file(s)`);
  const rawBlocks = parseAndMergeBlocks(project.blockPaths);

  log(`Found ${rawBlocks.length} block(s): ${rawBlocks.map((b) => b.id).join(", ")}`);

  // Step 6: Process assets
  log("Processing assets");
  const assetResult = processAssets(
    rawBlocks.map((b) => ({
      id: b.id,
      visualDescription: b.visualDescription,
      sourceFilePath: b.sourceFilePath,
    })),
    project.projectDir,
    absOutDir,
  );

  // Build the updated visual descriptions map
  const updatedDescriptions = new Map<string, string>();
  for (const b of assetResult.blocks) {
    updatedDescriptions.set(b.id, b.visualDescription);
  }

  // Step 5: Assemble Script object
  const blocks: Block[] = rawBlocks.map((raw) => ({
    id: raw.id,
    title: raw.title,
    enter: raw.enter,
    exit: raw.exit,
    visual: {
      description: updatedDescriptions.get(raw.id) ?? raw.visualDescription,
    },
    narration: {
      lines: raw.narrationLines,
      ...(raw.explicitDurationSec !== undefined
        ? { explicitDurationSec: raw.explicitDurationSec }
        : {}),
    },
  }));

  const compiledAt = new Date().toISOString();

  const script: CompiledScript = {
    meta: {
      schemaVersion: "1.0",
      title: meta.title,
      voiceRef: meta.voiceRef,
      aspect: meta.aspect,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      theme: meta.theme,
      subtitleSafeBottom,
    },
    blocks,
    assets: assetResult.assets,
    artifacts: {
      compiledAt,
    },
  } as CompiledScript;

  // Step 7: JSON Schema validation
  const valid = validate(script);
  if (!valid) {
    const errors = validate.errors?.map((e) => `${e.instancePath} ${e.message}`).join("; ");
    throw new CompileError(
      `Compiled script.json failed schema validation: ${errors}`,
    );
  }

  // Step 8: Write output files
  // Ensure output directory exists
  mkdirSync(absOutDir, { recursive: true });
  mkdirSync(resolve(absOutDir, "public"), { recursive: true });

  const scriptJson = JSON.stringify(script, null, 2);
  const scriptPath = resolve(absOutDir, "script.json");
  const publicScriptPath = resolve(absOutDir, "public", "script.json");

  writeFileSync(scriptPath, scriptJson, "utf-8");
  writeFileSync(publicScriptPath, scriptJson, "utf-8");

  log(`Wrote ${scriptPath}`);
  log(`Wrote ${publicScriptPath}`);
  log(`Compilation complete: ${blocks.length} block(s)`);

  return {
    outDir: absOutDir,
    scriptPath,
    script,
  };
}