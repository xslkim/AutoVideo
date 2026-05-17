import fs from 'node:fs';
import path from 'node:path';
import type { BlockStatus, VisualMode } from '../types/api.js';

// ---------------------------------------------------------------------------
// Regexes — B.1 (shared with client)
// ---------------------------------------------------------------------------

const BLOCK_HEADER = /^>>>\s+(?<title>.+?)\s+#(?<id>B\d+)\s*$/;
const DIRECTIVE = /^@(?<key>enter|exit|duration|visual):\s*(?<value>.*)$/;

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export interface ParseWarning {
  line: number;
  message: string;
}

// ---------------------------------------------------------------------------
// script.json lightweight types (only the fields we read)
// ---------------------------------------------------------------------------

interface ScriptJsonBlock {
  id: string;
  visualMode?: string;
  audio?: { wavPath?: string };
  visual?: { componentPath?: string; imagePath?: string };
  render?: { partialPath?: string };
}

interface ScriptJson {
  blocks?: ScriptJsonBlock[];
}

// ---------------------------------------------------------------------------
// parseScript
// ---------------------------------------------------------------------------

export interface ParseResult {
  blocks: BlockStatus[];
  warnings: ParseWarning[];
}

/**
 * Parse script.md and determine block statuses.
 *
 * @param scriptMd   Full content of script.md
 * @param buildDir   Absolute path to build/{currentSlug}/ (may not exist)
 */
export function parseScript(scriptMd: string, buildDir: string): ParseResult {
  const lines = scriptMd.split('\n');
  const warnings: ParseWarning[] = [];

  // -----------------------------------------------------------------------
  // Load script.json if available
  // -----------------------------------------------------------------------
  const scriptJsonPath = path.join(buildDir, 'script.json');
  let jsonBlocks: Map<string, ScriptJsonBlock> = new Map();

  if (fs.existsSync(scriptJsonPath)) {
    try {
      const raw: ScriptJson = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'));
      if (Array.isArray(raw.blocks)) {
        for (const b of raw.blocks) {
          if (typeof b.id === 'string') jsonBlocks.set(b.id, b);
        }
      }
    } catch {
      // script.json is unreadable — treat as absent
    }
  }

  // -----------------------------------------------------------------------
  // First pass: collect block header positions and their @visual directives
  // -----------------------------------------------------------------------

  interface RawBlock {
    id: string;
    title: string;
    line: number; // 1-based
    visualMode: VisualMode;
    imageSource?: string;
    videoSource?: string;
    enter: string;
    exit: string;
  }

  const rawBlocks: RawBlock[] = [];
  const seenIds = new Map<string, number>(); // id → first line (1-based)

  let currentBlock: RawBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1; // 1-based
    const line = lines[i];

    const headerMatch = BLOCK_HEADER.exec(line);
    if (headerMatch) {
      // Finish previous block
      if (currentBlock) rawBlocks.push(currentBlock);

      const id = headerMatch.groups!.id;
      const title = headerMatch.groups!.title;

      if (seenIds.has(id)) {
        warnings.push({ line: lineNum, message: `重复的块 ID: ${id}（首次出现在第 ${seenIds.get(id)} 行）` });
      } else {
        seenIds.set(id, lineNum);
      }

      currentBlock = { id, title, line: lineNum, visualMode: 'animation', enter: 'fade', exit: 'fade' };
      continue;
    }

    if (currentBlock) {
      const directiveMatch = DIRECTIVE.exec(line);
      if (directiveMatch) {
        const key = directiveMatch.groups!.key;
        const value = directiveMatch.groups!.value.trim();
        if (key === 'visual') {
          const imgMatch = value.match(/^image\((.+?)\)$/);
          if (imgMatch) {
            currentBlock.visualMode = 'image';
            currentBlock.imageSource = imgMatch[1].trim();
          } else {
            const vidMatch = value.match(/^video\((.+?)\)$/);
            if (vidMatch) {
              currentBlock.visualMode = 'video';
              currentBlock.videoSource = vidMatch[1].trim();
            } else if (value === 'animation' || value === 'image' || value === 'video') {
              currentBlock.visualMode = value as VisualMode;
            } else {
              warnings.push({
                line: lineNum,
                message: `@visual 值非法: "${value}"，将降级为 animation`,
              });
              currentBlock.visualMode = 'animation';
            }
          }
        } else if (key === 'enter') {
          currentBlock.enter = value;
        } else if (key === 'exit') {
          currentBlock.exit = value;
        }
      }
    }
  }

  // Push the last block
  if (currentBlock) rawBlocks.push(currentBlock);

  // -----------------------------------------------------------------------
  // Second pass: determine block statuses using script.json + disk checks
  // -----------------------------------------------------------------------

  const blocks: BlockStatus[] = rawBlocks.map((rb) => {
    const jb = jsonBlocks.get(rb.id);

    // ------ audio ------
    let audio = false;
    if (jb?.audio?.wavPath) {
      const absWavPath = path.join(buildDir, jb.audio.wavPath);
      audio = fs.existsSync(absWavPath);
    }

    // ------ visual ------
    let visual = false;
    // visualMode from @visual directive takes precedence over script.json field
    const visualMode = rb.visualMode;

    if (visualMode === 'image') {
      if (jb?.visual?.imagePath) {
        const absImagePath = path.join(buildDir, jb.visual.imagePath);
        visual = fs.existsSync(absImagePath);
      }
    } else if (visualMode === 'video') {
      // video mode: check componentPath (wrapper always generated by compile)
      if (jb?.visual?.componentPath) {
        const absComponentPath = path.join(buildDir, jb.visual.componentPath);
        visual = fs.existsSync(absComponentPath);
      }
    } else {
      // animation mode
      if (jb?.visual?.componentPath) {
        const absComponentPath = path.join(buildDir, jb.visual.componentPath);
        visual = fs.existsSync(absComponentPath);
      }
    }

    // ------ rendered ------
    let rendered = false;
    if (jb?.render?.partialPath) {
      const absPartialPath = path.join(buildDir, jb.render.partialPath);
      rendered = fs.existsSync(absPartialPath);
    } else {
      // Fallback: disk probe at canonical path
      const fallbackPath = path.join(buildDir, 'output', 'partials', `${rb.id}.mp4`);
      rendered = fs.existsSync(fallbackPath);
    }

    return {
      id: rb.id,
      title: rb.title,
      line: rb.line,
      visualMode,
      ...(rb.imageSource !== undefined ? { imageSource: rb.imageSource } : {}),
      ...(rb.videoSource !== undefined ? { videoSource: rb.videoSource } : {}),
      enter: rb.enter,
      exit: rb.exit,
      audio,
      visual,
      rendered,
    };
  });

  return { blocks, warnings };
}
