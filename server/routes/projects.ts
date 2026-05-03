import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import { projectGuard, PROJECT_NAME_RE } from '../middleware/pathGuard.js';
import {
  listProjects,
  getProject,
  readFileWithEtag,
  writeFileWithEtag,
} from '../services/projectService.js';

const TEMPLATES_DIR = path.resolve('templates/starter');

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function removeDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

export function createProjectRoutes(projectsRoot: string) {
  const app = new Hono();

  // GET /api/projects — project list
  app.get('/', (c) => {
    const projects = listProjects(projectsRoot);
    return c.json(projects);
  });

  // POST /api/projects — create new project
  app.post('/', async (c) => {
    const body = await c.req.json<{ name: string; title?: string; slug?: string }>();
    const name = body.name?.trim();

    if (!name || !PROJECT_NAME_RE.test(name)) {
      return c.json({ error: { code: 'ERR_INVALID_PROJECT_NAME', message: `Invalid project name: ${name}. Must match ${PROJECT_NAME_RE}` } }, 400);
    }

    const projDir = path.join(projectsRoot, name);
    if (fs.existsSync(projDir)) {
      return c.json({ error: { code: 'ERR_PROJECT_EXISTS', message: `Project already exists: ${name}` } }, 409);
    }

    // Copy template
    try {
      copyDir(TEMPLATES_DIR, projDir);
    } catch (err) {
      return c.json({ error: { code: 'ERR_COPY_FAILED', message: `Failed to copy template: ${err instanceof Error ? err.message : String(err)}` } }, 500);
    }

    // Replace title and slug in meta.md if provided
    if (body.title || body.slug) {
      const metaPath = path.join(projDir, 'meta.md');
      if (fs.existsSync(metaPath)) {
        let metaContent = fs.readFileSync(metaPath, 'utf-8');
        if (body.title) {
          metaContent = metaContent.replace(/^title:.*$/m, `title: ${body.title}`);
        }
        if (body.slug) {
          metaContent = metaContent.replace(/^(slug:.*)?$/m, ``);
        }
        // Add slug line if specified (after title line or in the frontmatter block)
        if (body.slug) {
          // Insert slug after title line
          const lines = metaContent.split('\n');
          const titleIdx = lines.findIndex(l => l.startsWith('title:'));
          if (titleIdx >= 0) {
            const slugLine = `slug: ${body.slug}`;
            // Check if slug already exists in the frontmatter
            const existingSlugIdx = lines.findIndex(l => l.startsWith('slug:'));
            if (existingSlugIdx >= 0) {
              lines[existingSlugIdx] = slugLine;
            } else {
              lines.splice(titleIdx + 1, 0, slugLine);
            }
          }
          metaContent = lines.join('\n');
        }
        fs.writeFileSync(metaPath, metaContent, 'utf-8');
      }
    }

    const project = getProject(projectsRoot, name);
    return c.json(project, 201);
  });

  // GET /api/projects/:name — project detail
  app.get('/:name', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const project = getProject(projectsRoot, name);
    if (!project) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: `Project not found: ${name}` } }, 404);
    }
    return c.json(project);
  });

  // DELETE /api/projects/:name — delete project (rm -rf)
  app.delete('/:name', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const projDir = path.join(projectsRoot, name);
    if (!fs.existsSync(projDir)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: `Project not found: ${name}` } }, 404);
    }

    try {
      removeDir(projDir);
    } catch (err) {
      return c.json({ error: { code: 'ERR_DELETE_FAILED', message: `Failed to delete project: ${err instanceof Error ? err.message : String(err)}` } }, 500);
    }

    return c.json({ ok: true });
  });

  // POST /api/projects/:name/cache/clear — clear cache/ and build/
  app.post('/:name/cache/clear', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const projDir = path.join(projectsRoot, name);
    if (!fs.existsSync(projDir)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: `Project not found: ${name}` } }, 404);
    }

    removeDir(path.join(projDir, 'cache'));
    removeDir(path.join(projDir, 'build'));

    return c.json({ ok: true });
  });

  // GET /api/projects/:name/meta — read meta.md
  app.get('/:name/meta', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const metaPath = path.join(projectsRoot, name, 'meta.md');
    if (!fs.existsSync(metaPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'meta.md not found' } }, 404);
    }
    const { content, etag } = readFileWithEtag(metaPath);
    c.header('ETag', etag);
    return c.json({ content });
  });

  // PUT /api/projects/:name/meta — save meta.md
  app.put('/:name/meta', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const metaPath = path.join(projectsRoot, name, 'meta.md');
    if (!fs.existsSync(metaPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'meta.md not found' } }, 404);
    }

    const ifMatch = c.req.header('If-Match');
    if (!ifMatch) {
      return c.json({ error: { code: 'ERR_MISSING_IF_MATCH', message: 'If-Match header required' } }, 400);
    }

    const body = await c.req.json<{ content: string }>();
    if (typeof body.content !== 'string') {
      return c.json({ error: { code: 'ERR_INVALID_BODY', message: 'body.content must be a string' } }, 400);
    }

    const result = writeFileWithEtag(metaPath, body.content, ifMatch);
    if ('conflict' in result) {
      return c.json({ currentContent: result.currentContent, currentEtag: result.currentEtag }, 409);
    }

    return c.json({ ok: true, etag: result.etag });
  });

  // GET /api/projects/:name/script — read script.md
  app.get('/:name/script', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const scriptPath = path.join(projectsRoot, name, 'script.md');
    if (!fs.existsSync(scriptPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'script.md not found' } }, 404);
    }
    const { content, etag } = readFileWithEtag(scriptPath);
    c.header('ETag', etag);
    return c.json({ content });
  });

  // PUT /api/projects/:name/script — save script.md
  app.put('/:name/script', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const scriptPath = path.join(projectsRoot, name, 'script.md');
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

    const result = writeFileWithEtag(scriptPath, body.content, ifMatch);
    if ('conflict' in result) {
      return c.json({ currentContent: result.currentContent, currentEtag: result.currentEtag }, 409);
    }

    return c.json({ ok: true, etag: result.etag });
  });

  return app;
}
