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
  readFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import Ajv from "ajv";

import { readProject, type ResolvedProject } from "../parser/project.js";
import { readMetaWithDimensions, type ResolvedMeta } from "../parser/meta.js";
import { parseAndMergeBlocks, type RawBlock } from "../parser/blocks.js";
import {
  processAssets,
  type BlockForAssets,
  type AssetProcessResult,
} from "../parser/assets.js";
import { resolveOutDir } from "../utils/slugify.js";

import type {
  Script,
  Block,
  AnimationPreset,
  AspectRatio,
} from "../types/script.js";

// ---------------------------------------------------------------------------
// JSON Schema loading
// ---------------------------------------------------------------------------

let _schema: object | undefined;

function loadSchema(): object {
  if (!_schema) {
    const schemaPath = resolve(
      new URL(".", import.meta.url).pathname,
      "../../schemas/script.schema.json"
    );
    _schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  }
  return _schema!;
}

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
  script: Script;
  outDir: string;
}

// ---------------------------------------------------------------------------
// Main compile pipeline
// ---------------------------------------------------------------------------

/**
 * Run the compile pipeline:
 *   1. Read project.json → resolve paths
 *   2. Parse meta.md → meta fields + dimensions + voiceRef validation
 *   3. Parse & merge all block files → RawBlock[]
 *   4. Process assets (hash, copy, rewrite paths)
 *   5. Assemble Script object with computed subtitleSafeBottom
 *   6. Validate against JSON Schema (Ajv)
 *   7. Write script.json + public/script.json + asset files
 *
 * @returns The compiled Script and the output directory path
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  const {
    projectPath,
    outDir: outFlag,
    configPath,
    metaArgs,
    dryRun,
    verbose,
  } = options;

  // ── Step 1: Read project.json ──────────────────────────────────────────
  if (verbose) console.log("[compile] Reading project:", projectPath);
  const project: ResolvedProject = readProject(projectPath);

  // ── Step 2: Parse meta.md (with --meta overrides) ──────────────────────
  if (verbose) console.log("[compile] Parsing meta:", project.metaPath);
  const meta: ResolvedMeta = readMetaWithDimensions(project.metaPath, metaArgs);

  // Validate voiceRef exists
  if (!existsSync(meta.voiceRef)) {
    throw new CompileError(
      `voiceRef file not found: ${meta.voiceRef}\n` +
        `Please provide a 10-30s clear voice WAV file at this path.`
    );
  }

  // ── Step 3: Parse & merge blocks ───────────────────────────────────────
  if (verbose)
    console.log(
      "[compile] Parsing blocks from",
      project.blockPaths.length,
      "files"
    );
  const rawBlocks: RawBlock[] = parseAndMergeBlocks(project.blockPaths);

  // ── Step 4: Determine output directory ─────────────────────────────────
  const outDir = resolveOutDir(meta.title, outFlag, meta.slug);
  if (verbose) console.log("[compile] Output directory:", outDir);

  // ── Step 5: Process assets ─────────────────────────────────────────────
  // Build BlockForAssets[] from RawBlock[]
  const blocksForAssets: BlockForAssets[] = rawBlocks.map((b) => ({
    id: b.id,
    visualDescription: b.visualDescription,
    sourceFilePath: b.sourceFilePath,
  }));

  if (verbose)
    console.log(
      "[compile] Processing assets for",
      blocksForAssets.length,
      "blocks"
    );
  const assetResult: AssetProcessResult = processAssets(
    blocksForAssets,
    project.projectDir,
    outDir
  );

  // ── Step 6: Compute subtitleSafeBottom ─────────────────────────────────
  const subtitleSafeBottom = Math.floor(meta.height * 0.15);

  // ── Step 7: Assemble Script ────────────────────────────────────────────
  // Merge processed visual descriptions back into blocks
  const scriptBlocks: Block[] = rawBlocks.map((raw, idx) => {
    // Find the matching processed block (same index)
    const processedBlock = assetResult.blocks[idx];

    return {
      id: raw.id,
      title: raw.title,
      enter: raw.enter,
      exit: raw.exit,
      visual: {
        description: processedBlock
          ? processedBlock.visualDescription
          : raw.visualDescription,
      },
      narration: {
        lines: raw.narrationLines,
        ...(raw.explicitDurationSec !== undefined && {
          explicitDurationSec: raw.explicitDurationSec,
        }),
      },
    };
  });

  const script: Script = {
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
    blocks: scriptBlocks,
    artifacts: {
      compiledAt: new Date().toISOString(),
    },
    assets: assetResult.assets,
  };

  // ── Step 8: Validate with JSON Schema (Ajv) ────────────────────────────
  if (verbose) console.log("[compile] Validating script against JSON schema");
  const schemaObj = loadSchema();
  const ajv = new Ajv({ allErrors: true, formats: true });
  // Add date-time format support
  ajv.addFormat("date-time", {
    type: "string",
    validate: (data: string) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
        data
      ),
  });
  const validate = ajv.compile(schemaObj);
  const valid = validate(script);
  if (!valid) {
    const errors = validate
      .errors!.map((e: { instancePath: string; message?: string }) => {
        const path = e.instancePath || "/";
        const msg = e.message || "unknown error";
        return `  ${path} ${msg}`;
      })
      .join("\n");
    throw new CompileError(`Script schema validation failed:\n${errors}`);
  }

  // ── Step 9: Write output ───────────────────────────────────────────────
  if (dryRun) {
    console.log(
      `Would compile:\n  Project: ${project.projectPath}\n  Meta: ${project.metaPath}\n  Blocks: ${project.blockPaths.length} file(s)\n  Title: ${meta.title}\n  Aspect: ${meta.aspect} (${meta.width}×${meta.height})\n  FPS: ${meta.fps}\n  Theme: ${meta.theme}\n  subtitleSafeBottom: ${subtitleSafeBottom}\n  Output: ${outDir}`
    );
    return { script, outDir };
  }

  // Create output directories
  mkdirSync(outDir, { recursive: true });
  const publicDir = resolve(outDir, "public");
  mkdirSync(publicDir, { recursive: true });
  const assetsDir = resolve(publicDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  // Serialize script
  const scriptJson = JSON.stringify(script, null, 2);

  // Write <out>/script.json
  const scriptPath = resolve(outDir, "script.json");
  writeFileSync(scriptPath, scriptJson, "utf-8");
  if (verbose) console.log("[compile] Wrote", scriptPath);

  // Write <out>/public/script.json (same content, for Remotion staticFile())
  const publicScriptPath = resolve(publicDir, "script.json");
  writeFileSync(publicScriptPath, scriptJson, "utf-8");
  if (verbose) console.log("[compile] Wrote", publicScriptPath);

  // Copy asset files to public/assets/
  for (const [relPath, buildPath] of Object.entries(assetResult.assets)) {
    const srcAbs = resolve(project.projectDir, relPath);
    const destAbs = resolve(publicDir, buildPath);

    if (existsSync(srcAbs)) {
      mkdirSync(dirname(destAbs), { recursive: true });
      copyFileSync(srcAbs, destAbs);
      if (verbose)
        console.log("[compile] Copied asset:", srcAbs, "→", destAbs);
    }
  }

  if (verbose) console.log("[compile] Done. Output:", outDir);

  return { script, outDir };
}