import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// ETag helpers
// ---------------------------------------------------------------------------

export function computeEtag(content: string | Buffer): string {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

// ---------------------------------------------------------------------------
// File read/write with ETag
// ---------------------------------------------------------------------------

export interface FileWithEtag {
  content: string;
  etag: string;
}

export function readFileWithEtag(filePath: string): FileWithEtag {
  const content = fs.readFileSync(filePath, 'utf-8');
  return { content, etag: computeEtag(content) };
}

export interface WriteResult {
  ok: true;
  etag: string;
}

export interface ConflictResult {
  conflict: true;
  currentContent: string;
  currentEtag: string;
}

export function writeFileWithEtag(
  filePath: string,
  newContent: string,
  ifMatch: string,
): WriteResult | ConflictResult {
  const current = fs.readFileSync(filePath, 'utf-8');
  const currentEtag = computeEtag(current);

  if (currentEtag !== ifMatch) {
    return { conflict: true, currentContent: current, currentEtag };
  }

  fs.writeFileSync(filePath, newContent, 'utf-8');
  const newEtag = computeEtag(newContent);
  return { ok: true, etag: newEtag };
}

// ---------------------------------------------------------------------------
// Meta parsing (lightweight, for project listing)
// ---------------------------------------------------------------------------

interface MetaFields {
  title?: string;
  slug?: string;
  aspect?: string;
  fps?: number;
}

function parseMetaFields(content: string): MetaFields {
  const fields: MetaFields = {};
  const lines = content.split('\n');

  let inMeta = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '--- meta ---') { inMeta = true; continue; }
    if (inMeta && trimmed === '---') break;
    if (!inMeta) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.substring(0, colonIdx).trim();
    const value = trimmed.substring(colonIdx + 1).trim();

    switch (key) {
      case 'title': fields.title = value; break;
      case 'slug': fields.slug = value; break;
      case 'aspect': fields.aspect = value; break;
      case 'fps': fields.fps = parseInt(value, 10) || 30; break;
    }
  }
  return fields;
}

function computeSlug(meta: MetaFields, projectName: string): string {
  return meta.slug || projectName;
}

// ---------------------------------------------------------------------------
// Block counting (lightweight, from script.md)
// ---------------------------------------------------------------------------

const BLOCK_HEADER_RE = /^>>>\s+(.+?)\s+#(B\d+)\s*$/;

function countBlocks(scriptContent: string): number {
  let count = 0;
  for (const line of scriptContent.split('\n')) {
    if (BLOCK_HEADER_RE.test(line)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// project.json validation
// ---------------------------------------------------------------------------

interface ProjectJson {
  meta: string;
  blocks: string[];
}

function isNonStandard(pj: ProjectJson): boolean {
  if (pj.meta !== './meta.md' && pj.meta !== 'meta.md') return true;
  if (!Array.isArray(pj.blocks) || pj.blocks.length !== 1) return true;
  const b = pj.blocks[0];
  if (b !== './script.md' && b !== 'script.md') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Project listing
// ---------------------------------------------------------------------------

export interface ProjectSummary {
  name: string;
  title: string;
  blockCount: number;
  latestBuildAt: string | null;
  hasFinal: boolean;
  nonStandard: boolean;
}

export function listProjects(projectsRoot: string): ProjectSummary[] {
  if (!fs.existsSync(projectsRoot)) return [];

  const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  const results: ProjectSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projDir = path.join(projectsRoot, entry.name);
    const pjPath = path.join(projDir, 'project.json');
    if (!fs.existsSync(pjPath)) continue;

    try {
      const pjRaw = fs.readFileSync(pjPath, 'utf-8');
      const pj: ProjectJson = JSON.parse(pjRaw);

      let title = entry.name;
      let blockCount = 0;
      let currentSlug = entry.name;

      // Read meta.md
      const metaPath = path.join(projDir, 'meta.md');
      if (fs.existsSync(metaPath)) {
        const metaContent = fs.readFileSync(metaPath, 'utf-8');
        const meta = parseMetaFields(metaContent);
        if (meta.title) title = meta.title;
        currentSlug = computeSlug(meta, entry.name);
      }

      // Count blocks from script.md
      const scriptPath = path.join(projDir, 'script.md');
      if (fs.existsSync(scriptPath)) {
        const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
        blockCount = countBlocks(scriptContent);
      }

      // Check build status
      const buildDir = path.join(projDir, 'build', currentSlug);
      let latestBuildAt: string | null = null;
      let hasFinal = false;

      if (fs.existsSync(buildDir)) {
        try {
          const stat = fs.statSync(buildDir);
          latestBuildAt = stat.mtime.toISOString();
        } catch { /* ignore */ }

        const finalNorm = path.join(buildDir, 'output', 'final_normalized.mp4');
        const finalPlain = path.join(buildDir, 'output', 'final.mp4');
        hasFinal = fs.existsSync(finalNorm) || fs.existsSync(finalPlain);
      }

      results.push({
        name: entry.name,
        title,
        blockCount,
        latestBuildAt,
        hasFinal,
        nonStandard: isNonStandard(pj),
      });
    } catch {
      // Skip unparseable projects
      continue;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Project detail
// ---------------------------------------------------------------------------

export interface ProjectDetail extends ProjectSummary {
  currentSlug: string;
  metaFields: MetaFields;
}

export function getProject(projectsRoot: string, name: string): ProjectDetail | null {
  const projDir = path.join(projectsRoot, name);
  const pjPath = path.join(projDir, 'project.json');
  if (!fs.existsSync(pjPath)) return null;

  try {
    const pjRaw = fs.readFileSync(pjPath, 'utf-8');
    const pj: ProjectJson = JSON.parse(pjRaw);

    let title = name;
    let blockCount = 0;
    let metaFields: MetaFields = {};

    const metaPath = path.join(projDir, 'meta.md');
    if (fs.existsSync(metaPath)) {
      const metaContent = fs.readFileSync(metaPath, 'utf-8');
      metaFields = parseMetaFields(metaContent);
      if (metaFields.title) title = metaFields.title;
    }

    const currentSlug = computeSlug(metaFields, name);

    const scriptPath = path.join(projDir, 'script.md');
    if (fs.existsSync(scriptPath)) {
      blockCount = countBlocks(fs.readFileSync(scriptPath, 'utf-8'));
    }

    const buildDir = path.join(projDir, 'build', currentSlug);
    let latestBuildAt: string | null = null;
    let hasFinal = false;

    if (fs.existsSync(buildDir)) {
      try { latestBuildAt = fs.statSync(buildDir).mtime.toISOString(); } catch { /* ignore */ }
      hasFinal = fs.existsSync(path.join(buildDir, 'output', 'final_normalized.mp4'))
        || fs.existsSync(path.join(buildDir, 'output', 'final.mp4'));
    }

    return {
      name,
      title,
      blockCount,
      latestBuildAt,
      hasFinal,
      nonStandard: isNonStandard(pj),
      currentSlug,
      metaFields,
    };
  } catch {
    return null;
  }
}

export { parseMetaFields, computeSlug };
