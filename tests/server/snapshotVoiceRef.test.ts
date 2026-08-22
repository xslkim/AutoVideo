/**
 * snapshotSourceFiles: voiceRef sidecar transcript must travel with the wav.
 * CosyVoice zero-shot registration resolves the transcript as a same-named
 * .txt next to the (snapshotted) voiceRef — without this copy the tts stage
 * fails with "Failed to register voice" on web builds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { snapshotSourceFiles } from '../../server/services/taskRunner';

let tmp: string;
let projectDir: string;
let outDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-snapshot-'));
  projectDir = path.join(tmp, 'proj');
  outDir = path.join(tmp, 'out');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'meta.md'),
    '--- meta ---\ntitle: T\nvoiceRef: ./voice/B00.wav\n---\n',
  );
  fs.writeFileSync(path.join(projectDir, 'script.md'), '>>> t #B01\n\n--- visual ---\nx\n\n--- narration ---\ny\n');
  fs.mkdirSync(path.join(projectDir, 'voice'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'voice', 'B00.wav'), 'fake-wav');
  fs.writeFileSync(path.join(projectDir, 'voice', 'B00.txt'), '参考音转写文本');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('snapshotSourceFiles voice sidecar', () => {
  it('copies the same-named .txt transcript next to the snapshotted voice wav', () => {
    snapshotSourceFiles(projectDir, outDir);
    const voiceDir = path.join(outDir, '_snapshot', 'voice');
    expect(fs.readFileSync(path.join(voiceDir, 'B00.wav'), 'utf-8')).toBe('fake-wav');
    expect(fs.readFileSync(path.join(voiceDir, 'B00.txt'), 'utf-8')).toBe('参考音转写文本');
    // snapshot meta.md points voiceRef at the local copy
    const meta = fs.readFileSync(path.join(outDir, '_snapshot', 'meta.md'), 'utf-8');
    expect(meta).toContain('voiceRef: ./voice/B00.wav');
  });

  it('refreshes the .txt even when the wav was already snapshotted (older builds)', () => {
    const voiceDir = path.join(outDir, '_snapshot', 'voice');
    fs.mkdirSync(voiceDir, { recursive: true });
    fs.writeFileSync(path.join(voiceDir, 'B00.wav'), 'fake-wav'); // pre-existing snapshot, no txt
    snapshotSourceFiles(projectDir, outDir);
    expect(fs.readFileSync(path.join(voiceDir, 'B00.txt'), 'utf-8')).toBe('参考音转写文本');
  });

  it('works without a sidecar (voxcpm path does not need one)', () => {
    fs.unlinkSync(path.join(projectDir, 'voice', 'B00.txt'));
    expect(() => snapshotSourceFiles(projectDir, outDir)).not.toThrow();
    expect(fs.existsSync(path.join(outDir, '_snapshot', 'voice', 'B00.wav'))).toBe(true);
  });
});
