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

describe('saveStoredConfig', () => {
  it('writes the file with owner-only permissions', () => {
    saveStoredConfig(tmpRoot, { version: 1, anthropic: { apiKey: 'secret' } });
    const fp = path.join(tmpRoot, '.autovideo-web', 'config.json');
    const mode = fs.statSync(fp).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(loadStoredConfig(tmpRoot).anthropic?.apiKey).toBe('secret');
  });
});
