/**
 * AutoVideo Web — 配置服务（单一事实来源）
 *
 * Web 模式的配置分层（低 → 高优先级）：
 *   1. DEFAULT_CONFIG + 仓库根 autovideo.config.json（复用 CLI loader）
 *   2. 环境变量
 *   3. .autovideo-web/config.json（设置面板写入）
 *
 * 两个视图：
 *   - resolveWebConfig(repoRoot): AppConfig
 *     仅含「用户显式配置」的覆盖层（UI 存储 + 环境变量兜底），
 *     供设置面板 GET 展示用 — 未配置的字段保持 undefined。
 *   - resolveTaskConfig(repoRoot): AutoVideoConfig
 *     完整生效配置（默认值 + autovideo.config.json + 覆盖层），
 *     taskRunner 传给 CLI 模块，doctor / 连通性测试也用它，
 *     保证「检查看到的」与「任务实际用的」一致。
 *
 * 此前 routes/system.ts 与 services/taskRunner.ts 各自维护一份合并逻辑，
 * 已出现漂移（useCLI 支持、env 优先级不一致）。收敛于此。
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig as loadCliConfig } from '../../src/config/load.js';
import { DEFAULT_VISUAL_QUALITY, type AutoVideoConfig } from '../../src/config/defaults.js';
import type { AppConfig } from '../types/api.js';

const CONFIG_FILE = '.autovideo-web/config.json';

// ---------------------------------------------------------------------------
// Stored config (.autovideo-web/config.json)
// ---------------------------------------------------------------------------

export function configFilePath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_FILE);
}

/** Read the raw stored config; malformed/missing file → empty config. */
export function loadStoredConfig(repoRoot: string): AppConfig {
  try {
    const raw = fs.readFileSync(configFilePath(repoRoot), 'utf-8');
    return JSON.parse(raw) as AppConfig;
  } catch {
    return { version: 1 };
  }
}

export function saveStoredConfig(repoRoot: string, config: AppConfig): void {
  const fp = configFilePath(repoRoot);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // The file holds API keys in plain text — keep it owner-only.
  fs.writeFileSync(fp, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(fp, 0o600); // mode above only applies on create; fix existing files too
  } catch { /* best effort */ }
}

/**
 * Recursively merge patch fields into target.
 * Field semantics: null → clear; "" or undefined → keep existing;
 * nested objects (e.g. anthropic.review) merge field-by-field.
 */
function mergeFields(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete target[k];
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      const nested: Record<string, unknown> =
        typeof target[k] === 'object' && target[k] !== null
          ? { ...(target[k] as Record<string, unknown>) }
          : {};
      mergeFields(nested, v as Record<string, unknown>);
      target[k] = nested;
    } else if (v !== '') {
      target[k] = v;
    }
    // v === "" means "unchanged" → skip
  }
}

/** Merge a PUT patch into the stored config (service-level deep merge). */
export function mergeStoredConfig(stored: AppConfig, patch: Partial<AppConfig>): AppConfig {
  const merged: AppConfig = { ...stored, version: 1 };

  for (const svc of ['anthropic', 'imageGen', 'voxcpm', 'musetalk', 'visualQuality'] as const) {
    const patchSvc = patch[svc];
    if (!patchSvc) continue;
    const target: Record<string, unknown> = { ...(stored[svc] || {}) };
    mergeFields(target, patchSvc as Record<string, unknown>);
    (merged as unknown as Record<string, unknown>)[svc] = target;
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Overlay view: stored config + env fallbacks (UI 优先于环境变量)
// ---------------------------------------------------------------------------

/**
 * 用户显式配置的覆盖层：UI 存储字段优先，缺失时回落到环境变量。
 * 不含默认值 — 未配置的字段保持 undefined。
 */
export function resolveWebConfig(repoRoot: string): AppConfig {
  const stored = loadStoredConfig(repoRoot);
  return {
    version: 1,
    anthropic: {
      provider: stored.anthropic?.provider || undefined,
      apiKey:
        stored.anthropic?.apiKey
        || process.env.ANTHROPIC_API_KEY
        || process.env.ANTHROPIC_AUTH_TOKEN
        || undefined,
      baseURL: stored.anthropic?.baseURL || process.env.ANTHROPIC_BASE_URL || undefined,
      model: stored.anthropic?.model || undefined,
      concurrency: stored.anthropic?.concurrency ?? undefined,
      useCLI: stored.anthropic?.useCLI ?? undefined,
      cliPath: stored.anthropic?.cliPath || undefined,
      cliTimeoutMs: stored.anthropic?.cliTimeoutMs ?? undefined,
      thinking: stored.anthropic?.thinking ?? undefined,
      review: stored.anthropic?.review ? { ...stored.anthropic.review } : undefined,
    },
    imageGen: {
      provider: stored.imageGen?.provider
        || (process.env.IMAGE_GEN_PROVIDER as 'openai' | 'sensenova' | undefined)
        || undefined,
      baseURL: stored.imageGen?.baseURL || process.env.IMAGE_GEN_BASE_URL || undefined,
      apiKey: stored.imageGen?.apiKey || process.env.IMAGE_GEN_API_KEY || undefined,
      model: stored.imageGen?.model || undefined,
      size: stored.imageGen?.size || undefined,
      timeoutMs: stored.imageGen?.timeoutMs ?? undefined,
      concurrency: stored.imageGen?.concurrency ?? undefined,
      numSteps: stored.imageGen?.numSteps ?? undefined,
      cfgScale: stored.imageGen?.cfgScale ?? undefined,
    },
    voxcpm: {
      endpoint: stored.voxcpm?.endpoint || process.env.VOXCPM_ENDPOINT || undefined,
      modelDir: stored.voxcpm?.modelDir || process.env.VOXCPM_MODEL_DIR || undefined,
      concurrency: stored.voxcpm?.concurrency ?? undefined,
    },
    musetalk: {
      url: stored.musetalk?.url || process.env.MUSETALK_URL || undefined,
    },
    visualQuality: stored.visualQuality ? { ...stored.visualQuality } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Effective task config: CLI config + overlay
// ---------------------------------------------------------------------------

/** Copy all defined (non-undefined) values from source onto target. */
function applyDefined(target: object, source: object): void {
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  }
}

/**
 * 完整生效配置：DEFAULT_CONFIG + autovideo.config.json + 覆盖层。
 * taskRunner 与 doctor / 连通性测试共用，保证行为一致。
 */
export function resolveTaskConfig(repoRoot: string): AutoVideoConfig {
  const cfg = loadCliConfig({ projectRoot: repoRoot }).config;
  const overlay = resolveWebConfig(repoRoot);

  if (overlay.anthropic) applyDefined(cfg.anthropic, overlay.anthropic);
  if (overlay.voxcpm) applyDefined(cfg.voxcpm, overlay.voxcpm);
  if (overlay.imageGen) applyDefined(cfg.imageGen, overlay.imageGen);
  if (overlay.musetalk?.url) {
    cfg.musetalk = { ...cfg.musetalk, url: overlay.musetalk.url };
  }
  if (overlay.visualQuality) {
    cfg.visualQuality = { ...DEFAULT_VISUAL_QUALITY, ...cfg.visualQuality };
    applyDefined(cfg.visualQuality, overlay.visualQuality);
  }

  return cfg;
}
