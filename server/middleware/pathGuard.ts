import { createMiddleware } from 'hono/factory';
import path from 'node:path';

const PROJECT_NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const ASSET_FILE_RE = /^[a-zA-Z0-9_.-]+\.(png|jpe?g|gif|webp|svg|wav)$/;

/**
 * Validates :name param as a legal project name.
 * Returns 400 if invalid or path traversal detected.
 */
export function projectGuard(projectsRoot: string) {
  return createMiddleware(async (c, next) => {
    const name = c.req.param('name');
    if (!name || !PROJECT_NAME_RE.test(name)) {
      return c.json({ error: { code: 'ERR_INVALID_PROJECT_NAME', message: `Invalid project name: ${name}` } }, 400);
    }

    const resolved = path.resolve(projectsRoot, name);
    if (!resolved.startsWith(projectsRoot + path.sep) && resolved !== projectsRoot) {
      return c.json({ error: { code: 'ERR_PATH_TRAVERSAL', message: 'Path traversal detected' } }, 400);
    }

    await next();
  });
}

/**
 * Validates :file param as a safe asset filename.
 * Returns 400 if invalid.
 */
export function fileGuard(projectsRoot: string) {
  return createMiddleware(async (c, next) => {
    const file = c.req.param('file');
    if (!file) {
      return c.json({ error: { code: 'ERR_MISSING_FILE', message: 'Missing file parameter' } }, 400);
    }

    if (file.includes('/') || file.includes('..') || file.includes('\\')) {
      return c.json({ error: { code: 'ERR_PATH_TRAVERSAL', message: 'Path traversal detected' } }, 400);
    }

    if (!ASSET_FILE_RE.test(file)) {
      return c.json({ error: { code: 'ERR_INVALID_FILENAME', message: `Invalid filename: ${file}` } }, 400);
    }

    await next();
  });
}

export { PROJECT_NAME_RE, ASSET_FILE_RE };
