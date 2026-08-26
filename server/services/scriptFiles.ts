import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NotFoundError, ValidationError } from './scriptEditor.js';

// ---------------------------------------------------------------------------
// 布局判定 — 旧版单文件 (script.md) vs 新版拆分双文件 (visuals.md + narration.md)
// ---------------------------------------------------------------------------

export type ScriptLayout =
  | { mode: 'single'; scriptPath: string }
  | { mode: 'split'; visualsPath: string; narrationPath: string };

/**
 * Resolve a project's script file layout from project.json.
 *
 * project.json blocks[0]:
 *   - string                                  → single (旧布局)
 *   - { visual, narration }                   → split (新布局)
 * project.json 缺失时按 script.md 存在与否回退；blocks entry 无法识别时按
 * 旧布局默认 ./script.md 处理（读取阶段再 404）。
 */
export function resolveScriptFiles(projDir: string): ScriptLayout {
  const pjPath = path.join(projDir, 'project.json');
  if (fs.existsSync(pjPath)) {
    try {
      const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8')) as { blocks?: unknown };
      const entry = Array.isArray(pj.blocks) ? pj.blocks[0] : undefined;
      if (typeof entry === 'string') {
        return { mode: 'single', scriptPath: path.join(projDir, entry) };
      }
      if (
        entry && typeof entry === 'object'
        && typeof (entry as any).visual === 'string'
        && typeof (entry as any).narration === 'string'
      ) {
        return {
          mode: 'split',
          visualsPath: path.join(projDir, (entry as any).visual),
          narrationPath: path.join(projDir, (entry as any).narration),
        };
      }
    } catch {
      // project.json unparseable — fall through to default
    }
    return { mode: 'single', scriptPath: path.join(projDir, 'script.md') };
  }

  // 无 project.json：script.md 存在则按旧布局，否则按新布局默认路径（再 404）
  const scriptPath = path.join(projDir, 'script.md');
  if (fs.existsSync(scriptPath)) return { mode: 'single', scriptPath };
  return {
    mode: 'split',
    visualsPath: path.join(projDir, 'visuals.md'),
    narrationPath: path.join(projDir, 'narration.md'),
  };
}

// ---------------------------------------------------------------------------
// Split-mode ETag — 两文件内容的联合 hash（与单文件相同的 sha256: 前缀约定）
// ---------------------------------------------------------------------------

export function computeSplitEtag(visuals: string, narration: string): string {
  const hash = crypto.createHash('sha256').update(visuals + '\0' + narration).digest('hex');
  return `sha256:${hash}`;
}

export interface SplitWithEtag {
  visuals: string;
  narration: string;
  etag: string;
}

export function readSplitWithEtag(visualsPath: string, narrationPath: string): SplitWithEtag {
  const visuals = fs.readFileSync(visualsPath, 'utf-8');
  const narration = fs.readFileSync(narrationPath, 'utf-8');
  return { visuals, narration, etag: computeSplitEtag(visuals, narration) };
}

/**
 * ETag 校验通过后一次性落盘两个文件（调用方需在此之前完成全部解析校验）。
 *
 * @returns 新 etag；null 表示 If-Match 冲突（未写盘）
 */
export function writeSplitWithEtag(
  visualsPath: string,
  narrationPath: string,
  visuals: string,
  narration: string,
  ifMatch: string,
): { etag: string } | null {
  const current = readSplitWithEtag(visualsPath, narrationPath);
  if (current.etag !== ifMatch) return null;

  fs.writeFileSync(visualsPath, visuals, 'utf-8');
  fs.writeFileSync(narrationPath, narration, 'utf-8');
  return { etag: computeSplitEtag(visuals, narration) };
}

// ---------------------------------------------------------------------------
// 合并块文本 ⇄ 拆分双文件块文本
// ---------------------------------------------------------------------------

const BLOCK_HEADER = /^>>>\s+(?<title>.+?)\s+#(?<id>B\d+)\s*$/;
// narration.md 块头标题可省（">>> #B01" 也合法）
const NARRATION_BLOCK_HEADER = /^>>>\s+(?:(?<title>.+?)\s+)?#(?<id>B\d+)\s*$/;
const VISUAL_MARK = /^---\s+visual\s+---\s*$/;
const NARRATION_MARK = /^---\s+narration\s+---\s*$/;

export interface SplitBlock {
  /** 块头 + 指令行 + 视觉描述正文（无 section 标记） */
  visualsBlock: string;
  /** 块头 + 旁白行 */
  narrationBlock: string;
}

/**
 * 把旧的合并块文本（含 --- visual --- / --- narration --- 标记）拆成
 * visuals.md / narration.md 各自的块文本。纯解析，不写盘。
 *
 * @throws ValidationError 块头非法或缺少任一 section 标记
 */
export function splitMergedBlock(content: string): SplitBlock {
  const lines = content.split('\n');
  if (!BLOCK_HEADER.exec(lines[0] ?? '')) {
    throw new ValidationError('block header missing or invalid');
  }

  const visIdx = lines.findIndex((l) => VISUAL_MARK.test(l));
  const narrIdx = lines.findIndex((l) => NARRATION_MARK.test(l));
  if (visIdx < 0 || narrIdx < 0 || narrIdx < visIdx) {
    throw new ValidationError('block must contain --- visual --- and --- narration --- sections');
  }

  const visualsLines = [...lines.slice(0, visIdx), ...lines.slice(visIdx + 1, narrIdx)];
  const narrationLines = [lines[0], ...lines.slice(narrIdx + 1)];
  return { visualsBlock: visualsLines.join('\n'), narrationBlock: narrationLines.join('\n') };
}

/**
 * 反向组合：visuals 块 + narration 块 → 合并块文本。
 * 视觉描述从块体内首个非空非 @ 行起；narration 块头忽略（以 visuals 块头为准）。
 */
export function mergeSplitBlocks(visualsBlock: string, narrationBlock: string): string {
  const vLines = visualsBlock.split('\n');
  let descStart = -1;
  for (let i = 1; i < vLines.length; i++) {
    if (vLines[i].trim() !== '' && !vLines[i].startsWith('@')) {
      descStart = i;
      break;
    }
  }
  const headLines = descStart < 0 ? vLines : vLines.slice(0, descStart);
  const descLines = descStart < 0 ? [] : vLines.slice(descStart);
  const nBody = narrationBlock.split('\n').slice(1);
  return [...headLines, '--- visual ---', ...descLines, '--- narration ---', ...nBody].join('\n');
}

/**
 * 整文件拆分（脚手架用）：script.md → { visuals, narration }。
 * 首个块头之前的内容（preamble）保留在 visuals 顶部。
 */
export function splitScriptFile(scriptMd: string): { visuals: string; narration: string } {
  const lines = scriptMd.split('\n');
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (BLOCK_HEADER.test(l)) starts.push(i);
  });

  if (starts.length === 0) {
    return { visuals: scriptMd, narration: '' };
  }

  const visualsParts: string[] = [];
  const narrationParts: string[] = [];
  if (starts[0] > 0) visualsParts.push(lines.slice(0, starts[0]).join('\n'));

  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const chunk = lines.slice(starts[k], end).join('\n');
    const { visualsBlock, narrationBlock } = splitMergedBlock(chunk);
    visualsParts.push(visualsBlock);
    narrationParts.push(narrationBlock);
  }

  return { visuals: visualsParts.join('\n'), narration: narrationParts.join('\n') };
}

// ---------------------------------------------------------------------------
// narration.md 块查找/替换（块头标题可省，结构同 scriptEditor）
// ---------------------------------------------------------------------------

/**
 * Extract a single block's content from narration.md（标题可省的宽松块头）。
 *
 * @throws NotFoundError if the block is not found
 */
export function extractNarrationBlock(narrationMd: string, id: string): string {
  const lines = narrationMd.split('\n');
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const m = NARRATION_BLOCK_HEADER.exec(lines[i]);
    if (m && m.groups!.id === id) {
      start = i;
      break;
    }
  }

  if (start < 0) {
    throw new NotFoundError(`block ${id} not found`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (NARRATION_BLOCK_HEADER.test(lines[i])) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join('\n');
}

/**
 * Replace a single block in narration.md（标题可省的宽松块头）。
 *
 * @throws NotFoundError if the block is not found
 * @throws ValidationError if newContent 的块头 ID 与 id 不一致
 */
export function replaceNarrationBlock(narrationMd: string, id: string, newContent: string): string {
  const lines = narrationMd.split('\n');
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const m = NARRATION_BLOCK_HEADER.exec(lines[i]);
    if (m && m.groups!.id === id) {
      start = i;
      break;
    }
  }

  if (start < 0) {
    throw new NotFoundError(`block ${id} not found`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (NARRATION_BLOCK_HEADER.test(lines[i])) {
      end = i;
      break;
    }
  }

  const newLines = newContent.split('\n');
  const head = NARRATION_BLOCK_HEADER.exec(newLines[0]);
  if (!head || head.groups!.id !== id) {
    throw new ValidationError('block header id mismatch');
  }

  return [...lines.slice(0, start), ...newLines, ...lines.slice(end)].join('\n');
}

// ---------------------------------------------------------------------------
// 块正文提取（cache 匹配用）
// ---------------------------------------------------------------------------

/** visuals.md 块正文：块体内首个非空非 @ 行起全是视觉描述 */
export function visualDescFromBlock(visualsBlock: string): string {
  const lines = visualsBlock.split('\n');
  let start = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && !lines[i].startsWith('@')) {
      start = i;
      break;
    }
  }
  return start < 0 ? '' : lines.slice(start).join('\n').trim();
}

/** narration.md 块正文：块头之后所有行（每个非空行一条旁白，** 高亮不变） */
export function narrationTextFromBlock(narrationBlock: string): string {
  return narrationBlock.split('\n').slice(1).join('\n').trim();
}
