import { describe, expect, it } from 'vitest';
import {
  validateRelativeSavePath,
  isAllowedRootUploadBasename,
  maxRootUploadBytes,
} from '../../server/utils/uploadPaths.js';

describe('uploadPaths', () => {
  it('allows Unicode filenames at project root', () => {
    expect(validateRelativeSavePath('最终渲染动画.mp4')).toBe(true);
    expect(isAllowedRootUploadBasename('最终渲染动画.mp4')).toBe(true);
    expect(isAllowedRootUploadBasename('Unity 原生的渲染效果1.jpg')).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(validateRelativeSavePath('../secret.mp4')).toBe(false);
    expect(validateRelativeSavePath('foo/../../etc/passwd')).toBe(false);
    expect(validateRelativeSavePath('/abs.mp4')).toBe(false);
  });

  it('allows mp4 with higher size limit', () => {
    expect(maxRootUploadBytes('clip.mp4')).toBe(500 * 1024 * 1024);
    expect(maxRootUploadBytes('photo.jpg')).toBe(10 * 1024 * 1024);
  });

  it('rejects unsupported extensions', () => {
    expect(isAllowedRootUploadBasename('readme.txt')).toBe(false);
  });
});
