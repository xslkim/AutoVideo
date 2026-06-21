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
  type ProgressEvent,
} from "../types/script.js";
import type { AutoVideoConfig } from "../config/defaults.js";
import { generateRenderRoot } from "../render/root-render.js";
import { renderBlocks, type RenderBlocksResult } from "../render/render-blocks.js";
import { concatPartials } from "../render/concat.js";
import { applyLoudnorm, type LoudnormResult } from "../render/loudnorm.js";
import { runQA, type QAResult } from "../render/qa.js";
import { extractAudio, generateLipsync, overlayLipsync, probeVideoSize, padAudio, concatLipsyncVideos, LipsyncError } from "../render/lipsync.js";

const DEFAULT_AVATAR_RADIUS = 24;

function resolveAvatarRadius(meta: Script["meta"]): number {
  const r = meta.avatarRadius ?? DEFAULT_AVATAR_RADIUS;
  return Math.min(128, Math.max(8, Math.round(r)));
}

/** Run MuseTalk per-block lip-sync (default when avatarRef is set). */
function shouldGenerateMuseTalkLipsync(meta: Script["meta"]): boolean {
  return Boolean(meta.avatarRef) && meta.skipLipsync !== true;
}

/** Overlay looping avatar.mp4 without MuseTalk (only when skipLipsync: true). */
function shouldOverlayRawAvatarLoop(meta: Script["meta"]): boolean {
  return Boolean(meta.avatarRef) && meta.skipLipsync === true;
}

// ── Error class ───────────────────────────────────────────────────────

export class RenderError extends Error {
  code: string;
  constructor(message: string, code = "ERR_RENDER_FAILED") {
    super(message);
    this.name = "RenderError";
    this.code = code;
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
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Skip renderBlocks, only concat + loudnorm + qa (PRD A.3) */
  concatOnly?: boolean;
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
    onProgress,
    signal,
    concatOnly = false,
  } = opts;

  const emit = (percent: number, step: string, blockId?: string) => {
    onProgress?.({ percent, step, stage: "render", blockId });
  };

  emit(0, "开始渲染");

  // Check abort before starting
  if (signal?.aborted) throw new RenderError("Render cancelled", "ERR_CANCELLED");

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
    emit(100, "Dry run 完成");
    return { script, cacheHits: 0, renders: 0 };
  }

  if (signal?.aborted) throw new RenderError("Render cancelled", "ERR_CANCELLED");

  // ── concatOnly mode (PRD A.3): skip renderBlocks, only concat+loudnorm+qa ─
  if (concatOnly) {
    emit(10, "验证 partial 文件");

    const allPartials = blocks.map(
      (b) => b.render?.partialPath ?? `output/partials/${b.id}.mp4`
    );

    for (const relPath of allPartials) {
      const absPath = path.join(buildDir, relPath);
      if (!fs.existsSync(absPath)) {
        throw new RenderError(
          `缺少 partial: ${path.basename(absPath, ".mp4")}`,
          "ERR_PARTIAL_MISSING"
        );
      }
    }

    if (signal?.aborted) throw new RenderError("Render cancelled", "ERR_CANCELLED");

    emit(30, "拼接 partials");
    console.log(`[render] Concatenating ${allPartials.length} partials...`);
    concatPartials(allPartials, { buildDir });
    console.log(`[render] Concat complete → output/final.mp4`);

    if (signal?.aborted) throw new RenderError("Render cancelled", "ERR_CANCELLED");

    // Avatar overlay in concatOnly mode
    const concatFinalPath = path.join(buildDir, "output", "final.mp4");
    if (meta.avatarRef) {
      if (shouldOverlayRawAvatarLoop(meta)) {
        // skipLipsync: true — overlay avatar.mp4 directly with repeat
        emit(35, "叠加头像画中画（无口型同步）");
        const concatAvatarOut = path.join(buildDir, "output", "final_avatar.mp4");
        const concatAvatarSize = await probeVideoSize(meta.avatarRef);
        await overlayLipsync(
          concatFinalPath, meta.avatarRef, concatAvatarOut,
          { width: concatAvatarSize.width, height: concatAvatarSize.height, margin: 0, radius: resolveAvatarRadius(meta), position: "bottom-left" },
          signal,
        );
        fs.renameSync(concatAvatarOut, concatFinalPath);
      } else if (shouldGenerateMuseTalkLipsync(meta)) {
        // skipLipsync: false (default) — per-block MuseTalk generation
        const lipsyncDir = path.join(buildDir, "output", "lipsync");
        fs.mkdirSync(lipsyncDir, { recursive: true });
        const musetalkUrl = config.musetalk?.url ?? "http://localhost:8001";
        const blockCount = blocks.length;

        for (let i = 0; i < blockCount; i++) {
          const block = blocks[i];
          const blockLipsyncPath = path.join(lipsyncDir, `${block.id}.mp4`);

          if (fs.existsSync(blockLipsyncPath)) {
            emit(35 + Math.round((i / blockCount) * 20), `口型同步: ${block.id} (缓存)`);
            console.log(`[render] Lipsync cache hit for ${block.id}`);
            continue;
          }

          const audioRelPath = block.audio!.wavPath;
          const audioPath = path.join(buildDir, audioRelPath);
          const enterMs = (block.timing?.enterSec ?? 0) * 1000;
          const totalSec = block.timing?.totalSec ?? block.audio!.durationSec;

          const paddedAudioPath = path.join(lipsyncDir, `${block.id}_padded.wav`);
          await padAudio(audioPath, paddedAudioPath, enterMs, totalSec, signal);

          emit(35 + Math.round((i / blockCount) * 20), `口型同步: ${block.id}`);
          console.log(`[render] Generating lipsync for ${block.id} (${totalSec.toFixed(1)}s)...`);

          try {
            await generateLipsync({
              avatarPath: meta.avatarRef,
              audioPath: paddedAudioPath,
              outputPath: blockLipsyncPath,
              fps: meta.fps,
              serviceUrl: musetalkUrl,
              signal,
            });
          } catch (err) {
            if (err instanceof LipsyncError) throw new RenderError(err.message, "ERR_LIPSYNC_FAILED");
            throw err;
          }

          try { fs.unlinkSync(paddedAudioPath); } catch {}
          if (signal?.aborted) throw new RenderError("Render cancelled", "ERR_CANCELLED");
        }

        emit(56, "拼接口型片段");
        const lipsyncParts = blocks.map((b) => path.join(lipsyncDir, `${b.id}.mp4`));
        const lipsyncFullPath = path.join(buildDir, "output", "lipsync_full.mp4");
        await concatLipsyncVideos(lipsyncParts, lipsyncFullPath, signal);

        emit(58, "叠加口型画中画");
        const concatLipsyncOut = path.join(buildDir, "output", "final_lipsync.mp4");
        const concatAvatarSize = await probeVideoSize(meta.avatarRef);
        await overlayLipsync(
          concatFinalPath, lipsyncFullPath, concatLipsyncOut,
          { width: concatAvatarSize.width, height: concatAvatarSize.height, margin: 0, radius: resolveAvatarRadius(meta), position: "bottom-left" },
          signal,
        );
        fs.renameSync(concatLipsyncOut, concatFinalPath);
        try { fs.unlinkSync(lipsyncFullPath); } catch {}
      }
    }

    if (signal?.aborted) throw new RenderError("Render cancelled", "ERR_CANCELLED");

    emit(60, "响度归一化");
    const loudnormCfg = renderConfig.loudnorm ?? {
      i: -16, tp: -1.5, lra: 11, twoPass: true, audioBitrate: "192k",
    };
    console.log(`[render] Applying loudnorm normalization...`);
    const loudnormOut: LoudnormResult = await applyLoudnorm(
      concatFinalPath, loudnormCfg, buildDir
    );
    console.log(`[render] Loudnorm complete → ${path.basename(loudnormOut.outputPath)}`);

    if (signal?.aborted) throw new RenderError("Render cancelled", "ERR_CANCELLED");

    emit(80, "QA 检查");
    const normedPath = loudnormOut.outputPath;
    const partialsDirQA = path.join(buildDir, "output", "partials");
    console.log(`[render] Running QA checks...`);
    const qaOut: QAResult = await runQA(
      normedPath, partialsDirQA,
      { width: meta.width, height: meta.height, fps: meta.fps },
      blocks.map((b) => ({ id: b.id, totalSec: b.timing?.totalSec ?? 0 }))
    );

    if (qaOut.errors.length > 0) {
      console.error(`[render] QA failed:`);
      for (const err of qaOut.errors) console.error(`  ✗ ${err}`);
      throw new RenderError(
        `QA check failed with ${qaOut.errors.length} error(s):\n` +
        qaOut.errors.map((e) => `  - ${e}`).join("\n"),
        "ERR_QA_FAILED"
      );
    }

    script.artifacts.renderedAt = new Date().toISOString();
    const scriptOutPathConcat = path.join(buildDir, "script.json");
    fs.writeFileSync(scriptOutPathConcat, JSON.stringify(script, null, 2), "utf-8");
    if (fs.existsSync(publicScriptPath)) {
      fs.writeFileSync(publicScriptPath, JSON.stringify(script, null, 2), "utf-8");
    }

    console.log(`✓ Concat-only complete → output/final_normalized.mp4`);
    emit(100, "Concat-only 完成");
    return { script, cacheHits: 0, renders: 0 };
  }

  emit(10, `渲染 ${blocks.length} 个块`);

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
      signal,
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
      signal,
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

  if (signal?.aborted) throw new RenderError("Render cancelled", "ERR_CANCELLED");

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
        `Block may not have been rendered. Run: autovideo render ${opts.scriptPath} --block <id> --force`,
        "ERR_PARTIAL_MISSING"
      );
    }
  }

  // ── Step 7.2: Per-block lipsync generation ─────────────────────────
  //
  // Generate a lipsync video for each block individually (short audio per
  // request) so no single MuseTalk request carries the entire video audio.
  // Each block's audio is padded with silence for enter/exit animations so
  // the lipsync duration matches the block partial duration exactly.

  // Per-block lipsync generation (default on; skipLipsync: true disables MuseTalk)
  const doLipsync = shouldGenerateMuseTalkLipsync(meta);
  const avatarRef = meta.avatarRef;
  if (doLipsync && avatarRef) {
    const lipsyncDir = path.join(buildDir, "output", "lipsync");
    fs.mkdirSync(lipsyncDir, { recursive: true });
    const musetalkUrl = (config as any).musetalk?.url ?? "http://localhost:8001";
    const blockCount = blocksToConcat.length;

    for (let i = 0; i < blockCount; i++) {
      const block = blocksToConcat[i];
      const blockLipsyncPath = path.join(lipsyncDir, `${block.id}.mp4`);

      // Cache hit: reuse existing lipsync if the block partial was unchanged
      if (fs.existsSync(blockLipsyncPath) && block.render?.cacheHit) {
        emit(50 + Math.round((i / blockCount) * 17), `口型同步: ${block.id} (缓存)`);
        console.log(`[render] Lipsync cache hit for ${block.id}`);
        continue;
      }

      const audioRelPath = block.audio!.wavPath;
      const audioPath = path.join(buildDir, audioRelPath);
      const enterMs = (block.timing?.enterSec ?? 0) * 1000;
      const totalSec = block.timing?.totalSec ?? block.audio!.durationSec;

      // Pad audio to match block total duration (enter-silence + narration + exit-silence)
      const paddedAudioPath = path.join(lipsyncDir, `${block.id}_padded.wav`);
      await padAudio(audioPath, paddedAudioPath, enterMs, totalSec, signal);

      emit(50 + Math.round((i / blockCount) * 17), `口型同步: ${block.id}`);
      console.log(`[render] Generating lipsync for ${block.id} (${totalSec.toFixed(1)}s)...`);

      try {
        await generateLipsync({
          avatarPath: avatarRef,
          audioPath: paddedAudioPath,
          outputPath: blockLipsyncPath,
          fps: meta.fps,
          serviceUrl: musetalkUrl,
          signal,
        });
      } catch (err) {
        if (err instanceof LipsyncError) {
          throw new RenderError(err.message, "ERR_LIPSYNC_FAILED");
        }
        throw err;
      }

      try { fs.unlinkSync(paddedAudioPath); } catch {}

      if (signal?.aborted) throw new RenderError("Render cancelled", "ERR_CANCELLED");
    }

    // Concat per-block lipsync videos into one (same total duration as final.mp4)
    emit(68, "拼接口型片段");
    const lipsyncParts = blocksToConcat.map((b) => path.join(lipsyncDir, `${b.id}.mp4`));
    const lipsyncFullPath = path.join(buildDir, "output", "lipsync_full.mp4");
    await concatLipsyncVideos(lipsyncParts, lipsyncFullPath, signal);
    console.log(`[render] Lipsync concat complete → output/lipsync_full.mp4`);
  }

  emit(70, "拼接 partials");
  console.log(`[render] Concatenating ${partialRelPaths.length} partials...`);
  concatPartials(partialRelPaths, { buildDir });
  console.log(`[render] Concat complete → output/final.mp4`);

  const finalAbsPath = path.join(buildDir, "output", "final.mp4");

  // ── Step 7.5: Overlay avatar onto final.mp4 ──────────────────────────

  if (meta.avatarRef) {
    emit(73, "叠加头像画中画");
    const finalWithAvatarPath = path.join(buildDir, "output", "final_avatar.mp4");
    const avatarSize = await probeVideoSize(meta.avatarRef);

    if (shouldOverlayRawAvatarLoop(meta)) {
      console.log(`[render] Overlaying avatar (no lip-sync) PiP...`);
      await overlayLipsync(
        finalAbsPath,
        meta.avatarRef,
        finalWithAvatarPath,
        { width: avatarSize.width, height: avatarSize.height, margin: 0, radius: resolveAvatarRadius(meta), position: "bottom-left" },
        signal,
      );
    } else if (shouldGenerateMuseTalkLipsync(meta)) {
      const lipsyncFullPath = path.join(buildDir, "output", "lipsync_full.mp4");
      console.log(`[render] Overlaying lip-sync PiP...`);
      await overlayLipsync(
        finalAbsPath,
        lipsyncFullPath,
        finalWithAvatarPath,
        { width: avatarSize.width, height: avatarSize.height, margin: 0, radius: resolveAvatarRadius(meta), position: "bottom-left" },
        signal,
      );
      try { fs.unlinkSync(lipsyncFullPath); } catch {}
    }

    fs.renameSync(finalWithAvatarPath, finalAbsPath);
    console.log(`[render] Avatar overlay complete`);
  }

  // ── Step 8: Loudnorm ────────────────────────────────────────────────

  emit(75, "响度归一化");

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

  emit(90, "QA 检查");

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
      qaResult.errors.map((e) => `  - ${e}`).join("\n"),
      "ERR_QA_FAILED"
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

  emit(100, "渲染完成");

  return {
    script,
    cacheHits: renderResult.cacheHits,
    renders: renderResult.renders,
  };
}

export default render;