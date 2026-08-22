/**
 * Tests for server/routes/system.ts
 *
 * - PUT /api/config: tts.provider value validation (400 on unknown values,
 *   aligned with the createTtsProvider factory error) and tts/cosyvoice
 *   field passthrough.
 * - POST /api/config/test: the cosyvoice branch probes {endpoint}/health —
 *   200 = ok, 503 = model still loading; the voxcpm branch keeps its old
 *   bare-endpoint behavior.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createSystemRoutes } from '../../server/routes/system';
import { loadStoredConfig, saveStoredConfig } from '../../server/services/configService';

// ── Mock TTS server: GET / → 200 (voxcpm), GET /health → settable (cosyvoice)

function createMockTtsServer(): Promise<{
  url: string;
  server: http.Server;
  paths: { value: string[] };
  setHealthStatus: (code: number) => void;
}> {
  const paths: { value: string[] } = { value: [] };
  let healthStatus = 200;

  const server = http.createServer((req, res) => {
    paths.value.push(req.url ?? '');
    if (req.url === '/health') {
      res.writeHead(healthStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(healthStatus === 200 ? { status: 'ok' } : { detail: 'model is still loading' }));
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr !== null) {
        resolve({
          url: `http://127.0.0.1:${addr.port}`,
          server,
          paths,
          setHealthStatus: (code: number) => { healthStatus = code; },
        });
      } else {
        reject(new Error('Failed to start mock server'));
      }
    });
  });
}

describe('system routes', () => {
  let tmpRoot: string;
  let mock: Awaited<ReturnType<typeof createMockTtsServer>>;
  let app: ReturnType<typeof createSystemRoutes>;

  const putConfig = (body: unknown) =>
    app.request('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const testService = (service: string) =>
    app.request('/api/config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service }),
    });

  beforeAll(async () => {
    mock = await createMockTtsServer();
  });

  afterAll(() => {
    mock.server.close();
  });

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-systemroutes-'));
    app = createSystemRoutes(tmpRoot);
    mock.paths.value = [];
    mock.setHealthStatus(200);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ── PUT /api/config: tts.provider validation ─────────────────────────

  it('PUT rejects an unknown tts.provider with 400 and writes nothing', async () => {
    const res = await putConfig({ tts: { provider: 'nope' } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('ERR_BAD_REQUEST');
    expect(body.error.message).toContain('nope');
    // The bad value never reached the stored config.
    expect(loadStoredConfig(tmpRoot).tts).toBeUndefined();
  });

  it('PUT accepts a valid tts.provider and round-trips it', async () => {
    const res = await putConfig({ tts: { provider: 'cosyvoice' } });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; config: { tts: { provider?: string } } };
    expect(body.ok).toBe(true);
    expect(body.config.tts.provider).toBe('cosyvoice');
    expect(loadStoredConfig(tmpRoot).tts?.provider).toBe('cosyvoice');
  });

  it('PUT passes tts.qa and seedSalt fields through (no whitelist drop)', async () => {
    const res = await putConfig({
      tts: { provider: 'cosyvoice', qa: { enabled: false, maxRetries: 5 } },
      voxcpm: { seedSalt: 'vx-salt' },
      cosyvoice: { seedSalt: 'cv-salt', referenceText: '参考文本', normalize: false },
    });
    expect(res.status).toBe(200);

    const getRes = await app.request('/api/config');
    const cfg = await getRes.json() as {
      tts: { provider?: string; qa?: { enabled?: boolean; maxRetries?: number } };
      voxcpm: { seedSalt?: string };
      cosyvoice: { seedSalt?: string; referenceText?: string; normalize?: boolean };
    };
    expect(cfg.tts.provider).toBe('cosyvoice');
    expect(cfg.tts.qa).toEqual({ enabled: false, maxRetries: 5 });
    expect(cfg.voxcpm.seedSalt).toBe('vx-salt');
    expect(cfg.cosyvoice.seedSalt).toBe('cv-salt');
    expect(cfg.cosyvoice.referenceText).toBe('参考文本');
    expect(cfg.cosyvoice.normalize).toBe(false);
  });

  // ── POST /api/config/test: dispatch ──────────────────────────────────

  it('cosyvoice is whitelisted (no 400); unknown services still 400', async () => {
    saveStoredConfig(tmpRoot, { version: 1, cosyvoice: { endpoint: mock.url } });
    const okRes = await testService('cosyvoice');
    expect(okRes.status).toBe(200);

    const badRes = await testService('bogus');
    expect(badRes.status).toBe(400);
  });

  it('cosyvoice branch probes {endpoint}/health and reports ok on 200', async () => {
    saveStoredConfig(tmpRoot, { version: 1, cosyvoice: { endpoint: mock.url } });
    const res = await testService('cosyvoice');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; latencyMs?: number };
    expect(body.ok).toBe(true);
    expect(mock.paths.value).toContain('/health');
  });

  it('cosyvoice branch reports model-loading on 503', async () => {
    saveStoredConfig(tmpRoot, { version: 1, cosyvoice: { endpoint: mock.url } });
    mock.setHealthStatus(503);
    const res = await testService('cosyvoice');
    const body = await res.json() as { ok: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain('加载');
  });

  it('voxcpm branch behavior unchanged: probes the bare endpoint', async () => {
    saveStoredConfig(tmpRoot, { version: 1, voxcpm: { endpoint: mock.url } });
    const res = await testService('voxcpm');
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(mock.paths.value).toContain('/');
    expect(mock.paths.value).not.toContain('/health');
  });
});
