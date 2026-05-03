/**
 * AutoVideo Web — Frame Renderer
 *
 * Remotion bundle cache + renderStill for frame preview.
 *
 * PRD refs: §7 (backend service structure), §8 (frame preview implementation)
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill, makeCancelSignal } from '@remotion/renderer';
import type { CancelSignal } from '@remotion/renderer';
import { generateRenderRoot } from '../../src/render/root-render.js';
import { computeSlug, parseMetaFields } from './projectService.js';
import type { Script, Block } from '../../src/types/script.js';

// ---------------------------------------------------------------------------
// Custom error with status code
// ---------------------------------------------------------------------------

class FrameError extends Error {
  code: string;
  status: number;
  reason?: string;
  constructor(message: string, code: string, status: number, reason?: string) {
    super(message);
    this.name = 'FrameError';
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Remotion source files to copy into build dir
// ---------------------------------------------------------------------------

const REMOTION_FILES = [
  { src: 'remotion/VideoComposition.tsx', dest: 'remotion/VideoComposition.tsx' },
  { src: 'remotion/engine/block-frame.tsx', dest: 'remotion/engine/block-frame.tsx' },
  { src: 'remotion/engine/theme.ts', dest: 'remotion/engine/theme.ts' },
  { src: 'remotion/engine/types.ts', dest: 'remotion/engine/types.ts' },
  { src: 'remotion/components/SubtitleOverlay.tsx', dest: 'remotion/components/SubtitleOverlay.tsx' },
];

// ---------------------------------------------------------------------------
// FrameRenderer
// ---------------------------------------------------------------------------

export class FrameRenderer {
  private projectsRoot: string;
  private repoRoot: string;

  /** Per-block concurrency control: only one renderStill per block at a time */
  private activeByBlock = new Map<string, () => void>();

  /** Bundle cache keyed by build directory */
  private bundleCache = new Map<string, { serveUrl: string; srcMtime: number }>();

  constructor(projectsRoot: string, repoRoot: string) {
    this.projectsRoot = projectsRoot;
    this.repoRoot = repoRoot;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Render a single PNG frame for a block.
   *
   * @param projectName - Project directory name
   * @param blockId - Block ID (e.g. "B01")
   * @param frame - Frame number (0-indexed)
   * @returns PNG image buffer
   */
  async renderFrame(
    projectName: string,
    blockId: string,
    frame: number,
  ): Promise<Buffer> {
    const projDir = path.join(this.projectsRoot, projectName);

    // Resolve current slug from meta.md
    const slug = this.resolveSlug(projDir);
    const buildDir = path.join(projDir, 'build', slug);

    // ── Step 1: Read script.json ──────────────────────────────────────
    const scriptPath = path.join(buildDir, 'script.json');
    if (!fs.existsSync(scriptPath)) {
      throw new FrameError(
        'Build not found. Run compile first.',
        'ERR_NO_BUILD',
        404,
      );
    }

    let script: Script;
    try {
      script = JSON.parse(fs.readFileSync(scriptPath, 'utf-8')) as Script;
    } catch {
      throw new FrameError(
        'Failed to parse script.json',
        'ERR_BAD_SCRIPT',
        500,
      );
    }

    // ── Step 2: Find block and validate componentPath ────────────────
    const block = script.blocks.find((b) => b.id === blockId);
    if (!block) {
      throw new FrameError(
        `Block ${blockId} not found in script.json`,
        'ERR_BLOCK_NOT_FOUND',
        404,
      );
    }

    const componentPath = block.visual.componentPath;
    if (!componentPath) {
      throw new FrameError(
        'Component not generated. Run visuals first.',
        'ERR_NO_COMPONENT',
        404,
        'no_component',
      );
    }

    const fullComponentPath = path.join(buildDir, componentPath);
    if (!fs.existsSync(fullComponentPath)) {
      throw new FrameError(
        'Component file not found',
        'ERR_NO_COMPONENT',
        404,
        'no_component',
      );
    }

    // ── Step 3: Calculate durationInFrames ───────────────────────────
    const fps = script.meta.fps;
    const durationInFrames = block.timing?.frames
      ?? Math.round((block.audio?.durationSec ?? 5) * fps);

    if (frame < 0 || frame >= durationInFrames) {
      throw new FrameError(
        `Frame ${frame} out of range [0, ${durationInFrames - 1}]`,
        'ERR_FRAME_OUT_OF_RANGE',
        422,
      );
    }

    // ── Step 4: Ensure Remotion files in build dir ───────────────────
    this.ensureRemotionSetup(buildDir, script);

    // ── Step 5: Get or create bundle ─────────────────────────────────
    const serveUrl = await this.getOrCreateBundle(buildDir);

    // ── Step 6: Concurrency control ──────────────────────────────────
    this.abortActive(blockId);
    const { cancelSignal, cancel } = makeCancelSignal();
    this.activeByBlock.set(blockId, cancel);

    // 30s hard timeout
    const timeoutId = setTimeout(() => cancel(), 30_000);

    try {
      // ── Step 7: selectComposition ──────────────────────────────────
      const composition = await selectComposition({
        serveUrl,
        id: 'Block',
        inputProps: { blockId },
        timeoutInMilliseconds: 30_000,
      });

      // ── Step 8: renderStill → PNG buffer ───────────────────────────
      const tmpFile = path.join(
        os.tmpdir(),
        `autovideo-frame-${crypto.randomUUID()}.png`,
      );

      await renderStill({
        composition,
        serveUrl,
        output: tmpFile,
        frame,
        inputProps: { blockId },
        imageFormat: 'png',
        scale: 1,
        timeoutInMilliseconds: 30_000,
        cancelSignal,
      });

      // Read output file
      if (!fs.existsSync(tmpFile)) {
        throw new FrameError(
          'Render produced no output',
          'ERR_RENDER_FAILED',
          500,
        );
      }

      const buffer = fs.readFileSync(tmpFile);

      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }

      return buffer;
    } catch (err) {
      if (err instanceof FrameError) throw err;

      const msg = err instanceof Error ? err.message : String(err);

      // Check if it was a timeout
      if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('cancel')) {
        throw new FrameError(
          `Frame render timed out after 30s`,
          'ERR_TIMEOUT',
          504,
        );
      }

      throw new FrameError(msg, 'ERR_RENDER_FAILED', 500);
    } finally {
      clearTimeout(timeoutId);
      this.activeByBlock.delete(blockId);
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Resolve the current slug from project's meta.md. */
  private resolveSlug(projDir: string): string {
    const metaPath = path.join(projDir, 'meta.md');
    if (fs.existsSync(metaPath)) {
      const metaContent = fs.readFileSync(metaPath, 'utf-8');
      const projectName = path.basename(projDir);
      return computeSlug(parseMetaFields(metaContent), projectName);
    }
    return path.basename(projDir);
  }

  /**
   * Ensure build directory has remotion-root.tsx, remotion/ source files,
   * and public/script.json so that Remotion bundle works.
   */
  private ensureRemotionSetup(buildDir: string, script: Script): void {
    // ── remotion-root.tsx ────────────────────────────────────────────
    const rootPath = path.join(buildDir, 'remotion-root.tsx');
    if (!fs.existsSync(rootPath)) {
      const rootContent = generateRenderRoot({ script, buildDir });
      fs.writeFileSync(rootPath, rootContent, 'utf-8');
    }

    // ── remotion/ source files ───────────────────────────────────────
    const remotionDir = path.join(buildDir, 'remotion');
    if (!fs.existsSync(remotionDir)) {
      for (const { src, dest } of REMOTION_FILES) {
        const srcPath = path.join(this.repoRoot, src);
        const destPath = path.join(buildDir, dest);
        if (fs.existsSync(srcPath)) {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }

    // ── public/script.json ───────────────────────────────────────────
    const publicScriptPath = path.join(buildDir, 'public', 'script.json');
    if (!fs.existsSync(publicScriptPath)) {
      fs.mkdirSync(path.dirname(publicScriptPath), { recursive: true });
      fs.writeFileSync(publicScriptPath, JSON.stringify(script, null, 2), 'utf-8');
    }

    // ── public/audio/ directory ──────────────────────────────────────
    const publicAudioDir = path.join(buildDir, 'public', 'audio');
    fs.mkdirSync(publicAudioDir, { recursive: true });
  }

  /**
   * Get or create a Remotion bundle for the given build directory.
   * Bundle is cached and invalidated when src/ content changes.
   */
  private async getOrCreateBundle(buildDir: string): Promise<string> {
    const srcDir = path.join(buildDir, 'src');
    const srcMtime = this.getDirMtime(srcDir);

    const cached = this.bundleCache.get(buildDir);
    if (cached && cached.srcMtime >= srcMtime) {
      return cached.serveUrl;
    }

    const remotionRootPath = path.join(buildDir, 'remotion-root.tsx');
    if (!fs.existsSync(remotionRootPath)) {
      throw new FrameError(
        'Remotion root not found',
        'ERR_NO_ROOT',
        500,
      );
    }

    const serveUrl = await bundle({
      entryPoint: remotionRootPath,
      publicDir: path.join(buildDir, 'public'),
    });

    this.bundleCache.set(buildDir, { serveUrl, srcMtime });
    return serveUrl;
  }

  /**
   * Get the latest mtime of all files in a directory (recursive).
   * Returns 0 if directory does not exist.
   */
  private getDirMtime(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let maxMtime = 0;
    const walk = (d: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          try {
            const stat = fs.statSync(fullPath);
            maxMtime = Math.max(maxMtime, stat.mtimeMs);
          } catch {
            /* ignore */
          }
        }
      }
    };
    try {
      walk(dir);
    } catch {
      /* ignore */
    }
    return maxMtime;
  }

  /** Cancel the active renderStill for a block, if any. */
  private abortActive(blockId: string): void {
    const prev = this.activeByBlock.get(blockId);
    if (prev) {
      prev();
      this.activeByBlock.delete(blockId);
    }
  }
}
