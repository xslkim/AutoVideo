import path from 'node:path';

/** Allowed extensions for files uploaded to project root (compile missing-asset dialog). */
export const ROOT_UPLOAD_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'wav',
  'mp4',
]);

const FORBIDDEN_SEGMENT_CHARS = /[\0\\]/;

/** Reject traversal / empty segments; allow Unicode filenames (incl. Chinese) and spaces. */
export function isSafeRelativePathSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..') return false;
  if (FORBIDDEN_SEGMENT_CHARS.test(segment)) return false;
  return !segment.includes('/');
}

/** Validate a relative save path (may include subdirs), e.g. `最终渲染动画.mp4`. */
export function validateRelativeSavePath(savePath: string): boolean {
  if (!savePath || savePath.startsWith('/') || savePath.startsWith('\\')) return false;
  const normalized = savePath.replace(/\\/g, '/');
  if (normalized.includes('..')) return false;
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 && parts.every(isSafeRelativePathSegment);
}

export function isAllowedRootUploadBasename(baseName: string): boolean {
  if (!isSafeRelativePathSegment(baseName)) return false;
  const ext = path.extname(baseName).slice(1).toLowerCase();
  return ROOT_UPLOAD_EXTENSIONS.has(ext);
}

export function maxRootUploadBytes(baseName: string): number {
  const ext = path.extname(baseName).slice(1).toLowerCase();
  if (ext === 'mp4') return 500 * 1024 * 1024; // 500MB for block videos
  return 10 * 1024 * 1024; // 10MB for images / wav
}

export function maxRootUploadLabel(baseName: string): string {
  const ext = path.extname(baseName).slice(1).toLowerCase();
  return ext === 'mp4' ? '500MB' : '10MB';
}
