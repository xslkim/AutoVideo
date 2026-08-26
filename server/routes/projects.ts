import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import { projectGuard, PROJECT_NAME_RE } from '../middleware/pathGuard.js';
import { slugify } from '../../src/utils/slugify.js';
import {
  listProjects,
  getProject,
  readFileWithEtag,
  writeFileWithEtag,
} from '../services/projectService.js';
import {
  resolveScriptFiles,
  readSplitWithEtag,
  writeSplitWithEtag,
  splitScriptFile,
} from '../services/scriptFiles.js';

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

    // Copy default voice reference (B00.wav) from repo root into the project,
    // along with its same-named .txt transcript — CosyVoice zero-shot cloning
    // requires it (see resolveCosyVoicePromptText in src/tts/provider.ts).
    const defaultVoicePath = path.resolve('B00.wav');
    if (fs.existsSync(defaultVoicePath)) {
      fs.copyFileSync(defaultVoicePath, path.join(projDir, 'B00.wav'));
      const defaultVoiceTxtPath = path.resolve('B00.txt');
      if (fs.existsSync(defaultVoiceTxtPath)) {
        fs.copyFileSync(defaultVoiceTxtPath, path.join(projDir, 'B00.txt'));
      }
    }

    // Always write an explicit lowercase slug into meta.md. The CLI derives
    // its build directory from slugify(title), the Web UI from slug || project
    // name — an explicit slug keeps both on the same build/<slug>/ directory.
    const metaPath = path.join(projDir, 'meta.md');
    if (fs.existsSync(metaPath)) {
      let metaContent = fs.readFileSync(metaPath, 'utf-8');
      if (body.title) {
        metaContent = metaContent.replace(/^title:.*$/m, `title: ${body.title}`);
      }
      const slug = slugify(String(body.slug || body.title || name));
      const lines = metaContent.split('\n');
      const slugIdx = lines.findIndex((l) => l.startsWith('slug:'));
      if (slugIdx >= 0) {
        lines[slugIdx] = `slug: ${slug}`;
      } else {
        const titleIdx = lines.findIndex((l) => l.startsWith('title:'));
        if (titleIdx >= 0) {
          lines.splice(titleIdx + 1, 0, `slug: ${slug}`);
        }
      }
      metaContent = lines.join('\n');
      fs.writeFileSync(metaPath, metaContent, 'utf-8');
    }

    // 新布局脚手架：把模板 script.md 拆成 visuals.md + narration.md（视觉描述
    // 进 visuals.md、旁白进 narration.md），project.json 改用对象 entry。
    const scaffoldScriptPath = path.join(projDir, 'script.md');
    if (fs.existsSync(scaffoldScriptPath)) {
      const scriptMd = fs.readFileSync(scaffoldScriptPath, 'utf-8');
      const { visuals, narration } = splitScriptFile(scriptMd);
      fs.writeFileSync(path.join(projDir, 'visuals.md'), visuals, 'utf-8');
      fs.writeFileSync(path.join(projDir, 'narration.md'), narration, 'utf-8');
      fs.rmSync(scaffoldScriptPath);
      fs.writeFileSync(
        path.join(projDir, 'project.json'),
        JSON.stringify(
          { meta: './meta.md', blocks: [{ visual: './visuals.md', narration: './narration.md' }] },
          null,
          2,
        ) + '\n',
        'utf-8',
      );
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

  // POST /api/projects/:name/cache/clear — clear build/（缓存为全局共享目录，
  // 不按项目清除；projDir/cache 为已废弃的历史结构，存在则一并删除）
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

  // GET /api/projects/:name/script — read script (single: script.md; split: visuals.md + narration.md)
  app.get('/:name/script', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const projDir = path.join(projectsRoot, name);
    const layout = resolveScriptFiles(projDir);

    if (layout.mode === 'single') {
      if (!fs.existsSync(layout.scriptPath)) {
        return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'script.md not found' } }, 404);
      }
      const { content, etag } = readFileWithEtag(layout.scriptPath);
      c.header('ETag', etag);
      return c.json({ mode: 'single', content });
    }

    if (!fs.existsSync(layout.visualsPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'visuals.md not found' } }, 404);
    }
    if (!fs.existsSync(layout.narrationPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'narration.md not found' } }, 404);
    }
    const { visuals, narration, etag } = readSplitWithEtag(layout.visualsPath, layout.narrationPath);
    c.header('ETag', etag);
    return c.json({ mode: 'split', visuals, narration });
  });

  // PUT /api/projects/:name/script — save script (single: { content }; split: { visuals, narration })
  app.put('/:name/script', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const projDir = path.join(projectsRoot, name);
    const layout = resolveScriptFiles(projDir);

    if (layout.mode === 'single') {
      if (!fs.existsSync(layout.scriptPath)) {
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

      const result = writeFileWithEtag(layout.scriptPath, body.content, ifMatch);
      if ('conflict' in result) {
        return c.json({ currentContent: result.currentContent, currentEtag: result.currentEtag }, 409);
      }

      return c.json({ ok: true, etag: result.etag });
    }

    // --- split layout ---
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

    const body = await c.req.json<{ visuals: string; narration: string }>();
    if (typeof body.visuals !== 'string' || typeof body.narration !== 'string') {
      return c.json({ error: { code: 'ERR_INVALID_BODY', message: 'body.visuals and body.narration must be strings' } }, 400);
    }

    // 先校验完再落盘两个文件
    const result = writeSplitWithEtag(
      layout.visualsPath,
      layout.narrationPath,
      body.visuals,
      body.narration,
      ifMatch,
    );
    if (!result) {
      const fresh = readSplitWithEtag(layout.visualsPath, layout.narrationPath);
      return c.json(
        { currentVisuals: fresh.visuals, currentNarration: fresh.narration, currentEtag: fresh.etag },
        409,
      );
    }

    return c.json({ ok: true, etag: result.etag });
  });

  return app;
}
