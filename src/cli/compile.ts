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
import { resolve, dirname, join } from "node:path";
import AjvModule from "ajv";
const Ajv = AjvModule.default ?? AjvModule;

import { readProject, type ResolvedProject } from "../parser/project.js";
import { readMetaWithDimensions, type ResolvedMeta, type MetaOverrides } from "../parser/meta.js";
import { parseProjectBlocks, type RawBlock } from "../parser/blocks.js";
import {
  processAssets,
  stripVisualComments,
  type BlockForAssets,
  type AssetProcessResult,
} from "../parser/assets.js";
import { resolveOutDir } from "../utils/slugify.js";
import { SUBTITLE_SAFE_BOTTOM_PCT } from "../config/defaults.js";
import {
  loadPronunciationDicts,
  applyPronunciation,
  DICT_FILENAME,
  PronunciationError,
} from "../tts/pronounce.js";
import { lintPronunciation, formatPronunciationLint, lintDictReplacements, formatDictLint } from "../tts/lint.js";
import { scaleFontMentions } from "../compile/font-scale.js";
import { lintNarrationSync } from "../compile/sync-lint.js";

import type {
  Script,
  Block,
  AnimationPreset,
  AspectRatio,
  NarrationLine,
  ProgressEvent,
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
  code: string;
  constructor(message: string, code = "ERR_COMPILE_FAILED") {
    super(message);
    this.name = "CompileError";
    this.code = code;
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
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Compile result
// ---------------------------------------------------------------------------

export interface CompileResult {
  script: Script;
  outDir: string;
  scriptPath: string;
}

// ---------------------------------------------------------------------------
// Inline HTML marker-line validation (PRD §3.4)
// ---------------------------------------------------------------------------

/**
 * Validate that inline HTML source does not contain lines that would be
 * silently truncated by the block section parser.
 *
 * The parser (blocks.ts) ends a `--- visual ---` section on a bare `---`
 * line or a `--- <word> ---` line, and `>>>` at line start begins a new
 * block. Inline HTML containing such lines would be silently cut short.
 * Detect and throw so the author can restructure (e.g. indent the line, or
 * wait for html(./path) external file mode in Phase 3).
 */
function assertNoHtmlMarkerLines(htmlContent: string, blockId: string): void {
  const lines = htmlContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (
      trimmed === "---" ||
      /^--- \w+ ---$/.test(trimmed) ||
      trimmed.startsWith(">>>")
    ) {
      throw new CompileError(
        `Block ${blockId}: inline HTML contains a line that the section parser ` +
          `would treat as a section/block boundary (line ${i + 1}: "${trimmed}"). ` +
          `The --- visual --- section would be silently truncated here. ` +
          `Indent the line or restructure the HTML to avoid a bare '---', ` +
          `'--- word ---', or '>>>' at line start.`,
        "ERR_HTML_MARKER_LINE",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Meta args parser
// ---------------------------------------------------------------------------

function parseMetaArgs(args?: string[]): MetaOverrides | undefined {
  if (!args || args.length === 0) return undefined;
  const overrides: MetaOverrides = {};
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq < 0) continue;
    const key = arg.slice(0, eq);
    const val = arg.slice(eq + 1);
    const num = Number(val);
    overrides[key] = isNaN(num) ? val : num;
  }
  return overrides;
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
    onProgress,
    signal,
  } = options;

  const emit = (percent: number, step: string, blockId?: string) => {
    onProgress?.({ percent, step, stage: "compile", blockId });
  };

  emit(0, "开始编译");

  // Check abort before starting
  if (signal?.aborted) throw new CompileError("Compile cancelled", "ERR_CANCELLED");

  // ── Step 1: Read project.json ──────────────────────────────────────────
  if (verbose) console.log("[compile] Reading project:", projectPath);
  const project: ResolvedProject = readProject(projectPath);

  emit(10, "解析 meta.md");

  // ── Step 2: Parse meta.md (with --meta overrides) ──────────────────────
  if (verbose) console.log("[compile] Parsing meta:", project.metaPath);
  const meta: ResolvedMeta = readMetaWithDimensions(project.metaPath, parseMetaArgs(metaArgs));

  // Validate voiceRef exists
  if (!existsSync(meta.voiceRef)) {
    throw new CompileError(
      `voiceRef file not found: ${meta.voiceRef}\n` +
        `Please provide a 10-30s clear voice WAV file at this path.`,
      "ERR_VOICE_REF_NOT_FOUND"
    );
  }

  emit(20, "解析块文件");

  // ── Step 3: Parse & merge blocks ───────────────────────────────────────
  if (verbose)
    console.log(
      "[compile] Parsing blocks from",
      project.blockEntries.length,
      "entries"
    );
  const rawBlocks: RawBlock[] = parseProjectBlocks(project.blockEntries);

  emit(40, "确定输出目录");

  // ── Step 4: Determine output directory ─────────────────────────────────
  const outDir = resolveOutDir(meta.title, outFlag, meta.slug, dirname(projectPath));
  if (verbose) console.log("[compile] Output directory:", outDir);

  if (signal?.aborted) throw new CompileError("Compile cancelled", "ERR_CANCELLED");

  emit(50, "处理资源文件");

  // ── Step 5: Process assets ─────────────────────────────────────────────
  // Build BlockForAssets[] from RawBlock[]
  // html blocks: pass empty visualDescription so processAssets does NOT scan
  // the HTML source for local paths (would mangle src="/href=" attributes).
  // The real HTML source is read directly from raw.visualDescription in Step 7.
  // Visual comments (`<!-- ... -->`) are documentation-only: strip them before
  // asset scanning so comment content (e.g. command examples like
  // `--patch ./scratch-plugin/cordis.yml`) is never treated as an asset ref,
  // never rewritten, and never reaches script.json / AI prompts.
  const blocksForAssets: BlockForAssets[] = rawBlocks.map((b) => ({
    id: b.id,
    visualDescription: b.visualMode === 'html' ? '' : stripVisualComments(b.visualDescription),
    sourceFilePath: b.sourceFilePath,
    ...(b.imageSource !== undefined ? { imageSource: b.imageSource } : {}),
    ...(b.videoSource !== undefined ? { videoSource: b.videoSource } : {}),
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

  emit(70, "组装 Script 对象");

  // ── Step 6: Compute subtitleSafeBottom ─────────────────────────────────
  const subtitleSafeBottom = Math.floor(meta.height * SUBTITLE_SAFE_BOTTOM_PCT);

  // ── Step 6.5: Load the pronunciation dictionary (optional) ─────────────
  let pronunciationRules;
  try {
    pronunciationRules = loadPronunciationDicts(project.projectDir);
  } catch (err) {
    if (err instanceof PronunciationError) {
      throw new CompileError(err.message, "ERR_DICT_INVALID");
    }
    throw err;
  }
  if (verbose && pronunciationRules.length > 0) {
    console.log(
      `[compile] Loaded ${pronunciationRules.length} pronunciation rule(s) (repo + machine + project ${DICT_FILENAME})`
    );
  }

  /**
   * Attach `speakText` when the dictionary actually rewrites a line. Leaving
   * it off for unchanged lines keeps script.json readable and keeps the audio
   * cache key identical to the no-dictionary case.
   */
  const withSpeakText = (line: NarrationLine): NarrationLine => {
    if (pronunciationRules.length === 0) return line;
    const speakText = applyPronunciation(line.ttsText, pronunciationRules);
    return speakText === line.ttsText ? line : { ...line, speakText };
  };

  // ── Step 7: Assemble Script ────────────────────────────────────────────
  // Merge processed visual descriptions back into blocks
  const scriptBlocks: Block[] = rawBlocks.map((raw, idx) => {
    // Find the matching processed block (same index)
    const processedBlock = assetResult.blocks[idx];
    const isHtml = raw.visualMode === 'html';

    // html blocks: visual.description is raw HTML source. It must bypass both
    // processAssets description rewriting (Step 5 passed empty) and
    // scaleFontMentions (whose FONT_MENTION regex would rewrite CSS font-size).
    const rawDescription = isHtml
      ? raw.visualDescription
      : (processedBlock ? processedBlock.visualDescription : raw.visualDescription);

    let description: string;
    if (isHtml) {
      description = rawDescription;
    } else {
      const fontScaled = scaleFontMentions(rawDescription, meta.height);
      if (verbose && fontScaled.scale !== 1) {
        console.log(
          `[compile] Block ${raw.id}: scaled font sizes ×${fontScaled.scale.toFixed(
            2,
          )} (smallest was ${fontScaled.originalMinPx}px)`,
        );
      }
      description = fontScaled.description;
    }

    return {
      id: raw.id,
      title: raw.title,
      enter: raw.enter,
      exit: raw.exit,
      visualMode: raw.visualMode,
      ...(processedBlock?.imageSource !== undefined
        ? { imageSource: processedBlock.imageSource }
        : {}),
      ...(processedBlock?.videoSource !== undefined
        ? { videoSource: processedBlock.videoSource }
        : {}),
      ...(raw.htmlSource !== undefined ? { htmlSource: raw.htmlSource } : {}),
      visual: {
        description,
      },
      narration: {
        lines: raw.narrationLines.map(withSpeakText),
        ...(raw.explicitDurationSec !== undefined && {
          explicitDurationSec: raw.explicitDurationSec,
        }),
      },
    };
  });

  // ── Step 7.1: Lint for uncovered Latin terms ───────────────────────────
  // Anything the dictionary did not rewrite that still looks suspicious
  // (camelCase, ALL_CAPS, file-like, version-like) is reported so the author
  // can extend dict.md instead of discovering mispronunciations by ear.
  const lintFindings = lintPronunciation(scriptBlocks, pronunciationRules);
  const lintReport = formatPronunciationLint(lintFindings);
  if (lintReport) console.warn(lintReport);

  // Dictionary RHS stability: replacements containing digits/symbols get
  // re-normalized server-side (wetext), making the reading unpredictable.
  const dictLintReport = formatDictLint(lintDictReplacements(pronunciationRules));
  if (dictLintReport) console.warn(dictLintReport);

  // ── Step 7.5: Set up local image blocks ────────────────────────────────
  // For image-mode blocks with imageSource, the image file already exists
  // locally. Copy it to public/images/{id}.png and write the wrapper
  // Component.tsx so the block is fully ready for preview and render
  // without needing the visuals stage.
  const WRAPPER_TSX = (id: string) => `import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

interface AnimationProps {
  frame: number; durationInFrames: number; width: number; height: number;
  subtitleSafeBottom: number; theme: any; fps: number;
}

const Component: React.FC<AnimationProps> = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <Img
      src={staticFile("images/${id}.png")}
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
  </AbsoluteFill>
);

export default Component;
`;

  for (const block of scriptBlocks) {
    if (block.visualMode === 'image' && block.imageSource) {
      const imagesDir = join(outDir, 'public', 'images');
      mkdirSync(imagesDir, { recursive: true });
      const srcPath = join(outDir, 'public', block.imageSource);
      const destPath = join(imagesDir, `${block.id}.png`);
      if (existsSync(srcPath)) {
        copyFileSync(srcPath, destPath);
        block.visual.imagePath = `public/images/${block.id}.png`;
      } else if (verbose) {
        console.warn(`[compile] Local image not found for ${block.id}: ${srcPath}`);
      }

      // Write wrapper Component.tsx so rendering works without visuals stage
      const blockDir = join(outDir, 'src', 'blocks', block.id);
      mkdirSync(blockDir, { recursive: true });
      const componentFile = join(blockDir, 'Component.tsx');
      writeFileSync(componentFile, WRAPPER_TSX(block.id), 'utf-8');
      block.visual.componentPath = `src/blocks/${block.id}/Component.tsx`;
    }
  }

  // ── Step 7.6: Set up local video blocks ────────────────────────────────
  // For video-mode blocks with videoSource, the video file already exists
  // locally. Copy it to public/videos/{id}.mp4 and write the wrapper
  // Component.tsx so the block is fully ready for preview and render
  // without needing the visuals stage.
  const VIDEO_WRAPPER_TSX = (id: string) => `import React from "react";
import { AbsoluteFill, Video, staticFile } from "remotion";

interface AnimationProps {
  frame: number; durationInFrames: number; width: number; height: number;
  subtitleSafeBottom: number; theme: any; fps: number;
}

const Component: React.FC<AnimationProps> = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <Video
      src={staticFile("videos/${id}.mp4")}
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
      loop
    />
  </AbsoluteFill>
);

export default Component;
`;

  for (const block of scriptBlocks) {
    if (block.visualMode === 'video' && block.videoSource) {
      const videosDir = join(outDir, 'public', 'videos');
      mkdirSync(videosDir, { recursive: true });
      const srcPath = join(outDir, 'public', block.videoSource);
      const destPath = join(videosDir, `${block.id}.mp4`);
      if (existsSync(srcPath)) {
        copyFileSync(srcPath, destPath);
        block.visual.videoPath = `public/videos/${block.id}.mp4`;
      } else if (verbose) {
        console.warn(`[compile] Local video not found for ${block.id}: ${srcPath}`);
      }

      // Write wrapper Component.tsx so rendering works without visuals stage
      const blockDir = join(outDir, 'src', 'blocks', block.id);
      mkdirSync(blockDir, { recursive: true });
      const componentFile = join(blockDir, 'Component.tsx');
      writeFileSync(componentFile, VIDEO_WRAPPER_TSX(block.id), 'utf-8');
      block.visual.componentPath = `src/blocks/${block.id}/Component.tsx`;
    }
  }

  // ── Step 7.7: Set up local html blocks ─────────────────────────────────
  // For html-mode blocks, write the HTML source to public/html/{id}.html so
  // the render stage can load it via headless Chrome. html blocks do NOT get
  // a Component.tsx — they bypass Remotion entirely (see render-blocks.ts).
  for (const block of scriptBlocks) {
    if (block.visualMode !== 'html') continue;

    if (block.htmlSource) {
      // html(./path) external file mode — arrives in Phase 3 (processHtmlAssets).
      throw new CompileError(
        `Block ${block.id}: @visual: html(./path) external file mode is not yet supported (Phase 3). ` +
          `Use inline @visual: html (HTML source in the --- visual --- section) for now.`,
        "ERR_HTML_EXTERNAL_NOT_SUPPORTED",
      );
    }

    // Inline mode: visual.description is the HTML source.
    const htmlContent = block.visual.description;
    assertNoHtmlMarkerLines(htmlContent, block.id);

    const htmlDir = join(outDir, "public", "html");
    mkdirSync(htmlDir, { recursive: true });
    const destPath = join(htmlDir, `${block.id}.html`);
    writeFileSync(destPath, htmlContent, "utf-8");
    block.visual.htmlPath = `public/html/${block.id}.html`;

    if (verbose) console.log(`[compile] Wrote html for ${block.id}: ${destPath}`);
  }

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
      ...(meta.avatarRef ? { avatarRef: meta.avatarRef } : {}),
      skipLipsync: meta.skipLipsync,
      ...(meta.avatarRef ? { avatarRadius: meta.avatarRadius } : {}),
    },
    blocks: scriptBlocks,
    artifacts: {
      compiledAt: new Date().toISOString(),
    },
    assets: assetResult.assets,
  };

  emit(80, "验证 Schema");

  // ── Step 8: Validate with JSON Schema (Ajv) ────────────────────────────
  if (verbose) console.log("[compile] Validating script against JSON schema");
  const schemaObj = loadSchema();
  const ajv = new Ajv({ allErrors: true });
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
    throw new CompileError(`Script schema validation failed:\n${errors}`, "ERR_SCHEMA_VALIDATION");
  }

  // ── Step 8.5: Narration-sync authoring lint (non-blocking) ─────────────
  // Catch description patterns that silently break narration↔animation sync
  // (absolute beats past the entrance, enumerated narration without a visual
  // mapping). The generator can only honour sync when the author declares it.
  const syncWarnings = lintNarrationSync(script.blocks);
  for (const w of syncWarnings) {
    console.warn(`[compile] ⚠ ${w.blockId} (${w.rule}): ${w.message}`);
  }
  if (syncWarnings.length > 0) {
    console.warn(
      `[compile] ${syncWarnings.length} 条旁白同步告警——动画可能与讲解错位，建议修改视觉描述后重新 compile`
    );
  }

  // ── Step 9: Write output ───────────────────────────────────────────────
  if (dryRun) {
    const blockSummary = project.blockEntries
      .map((e) =>
        e.kind === "single"
          ? `\n    - ${e.path} (single-file)`
          : `\n    - ${e.visualPath} + ${e.narrationPath} (split)`,
      )
      .join("");
    console.log(
      `Would compile:\n  Project: ${project.projectPath}\n  Meta: ${project.metaPath}\n  Blocks: ${project.blockEntries.length} entr${project.blockEntries.length === 1 ? "y" : "ies"}${blockSummary}\n  Title: ${meta.title}\n  Aspect: ${meta.aspect} (${meta.width}×${meta.height})\n  FPS: ${meta.fps}\n  Theme: ${meta.theme}\n  subtitleSafeBottom: ${subtitleSafeBottom}\n  Output: ${outDir}`
    );
    emit(100, "Dry run 完成");
    return { script, outDir, scriptPath: resolve(outDir, "script.json") };
  }

  emit(90, "写入输出文件");

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

  emit(100, "编译完成");

  return { script, outDir, scriptPath };
}