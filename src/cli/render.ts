/**
 * AutoVideo — render command (Stage 4)
 *
 * PRD §6.4 — Render IR + assets → MP4
 *
 * Flow:
 *   1. Validate RenderInputScript (all blocks have audio + componentPath)
 *   2. Compute timing for each block → write back to script
 *   3. Write public/script.json (main process, once)
 *   4. Write remotion-root.tsx (parameterized Composition)
 *   5. Render all / specified block partials (cache-aware)
 *   6. ffmpeg concat → final.mp4
 *   7. loudnorm two-pass → final_normalized.mp4
 *   8. QA check
 *   9. Write artifacts.renderedAt
 *
 * `--block B03 --force`: Only re-render B03 (force cache miss), then re-concat.
 * Other blocks' partials are reused from disk.
 *
 * @see PRD §6.4
 */

import fs from "node:fs";
import path from "node:path";
import {
  assertRenderInputReady,
  type Script,
  type Block,
} from "../types/script.js";
import type { AutoVideoConfig } from "../config/defaults.js";
import { generateRenderRoot } from "../render/root-render.js";
import { renderBlocks, type RenderBlocksResult } from "../render/render-blocks.js";
import { concatPartials } from "../render/concat.js";
import { applyLoudnorm, type LoudnormResult } from "../render/loudnorm.js";
import { runQA, type QAResult } from "../render/qa.js";

// ── Error class ───────────────────────────────────────────────────────

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

// ── Options ───────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Path to script.json */
  scriptPath: string;
  /** Fully merged configuration */
  config: AutoVideoConfig;
  /** Only process these block IDs */
  blockIds?: string[];
  /** Force cache miss for all / specified blocks */
  force?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Dry run — show plan but don't execute */
  dryRun?: boolean;
}

export interface RenderResult {
  /** The updated script with timing + render fields populated */
  script: Script;
  /** Number of partial cache hits */
  cacheHits: number;
  /** Number of actual renders */
  renders: number;
}

// ── Timing computation ────────────────────────────────────────────────

/**
 * Compute timing for a single block.
 *
 * Per PRD §6.4 step 1:
 *   hold = max(audio.durationSec, narration.explicitDurationSec, MIN_HOLD)
 *   enter / exit from config defaults (none preset = 0)
 *   total = enter + hold + exit
 *   frames = round(total * fps)
 *   enterFrames = round(enterSec * fps)
 */
function computeBlockTimingWithFps(
  block: Block,
  fps: number,
  config: AutoVideoConfig
): NonNullable<Block["timing"]> {
  const renderConfig = config.render;
  const minHoldSec = renderConfig?.minHoldSec ?? 1.5;

  // Enter / exit duration based on animation preset
  const isNoneEnter = block.enter === "none";
  const isNoneExit = block.exit === "none";

  const enterSec = isNoneEnter ? 0 : (renderConfig?.defaultEnterSec ?? 0.5);
  const exitSec = isNoneExit ? 0 : (renderConfig?.defaultExitSec ?? 0.3);

  // Hold = max(audio duration, explicit @duration, MIN_HOLD)
  const audioDur = block.audio?.durationSec ?? 0;
  const explicitDur = block.narration.explicitDurationSec ?? 0;
  const holdSec = Math.max(audioDur, explicitDur, minHoldSec);

  const totalSec = enterSec + holdSec + exitSec;
  const frames = Math.round(totalSec * fps);
  const enterFrames = Math.round(enterSec * fps);

  return {
    enterSec,
    holdSec,
    exitSec,
    totalSec,
    frames,
    enterFrames,
  };
}

// ── Main ──────────────────────────────────────────────────────────────

/**
 * Execute the render stage.
 *
 * @throws RenderError on fatal errors
 */
export async function render(opts: RenderOptions): Promise<RenderResult> {
  const {
    config,
    verbose = false,
    dryRun = false,
    force = false,
    blockIds,
  } = opts;

  const renderConfig = config.render ?? {};

  // ── Step 1: Load and validate script ──────────────────────────────

  const scriptRaw = JSON.parse(
    fs.readFileSync(opts.scriptPath, "utf-8")
  ) as unknown;

  // Determine which blocks to process (parsed before validation so we can
  // limit validation to only the blocks that will actually be rendered).
  const targetBlockIds = blockIds ? new Set(blockIds) : undefined;

  // Only validate blocks that are in scope; other blocks may still be incomplete
  // (e.g. during staged / partial rendering of a large project).
  assertRenderInputReady(scriptRaw, targetBlockIds);
  const script = scriptRaw as Script;

  const scriptDir = path.resolve(path.dirname(opts.scriptPath));
  const buildDir = scriptDir; // script.json is at the root of build out dir

  const { meta, blocks } = script;
  const fps = meta.fps;

  // ── Step 2: Compute timing and write back ─────────────────────────

  for (const block of blocks) {
    block.timing = computeBlockTimingWithFps(block, fps, config);
  }

  if (verbose) {
    for (const block of blocks) {
      console.log(
        `[render] ${block.id}: enter=${block.timing!.enterSec.toFixed(2)}s ` +
        `hold=${block.timing!.holdSec.toFixed(2)}s ` +
        `exit=${block.timing!.exitSec.toFixed(2)}s ` +
        `total=${block.timing!.totalSec.toFixed(2)}s ` +
        `(${block.timing!.frames} frames)`
      );
    }
  }

  // ── Step 3: Write public/script.json ──────────────────────────────

  const publicDir = path.join(buildDir, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  const publicScriptPath = path.join(publicDir, "script.json");
  fs.writeFileSync(publicScriptPath, JSON.stringify(script, null, 2), "utf-8");
  console.log(`[render] Wrote ${publicScriptPath}`);

  // ── Step 4: Copy remotion files into build dir ─────────────────────

  const buildRemotionDir = path.join(buildDir, "remotion");
  const buildEngineDir = path.join(buildRemotionDir, "engine");
  const buildComponentsDir = path.join(buildRemotionDir, "components");
  fs.mkdirSync(buildEngineDir, { recursive: true });
  fs.mkdirSync(buildComponentsDir, { recursive: true });

  const repoRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../..",
  );

  const remotionFiles = [
    { src: "remotion/VideoComposition.tsx", dest: "remotion/VideoComposition.tsx" },
    { src: "remotion/engine/block-frame.tsx", dest: "remotion/engine/block-frame.tsx" },
    { src: "remotion/engine/theme.ts", dest: "remotion/engine/theme.ts" },
    { src: "remotion/engine/types.ts", dest: "remotion/engine/types.ts" },
    { src: "remotion/components/SubtitleOverlay.tsx", dest: "remotion/components/SubtitleOverlay.tsx" },
  ];

  for (const { src, dest } of remotionFiles) {
    const srcPath = path.join(repoRoot, src);
    const destPath = path.join(buildDir, dest);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  console.log(`[render] Copied remotion files to ${buildRemotionDir}`);

  // ── Step 5: Write remotion-root.tsx ────────────────────────────────

  const rootContent = generateRenderRoot({ script, buildDir });
  const rootPath = path.join(buildDir, "remotion-root.tsx");
  fs.writeFileSync(rootPath, rootContent, "utf-8");
  console.log(`[render] Wrote ${rootPath}`);

  if (dryRun) {
    console.log(`[render] Dry run — would render ${blocks.length} block(s)`);
    return { script, cacheHits: 0, renders: 0 };
  }

  // ── Step 6: Render block partials ─────────────────────────────────

  // Determine force blocks set
  const forceBlocks: Set<string> | undefined =
    force && targetBlockIds
      ? targetBlockIds
      : force
        ? new Set(blocks.map((b) => b.id))
        : undefined;

  console.log(
    `[render] Rendering ${blocks.length} block(s)...` +
    (force ? " (force)" : "") +
    (targetBlockIds ? ` blocks: ${[...targetBlockIds].join(",")}` : "")
  );

  let renderResult: RenderBlocksResult;

  // For --block mode, we need special handling:
  // - Only render specified blocks (force miss)
  // - Other blocks reuse existing partials from disk
  if (targetBlockIds) {
    // Only render the specified blocks
    const targetBlocks = blocks.filter((b) => targetBlockIds.has(b.id));

    // Verify all target blocks exist in script
    const foundIds = new Set(targetBlocks.map((b) => b.id));
    for (const id of targetBlockIds) {
      if (!foundIds.has(id)) {
        throw new RenderError(`Block ${id} not found in script`);
      }
    }

    // Record mtimes of non-target block partials (for verification)
    const nonTargetBlocks = blocks.filter((b) => !targetBlockIds.has(b.id));
    const nonTargetMtimes = new Map<string, Date>();
    for (const b of nonTargetBlocks) {
      const partialPath = path.join(
        buildDir, "output", "partials", `${b.id}.mp4`
      );
      if (fs.existsSync(partialPath)) {
        const stat = fs.statSync(partialPath);
        nonTargetMtimes.set(b.id, stat.mtime);
      }
    }

    // Build a partial script with only target blocks for renderBlocks
    const targetScript: Script = { ...script, blocks: targetBlocks };
    const targetForceBlocks = force
      ? new Set(targetBlocks.map((b) => b.id))
      : undefined;

    renderResult = await renderBlocks(targetScript, {
      buildDir,
      config,
      forceBlocks: targetForceBlocks,
    });

    // Verify non-target partials were not modified
    for (const b of nonTargetBlocks) {
      const partialPath = path.join(
        buildDir, "output", "partials", `${b.id}.mp4`
      );
      if (fs.existsSync(partialPath) && nonTargetMtimes.has(b.id)) {
        const stat = fs.statSync(partialPath);
        const origMtime = nonTargetMtimes.get(b.id)!;
        if (stat.mtime.getTime() !== origMtime.getTime()) {
          console.warn(
            `[render] Warning: non-target block ${b.id} partial was modified ` +
            `(this shouldn't happen)`
          );
        }
      }
    }

    // Merge render results back into full script
    for (const result of renderResult.blocks) {
      const block = blocks.find((b) => b.id === result.id);
      if (block) {
        block.render = {
          partialPath: result.partialPath,
          cacheHit: result.cacheHit,
        };
      }
    }

    // Ensure non-target blocks have render info
    for (const b of nonTargetBlocks) {
      if (!b.render) {
        b.render = {
          partialPath: `output/partials/${b.id}.mp4`,
          cacheHit: true, // reused from disk, effectively a "cache hit"
        };
      }
    }
  } else {
    // Render all blocks
    renderResult = await renderBlocks(script, {
      buildDir,
      config,
      forceBlocks,
    });

    // Write render info back to blocks
    for (const result of renderResult.blocks) {
      const block = blocks.find((b) => b.id === result.id);
      if (block) {
        block.render = {
          partialPath: result.partialPath,
          cacheHit: result.cacheHit,
        };
      }
    }
  }

  console.log(
    `[render] Partial rendering complete: ` +
    `${renderResult.cacheHits} cache hits, ${renderResult.renders} renders`
  );

  // ── Step 7: ffmpeg concat ──────────────────────────────────────────

  // In --block mode only concat the requested blocks (staged / partial build).
  // In full mode concat all blocks (non-target partials are reused from disk).
  const blocksToConcat = targetBlockIds
    ? blocks.filter((b) => targetBlockIds.has(b.id))
    : blocks;

  const partialRelPaths = blocksToConcat.map(
    (b) => b.render?.partialPath ?? `output/partials/${b.id}.mp4`
  );

  // Verify all partials exist
  for (const relPath of partialRelPaths) {
    const absPath = path.join(buildDir, relPath);
    if (!fs.existsSync(absPath)) {
      throw new RenderError(
        `Partial not found: ${absPath}\n` +
        `Block may not have been rendered. Run: autovideo render ${opts.scriptPath} --block <id> --force`
      );
    }
  }

  console.log(`[render] Concatenating ${partialRelPaths.length} partials...`);
  concatPartials(partialRelPaths, { buildDir });

  console.log(`[render] Concat complete → output/final.mp4`);

  // ── Step 8: Loudnorm ────────────────────────────────────────────────

  const finalAbsPath = path.join(buildDir, "output", "final.mp4");
  const loudnormConfig = renderConfig.loudnorm ?? {
    i: -16,
    tp: -1.5,
    lra: 11,
    twoPass: true,
    audioBitrate: "192k",
  };

  console.log(`[render] Applying loudnorm normalization...`);
  const loudnormResult: LoudnormResult = await applyLoudnorm(
    finalAbsPath,
    loudnormConfig,
    buildDir
  );

  console.log(
    `[render] Loudnorm complete → ${path.basename(loudnormResult.outputPath)}`
  );

  if (verbose && loudnormResult.measured) {
    console.log(
      `[render] Measured: I=${loudnormResult.measured.i.toFixed(2)} ` +
      `TP=${loudnormResult.measured.tp.toFixed(2)} ` +
      `LRA=${loudnormResult.measured.lra.toFixed(2)} ` +
      `thresh=${loudnormResult.measured.thresh.toFixed(2)} ` +
      `offset=${loudnormResult.measured.targetOffset.toFixed(2)}`
    );
  }

  // ── Step 9: QA ──────────────────────────────────────────────────────

  const normalizedAbsPath = loudnormResult.outputPath;
  const partialsDir = path.join(buildDir, "output", "partials");

  console.log(`[render] Running QA checks...`);
  const qaResult: QAResult = await runQA(
    normalizedAbsPath,
    partialsDir,
    { width: meta.width, height: meta.height, fps: meta.fps },
    blocksToConcat.map((b) => ({
      id: b.id,
      totalSec: b.timing?.totalSec ?? 0,
    }))
  );

  if (qaResult.errors.length > 0) {
    console.error(`[render] QA failed:`);
    for (const err of qaResult.errors) {
      console.error(`  ✗ ${err}`);
    }
    throw new RenderError(
      `QA check failed with ${qaResult.errors.length} error(s):\n` +
      qaResult.errors.map((e) => `  - ${e}`).join("\n")
    );
  }

  if (qaResult.warnings.length > 0) {
    console.warn(`[render] QA warnings:`);
    for (const w of qaResult.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }

  console.log(`[render] QA passed`);

  // ── Step 10: Write artifacts.renderedAt ──────────────────────────────

  script.artifacts.renderedAt = new Date().toISOString();

  // Write final script.json
  const scriptOutPath = path.join(buildDir, "script.json");
  fs.writeFileSync(scriptOutPath, JSON.stringify(script, null, 2), "utf-8");

  // Also update public/script.json
  fs.writeFileSync(publicScriptPath, JSON.stringify(script, null, 2), "utf-8");

  console.log(
    `✓ Render complete: ${blocks.length} blocks → output/final_normalized.mp4`
  );

  return {
    script,
    cacheHits: renderResult.cacheHits,
    renders: renderResult.renders,
  };
}

export default render;