// Audit: Ops #7 / Security #12 (log redaction), Ops #13 (trust proxy + DB health
// check) / Task 9.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { app, LOG_REDACT_PATHS } from '../index';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/health — checks the database, not just the process (Task 9.3)', () => {
  it('returns { ok: true, db: true } when the database is reachable', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: true });
  });

  it('returns 503 { ok: false, db: false } when the database query fails', async (ctx) => {
    if (!ok) return ctx.skip();
    vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('simulated DB outage'));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, db: false });
  });
});

describe('Request logging redacts credentials (Task 9.1)', () => {
  it('LOG_REDACT_PATHS covers Authorization, X-API-Key, cookies, and Set-Cookie', () => {
    expect(LOG_REDACT_PATHS).toEqual(expect.arrayContaining([
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ]));
  });

  it('a logged request with an Authorization header replaces the value with [Redacted]', () => {
    const lines: string[] = [];
    const testLogger = pino({ redact: LOG_REDACT_PATHS }, { write: (line: string) => { lines.push(line); } });

    testLogger.info({
      req: {
        headers: {
          authorization: 'Bearer super-secret-jwt-value',
          'x-api-key': 'super-secret-api-key',
          cookie: 'session=super-secret-cookie',
        },
      },
    }, 'request received');

    expect(lines.length).toBe(1);
    const logged = JSON.parse(lines[0]);
    expect(logged.req.headers.authorization).toBe('[Redacted]');
    expect(logged.req.headers['x-api-key']).toBe('[Redacted]');
    expect(logged.req.headers.cookie).toBe('[Redacted]');
    // The secret values must never appear anywhere in the log line.
    expect(lines[0]).not.toContain('super-secret-jwt-value');
    expect(lines[0]).not.toContain('super-secret-api-key');
    expect(lines[0]).not.toContain('super-secret-cookie');
  });
});

describe('trust proxy is enabled in production only (Task 9.2)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.resetModules();
  });

  it('is not set under NODE_ENV=test (current behavior, unaffected)', () => {
    expect(app.get('trust proxy')).toBeFalsy();
  });

  it('is set to 1 when the module loads under NODE_ENV=production', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    const prodModule = await import('../index');
    expect(prodModule.app.get('trust proxy')).toBe(1);
  });
});
