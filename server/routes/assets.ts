import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import { projectGuard, fileGuard } from '../middleware/pathGuard.js';
import { readFileWithEtag, writeFileWithEtag, computeEtag } from '../services/projectService.js';
import {
  validateRelativeSavePath,
  isAllowedRootUploadBasename,
  maxRootUploadBytes,
  maxRootUploadLabel,
} from '../utils/uploadPaths.js';

const ASSET_FILE_RE = /^[a-zA-Z0-9_.-]+\.(png|jpe?g|gif|webp|svg)$/;
const WAV_FILE_RE = /^[a-zA-Z0-9_.-]+\.wav$/;
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
};

function getMime(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export function createAssetRoutes(projectsRoot: string) {
  const app = new Hono();

  // GET /api/projects/:name/assets — list top-level asset files
  app.get('/:name/assets', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const assetsDir = path.join(projectsRoot, name, 'assets');
    if (!fs.existsSync(assetsDir)) {
      return c.json([]);
    }
    const entries = fs.readdirSync(assetsDir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && ASSET_FILE_RE.test(e.name))
      .map(e => {
        const stat = fs.statSync(path.join(assetsDir, e.name));
        return {
          name: e.name,
          size: stat.size,
          mime: getMime(e.name),
        };
      });
    return c.json(files);
  });

  // POST /api/projects/:name/assets — upload assets (multipart, field name "file")
  app.post('/:name/assets', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const assetsDir = path.join(projectsRoot, name, 'assets');

    // Ensure assets directory exists
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    try {
      const formData = await c.req.raw.formData();
      const uploaded: { name: string; size: number }[] = [];
      const errors: { name: string; reason: string }[] = [];

      // Collect all file entries
      for (const [fieldName, value] of formData.entries()) {
        if (fieldName !== 'file' || !(value instanceof File)) continue;

        const file = value;

        // Validate file size
        if (file.size > MAX_UPLOAD_SIZE) {
          errors.push({ name: file.name, reason: 'File exceeds 10MB limit' });
          continue;
        }

        // Validate file name
        if (!ASSET_FILE_RE.test(file.name)) {
          errors.push({ name: file.name, reason: 'Invalid file name' });
          continue;
        }

        try {
          const buf = Buffer.from(await file.arrayBuffer());
          fs.writeFileSync(path.join(assetsDir, file.name), buf);
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

  // DELETE /api/projects/:name/assets/:file — delete an asset file
  app.delete('/:name/assets/:file', projectGuard(projectsRoot), fileGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const file = c.req.param('file')!;
    const filePath = path.join(projectsRoot, name, 'assets', file);

    if (!fs.existsSync(filePath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: `File not found: ${file}` } }, 404);
    }

    fs.unlinkSync(filePath);
    return c.json({ ok: true });
  });

  // GET /api/projects/:name/assets/:file — serve file content
  app.get('/:name/assets/:file', projectGuard(projectsRoot), fileGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const file = c.req.param('file')!;
    const filePath = path.join(projectsRoot, name, 'assets', file);

    if (!fs.existsSync(filePath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: `File not found: ${file}` } }, 404);
    }

    const buf = fs.readFileSync(filePath);
    c.header('Content-Type', getMime(file));
    c.header('Content-Length', String(buf.length));
    return c.body(buf as unknown as string);
  });

  // HEAD /api/projects/:name/avatar — check avatar existence (used by frontend checkAvatar)
  app.on('HEAD', '/:name/avatar', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const avatarPath = path.join(projectsRoot, name, 'avatar.mp4');
    if (!fs.existsSync(avatarPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Avatar not found' } }, 404);
    }
    const stat = fs.statSync(avatarPath);
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
      },
    });
  });

  // GET /api/projects/:name/avatar — serve avatar video (supports Range for <video> element)
  app.get('/:name/avatar', projectGuard(projectsRoot), (c) => {
    const name = c.req.param('name')!;
    const avatarPath = path.join(projectsRoot, name, 'avatar.mp4');

    if (!fs.existsSync(avatarPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Avatar not found' } }, 404);
    }

    const stat = fs.statSync(avatarPath);
    const total = stat.size;
    const rangeHeader = c.req.header('Range');

    if (rangeHeader) {
      // Parse "bytes=start-end"
      const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      const start = m?.[1] ? parseInt(m[1], 10) : 0;
      const end = m?.[2] ? parseInt(m[2], 10) : total - 1;
      const chunkSize = end - start + 1;
      const buf = Buffer.alloc(chunkSize);
      const fd = fs.openSync(avatarPath, 'r');
      fs.readSync(fd, buf, 0, chunkSize, start);
      fs.closeSync(fd);
      return new Response(buf, {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
        },
      });
    }

    const buf = fs.readFileSync(avatarPath);
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
      },
    });
  });

  // POST /api/projects/:name/upload-root — upload file to project root dir
  // Accepts optional form field `savePath` (e.g. "generated_images/image1.png")
  // to place the file in a subdirectory under the project root.
  app.post('/:name/upload-root', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const rootDir = path.join(projectsRoot, name);

    try {
      const formData = await c.req.raw.formData();
      const uploaded: { name: string; size: number }[] = [];
      const errors: { name: string; reason: string }[] = [];

      // Optional: caller-specified save path (relative, may include subdirs)
      const savePathEntry = formData.get('savePath');
      const savePath = typeof savePathEntry === 'string' && savePathEntry.trim() ? savePathEntry.trim() : null;

      if (savePath !== null && !validateRelativeSavePath(savePath)) {
        return c.json({ error: { code: 'ERR_INVALID_PATH', message: 'Invalid save path' } }, 400);
      }

      for (const [fieldName, value] of formData.entries()) {
        if (fieldName !== 'file' || !(value instanceof File)) continue;

        const file = value;

        // Determine where to save: use savePath if provided, else flat to root
        const targetRelPath = savePath ?? file.name;
        const baseName = path.basename(targetRelPath);

        const maxBytes = maxRootUploadBytes(baseName);
        if (file.size > maxBytes) {
          errors.push({
            name: file.name,
            reason: `File exceeds ${maxRootUploadLabel(baseName)} limit`,
          });
          continue;
        }

        if (!isAllowedRootUploadBasename(baseName)) {
          errors.push({ name: file.name, reason: 'Invalid file name or unsupported type' });
          continue;
        }

        // Final path traversal guard
        const targetAbsPath = path.resolve(rootDir, targetRelPath);
        if (!targetAbsPath.startsWith(rootDir + path.sep)) {
          errors.push({ name: file.name, reason: 'Path traversal detected' });
          continue;
        }

        try {
          const buf = Buffer.from(await file.arrayBuffer());
          const targetDir = path.dirname(targetAbsPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          fs.writeFileSync(targetAbsPath, buf);
          uploaded.push({ name: targetRelPath, size: file.size });
        } catch {
          errors.push({ name: file.name, reason: 'Failed to write file' });
        }
      }

      return c.json({ uploaded, errors });
    } catch {
      return c.json({ error: { code: 'ERR_UPLOAD_FAILED', message: 'Failed to process upload' } }, 400);
    }
  });

  // POST /api/projects/:name/voice — upload voice reference
  app.post('/:name/voice', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const voiceDir = path.join(projectsRoot, name, 'voice');
    const metaPath = path.join(projectsRoot, name, 'meta.md');

    if (!fs.existsSync(metaPath)) {
      return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'meta.md not found' } }, 404);
    }

    // Check If-Match for meta.md
    const ifMatch = c.req.header('If-Match');
    if (!ifMatch) {
      return c.json({ error: { code: 'ERR_MISSING_IF_MATCH', message: 'If-Match header required' } }, 400);
    }

    try {
      const formData = await c.req.raw.formData();
      const file = formData.get('file');

      if (!(file instanceof File)) {
        return c.json({ error: { code: 'ERR_INVALID_BODY', message: 'Missing file field' } }, 400);
      }

      // Validate file is WAV
      if (!WAV_FILE_RE.test(file.name)) {
        return c.json({ error: { code: 'ERR_INVALID_FILENAME', message: 'Only .wav files are accepted for voice upload' } }, 400);
      }

      // Ensure voice directory exists
      if (!fs.existsSync(voiceDir)) {
        fs.mkdirSync(voiceDir, { recursive: true });
      }

      // Write voice file
      const buf = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(path.join(voiceDir, file.name), buf);

      // Update meta.md voiceRef
      const voiceRef = `./voice/${file.name}`;
      const current = fs.readFileSync(metaPath, 'utf-8');
      const currentEtag = computeEtag(current);

      if (currentEtag !== ifMatch) {
        // Clean up the uploaded file since we can't update meta.md
        try { fs.unlinkSync(path.join(voiceDir, file.name)); } catch { /* ignore */ }
        return c.json({ currentContent: current, currentEtag }, 409);
      }

      // Rewrite meta.md: update or add voiceRef in the meta section
      const lines = current.split('\n');
      let inMeta = false;
      let voiceRefLine = -1;
      let metaEndLine = -1;

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === '--- meta ---') { inMeta = true; continue; }
        if (inMeta && trimmed === '---') { metaEndLine = i; break; }
        if (!inMeta) continue;
        if (trimmed.startsWith('voiceRef')) {
          voiceRefLine = i;
        }
      }

      if (voiceRefLine >= 0) {
        // Replace existing voiceRef
        const indent = lines[voiceRefLine].match(/^(\s*)/)?.[1] ?? '';
        lines[voiceRefLine] = `${indent}voiceRef: ${voiceRef}`;
      } else if (metaEndLine >= 0) {
        // Insert voiceRef before the closing ---
        lines.splice(metaEndLine, 0, `voiceRef: ${voiceRef}`);
      } else {
        // No meta section found — shouldn't happen for valid meta.md
        return c.json({ error: { code: 'ERR_INVALID_META', message: 'Could not find meta section in meta.md' } }, 400);
      }

      const newContent = lines.join('\n');
      fs.writeFileSync(metaPath, newContent, 'utf-8');
      const newEtag = computeEtag(newContent);

      return c.json({
        voiceRef,
        metaContent: newContent,
        metaEtag: newEtag,
      });
    } catch {
      return c.json({ error: { code: 'ERR_UPLOAD_FAILED', message: 'Failed to process voice upload' } }, 400);
    }
  });

  // POST /api/projects/:name/avatar — upload avatar video for lip-sync
  app.post('/:name/avatar', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const projectDir = path.join(projectsRoot, name);
    const metaPath = path.join(projectDir, 'meta.md');

    try {
      const formData = await c.req.raw.formData();
      const fileEntry = formData.get('file');

      if (!fileEntry || !(fileEntry instanceof File)) {
        return c.json({ error: { code: 'ERR_BAD_REQUEST', message: 'No file provided' } }, 400);
      }

      const file = fileEntry;

      if (!file.name.toLowerCase().endsWith('.mp4')) {
        return c.json({ error: { code: 'ERR_INVALID_FILE', message: 'Only .mp4 files are accepted for avatar upload' } }, 400);
      }

      if (file.size > 50 * 1024 * 1024) { // 50MB limit for video
        return c.json({ error: { code: 'ERR_FILE_TOO_LARGE', message: 'Avatar video must be under 50MB' } }, 400);
      }

      // Save as avatar.mp4 in project root
      const targetPath = path.join(projectDir, 'avatar.mp4');
      const buf = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(targetPath, buf);

      // Update meta.md to include avatarRef if not already present
      if (fs.existsSync(metaPath)) {
        let metaContent = fs.readFileSync(metaPath, 'utf-8');
        const avatarRefMatch = metaContent.match(/^avatarRef:\s*.+$/m);
        if (avatarRefMatch) {
          // Update existing avatarRef
          metaContent = metaContent.replace(/^avatarRef:\s*.+$/m, 'avatarRef: ./avatar.mp4');
        } else {
          // Add avatarRef before closing ---
          metaContent = metaContent.replace(
            /^---\s*$/m,
            'avatarRef: ./avatar.mp4\nskipLipsync: false\n---',
          );
        }
        // Ensure default lip-sync when avatar is present (unless user explicitly disabled)
        if (!/^skipLipsync:\s*.+$/m.test(metaContent)) {
          metaContent = metaContent.replace(
            /^avatarRef:\s*.+$/m,
            'avatarRef: ./avatar.mp4\nskipLipsync: false',
          );
        }
        if (!/^avatarRadius:\s*\d+\s*$/m.test(metaContent)) {
          metaContent = metaContent.replace(
            /^avatarRef:\s*.+$/m,
            (line) => `${line}\navatarRadius: 24`,
          );
        }
        fs.writeFileSync(metaPath, metaContent, 'utf-8');
      }

      return c.json({ ok: true, filename: 'avatar.mp4', size: file.size });
    } catch {
      return c.json({ error: { code: 'ERR_UPLOAD_FAILED', message: 'Failed to process avatar upload' } }, 400);
    }
  });

  // DELETE /api/projects/:name/avatar — remove avatar video
  app.delete('/:name/avatar', projectGuard(projectsRoot), async (c) => {
    const name = c.req.param('name')!;
    const projectDir = path.join(projectsRoot, name);
    const avatarPath = path.join(projectDir, 'avatar.mp4');
    const metaPath = path.join(projectDir, 'meta.md');

    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }

    // Remove avatarRef from meta.md
    if (fs.existsSync(metaPath)) {
      let metaContent = fs.readFileSync(metaPath, 'utf-8');
      metaContent = metaContent.replace(/^avatarRef:\s*.+\n?/m, '');
      fs.writeFileSync(metaPath, metaContent, 'utf-8');
    }

    return c.json({ ok: true });
  });

  return app;
}
