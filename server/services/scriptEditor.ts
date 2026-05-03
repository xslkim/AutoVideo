// ---------------------------------------------------------------------------
// Regexes — B.1 (shared with client)
// ---------------------------------------------------------------------------

const BLOCK_HEADER = /^>>>\s+(?<title>.+?)\s+#(?<id>B\d+)\s*$/;

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class NotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'ERR_BLOCK_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  readonly statusCode = 422;
  readonly code = 'ERR_BLOCK_ID_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ---------------------------------------------------------------------------
// extractBlock — B.2 伪代码
// ---------------------------------------------------------------------------

export interface ExtractResult {
  content: string;
  /** [startLine, endLine) — 0-based line indices into script.md split on '\n' */
  range: [number, number];
}

/**
 * Extract a single block's content from script.md.
 *
 * @param scriptMd  Full content of script.md
 * @param id        Block ID to locate (e.g. 'B01')
 * @returns         Block content (lines joined with '\n') and its [start, end) line range
 * @throws          NotFoundError if the block is not found
 */
export function extractBlock(scriptMd: string, id: string): ExtractResult {
  const lines = scriptMd.split('\n');
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const m = BLOCK_HEADER.exec(lines[i]);
    if (m && m.groups!.id === id) {
      start = i;
      break;
    }
  }

  if (start < 0) {
    throw new NotFoundError(`block ${id} not found`);
  }

  let end = lines.length; // default: to end of file
  for (let i = start + 1; i < lines.length; i++) {
    if (BLOCK_HEADER.test(lines[i])) {
      end = i;
      break;
    }
  }

  return { content: lines.slice(start, end).join('\n'), range: [start, end] };
}

// ---------------------------------------------------------------------------
// replaceBlock — B.2 伪代码
// ---------------------------------------------------------------------------

/**
 * Replace a single block in script.md with new content.
 *
 * @param scriptMd    Full content of script.md
 * @param id          Block ID to replace (e.g. 'B01')
 * @param newContent  New block content (must start with a valid block header with the same ID)
 * @returns           New full script.md content
 * @throws            NotFoundError if the block is not found
 * @throws            ValidationError if the first line of newContent changes the block ID
 */
export function replaceBlock(scriptMd: string, id: string, newContent: string): string {
  const { range } = extractBlock(scriptMd, id);
  const newLines = newContent.split('\n');

  // Validate that the first line still has the same block ID
  const head = BLOCK_HEADER.exec(newLines[0]);
  if (!head || head.groups!.id !== id) {
    throw new ValidationError('block header id mismatch');
  }

  const lines = scriptMd.split('\n');
  return [...lines.slice(0, range[0]), ...newLines, ...lines.slice(range[1])].join('\n');
}
