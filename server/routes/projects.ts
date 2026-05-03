import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import { projectGuard } from '../middleware/pathGuard.js';
import {
  listProjects,
  getProject,
  readFileWithEtag,
  writeFileWithEtag,
} from '../services/projectService.js';

export function createProjectRoutes(projectsRoot: string) {
  const app = new Hono();

  // GET /api/projects — project list
  app.get('/', (c) => {
    const projects = listProjects(projectsRoot);
    return c.json(projects);
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
