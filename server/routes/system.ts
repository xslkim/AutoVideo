import { Hono } from 'hono';
import type { AppConfig, AppConfigPublic, DoctorReport } from '../types/api.js';
import { checkFfmpeg, checkChromium } from '../../src/cli/doctor.js';
import {
  imageGenHealthURL,
  isImageGenConfigured,
  resolveImageGenProvider,
} from '../../src/ai/image-gen.js';
import {
  resolveAgentProvider,
  defaultCliBinary,
  checkCliVersion,
} from '../../src/ai/agent/index.js';
import { DEFAULT_VISUAL_QUALITY } from '../../src/config/defaults.js';
import {
  loadStoredConfig,
  saveStoredConfig,
  mergeStoredConfig,
  resolveWebConfig,
  resolveTaskConfig,
} from '../services/configService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Desensitize apiKey fields for public API response.
 * Display defaults (visualQuality / musetalk url) are filled in here so the
 * settings UI always has values to show.
 */
function publicConfig(overlay: AppConfig): AppConfigPublic {
  const mask = (key?: string): { set: boolean; last4?: string } => {
    if (!key) return { set: false };
    return { set: true, last4: key.length >= 4 ? key.slice(-4) : key };
  };

  return {
    version: 1,
    anthropic: {
      provider: overlay.anthropic?.provider,
      apiKey: mask(overlay.anthropic?.apiKey),
      baseURL: overlay.anthropic?.baseURL,
      model: overlay.anthropic?.model,
      concurrency: overlay.anthropic?.concurrency,
      useCLI: overlay.anthropic?.useCLI,
      cliPath: overlay.anthropic?.cliPath,
      cliTimeoutMs: overlay.anthropic?.cliTimeoutMs,
      thinking: overlay.anthropic?.thinking,
      review: overlay.anthropic?.review
        ? {
            provider: overlay.anthropic.review.provider,
            model: overlay.anthropic.review.model,
            baseURL: overlay.anthropic.review.baseURL,
            apiKey: mask(overlay.anthropic.review.apiKey),
            cliPath: overlay.anthropic.review.cliPath,
            cliTimeoutMs: overlay.anthropic.review.cliTimeoutMs,
          }
        : undefined,
    },
    imageGen: {
      provider: overlay.imageGen?.provider,
      baseURL: overlay.imageGen?.baseURL,
      apiKey: mask(overlay.imageGen?.apiKey),
      model: overlay.imageGen?.model,
      size: overlay.imageGen?.size,
      timeoutMs: overlay.imageGen?.timeoutMs,
      concurrency: overlay.imageGen?.concurrency,
      numSteps: overlay.imageGen?.numSteps,
      cfgScale: overlay.imageGen?.cfgScale,
    },
    voxcpm: {
      endpoint: overlay.voxcpm?.endpoint,
      modelDir: overlay.voxcpm?.modelDir,
      concurrency: overlay.voxcpm?.concurrency,
      seedSalt: overlay.voxcpm?.seedSalt,
    },
    tts: {
      provider: overlay.tts?.provider,
      qa: overlay.tts?.qa ? { ...overlay.tts.qa } : undefined,
    },
    cosyvoice: {
      endpoint: overlay.cosyvoice?.endpoint,
      modelDir: overlay.cosyvoice?.modelDir,
      concurrency: overlay.cosyvoice?.concurrency,
      referenceText: overlay.cosyvoice?.referenceText,
      normalize: overlay.cosyvoice?.normalize,
      seedSalt: overlay.cosyvoice?.seedSalt,
    },
    musetalk: {
      url: overlay.musetalk?.url || 'http://localhost:8001',
    },
    visualQuality: {
      enabled: overlay.visualQuality?.enabled ?? DEFAULT_VISUAL_QUALITY.enabled,
      minFontCoeff: overlay.visualQuality?.minFontCoeff ?? DEFAULT_VISUAL_QUALITY.minFontCoeff,
      minAnyFontCoeff:
        overlay.visualQuality?.minAnyFontCoeff ?? DEFAULT_VISUAL_QUALITY.minAnyFontCoeff,
      minElements: overlay.visualQuality?.minElements ?? DEFAULT_VISUAL_QUALITY.minElements,
      minCoverage: overlay.visualQuality?.minCoverage ?? DEFAULT_VISUAL_QUALITY.minCoverage,
      review: overlay.visualQuality?.review ?? DEFAULT_VISUAL_QUALITY.review,
      maxReviewRounds:
        overlay.visualQuality?.maxReviewRounds ?? DEFAULT_VISUAL_QUALITY.maxReviewRounds,
    },
  };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createSystemRoutes(repoRoot: string): Hono {
  const router = new Hono();

  // GET /api/config — return desensitized config
  router.get('/api/config', (c) => {
    return c.json(publicConfig(resolveWebConfig(repoRoot)));
  });

  // PUT /api/config — partial or full update
  router.put('/api/config', async (c) => {
    const body = await c.req.json() as Partial<AppConfig>;

    // Reject unknown TTS providers up front — otherwise the bad value would
    // persist and only surface when the TTS stage factory throws
    // (src/tts/provider.ts createTtsProvider). null clears, so it's allowed.
    const ttsProvider = body.tts?.provider;
    if (ttsProvider !== undefined && ttsProvider !== null
      && !['voxcpm', 'cosyvoice'].includes(ttsProvider)) {
      return c.json({
        error: {
          code: 'ERR_BAD_REQUEST',
          message: `Invalid tts.provider: ${String(ttsProvider)}（支持 voxcpm / cosyvoice）`,
        },
      }, 400);
    }

    const stored = loadStoredConfig(repoRoot);
    const merged = mergeStoredConfig(stored, body);
    saveStoredConfig(repoRoot, merged);
    return c.json({ ok: true, config: publicConfig(resolveWebConfig(repoRoot)) });
  });

  // POST /api/config/test — connectivity test (uses effective task config,
  // so the result reflects what a real task would use)
  router.post('/api/config/test', async (c) => {
    const body = await c.req.json() as { service: string };
    const service = body.service;

    if (!['anthropic', 'imageGen', 'voxcpm', 'cosyvoice', 'musetalk'].includes(service)) {
      return c.json({ error: { code: 'ERR_BAD_REQUEST', message: `Unknown service: ${service}` } }, 400);
    }

    const cfg = resolveTaskConfig(repoRoot);

    switch (service) {
      case 'anthropic': {
        const provider = resolveAgentProvider(cfg.anthropic);
        if (provider !== 'anthropic-api') {
          const cliPath = cfg.anthropic.cliPath || defaultCliBinary(provider);
          const result = await checkCliVersion(cliPath);
          return c.json(result);
        }

        const key = cfg.anthropic.apiKey;
        const baseURL = cfg.anthropic.baseURL || 'https://api.anthropic.com';
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
              model: cfg.anthropic.model || 'claude-sonnet-4-6',
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
        const igConfig = cfg.imageGen;

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
          if (provider === 'openai' && igConfig.apiKey) {
            headers.Authorization = `Bearer ${igConfig.apiKey}`;
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
        const endpoint = cfg.voxcpm.endpoint || 'http://127.0.0.1:8000';
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

      case 'cosyvoice': {
        // CosyVoice answers /health with 503 while the model is still
        // loading (or after a load failure) — probe that, not the bare port.
        const endpoint = cfg.cosyvoice.endpoint || 'http://127.0.0.1:8002';
        const start = Date.now();
        try {
          const resp = await fetch(`${endpoint}/health`, {
            signal: AbortSignal.timeout(5000),
          });
          const latencyMs = Date.now() - start;
          if (resp.ok) {
            return c.json({ ok: true, latencyMs });
          }
          if (resp.status === 503) {
            return c.json({ ok: false, latencyMs, message: '服务在线，模型仍在加载中（或加载失败），稍候重试' });
          }
          return c.json({ ok: false, latencyMs, message: `HTTP ${resp.status}` });
        } catch (err) {
          return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) });
        }
      }

      case 'musetalk': {
        const musetalkUrl = cfg.musetalk?.url || 'http://localhost:8001';
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
    const cfg = resolveTaskConfig(repoRoot);
    const report: DoctorReport = {
      voxcpm: { status: 'fail', message: '' },
      cosyvoice: { status: 'fail', message: '' },
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

    // ── anthropic / agent ───────────────────────────────────────────────
    const agentProvider = resolveAgentProvider(cfg.anthropic);
    if (agentProvider !== 'anthropic-api') {
      const cliPath = cfg.anthropic.cliPath || defaultCliBinary(agentProvider);
      const cliCheck = await checkCliVersion(cliPath);
      report.anthropic = cliCheck.ok
        ? { status: 'ok' as const, message: `CLI 模式（${cliPath}）` }
        : { status: 'missing' as const, message: `CLI 模式不可用：${cliCheck.message}` };
    } else if (cfg.anthropic.apiKey) {
      report.anthropic = { status: 'ok' as const };
    } else {
      report.anthropic = { status: 'missing' as const, message: '未配置 Anthropic API Key' };
    }

    // ── imageGen ────────────────────────────────────────────────────────
    const igConfig = cfg.imageGen;

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
          if (provider === 'openai' && igConfig.apiKey) {
            headers.Authorization = `Bearer ${igConfig.apiKey}`;
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
    const voxcpmEndpoint = cfg.voxcpm.endpoint || 'http://127.0.0.1:8000';
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

    // ── cosyvoice ─────────────────────────────────────────────────────────
    // /health answers 503 while the model loads — report that distinctly.
    const cosyvoiceEndpoint = cfg.cosyvoice.endpoint || 'http://127.0.0.1:8002';
    try {
      const resp = await fetch(`${cosyvoiceEndpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        report.cosyvoice = { status: 'ok' as const };
      } else if (resp.status === 503) {
        report.cosyvoice = { status: 'fail' as const, message: '模型加载中（或加载失败）' };
      } else {
        report.cosyvoice = { status: 'fail' as const, message: `HTTP ${resp.status}` };
      }
    } catch (err) {
      report.cosyvoice = {
        status: 'fail' as const,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // ── musetalk ──────────────────────────────────────────────────────────
    const musetalkUrl = cfg.musetalk?.url || 'http://localhost:8001';
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
