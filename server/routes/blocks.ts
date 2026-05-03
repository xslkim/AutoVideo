import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import { projectGuard } from '../middleware/pathGuard.js';
import { serveFileWithRange } from '../middleware/range.js';
import { readFileWithEtag, writeFileWithEtag, parseMetaFields, computeSlug } from '../services/projectService.js';
import { parseScript } from '../services/scriptParser.js';
import {
  extractBlock,
  replaceBlock,
  NotFoundError,
  ValidationError,
} from '../services/scriptEditor.js';
import { FrameRenderer } from '../services/frameRenderer.js';
import type { VisualMode } from '../types/api.js';

// Allowed visual modes
const VISUAL_MODES: VisualMode[] = ['animation', 'image'];

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

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createBlockRoutes(projectsRoot: string, frameRenderer: FrameRenderer) {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/projects/:name/blocks
  // -------------------------------------------------------------------------
  app.get('/:name/blocks', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const projDir = path.join(projectsRoot, name);
    const scriptPath = path.join(projDir, 'script.md');

    if (!fs.existsSync(scriptPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'script.md not found' } }, 404);
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
    const scriptMd = fs.readFileSync(scriptPath, 'utf-8');
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
    const scriptPath = path.join(projDir, 'script.md');

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
  });

  // -------------------------------------------------------------------------
  // PUT /api/projects/:name/blocks/:id/visual-mode
  // Toggle @visual directive inside a block (ETag-protected)
  // -------------------------------------------------------------------------
  app.put('/:name/blocks/:id/visual-mode', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const id = c.req.param('id')!;
    const projDir = path.join(projectsRoot, name);
    const scriptPath = path.join(projDir, 'script.md');

    if (!fs.existsSync(scriptPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'script.md not found' } }, 404);
    }

    const ifMatch = c.req.header('If-Match');
    if (!ifMatch) {
      return c.json({ error: { code: 'ERR_MISSING_IF_MATCH', message: 'If-Match header required' } }, 400);
    }

    const body = await c.req.json<{ mode: string }>();
    const mode = body.mode as VisualMode;
    if (!VISUAL_MODES.includes(mode)) {
      return c.json(
        { error: { code: 'ERR_INVALID_MODE', message: `mode must be one of: ${VISUAL_MODES.join(', ')}` } },
        400,
      );
    }

    // Read current script.md and check ETag
    const { content: scriptMd, etag: currentEtag } = readFileWithEtag(scriptPath);
    if (currentEtag !== ifMatch) {
      return c.json({ currentContent: scriptMd, currentEtag }, 409);
    }

    // Extract block, patch @visual directive, replace block
    let newScriptMd: string;
    try {
      const { content: blockContent } = extractBlock(scriptMd, id);
      const patchedBlock = patchVisualMode(blockContent, mode);
      newScriptMd = replaceBlock(scriptMd, id, patchedBlock);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: { code: err.code, message: err.message } }, 404);
      }
      if (err instanceof ValidationError) {
        return c.json({ error: { code: err.code, message: err.message } }, 422);
      }
      throw err;
    }

    // Write back
    const result = writeFileWithEtag(scriptPath, newScriptMd, ifMatch);
    if ('conflict' in result) {
      const fresh = readFileWithEtag(scriptPath);
      return c.json({ currentContent: fresh.content, currentEtag: fresh.etag }, 409);
    }

    return c.json({ ok: true, etag: result.etag, mode });
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

  // ---------------------------------------------------------------------------
  // GET /api/projects/:name/blocks/:id/preview?frame=N → PNG frame preview
  // ---------------------------------------------------------------------------
  app.get('/:name/blocks/:id/preview', projectGuard(projectsRoot), async (c) => {
    const { name, id } = c.req.param();
    const frameStr = c.req.query('frame') || '0';
    const frame = parseInt(frameStr, 10);

    if (isNaN(frame) || frame < 0) {
      return c.json(
        { error: { code: 'ERR_INVALID_FRAME', message: 'frame must be a non-negative integer' } },
        400,
      );
    }

    try {
      const pngBuffer = await frameRenderer.renderFrame(name, id, frame);
      return new Response(new Uint8Array(pngBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err: any) {
      // FrameError has status/code/reason
      if (err.status && err.code) {
        const body: any = { error: { code: err.code, message: err.message } };
        if (err.reason) body.reason = err.reason;
        return c.json(body, err.status);
      }
      // Unexpected errors
      console.error(`[preview] Unhandled error for ${name}/${id} frame ${frame}:`, err);
      return c.json(
        { error: { code: 'ERR_INTERNAL', message: 'Internal server error' } },
        500,
      );
    }
  });

  return app;
}
