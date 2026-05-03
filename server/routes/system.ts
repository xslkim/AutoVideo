import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs';
import type { AppConfig, AppConfigPublic } from '../types/api.js';

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
      baseURL: stored.imageGen?.baseURL || process.env.IMAGE_GEN_BASE_URL || undefined,
      apiKey: stored.imageGen?.apiKey || process.env.IMAGE_GEN_API_KEY || undefined,
      model: stored.imageGen?.model || undefined,
      size: stored.imageGen?.size || undefined,
      timeoutMs: stored.imageGen?.timeoutMs ?? undefined,
      concurrency: stored.imageGen?.concurrency ?? undefined,
    },
    voxcpm: {
      endpoint: stored.voxcpm?.endpoint || process.env.VOXCPM_ENDPOINT || undefined,
      autoStart: stored.voxcpm?.autoStart ?? undefined,
      concurrency: stored.voxcpm?.concurrency ?? undefined,
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
      baseURL: full.imageGen?.baseURL,
      apiKey: mask(full.imageGen?.apiKey),
      model: full.imageGen?.model,
      size: full.imageGen?.size,
      timeoutMs: full.imageGen?.timeoutMs,
      concurrency: full.imageGen?.concurrency,
    },
    voxcpm: {
      endpoint: full.voxcpm?.endpoint,
      autoStart: full.voxcpm?.autoStart,
      concurrency: full.voxcpm?.concurrency,
    },
  };
}

/**
 * Merge partial config into stored config (deep merge at the service level).
 * API key fields: null means clear; "" or undefined means keep existing.
 */
function mergeConfig(stored: AppConfig, patch: Partial<AppConfig>): AppConfig {
  const merged: AppConfig = { ...stored, version: 1 };

  for (const svc of ['anthropic', 'imageGen', 'voxcpm'] as const) {
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
    const body = await c.req.json() as { service: 'anthropic' | 'imageGen' | 'voxcpm' };
    const service = body.service;

    if (!['anthropic', 'imageGen', 'voxcpm'].includes(service)) {
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
        const key = full.imageGen?.apiKey;
        const baseURL = full.imageGen?.baseURL;
        if (!baseURL) return c.json({ ok: false, message: '未配置 Base URL' });
        if (!key) return c.json({ ok: false, message: '未配置 API Key' });
        const start = Date.now();
        try {
          const resp = await fetch(`${baseURL}/v1/models`, {
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(10000),
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
    }
  });

  return router;
}
