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
import { TaskQueue } from './services/taskQueue.js';
import { createTaskRunner } from './services/taskRunner.js';
import { FrameRenderer } from './services/frameRenderer.js';

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

const frameRenderer = new FrameRenderer(projectsRoot, repoRoot);

// --- API routes ---

app.get('/api/health', (c) => {
  return c.json({ ok: true, version: '0.1.0', projectsRoot });
});

app.route('/api/projects', createProjectRoutes(projectsRoot));
app.route('/api/projects', createBlockRoutes(projectsRoot, frameRenderer));
app.route('/api/projects', createAssetRoutes(projectsRoot));
app.route('/api/projects', createOutputRoutes(projectsRoot));
app.route('/api/tasks', createTaskRoutes(taskQueue));

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

// --- Start server ---

const port = parseInt(process.env.PORT || '3030', 10);
const host = process.env.HOST || '127.0.0.1';

console.log(`AutoVideo Web server starting on http://${host}:${port} (${isDev ? 'dev' : 'production'})`);

serve({ fetch: app.fetch, port, hostname: host });
