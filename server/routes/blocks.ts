import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { projectGuard } from '../middleware/pathGuard.js';
import { serveFileWithRange } from '../middleware/range.js';
import { readFileWithEtag, writeFileWithEtag, parseMetaFields, computeSlug } from '../services/projectService.js';
import { parseScript } from '../services/scriptParser.js';
import { resolveTaskConfig } from '../services/configService.js';
import {
  extractBlock,
  replaceBlock,
  NotFoundError,
  ValidationError,
} from '../services/scriptEditor.js';
import {
  resolveScriptFiles,
  readSplitWithEtag,
  writeSplitWithEtag,
  splitMergedBlock,
  extractNarrationBlock,
  replaceNarrationBlock,
  visualDescFromBlock,
  narrationTextFromBlock,
} from '../services/scriptFiles.js';
import type { VisualMode, CacheClearKind } from '../types/api.js';

// Allowed visual modes
const VISUAL_MODES: VisualMode[] = ['animation', 'image', 'html'];

// Allowed animation presets
const ANIMATION_PRESETS = [
  'fade', 'fade-up', 'fade-down',
  'slide-left', 'slide-right',
  'zoom-in', 'zoom-out', 'none',
];

// Allowed cache clear kinds
const CACHE_CLEAR_KINDS: CacheClearKind[] = ['audio', 'visual', 'partial', 'all'];

/** Type guard for CacheClearKind */
function isCacheClearKind(v: unknown): v is CacheClearKind {
  return typeof v === 'string' && (CACHE_CLEAR_KINDS as string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read meta.md and return the current slug (defaults to project name). */
function resolveSlug(projectsRoot: string, name: string): string {
  const metaPath = path.join(projectsRoot, name, 'meta.md');
  if (fs.existsSync(metaPath)) {
    const metaContent = fs.readFileSync(metaPath, 'utf-8');
    return computeSlug(parseMetaFields(metaContent), name);
  }
  return name;
}

// ---------------------------------------------------------------------------
// Visual-mode patch helper
// ---------------------------------------------------------------------------

const VISUAL_DIRECTIVE_RE = /^@visual:\s*/;

/**
 * Update or insert `@visual: <mode>` in a block's content string.
 * The block header (first line) is never touched.
 */
function patchVisualMode(blockContent: string, mode: VisualMode): string {
  const lines = blockContent.split('\n');
  let found = false;

  for (let i = 1; i < lines.length; i++) {
    if (VISUAL_DIRECTIVE_RE.test(lines[i])) {
      lines[i] = `@visual: ${mode}`;
      found = true;
      break;
    }
  }

  if (!found) {
    // Insert immediately after block header (line 0)
    lines.splice(1, 0, `@visual: ${mode}`);
  }

  return lines.join('\n');
}

/**
 * Update or insert `@<key>: <value>` in a block's content string.
 * Used for @enter and @exit directives.
 */
function patchDirective(blockContent: string, key: string, value: string): string {
  const lines = blockContent.split('\n');
  const directiveRe = new RegExp(`^@${key}:\\s*`);

  for (let i = 1; i < lines.length; i++) {
    if (directiveRe.test(lines[i])) {
      lines[i] = `@${key}: ${value}`;
      return lines.join('\n');
    }
  }

  // Not found — insert after block header (line 0)
  lines.splice(1, 0, `@${key}: ${value}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createBlockRoutes(projectsRoot: string, repoRoot: string) {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/projects/:name/blocks
  // -------------------------------------------------------------------------
  app.get('/:name/blocks', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const projDir = path.join(projectsRoot, name);
    // 新布局从 visuals.md 解析块头/指令（语法同 script.md，仅无 section 标记）
    const layout = resolveScriptFiles(projDir);
    const blocksPath = layout.mode === 'single' ? layout.scriptPath : layout.visualsPath;

    if (!fs.existsSync(blocksPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: `${path.basename(blocksPath)} not found` } }, 404);
    }

    // Determine currentSlug from meta.md
    let currentSlug = name;
    const metaPath = path.join(projDir, 'meta.md');
    if (fs.existsSync(metaPath)) {
      const metaContent = fs.readFileSync(metaPath, 'utf-8');
      const slugMatch = metaContent.match(/^slug:\s*(.+)$/m);
      if (slugMatch) currentSlug = slugMatch[1].trim();
    }

    const buildDir = path.join(projDir, 'build', currentSlug);
    const scriptMd = fs.readFileSync(blocksPath, 'utf-8');
    const { blocks, warnings } = parseScript(scriptMd, buildDir);

    return c.json({ blocks, warnings, currentSlug });
  });

  // -------------------------------------------------------------------------
  // PUT /api/projects/:name/blocks/:id
  // Replace a single block's content in script.md (ETag-protected)
  // -------------------------------------------------------------------------
  app.put('/:name/blocks/:id', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const id = c.req.param('id')!;
    const projDir = path.join(projectsRoot, name);
    const layout = resolveScriptFiles(projDir);

    if (layout.mode === 'single') {
      const scriptPath = layout.scriptPath;
      if (!fs.existsSync(scriptPath)) {
        return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'script.md not found' } }, 404);
      }

      const ifMatch = c.req.header('If-Match');
      if (!ifMatch) {
        return c.json({ error: { code: 'ERR_MISSING_IF_MATCH', message: 'If-Match header required' } }, 400);
      }

      const body = await c.req.json<{ content: string }>();
      if (typeof body.content !== 'string') {
        return c.json({ error: { code: 'ERR_INVALID_BODY', message: 'body.content must be a string' } }, 400);
      }

      // Read current script.md and check ETag
      const { content: scriptMd, etag: currentEtag } = readFileWithEtag(scriptPath);
      if (currentEtag !== ifMatch) {
        return c.json({ currentContent: scriptMd, currentEtag }, 409);
      }

      // Replace block content (may throw NotFoundError or ValidationError)
      let newScriptMd: string;
      try {
        newScriptMd = replaceBlock(scriptMd, id, body.content);
      } catch (err) {
        if (err instanceof NotFoundError) {
          return c.json({ error: { code: err.code, message: err.message } }, 404);
        }
        if (err instanceof ValidationError) {
          return c.json({ error: { code: err.code, message: err.message } }, 422);
        }
        throw err;
      }

      // Write back (re-checks ETag atomically)
      const result = writeFileWithEtag(scriptPath, newScriptMd, ifMatch);
      if ('conflict' in result) {
        const fresh = readFileWithEtag(scriptPath);
        return c.json({ currentContent: fresh.content, currentEtag: fresh.etag }, 409);
      }

      return c.json({ ok: true, etag: result.etag });
    }

    // --- split layout: 合并块文本拆成两份，分别写入 visuals.md / narration.md ---
    if (!fs.existsSync(layout.visualsPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'visuals.md not found' } }, 404);
    }
    if (!fs.existsSync(layout.narrationPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'narration.md not found' } }, 404);
    }

    const ifMatch = c.req.header('If-Match');
    if (!ifMatch) {
      return c.json({ error: { code: 'ERR_MISSING_IF_MATCH', message: 'If-Match header required' } }, 400);
    }

    const body = await c.req.json<{ content: string }>();
    if (typeof body.content !== 'string') {
      return c.json({ error: { code: 'ERR_INVALID_BODY', message: 'body.content must be a string' } }, 400);
    }

    // Read current files and check combined ETag
    const current = readSplitWithEtag(layout.visualsPath, layout.narrationPath);
    if (current.etag !== ifMatch) {
      return c.json(
        { currentVisuals: current.visuals, currentNarration: current.narration, currentEtag: current.etag },
        409,
      );
    }

    // 先完整解析校验（拆块 + 两个文件各自定位替换），全部通过后才落盘
    let newVisuals: string;
    let newNarration: string;
    try {
      const { visualsBlock, narrationBlock } = splitMergedBlock(body.content);
      newVisuals = replaceBlock(current.visuals, id, visualsBlock);
      newNarration = replaceNarrationBlock(current.narration, id, narrationBlock);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: { code: err.code, message: err.message } }, 404);
      }
      if (err instanceof ValidationError) {
        return c.json({ error: { code: err.code, message: err.message } }, 422);
      }
      throw err;
    }

    // Write back both files (re-checks ETag)
    const result = writeSplitWithEtag(layout.visualsPath, layout.narrationPath, newVisuals, newNarration, ifMatch);
    if (!result) {
      const fresh = readSplitWithEtag(layout.visualsPath, layout.narrationPath);
      return c.json(
        { currentVisuals: fresh.visuals, currentNarration: fresh.narration, currentEtag: fresh.etag },
        409,
      );
    }

    return c.json({ ok: true, etag: result.etag });
  });

  // -------------------------------------------------------------------------
  // PUT /api/projects/:name/blocks/:id/visual-mode
  // Update block directives: @visual / @enter / @exit (ETag-protected)
  // -------------------------------------------------------------------------
  app.put('/:name/blocks/:id/visual-mode', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const id = c.req.param('id')!;
    const projDir = path.join(projectsRoot, name);
    const layout = resolveScriptFiles(projDir);

    // @visual/@enter/@exit 指令行都在 visuals.md（新）或 script.md（旧）里
    const directivesPath = layout.mode === 'single' ? layout.scriptPath : layout.visualsPath;
    if (!fs.existsSync(directivesPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: `${path.basename(directivesPath)} not found` } }, 404);
    }
    if (layout.mode === 'split' && !fs.existsSync(layout.narrationPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'narration.md not found' } }, 404);
    }

    const ifMatch = c.req.header('If-Match');
    if (!ifMatch) {
      return c.json({ error: { code: 'ERR_MISSING_IF_MATCH', message: 'If-Match header required' } }, 400);
    }

    const body = await c.req.json<{ mode?: string; enter?: string; exit?: string }>();

    // Validate mode if provided
    if (body.mode !== undefined && !VISUAL_MODES.includes(body.mode as VisualMode)) {
      return c.json(
        { error: { code: 'ERR_INVALID_MODE', message: `mode must be one of: ${VISUAL_MODES.join(', ')}` } },
        400,
      );
    }
    // Validate enter if provided
    if (body.enter !== undefined && !ANIMATION_PRESETS.includes(body.enter)) {
      return c.json(
        { error: { code: 'ERR_INVALID_ENTER', message: `enter must be one of: ${ANIMATION_PRESETS.join(', ')}` } },
        400,
      );
    }
    // Validate exit if provided
    if (body.exit !== undefined && !ANIMATION_PRESETS.includes(body.exit)) {
      return c.json(
        { error: { code: 'ERR_INVALID_EXIT', message: `exit must be one of: ${ANIMATION_PRESETS.join(', ')}` } },
        400,
      );
    }

    // Patch block directives (shared by both layouts)
    const patchBlock = (fileContent: string): string => {
      const { content: blockContent } = extractBlock(fileContent, id);
      let patchedBlock = blockContent;
      if (body.mode !== undefined) {
        patchedBlock = patchVisualMode(patchedBlock, body.mode as VisualMode);
      }
      if (body.enter !== undefined) {
        patchedBlock = patchDirective(patchedBlock, 'enter', body.enter);
      }
      if (body.exit !== undefined) {
        patchedBlock = patchDirective(patchedBlock, 'exit', body.exit);
      }
      return replaceBlock(fileContent, id, patchedBlock);
    };

    const handlePatchError = (err: unknown) => {
      if (err instanceof NotFoundError) {
        return c.json({ error: { code: err.code, message: err.message } }, 404);
      }
      if (err instanceof ValidationError) {
        return c.json({ error: { code: err.code, message: err.message } }, 422);
      }
      throw err;
    };

    if (layout.mode === 'single') {
      const scriptPath = layout.scriptPath;

      // Read current script.md and check ETag
      const { content: scriptMd, etag: currentEtag } = readFileWithEtag(scriptPath);
      if (currentEtag !== ifMatch) {
        return c.json({ currentContent: scriptMd, currentEtag }, 409);
      }

      let newScriptMd: string;
      try {
        newScriptMd = patchBlock(scriptMd);
      } catch (err) {
        return handlePatchError(err);
      }

      // Write back
      const result = writeFileWithEtag(scriptPath, newScriptMd, ifMatch);
      if ('conflict' in result) {
        const fresh = readFileWithEtag(scriptPath);
        return c.json({ currentContent: fresh.content, currentEtag: fresh.etag }, 409);
      }

      return c.json({ ok: true, etag: result.etag, mode: body.mode, enter: body.enter, exit: body.exit });
    }

    // --- split layout: 只改 visuals.md，narration.md 原样 ---
    const current = readSplitWithEtag(layout.visualsPath, layout.narrationPath);
    if (current.etag !== ifMatch) {
      return c.json(
        { currentVisuals: current.visuals, currentNarration: current.narration, currentEtag: current.etag },
        409,
      );
    }

    let newVisuals: string;
    try {
      newVisuals = patchBlock(current.visuals);
    } catch (err) {
      return handlePatchError(err);
    }

    const result = writeSplitWithEtag(layout.visualsPath, layout.narrationPath, newVisuals, current.narration, ifMatch);
    if (!result) {
      const fresh = readSplitWithEtag(layout.visualsPath, layout.narrationPath);
      return c.json(
        { currentVisuals: fresh.visuals, currentNarration: fresh.narration, currentEtag: fresh.etag },
        409,
      );
    }

    return c.json({ ok: true, etag: result.etag, mode: body.mode, enter: body.enter, exit: body.exit });
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:name/blocks/:id/cache/clear
  // Clear block-level cache + build products + script.json fields
  // ---------------------------------------------------------------------------
  app.post('/:name/blocks/:id/cache/clear', projectGuard(projectsRoot), async (c) => {
    const { name, id } = c.req.param();
    const body = await c.req.json<{ kind: unknown }>();

    if (!isCacheClearKind(body.kind)) {
      return c.json(
        { error: { code: 'ERR_INVALID_KIND', message: `kind must be one of: ${CACHE_CLEAR_KINDS.join(', ')}` } },
        400,
      );
    }

    const kind = body.kind;
    const projDir = path.join(projectsRoot, name);

    // Resolve current slug
    const slug = resolveSlug(projectsRoot, name);
    const buildDir = path.join(projDir, 'build', slug);
    const scriptJsonPath = path.join(buildDir, 'script.json');
    // 缓存目录与 CLI 统一：配置中的全局缓存目录（默认 ~/.autovideo/cache）
    const cacheDir = resolveTaskConfig(repoRoot).cache.dir;
    const manifestPath = path.join(cacheDir, 'manifest.json');

    // --- Parse block content for cache matching ---
    // 旧布局读 script.md（section 标记提取）；新布局读 visuals.md（视觉描述）
    // 与 narration.md（旁白文本，audio 缓存按 ttsText 匹配需要）
    const layout = resolveScriptFiles(projDir);
    let narrationText = '';
    let visualDesc = '';

    if (layout.mode === 'single') {
      const scriptPath = layout.scriptPath;
      if (fs.existsSync(scriptPath)) {
        try {
          const scriptMd = fs.readFileSync(scriptPath, 'utf-8');
          const { content: blockContent } = extractBlock(scriptMd, id);
          // Extract narration section text
          const narrMatch = blockContent.match(/---\s+narration\s+---\s*\n([\s\S]*?)(?=\n(?:---\s+(?:visual|narration)|$))/);
          if (narrMatch) narrationText = narrMatch[1].trim();
          // Extract visual section text
          const visMatch = blockContent.match(/---\s+visual\s+---\s*\n([\s\S]*?)(?=\n(?:---\s+(?:visual|narration)|$))/);
          if (visMatch) visualDesc = visMatch[1].trim();
        } catch {
          // Block not found in script.md — proceed with cache and build cleanup only
        }
      }
    } else {
      if (fs.existsSync(layout.visualsPath)) {
        try {
          const visualsMd = fs.readFileSync(layout.visualsPath, 'utf-8');
          visualDesc = visualDescFromBlock(extractBlock(visualsMd, id).content);
        } catch {
          // Block not found in visuals.md — proceed with cache and build cleanup only
        }
      }
      if (fs.existsSync(layout.narrationPath)) {
        try {
          const narrationMd = fs.readFileSync(layout.narrationPath, 'utf-8');
          narrationText = narrationTextFromBlock(extractNarrationBlock(narrationMd, id));
        } catch {
          // Block not found in narration.md — proceed with cache and build cleanup only
        }
      }
    }

    // --- Clear cache manifest entries ---
    let clearedCache = 0;

    if (fs.existsSync(manifestPath)) {
      try {
        const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestRaw) as Record<string, any>;
        const manifestDirty = { ...manifest };

        // Map kind → cache types to look for
        const typeMap: Record<CacheClearKind, string[]> = {
          audio: ['audio'],
          visual: ['component', 'images'],
          partial: ['partial'],
          all: ['audio', 'component', 'images', 'partial'],
        };
        const targetTypes = typeMap[kind];

        for (const [entryId, entry] of Object.entries(manifestDirty)) {
          if (!targetTypes.includes(entry.type)) continue;

          let matched = false;

          if (entry.type === 'audio' && narrationText) {
            // Match by ttsText in the cache key
            matched = entry.key?.ttsText === narrationText;
          } else if (entry.type === 'component' && visualDesc) {
            // Match by descriptionHash
            const descHash = crypto.createHash('md5').update(visualDesc).digest('hex');
            matched = entry.key?.descriptionHash === descHash;
          } else if (entry.type === 'images' && visualDesc) {
            // Match by prompt in the cache key
            matched = entry.key?.prompt === visualDesc;
          } else if (entry.type === 'partial') {
            // Partials are hard to match precisely; skip cache matching for partials
            // Build product and script.json clearing still resets block status
            matched = false;
          }

          if (matched) {
            // Delete the cache file
            const filePath = path.join(cacheDir, entry.file);
            try { fs.unlinkSync(filePath); } catch { /* already gone */ }
            delete manifestDirty[entryId];
            clearedCache++;
          }
        }

        fs.writeFileSync(manifestPath, JSON.stringify(manifestDirty, null, 2), 'utf-8');
      } catch {
        // Manifest corrupted — skip cache clearing, continue with build cleanup
      }
    }

    // --- Clear build products ---
    // Compile-managed visuals (local image with imageSource / video / html) are
    // products of the compile stage — no later stage can regenerate them, so a
    // cache clear must not remove them. Deleting them strands the block: render
    // fails with "image mode requires visual.imagePath" and only a full
    // recompile restores them.
    let compileManagedVisual = false;
    if (fs.existsSync(scriptJsonPath)) {
      try {
        const scriptJson = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'));
        const b = ((scriptJson.blocks ?? []) as any[]).find((x: any) => x.id === id);
        compileManagedVisual = !!b && (
          b.visualMode === 'video' ||
          b.visualMode === 'html' ||
          (b.visualMode === 'image' && typeof b.imageSource === 'string')
        );
      } catch { /* script.json corrupted — treat as not compile-managed */ }
    }
    if (kind === 'audio' || kind === 'all') {
      const p = path.join(buildDir, 'public', 'audio', `${id}.wav`);
      try { fs.unlinkSync(p); } catch { /* not found */ }
    }
    if ((kind === 'visual' || kind === 'all') && !compileManagedVisual) {
      const compPath = path.join(buildDir, 'src', 'blocks', id, 'Component.tsx');
      const imgPath = path.join(buildDir, 'public', 'images', `${id}.png`);
      try { fs.unlinkSync(compPath); } catch { /* not found */ }
      try { fs.unlinkSync(imgPath); } catch { /* not found */ }
    }
    if (kind === 'partial' || kind === 'all') {
      const partialPath = path.join(buildDir, 'output', 'partials', `${id}.mp4`);
      try { fs.unlinkSync(partialPath); } catch { /* not found */ }
    }

    // --- Clear script.json fields ---
    if (fs.existsSync(scriptJsonPath)) {
      try {
        const raw = fs.readFileSync(scriptJsonPath, 'utf-8');
        const scriptJson = JSON.parse(raw);
        const blocks: any[] = scriptJson.blocks ?? [];
        const block = blocks.find((b: any) => b.id === id);

        if (block) {
          if (kind === 'audio' || kind === 'all') {
            delete block.audio;
          }
          if ((kind === 'visual' || kind === 'all') && !compileManagedVisual) {
            if (block.visual) {
              delete block.visual.componentPath;
              delete block.visual.imagePath;
            }
          }
          if (kind === 'partial' || kind === 'all') {
            delete block.render;
          }
          if (kind === 'all') {
            delete block.timing;
          }
          fs.writeFileSync(scriptJsonPath, JSON.stringify(scriptJson, null, 2), 'utf-8');
        }
      } catch {
        // script.json corrupted — skip
      }
    }

    return c.json({ ok: true, clearedCache, kind });
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:name/blocks/:id/audio → WAV (supports Range)
  // ---------------------------------------------------------------------------
  app.get('/:name/blocks/:id/audio', projectGuard(projectsRoot), (c) => {
    const { name, id } = c.req.param();
    const slug = resolveSlug(projectsRoot, name);
    const filePath = path.join(projectsRoot, name, 'build', slug, 'public', 'audio', `${id}.wav`);
    return serveFileWithRange(c, filePath, 'audio/wav');
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:name/blocks/:id/component → Component.tsx text/plain
  // ---------------------------------------------------------------------------
  app.get('/:name/blocks/:id/component', projectGuard(projectsRoot), (c) => {
    const { name, id } = c.req.param();
    const slug = resolveSlug(projectsRoot, name);
    const filePath = path.join(projectsRoot, name, 'build', slug, 'src', 'blocks', id, 'Component.tsx');
    if (!fs.existsSync(filePath)) {
      return new Response('Not Found', { status: 404 });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:name/blocks/:id/image → PNG (image mode)
  //   ?download=1 → Content-Disposition: attachment
  // ---------------------------------------------------------------------------
  app.get('/:name/blocks/:id/image', projectGuard(projectsRoot), (c) => {
    const { name, id } = c.req.param();
    const slug = resolveSlug(projectsRoot, name);
    const filePath = path.join(projectsRoot, name, 'build', slug, 'public', 'images', `${id}.png`);
    const download = c.req.query('download') === '1';
    return serveFileWithRange(c, filePath, 'image/png', download ? `${id}.png` : undefined);
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:name/blocks/:id/video → partial MP4 (supports Range)
  // ---------------------------------------------------------------------------
  app.get('/:name/blocks/:id/video', projectGuard(projectsRoot), (c) => {
    const { name, id } = c.req.param();
    const slug = resolveSlug(projectsRoot, name);
    const filePath = path.join(projectsRoot, name, 'build', slug, 'output', 'partials', `${id}.mp4`);
    return serveFileWithRange(c, filePath, 'video/mp4');
  });

  return app;
}
