import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProjectRoutes } from './routes/projects.js';
import { createBlockRoutes } from './routes/blocks.js';
import { createAssetRoutes } from './routes/assets.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createOutputRoutes } from './routes/output.js';
import { createSystemRoutes } from './routes/system.js';
import { TaskQueue } from './services/taskQueue.js';
import { createTaskRunner } from './services/taskRunner.js';

const app = new Hono();

const isDev = process.env.NODE_ENV !== 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In compiled output: dist/server/server/ → go up 3 to repo root
// In source (tsx): server/ → go up 1 to repo root
const DIST_SEGMENTS = path.join('dist', 'server', 'server');
const repoRoot = __dirname.endsWith(DIST_SEGMENTS)
  ? path.resolve(__dirname, '../../..')
  : path.resolve(__dirname, '..');
const projectsRoot = process.env.PROJECTS_ROOT || path.join(repoRoot, 'project');

// --- Task queue (shared singleton) ---

export const taskQueue = new TaskQueue(projectsRoot, repoRoot);

// Register the real task runner (WP3.3)
taskQueue.onRun(createTaskRunner(projectsRoot, repoRoot));

// --- API routes ---

app.get('/api/health', (c) => {
  return c.json({ ok: true, version: '0.1.0', projectsRoot });
});

app.route('/api/projects', createProjectRoutes(projectsRoot));
app.route('/api/projects', createBlockRoutes(projectsRoot));
app.route('/api/projects', createAssetRoutes(projectsRoot));

// Upload file to project root (for missing assets dialog)
app.post('/api/projects/:name/upload-root', async (c) => {
  const name = c.req.param('name');
  if (!name || !/^[a-zA-Z0-9_-]{1,40}$/.test(name)) {
    return c.json({ error: { code: 'ERR_INVALID_PROJECT_NAME', message: `Invalid project name: ${name}` } }, 400);
  }
  const rootDir = path.join(projectsRoot, name);
  const ROOT_FILE_RE = /^[a-zA-Z0-9_.-]+\.(png|jpe?g|gif|webp|svg|wav)$/;
  const MAX_SIZE = 10 * 1024 * 1024;

  try {
    const formData = await c.req.raw.formData();
    const uploaded: { name: string; size: number }[] = [];
    const errors: { name: string; reason: string }[] = [];

    for (const [fieldName, value] of formData.entries()) {
      if (fieldName !== 'file' || !(value instanceof File)) continue;
      const file = value;
      if (file.size > MAX_SIZE) {
        errors.push({ name: file.name, reason: 'File exceeds 10MB limit' });
        continue;
      }
      if (!ROOT_FILE_RE.test(file.name)) {
        errors.push({ name: file.name, reason: 'Invalid file name' });
        continue;
      }
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(path.join(rootDir, file.name), buf);
        uploaded.push({ name: file.name, size: file.size });
      } catch {
        errors.push({ name: file.name, reason: 'Failed to write file' });
      }
    }

    return c.json({ uploaded, errors });
  } catch {
    return c.json({ error: { code: 'ERR_UPLOAD_FAILED', message: 'Failed to process upload' } }, 400);
  }
});
app.route('/api/projects', createOutputRoutes(projectsRoot));
app.route('/api/tasks', createTaskRoutes(taskQueue));
app.route('/', createSystemRoutes(repoRoot));

// --- Static / SPA fallback ---

if (isDev) {
  // Dev mode: proxy non-API requests to Vite dev server
  const VITE_ORIGIN = 'http://localhost:5173';
  app.all('*', async (c) => {
    const url = new URL(c.req.url);
    const target = `${VITE_ORIGIN}${url.pathname}${url.search}`;
    try {
      const headers = new Headers(c.req.raw.headers);
      headers.delete('host');
      const resp = await fetch(target, {
        method: c.req.method,
        headers,
        body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
        // @ts-expect-error duplex needed for streaming request bodies
        duplex: 'half',
      });
      return new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      });
    } catch {
      return c.text('Vite dev server not running', 502);
    }
  });
} else {
  // Production: serve static files from web/dist/
  const webDistPath = path.join(repoRoot, 'web', 'dist');
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), webDistPath) }));

  // SPA fallback: any non-API GET that didn't match a static file → index.html
  app.get('*', async (c) => {
    const indexPath = path.join(webDistPath, 'index.html');
    try {
      const html = fs.readFileSync(indexPath, 'utf-8');
      return c.html(html);
    } catch {
      return c.text('index.html not found', 404);
    }
  });
}

// --- Startup checks ---

// Warn if .autovideo-web/ is not in .gitignore
const gitignorePath = path.join(repoRoot, '.gitignore');
try {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
  if (!gitignoreContent.split('\n').some((line) => line.trim() === '.autovideo-web/')) {
    console.warn('[WARN] .autovideo-web/ is not listed in .gitignore. This directory contains runtime data and should not be committed to version control.');
  }
} catch {
  // .gitignore not found — not an error, just skip the check
}

// --- Start server ---

const port = parseInt(process.env.PORT || '3030', 10);
const host = process.env.HOST || '127.0.0.1';

console.log(`AutoVideo Web server starting on http://${host}:${port} (${isDev ? 'dev' : 'production'})`);

const server = serve({ fetch: app.fetch, port, hostname: host });

// --- Process-level error handlers (prevent crash on uncaught errors) ---

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message);
  console.error(err.stack);
  // Log but do NOT exit — keep the server running for other tasks
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  // Log but do NOT exit — keep the server running for other tasks
});

// --- Graceful shutdown on SIGINT / SIGTERM ---

let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return; // Prevent duplicate shutdown
  shuttingDown = true;

  console.log(`\n[server] Received ${signal}, shutting down gracefully...`);

  // Stop accepting new HTTP connections
  server.close();

  // Gracefully stop the task queue: reject new tasks, abort current, wait, cleanup
  await taskQueue.shutdown();

  console.log('[server] Goodbye.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
