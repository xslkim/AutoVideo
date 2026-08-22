/**
 * Tests for server/services/configService.ts
 *
 * Locks down the config merge protocol:
 * - PUT patch semantics: null → clear, "" → keep, nested objects merge field-wise
 * - resolveWebConfig: stored > env fallback
 * - resolveTaskConfig: defaults + overlay, review passthrough
 * - saveStoredConfig: owner-only file mode
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mergeStoredConfig,
  saveStoredConfig,
  loadStoredConfig,
  resolveWebConfig,
  resolveTaskConfig,
  applyDraftOverlay,
} from '../../server/services/configService';
import type { AppConfig } from '../../server/types/api';

let tmpRoot: string;
const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'VOXCPM_ENDPOINT',
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-configsvc-'));
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('mergeStoredConfig', () => {
  it('keeps existing values for "" and clears for null', () => {
    const stored: AppConfig = {
      version: 1,
      anthropic: { apiKey: 'old-key', model: 'old-model', baseURL: 'https://old' },
    };
    const merged = mergeStoredConfig(stored, {
      anthropic: { apiKey: '', model: 'new-model', baseURL: null as unknown as string },
    });
    expect(merged.anthropic?.apiKey).toBe('old-key');
    expect(merged.anthropic?.model).toBe('new-model');
    expect(merged.anthropic?.baseURL).toBeUndefined();
  });

  it('merges nested review field-wise, preserving the saved apiKey', () => {
    const stored: AppConfig = {
      version: 1,
      anthropic: { review: { apiKey: 'review-key', model: 'old-review-model' } },
    };
    const merged = mergeStoredConfig(stored, {
      anthropic: { review: { model: 'glm-4.6' } },
    });
    expect(merged.anthropic?.review?.apiKey).toBe('review-key');
    expect(merged.anthropic?.review?.model).toBe('glm-4.6');
  });

  it('trims apiKey on write and ignores whitespace-only keys', () => {
    const stored: AppConfig = { version: 1, anthropic: { apiKey: 'old-key' } };
    expect(mergeStoredConfig(stored, { anthropic: { apiKey: '  new-key  ' } }).anthropic?.apiKey)
      .toBe('new-key');
    expect(mergeStoredConfig(stored, { anthropic: { apiKey: '   ' } }).anthropic?.apiKey)
      .toBe('old-key');
  });

  it('clears the whole review object with null', () => {
    const stored: AppConfig = {
      version: 1,
      anthropic: { review: { model: 'glm-4.6' } },
    };
    const merged = mergeStoredConfig(stored, {
      anthropic: { review: null as unknown as undefined },
    });
    expect(merged.anthropic?.review).toBeUndefined();
  });
});

describe('resolveWebConfig', () => {
  it('prefers stored values over environment variables', () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    saveStoredConfig(tmpRoot, { version: 1, anthropic: { apiKey: 'ui-key' } });
    const overlay = resolveWebConfig(tmpRoot);
    expect(overlay.anthropic?.apiKey).toBe('ui-key');
  });

  it('falls back to ANTHROPIC_AUTH_TOKEN when nothing is stored', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'token-from-env';
    const overlay = resolveWebConfig(tmpRoot);
    expect(overlay.anthropic?.apiKey).toBe('token-from-env');
  });
});

describe('resolveTaskConfig', () => {
  it('applies the stored overlay onto CLI defaults', () => {
    saveStoredConfig(tmpRoot, {
      version: 1,
      anthropic: {
        provider: 'opencode-cli',
        model: 'deepseek/deepseek-chat',
        review: { provider: 'anthropic-api', model: 'glm-4.6' },
      },
      voxcpm: { endpoint: 'http://tts.local:8000' },
    });
    const cfg = resolveTaskConfig(tmpRoot);
    expect(cfg.anthropic.provider).toBe('opencode-cli');
    expect(cfg.anthropic.model).toBe('deepseek/deepseek-chat');
    expect(cfg.anthropic.review?.model).toBe('glm-4.6');
    expect(cfg.voxcpm.endpoint).toBe('http://tts.local:8000');
    // untouched defaults survive
    expect(cfg.anthropic.maxRetries).toBeGreaterThan(0);
  });

  it('passes the thinking mode through the overlay', () => {
    saveStoredConfig(tmpRoot, { version: 1, anthropic: { thinking: 'medium' } });
    const cfg = resolveTaskConfig(tmpRoot);
    expect(cfg.anthropic.thinking).toBe('medium');
    expect(resolveWebConfig(tmpRoot).anthropic?.thinking).toBe('medium');
  });

  it('UI config beats env vars for voxcpm endpoint', () => {
    process.env.VOXCPM_ENDPOINT = 'http://env:8000';
    saveStoredConfig(tmpRoot, { version: 1, voxcpm: { endpoint: 'http://ui:8000' } });
    expect(resolveTaskConfig(tmpRoot).voxcpm.endpoint).toBe('http://ui:8000');
  });
});

describe('applyDraftOverlay', () => {
  it('lets an unsaved form apiKey override the resolved task config', () => {
    saveStoredConfig(tmpRoot, { version: 1, anthropic: { model: 'glm-4.6' } });
    const cfg = resolveTaskConfig(tmpRoot);
    expect(cfg.anthropic.apiKey).toBeUndefined();

    const drafted = applyDraftOverlay(cfg, {
      anthropic: {
        provider: 'anthropic-api',
        apiKey: '  glm-draft-key  ',
        baseURL: 'https://open.bigmodel.cn/api/anthropic',
      },
    });
    expect(drafted.anthropic.apiKey).toBe('glm-draft-key');
    expect(drafted.anthropic.baseURL).toBe('https://open.bigmodel.cn/api/anthropic');
    expect(drafted.anthropic.model).toBe('glm-4.6');
    // original is unchanged
    expect(cfg.anthropic.apiKey).toBeUndefined();
  });

  it('ignores blank draft apiKey so a previously saved key is kept', () => {
    saveStoredConfig(tmpRoot, { version: 1, anthropic: { apiKey: 'saved-key' } });
    const drafted = applyDraftOverlay(resolveTaskConfig(tmpRoot), {
      anthropic: { apiKey: '   ', model: 'glm-4.6' },
    });
    expect(drafted.anthropic.apiKey).toBe('saved-key');
    expect(drafted.anthropic.model).toBe('glm-4.6');
  });

  it('applies a cosyvoice draft endpoint (unsaved form value is testable)', () => {
    const cfg = resolveTaskConfig(tmpRoot);
    const drafted = applyDraftOverlay(cfg, {
      cosyvoice: { endpoint: 'http://127.0.0.1:9002' },
    });
    expect(drafted.cosyvoice.endpoint).toBe('http://127.0.0.1:9002');
    // original is unchanged
    expect(cfg.cosyvoice.endpoint).not.toBe('http://127.0.0.1:9002');
  });
});

describe('saveStoredConfig', () => {
  it('writes the file with owner-only permissions', () => {
    saveStoredConfig(tmpRoot, { version: 1, anthropic: { apiKey: 'secret' } });
    const fp = path.join(tmpRoot, '.autovideo-web', 'config.json');
    const mode = fs.statSync(fp).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(loadStoredConfig(tmpRoot).anthropic?.apiKey).toBe('secret');
  });
});

// ── tts / cosyvoice sections (B2: provider 切换的 web 防丢字段接缝) ─────

describe('tts/cosyvoice config passthrough', () => {
  it('mergeStoredConfig keeps tts and cosyvoice sections from a PUT patch', () => {
    const merged = mergeStoredConfig({ version: 1 }, {
      tts: { provider: 'cosyvoice' },
      cosyvoice: { endpoint: 'http://127.0.0.1:8002', referenceText: '参考文本', normalize: false },
    });
    expect(merged.tts?.provider).toBe('cosyvoice');
    expect(merged.cosyvoice?.endpoint).toBe('http://127.0.0.1:8002');
    expect(merged.cosyvoice?.referenceText).toBe('参考文本');
    expect(merged.cosyvoice?.normalize).toBe(false);
  });

  it('mergeStoredConfig merges cosyvoice field-wise into the stored config', () => {
    const stored: AppConfig = {
      version: 1,
      cosyvoice: { endpoint: 'http://old:8002', modelDir: '/models/cosy' },
    };
    const merged = mergeStoredConfig(stored, { cosyvoice: { endpoint: 'http://new:8002' } });
    expect(merged.cosyvoice?.endpoint).toBe('http://new:8002');
    expect(merged.cosyvoice?.modelDir).toBe('/models/cosy');
  });

  it('resolveWebConfig surfaces stored tts/cosyvoice values', () => {
    saveStoredConfig(tmpRoot, {
      version: 1,
      tts: { provider: 'cosyvoice' },
      cosyvoice: { endpoint: 'http://cosy:8002', referenceText: '参考文本' },
    });
    const overlay = resolveWebConfig(tmpRoot);
    expect(overlay.tts?.provider).toBe('cosyvoice');
    expect(overlay.cosyvoice?.endpoint).toBe('http://cosy:8002');
    expect(overlay.cosyvoice?.referenceText).toBe('参考文本');
  });

  it('resolveWebConfig falls back to COSYVOICE_ENDPOINT when nothing is stored', () => {
    const saved = process.env.COSYVOICE_ENDPOINT;
    process.env.COSYVOICE_ENDPOINT = 'http://env-cosy:8002';
    try {
      expect(resolveWebConfig(tmpRoot).cosyvoice?.endpoint).toBe('http://env-cosy:8002');
    } finally {
      if (saved === undefined) delete process.env.COSYVOICE_ENDPOINT;
      else process.env.COSYVOICE_ENDPOINT = saved;
    }
  });

  it('resolveTaskConfig applies the tts/cosyvoice overlay onto CLI defaults', () => {
    saveStoredConfig(tmpRoot, {
      version: 1,
      tts: { provider: 'cosyvoice' },
      cosyvoice: { endpoint: 'http://cosy:8002', normalize: false },
    });
    const cfg = resolveTaskConfig(tmpRoot);
    expect(cfg.tts.provider).toBe('cosyvoice');
    expect(cfg.cosyvoice.endpoint).toBe('http://cosy:8002');
    expect(cfg.cosyvoice.normalize).toBe(false);
    // untouched defaults survive
    expect(cfg.cosyvoice.concurrency).toBeGreaterThan(0);
    expect(cfg.voxcpm.endpoint).toBeTruthy();
  });

  it('resolveTaskConfig keeps the voxcpm default when no overlay is stored', () => {
    const cfg = resolveTaskConfig(tmpRoot);
    expect(cfg.tts.provider).toBe('voxcpm');
  });

  it('mergeStoredConfig merges tts.qa field-wise into the stored config', () => {
    const stored: AppConfig = {
      version: 1,
      tts: { provider: 'cosyvoice', qa: { enabled: true, maxRetries: 2 } },
    };
    const merged = mergeStoredConfig(stored, { tts: { qa: { enabled: false } } });
    expect(merged.tts?.provider).toBe('cosyvoice');
    expect(merged.tts?.qa?.enabled).toBe(false);
    expect(merged.tts?.qa?.maxRetries).toBe(2);
  });

  it('resolveWebConfig surfaces tts.qa and both seedSalt fields', () => {
    saveStoredConfig(tmpRoot, {
      version: 1,
      tts: { provider: 'cosyvoice', qa: { enabled: false, maxRetries: 5 } },
      voxcpm: { seedSalt: 'vx-salt' },
      cosyvoice: { seedSalt: 'cv-salt' },
    });
    const overlay = resolveWebConfig(tmpRoot);
    expect(overlay.tts?.qa).toEqual({ enabled: false, maxRetries: 5 });
    expect(overlay.voxcpm?.seedSalt).toBe('vx-salt');
    expect(overlay.cosyvoice?.seedSalt).toBe('cv-salt');
  });

  it('resolveTaskConfig applies tts.qa and seedSalt overlays onto CLI defaults', () => {
    saveStoredConfig(tmpRoot, {
      version: 1,
      tts: { qa: { enabled: false, maxRetries: 5 } },
      cosyvoice: { seedSalt: 'cv-salt' },
    });
    const cfg = resolveTaskConfig(tmpRoot);
    expect(cfg.tts.qa?.enabled).toBe(false);
    expect(cfg.tts.qa?.maxRetries).toBe(5);
    expect(cfg.cosyvoice.seedSalt).toBe('cv-salt');
  });
});
