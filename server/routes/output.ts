import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import { projectGuard } from '../middleware/pathGuard.js';
import { serveFileWithRange } from '../middleware/range.js';
import { parseMetaFields, computeSlug } from '../services/projectService.js';

/** Read meta.md and return the current slug (defaults to project name). */
function resolveSlug(projectsRoot: string, name: string): string {
  const metaPath = path.join(projectsRoot, name, 'meta.md');
  if (fs.existsSync(metaPath)) {
    const metaContent = fs.readFileSync(metaPath, 'utf-8');
    return computeSlug(parseMetaFields(metaContent), name);
  }
  return name;
}

export function createOutputRoutes(projectsRoot: string) {
  const app = new Hono();

  // ---------------------------------------------------------------------------
  // GET /api/projects/:name/output
  //   final_normalized.mp4 first, fallback final.mp4, 404 if neither
  //   ?variant=quick → serve from the quick-build dir (build/<slug>-quick/output)
  //   ?download=1 → Content-Disposition: attachment
  // ---------------------------------------------------------------------------
  app.get('/:name/output', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const slug = resolveSlug(projectsRoot, name);
    const isQuick = c.req.query('variant') === 'quick';
    const buildSlug = isQuick ? `${slug}-quick` : slug;
    const outputDir = path.join(projectsRoot, name, 'build', buildSlug, 'output');

    const normalizedPath = path.join(outputDir, 'final_normalized.mp4');
    const plainPath = path.join(outputDir, 'final.mp4');

    let filePath: string;
    if (fs.existsSync(normalizedPath)) {
      filePath = normalizedPath;
    } else if (fs.existsSync(plainPath)) {
      filePath = plainPath;
    } else {
      return new Response('Not Found', { status: 404 });
    }

    const download = c.req.query('download') === '1';
    const downloadName = download ? `${buildSlug}.mp4` : undefined;

    const response = serveFileWithRange(c, filePath, 'video/mp4', downloadName);

    // When falling back to final.mp4, append X-Source header
    if (filePath === plainPath) {
      const origHeaders = response.headers;
      const newHeaders = new Headers(origHeaders);
      newHeaders.set('X-Source', 'final.mp4');
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    }

    return response;
  });

  return app;
}
