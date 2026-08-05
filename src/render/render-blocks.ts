/**
 * render-blocks.ts — Partial rendering with programmatic bundle + renderMedia
 *
 * T6.3: Renders each block as an independent partial MP4 using Remotion's
 * programmatic API. Supports caching, retry, and block-level concurrency.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { bundle } from '@remotion/bundler';
import {
  selectComposition,
  renderMedia,
  makeCancelSignal,
} from '@remotion/renderer';
import pLimit from 'p-limit';

import type { Script, Block } from '../types/script.js';
import { DEFAULT_QUALITY, type AutoVideoConfig } from '../config/defaults.js';
import { CacheStore, type PartialKey } from '../cache/store.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RenderBlocksResult {
  /** Per-block results, in order */
  blocks: Array<{
    id: string;
    partialPath: string;
    cacheHit: boolean;
  }>;
  /** Total number of cache hits */
  cacheHits: number;
  /** Total number of renders (cache misses) */
  renders: number;
}

export interface RenderBlocksOptions {
  /** Build output directory (cwd for all relative paths) */
  buildDir: string;
  /** Configuration (merged defaults + user config) */
  config: AutoVideoConfig;
  /** Force re-render (ignore cache) for specific block IDs, or all blocks */
  forceBlocks?: Set<string>;
  /** External abort signal for cancellation */
  signal?: AbortSignal;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getRemotionVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('@remotion/renderer/package.json');
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Ensure directory exists */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Copy file, ensuring destination directory exists */
function copyFile(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Render all blocks as partial MP4s.
 *
 * 1. Bundle Remotion once → shared serveUrl
 * 2. For each block: check partial cache → hit: cp, miss: renderMedia
 * 3. Block-level concurrency via p-limit
 * 4. On failure: 1 retry, then abort all in-flight
 */
export async function renderBlocks(
  script: Script,
  options: RenderBlocksOptions
): Promise<RenderBlocksResult> {
  const { buildDir, config, forceBlocks, signal: externalSignal } = options;
  const renderConfig = config.render ?? {};

  const blockConcurrency = renderConfig.blockConcurrency ?? 4;
  const cpus = typeof require === 'undefined' ? 4 : require('os').cpus().length;
  const framesConcurrencyPerBlock =
    renderConfig.framesConcurrencyPerBlock ??
    Math.max(1, Math.floor(cpus / blockConcurrency));

  // Browser timeout: default 120s to handle slow WSL2 / resource-constrained envs
  const browserTimeoutMs = renderConfig.browserTimeoutMs ?? 120000;
  // browserExecutable: null = Remotion auto-detect
  const browserExecutable = renderConfig.browser ?? null;
  // WSL2 / Linux: default to single-process mode to avoid multi-process startup failures
  const enableMultiProcessOnLinux = renderConfig.enableMultiProcessOnLinux ?? false;

  const quality = { ...DEFAULT_QUALITY, ...(renderConfig.quality ?? {}) };

  const partialsDir = path.join(buildDir, 'output', 'partials');
  ensureDir(partialsDir);

  const results: RenderBlocksResult['blocks'] = [];
  let cacheHits = 0;
  let renders = 0;

  // Track failed blocks for error reporting
  const failures: Array<{ id: string; error: Error }> = [];
  let aborted = false;

  // ── Step 1: Bundle once ──────────────────────────────────────────────────
  const remotionRootPath = path.join(buildDir, 'remotion-root.tsx');
  if (!fs.existsSync(remotionRootPath)) {
    throw new Error(
      `Remotion root not found at ${remotionRootPath}. Run root-render first.`
    );
  }

  console.log(`[render-blocks] Bundling Remotion project...`);
  const bundleStartTime = Date.now();

  const serveUrl = await bundle({
    entryPoint: remotionRootPath,
    // Remotion bundles to a temp dir by default; we can specify publicDir
    publicDir: path.join(buildDir, 'public'),
  });

  console.log(
    `[render-blocks] Bundle complete in ${((Date.now() - bundleStartTime) / 1000).toFixed(1)}s → ${serveUrl}`
  );

  // ── Step 2: Render each block ───────────────────────────────────────────
  const limiter = pLimit(blockConcurrency);
  const { cancelSignal, cancel } = makeCancelSignal();

  // Forward external signal cancellation to internal cancel
  if (externalSignal) {
    if (externalSignal.aborted) {
      cancel();
      throw new Error("Render cancelled");
    }
    externalSignal.addEventListener("abort", () => cancel(), { once: true });
  }

  const renderTasks = script.blocks.map((block: Block) => {
    return limiter(async () => {
      if (aborted) {
        return;
      }

      const blockId = block.id;
      const partialPath = path.join('output', 'partials', `${blockId}.mp4`);
      const fullPartialPath = path.join(buildDir, partialPath);

      // Compute cache key
      const componentPath = block.visual.componentPath;
      if (!componentPath) {
        throw new Error(`Block ${blockId} has no componentPath`);
      }

      const fullComponentPath = path.join(buildDir, componentPath);
      const audioPath = block.audio?.wavPath;
      if (!audioPath) {
        throw new Error(`Block ${blockId} has no audio.wavPath`);
      }
      const fullAudioPath = path.join(buildDir, audioPath);

      // Read component and audio content for cache key computation
      const componentContent = fs.readFileSync(fullComponentPath, 'utf-8');
      const audioContent = fs.readFileSync(fullAudioPath);

      const isForce = forceBlocks?.has(blockId);

      // ── Cache lookup ────────────────────────────────────────────────────
      const cache = new CacheStore({
        cacheDir: config.cache?.dir ?? '~/.cache/autovideo',
        maxSizeGB: config.cache?.maxSizeGB ?? 10,
      });

      const remotionVersion = getRemotionVersion();
      const partialKey: PartialKey = {
        componentHash: crypto.createHash('md5').update(componentContent).digest('hex'),
        audioHash: crypto.createHash('md5').update(audioContent).digest('hex'),
        theme: script.meta.theme,
        width: script.meta.width,
        height: script.meta.height,
        fps: script.meta.fps,
        enter: block.enter ?? 'fade',
        exit: block.exit ?? 'fade',
        remotionVersion,
        // Encoding settings are part of the identity of a partial: mixing
        // partials produced under different settings would splice visibly
        // different quality (and possibly different pix_fmt) into one video.
        qualityJson: JSON.stringify(quality),
      };

      if (!isForce) {
        const cached = await cache.get('partial', partialKey);
        if (cached) {
          copyFile(cached, fullPartialPath);
          console.log(`[render-blocks] Cache hit: ${blockId}`);
          cacheHits++;
          results.push({ id: blockId, partialPath, cacheHit: true });
          return;
        }
      }

      // ── Cache miss: render ──────────────────────────────────────────────
      console.log(`[render-blocks] Rendering ${blockId}...`);
      renders++;

      const maxAttempts = 2; // 1 initial + 1 retry
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (aborted) {
          return;
        }

        try {
          // Select composition for this block
          const composition = await selectComposition({
            serveUrl,
            id: 'Block',
            inputProps: { blockId },
            timeoutInMilliseconds: browserTimeoutMs,
            browserExecutable,
            chromiumOptions: { enableMultiProcessOnLinux },
          });

          // Render the block
          await renderMedia({
            composition,
            serveUrl,
            outputLocation: fullPartialPath,
            inputProps: { blockId },
            concurrency: framesConcurrencyPerBlock,
            codec: 'h264',
            imageFormat: quality.imageFormat,
            jpegQuality: quality.imageFormat === 'jpeg' ? quality.jpegQuality : undefined,
            crf: quality.crf,
            x264Preset: quality.x264Preset,
            pixelFormat: quality.pixelFormat,
            colorSpace: quality.colorSpace,
            cancelSignal,
            timeoutInMilliseconds: browserTimeoutMs,
            browserExecutable,
            chromiumOptions: { enableMultiProcessOnLinux },
            onProgress: ({ progress }) => {
              if (attempt === 1) {
                const pct = (progress * 100).toFixed(0);
                process.stdout.write(
                  `\r[render-blocks] ${blockId}: ${pct}%`
                );
              }
            },
          });

          if (attempt === 1) {
            process.stdout.write('\n');
          }

          console.log(`[render-blocks] Rendered ${blockId} (attempt ${attempt})`);

          // Copy to cache
          await cache.put('partial', partialKey, fullPartialPath, partialKey);

          results.push({ id: blockId, partialPath, cacheHit: false });
          lastError = undefined;
          break; // success, exit retry loop
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.error(
            `[render-blocks] ${blockId} attempt ${attempt} failed: ${lastError.message}`
          );

          if (attempt < maxAttempts) {
            console.log(`[render-blocks] Retrying ${blockId}...`);
          }
        }
      }

      if (lastError) {
        // Failed after all retries
        failures.push({ id: blockId, error: lastError });

        // Abort other in-flight renders
        if (!aborted) {
          aborted = true;
          cancel();
          console.error(
            `[render-blocks] Aborting all in-flight renders due to ${blockId} failure`
          );
        }
      }
    });
  });

  await Promise.all(renderTasks);

  // ── Check for failures ──────────────────────────────────────────────────
  if (failures.length > 0) {
    const failedIds = failures.map((f) => f.id).join(', ');
    const errorMessages = failures
      .map((f) => `  ${f.id}: ${f.error.message}`)
      .join('\n');

    throw new Error(
      `Render failed for block(s): ${failedIds}\n${errorMessages}\n\n` +
        `Resume after fixing:\n` +
        `  autovideo render script.json --block ${failedIds} --force`
    );
  }

  // Sort results by block order in script
  const blockOrder = new Map<string, number>(script.blocks.map((b: Block, i: number) => [b.id, i]));
  results.sort((a, b) => (blockOrder.get(a.id) ?? 0) - (blockOrder.get(b.id) ?? 0));

  return { blocks: results, cacheHits, renders };
}

export default renderBlocks;