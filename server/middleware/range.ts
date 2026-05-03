import type { Context } from 'hono';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Parse a Range header value like "bytes=0-1023" or "bytes=500-".
 * Returns { start, end } or null if the range is invalid.
 */
function parseRange(header: string, fileSize: number): { start: number; end: number } | null {
  const match = header.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);

  let end: number;
  if (match[2] === '') {
    // Open-ended range: bytes=N- → rest of file
    end = fileSize - 1;
  } else {
    end = parseInt(match[2], 10);
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < 0 ||
    start > end ||
    start >= fileSize
  ) {
    return null;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

/**
 * Serve a file with HTTP Range support.
 *
 * - No Range header → 200 + full file
 * - Valid Range: bytes=start-end → 206 + Content-Range + byte slice
 * - Invalid Range → 200 + full file (graceful fallback)
 * - File not found → 404
 */
export function serveFileWithRange(
  c: Context,
  filePath: string,
  contentType: string,
  downloadName?: string,
): Response {
  // Resolve and stat the file
  const resolvedPath = path.resolve(filePath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  if (!stat.isFile()) {
    return new Response('Not Found', { status: 404 });
  }

  const fileSize = stat.size;
  const rangeHeader = c.req.header('Range');

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Accept-Ranges', 'bytes');

  if (downloadName) {
    headers.set('Content-Disposition', `attachment; filename="${downloadName}"`);
  }

  // No Range header — return full file
  if (!rangeHeader) {
    headers.set('Content-Length', String(fileSize));
    const body = fs.readFileSync(resolvedPath);
    return new Response(body, { status: 200, headers });
  }

  // Parse Range header
  const range = parseRange(rangeHeader, fileSize);
  if (!range) {
    // Invalid range — fall back to full file
    headers.set('Content-Length', String(fileSize));
    const body = fs.readFileSync(resolvedPath);
    return new Response(body, { status: 200, headers });
  }

  const { start, end } = range;
  const length = end - start + 1;

  headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  headers.set('Content-Length', String(length));

  // Read only the requested byte range
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(resolvedPath, 'r');
  try {
    fs.readSync(fd, buf, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  return new Response(buf, { status: 206, headers });
}
