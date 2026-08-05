import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import type { AppConfig, AppConfigPublic, DoctorReport } from '../types/api.js';
import { checkFfmpeg, checkChromium } from '../../src/cli/doctor.js';
import {
  imageGenHealthURL,
  isImageGenConfigured,
  resolveImageGenProvider,
} from '../../src/ai/image-gen.js';
import type { ImageGenConfig } from '../../src/config/defaults.js';
import { DEFAULT_VISUAL_QUALITY } from '../../src/config/defaults.js';

const CONFIG_FILE = '.autovideo-web/config.json';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function configPath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_FILE);
}

function loadConfig(repoRoot: string): AppConfig {
  const fp = configPath(repoRoot);
  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    return JSON.parse(raw) as AppConfig;
  } catch {
    return { version: 1 };
  }
}

function saveConfig(repoRoot: string, config: AppConfig): void {
  const fp = configPath(repoRoot);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Resolve full config: UI config takes priority; missing fields fallback to env.
 */
function resolveConfig(repoRoot: string): AppConfig {
  const stored = loadConfig(repoRoot);
  return {
    version: 1,
    anthropic: {
      apiKey: stored.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || undefined,
      baseURL: stored.anthropic?.baseURL || process.env.ANTHROPIC_BASE_URL || undefined,
      model: stored.anthropic?.model || undefined,
      concurrency: stored.anthropic?.concurrency ?? undefined,
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
      url: stored.musetalk?.url || process.env.MUSETALK_URL || 'http://localhost:8001',
    },
    visualQuality: {
      enabled: stored.visualQuality?.enabled ?? DEFAULT_VISUAL_QUALITY.enabled,
      minFontCoeff: stored.visualQuality?.minFontCoeff ?? DEFAULT_VISUAL_QUALITY.minFontCoeff,
      minAnyFontCoeff:
        stored.visualQuality?.minAnyFontCoeff ?? DEFAULT_VISUAL_QUALITY.minAnyFontCoeff,
      minElements: stored.visualQuality?.minElements ?? DEFAULT_VISUAL_QUALITY.minElements,
      minCoverage: stored.visualQuality?.minCoverage ?? DEFAULT_VISUAL_QUALITY.minCoverage,
      review: stored.visualQuality?.review ?? DEFAULT_VISUAL_QUALITY.review,
      maxReviewRounds: stored.visualQuality?.maxReviewRounds ?? DEFAULT_VISUAL_QUALITY.maxReviewRounds,
    },
  };
}

/**
 * Desensitize apiKey fields for public API response.
 */
function publicConfig(full: AppConfig): AppConfigPublic {
  const mask = (key?: string): { set: boolean; last4?: string } => {
    if (!key) return { set: false };
    return { set: true, last4: key.length >= 4 ? key.slice(-4) : key };
  };

  return {
    version: 1,
    anthropic: {
      apiKey: mask(full.anthropic?.apiKey),
      baseURL: full.anthropic?.baseURL,
      model: full.anthropic?.model,
      concurrency: full.anthropic?.concurrency,
    },
    imageGen: {
      provider: full.imageGen?.provider,
      baseURL: full.imageGen?.baseURL,
      apiKey: mask(full.imageGen?.apiKey),
      model: full.imageGen?.model,
      size: full.imageGen?.size,
      timeoutMs: full.imageGen?.timeoutMs,
      concurrency: full.imageGen?.concurrency,
      numSteps: full.imageGen?.numSteps,
      cfgScale: full.imageGen?.cfgScale,
    },
    voxcpm: {
      endpoint: full.voxcpm?.endpoint,
      modelDir: full.voxcpm?.modelDir,
      concurrency: full.voxcpm?.concurrency,
    },
    musetalk: {
      url: full.musetalk?.url,
    },
    visualQuality: {
      enabled: full.visualQuality?.enabled,
      minFontCoeff: full.visualQuality?.minFontCoeff,
      minAnyFontCoeff: full.visualQuality?.minAnyFontCoeff,
      minElements: full.visualQuality?.minElements,
      minCoverage: full.visualQuality?.minCoverage,
      review: full.visualQuality?.review,
      maxReviewRounds: full.visualQuality?.maxReviewRounds,
    },
  };
}

/**
 * Merge partial config into stored config (deep merge at the service level).
 * API key fields: null means clear; "" or undefined means keep existing.
 */
function mergeConfig(stored: AppConfig, patch: Partial<AppConfig>): AppConfig {
  const merged: AppConfig = { ...stored, version: 1 };

  for (const svc of ['anthropic', 'imageGen', 'voxcpm', 'musetalk', 'visualQuality'] as const) {
    const patchSvc = patch[svc];
    if (!patchSvc) continue;
    merged[svc] = { ...(stored[svc] || {}) };
    for (const [k, v] of Object.entries(patchSvc)) {
      if (v === null) {
        delete (merged[svc] as Record<string, unknown>)[k];
      } else if (v !== '') {
        (merged[svc] as Record<string, unknown>)[k] = v;
      }
      // v === "" means "unchanged" → skip
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createSystemRoutes(repoRoot: string): Hono {
  const router = new Hono();

  // GET /api/config — return desensitized config
  router.get('/api/config', (c) => {
    const full = resolveConfig(repoRoot);
    return c.json(publicConfig(full));
  });

  // PUT /api/config — partial or full update
  router.put('/api/config', async (c) => {
    const body = await c.req.json() as Partial<AppConfig>;
    const stored = loadConfig(repoRoot);
    const merged = mergeConfig(stored, body);
    saveConfig(repoRoot, merged);
    const full = resolveConfig(repoRoot);
    return c.json({ ok: true, config: publicConfig(full) });
  });

  // POST /api/config/test — connectivity test
  router.post('/api/config/test', async (c) => {
    const body = await c.req.json() as { service: string };
    const service = body.service;

    if (!['anthropic', 'imageGen', 'voxcpm', 'musetalk'].includes(service)) {
      return c.json({ error: { code: 'ERR_BAD_REQUEST', message: `Unknown service: ${service}` } }, 400);
    }

    const full = resolveConfig(repoRoot);

    switch (service) {
      case 'anthropic': {
        const key = full.anthropic?.apiKey;
        const baseURL = full.anthropic?.baseURL || 'https://api.anthropic.com';
        if (!key) return c.json({ ok: false, message: '未配置 API Key' });
        const start = Date.now();
        try {
          const resp = await fetch(`${baseURL}/v1/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: full.anthropic?.model || 'claude-sonnet-4-6',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ping' }],
            }),
            signal: AbortSignal.timeout(15000),
          });
          const latencyMs = Date.now() - start;
          if (resp.ok) {
            return c.json({ ok: true, latencyMs });
          }
          const errText = await resp.text().catch(() => '');
          return c.json({ ok: false, latencyMs, message: `HTTP ${resp.status} ${errText.slice(0, 200)}` });
        } catch (err) {
          return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) });
        }
      }

      case 'imageGen': {
        const igConfig: ImageGenConfig = {
          provider: full.imageGen?.provider,
          baseURL: full.imageGen?.baseURL,
          apiKey: full.imageGen?.apiKey,
          model: full.imageGen?.model || 'gpt-image-1',
          timeoutMs: full.imageGen?.timeoutMs ?? 600000,
          concurrency: full.imageGen?.concurrency ?? 1,
          numSteps: full.imageGen?.numSteps,
          cfgScale: full.imageGen?.cfgScale,
        };

        if (!isImageGenConfigured(igConfig)) {
          return c.json({ ok: false, message: '未配置文生图 API Key（OpenAI 模式需要）' });
        }

        const healthURL = imageGenHealthURL(igConfig);
        if (!healthURL) {
          return c.json({ ok: false, message: '未配置文生图服务地址' });
        }

        const provider = resolveImageGenProvider(igConfig);
        const start = Date.now();
        try {
          const headers: Record<string, string> = {};
          if (provider === 'openai' && full.imageGen?.apiKey) {
            headers.Authorization = `Bearer ${full.imageGen.apiKey}`;
          }

          const resp = await fetch(healthURL, {
            headers,
            signal: AbortSignal.timeout(10000),
          });
          const latencyMs = Date.now() - start;

          if (provider === 'sensenova') {
            if (!resp.ok) {
              const errText = await resp.text().catch(() => '');
              return c.json({ ok: false, latencyMs, message: `HTTP ${resp.status} ${errText.slice(0, 200)}` });
            }
            const data = await resp.json().catch(() => null) as { ok?: boolean; model_loaded?: boolean } | null;
            if (data?.ok && data?.model_loaded) {
              return c.json({ ok: true, latencyMs });
            }
            return c.json({
              ok: false,
              latencyMs,
              message: data?.ok ? '模型尚未加载完成' : 'SenseNova 健康检查失败',
            });
          }

          if (resp.ok) {
            return c.json({ ok: true, latencyMs });
          }
          const errText = await resp.text().catch(() => '');
          return c.json({ ok: false, latencyMs, message: `HTTP ${resp.status} ${errText.slice(0, 200)}` });
        } catch (err) {
          return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) });
        }
      }

      case 'voxcpm': {
        const endpoint = full.voxcpm?.endpoint || 'http://127.0.0.1:8000';
        const start = Date.now();
        try {
          const resp = await fetch(endpoint, {
            signal: AbortSignal.timeout(5000),
          });
          const latencyMs = Date.now() - start;
          if (resp.ok) {
            return c.json({ ok: true, latencyMs });
          }
          return c.json({ ok: false, latencyMs, message: `HTTP ${resp.status}` });
        } catch (err) {
          return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) });
        }
      }

      case 'musetalk': {
        const musetalkUrl = full.musetalk?.url || 'http://localhost:8001';
        const start = Date.now();
        try {
          const resp = await fetch(musetalkUrl, {
            signal: AbortSignal.timeout(5000),
          });
          const latencyMs = Date.now() - start;
          if (resp.ok) {
            return c.json({ ok: true, latencyMs });
          }
          return c.json({ ok: false, latencyMs, message: `HTTP ${resp.status}` });
        } catch (err) {
          return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  });
  router.get('/api/doctor', async (c) => {
    const full = resolveConfig(repoRoot);
    const report: DoctorReport = {
      voxcpm: { status: 'fail', message: '' },
      anthropic: { status: 'missing' },
      imageGen: { status: 'missing' },
      ffmpeg: { status: 'missing' },
      remotion: { status: 'ok', version: 'unknown' },
      musetalk: { status: 'missing' },
    };

    // ── ffmpeg ──────────────────────────────────────────────────────────
    const ffmpegCheck = await checkFfmpeg();
    report.ffmpeg = {
      status: ffmpegCheck.status === 'PASS' ? 'ok' : 'missing',
      version: ffmpegCheck.status === 'PASS' ? ffmpegCheck.detail.split('\n')[0]?.trim() : undefined,
    };

    // ── remotion / chromium ─────────────────────────────────────────────
    const chromiumCheck = await checkChromium();
    report.remotion = {
      status: 'ok' as const,
      version: chromiumCheck.status === 'PASS' ? 'available' : chromiumCheck.detail,
    };

    // ── anthropic ───────────────────────────────────────────────────────
    if (full.anthropic?.apiKey) {
      report.anthropic = { status: 'ok' as const };
    } else {
      report.anthropic = { status: 'missing' as const, message: '未配置 Anthropic API Key' };
    }

    // ── imageGen ────────────────────────────────────────────────────────
    const igConfig: ImageGenConfig = {
      provider: full.imageGen?.provider,
      baseURL: full.imageGen?.baseURL,
      apiKey: full.imageGen?.apiKey,
      model: full.imageGen?.model || 'gpt-image-1',
      timeoutMs: full.imageGen?.timeoutMs ?? 600000,
      concurrency: full.imageGen?.concurrency ?? 1,
      numSteps: full.imageGen?.numSteps,
      cfgScale: full.imageGen?.cfgScale,
    };

    if (!isImageGenConfigured(igConfig)) {
      report.imageGen = {
        status: 'missing' as const,
        message: resolveImageGenProvider(igConfig) === 'sensenova'
          ? '未配置文生图服务'
          : '未配置文生图 API Key',
      };
    } else {
      const healthURL = imageGenHealthURL(igConfig);
      if (!healthURL) {
        report.imageGen = { status: 'missing' as const, message: '未配置文生图服务地址' };
      } else {
        try {
          const provider = resolveImageGenProvider(igConfig);
          const headers: Record<string, string> = {};
          if (provider === 'openai' && full.imageGen?.apiKey) {
            headers.Authorization = `Bearer ${full.imageGen.apiKey}`;
          }
          const resp = await fetch(healthURL, {
            headers,
            signal: AbortSignal.timeout(5000),
          });
          if (provider === 'sensenova') {
            if (resp.ok) {
              const data = await resp.json().catch(() => null) as { ok?: boolean; model_loaded?: boolean } | null;
              if (data?.ok && data?.model_loaded) {
                report.imageGen = { status: 'ok' as const };
              } else if (data?.ok) {
                report.imageGen = { status: 'fail' as const, message: 'SenseNova 模型加载中' };
              } else {
                report.imageGen = { status: 'fail' as const, message: 'SenseNova 健康检查失败' };
              }
            } else {
              report.imageGen = { status: 'fail' as const, message: `HTTP ${resp.status}` };
            }
          } else if (resp.ok) {
            report.imageGen = { status: 'ok' as const };
          } else {
            report.imageGen = { status: 'fail' as const, message: `HTTP ${resp.status}` };
          }
        } catch (err) {
          report.imageGen = {
            status: 'fail' as const,
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    // ── voxcpm ──────────────────────────────────────────────────────────
    const voxcpmEndpoint = full.voxcpm?.endpoint || 'http://127.0.0.1:8000';
    try {
      const resp = await fetch(voxcpmEndpoint, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        report.voxcpm = { status: 'ok' as const };
      } else {
        report.voxcpm = { status: 'fail' as const, message: `HTTP ${resp.status}` };
      }
    } catch (err) {
      report.voxcpm = {
        status: 'fail' as const,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // ── musetalk ──────────────────────────────────────────────────────────
    const musetalkUrl = full.musetalk?.url || 'http://localhost:8001';
    try {
      const resp = await fetch(musetalkUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        report.musetalk = { status: 'ok' as const };
      } else {
        report.musetalk = { status: 'fail' as const, message: `HTTP ${resp.status}` };
      }
    } catch (err) {
      report.musetalk = {
        status: 'fail' as const,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    return c.json(report);
  });

  return router;
}
