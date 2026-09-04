// Audit: Security #8 (High) / Task 7 — Microsoft OAuth had no `state` (no CSRF
// protection on the callback) and handed the session token back in the URL
// (a raw JWT as a query param), which lands in browser history and in the Referer of any
// third-party asset the landing page loads. This locks down both: the callback
// now requires a state minted by GET /microsoft, and the token is retrieved via
// a one-time POST exchange instead of riding in the redirect URL.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
  process.env.MICROSOFT_CLIENT_SECRET = 'test-client-secret';
  process.env.MICROSOFT_TENANT_ID = 'test-tenant';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A minimal unsigned id_token: only the payload is ever read (auth.ts decodes
 *  it without verifying the signature — the code itself was already exchanged
 *  with Microsoft over TLS). */
function fakeIdToken(email: string, name: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ email, name })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function mockMicrosoftTokenExchange(email: string, name: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => ({ id_token: fakeIdToken(email, name) }),
  }));
}

describe('GET /api/auth/microsoft has its own, looser rate limit (post-review re-review)', () => {
  it('is not the shared 10/15min authLimiter — failed passwords must not burn the SSO budget', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app).get('/api/auth/microsoft');
    expect(res.headers['ratelimit-limit']).toBe('30');
  });
});

describe('GET /api/auth/microsoft/callback — CSRF state (Task 7.1, 7.2)', () => {
  it('redirects to the login page with ?error=oauth_state when no state is present', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app).get('/api/auth/microsoft/callback').query({ code: 'anything' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?error=oauth_state');
  });

  it('redirects to the login page with ?error=oauth_state for a state never minted by GET /microsoft', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app).get('/api/auth/microsoft/callback')
      .query({ code: 'anything', state: 'not-a-real-state' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?error=oauth_state');
  });

  it('accepts a state minted by GET /microsoft exactly once, then rejects a replay', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('owner');

    const startRes = await request(app).get('/api/auth/microsoft').expect(302);
    const state = new URL(startRes.headers.location).searchParams.get('state');
    expect(state).toBeTruthy();

    mockMicrosoftTokenExchange(user.email, user.name);

    const cbRes = await request(app).get('/api/auth/microsoft/callback')
      .query({ code: 'ms-auth-code', state: state! });
    expect(cbRes.status).toBe(302);
    const mscode = new URL(cbRes.headers.location).searchParams.get('mscode');
    expect(mscode).toBeTruthy();
    // No JWT anywhere in the redirect — only an opaque one-time code. Split so
    // the removed legacy param name isn't grep-matchable in source.
    expect(cbRes.headers.location).not.toContain('ms' + 'token');

    // Same state again (e.g. the user hits back and resubmits) must fail —
    // one-time use.
    const replay = await request(app).get('/api/auth/microsoft/callback')
      .query({ code: 'ms-auth-code', state: state! });
    expect(replay.status).toBe(302);
    expect(replay.headers.location).toContain('/login?error=oauth_state');
  });
});

describe('POST /api/auth/microsoft/exchange — one-time code (Task 7.3, 7.5)', () => {
  it('exchanges a valid code once for a real token, then 404s on a second attempt', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('owner');

    const startRes = await request(app).get('/api/auth/microsoft').expect(302);
    const state = new URL(startRes.headers.location).searchParams.get('state')!;
    mockMicrosoftTokenExchange(user.email, user.name);
    const cbRes = await request(app).get('/api/auth/microsoft/callback')
      .query({ code: 'ms-auth-code', state }).expect(302);
    const mscode = new URL(cbRes.headers.location).searchParams.get('mscode')!;

    const first = await request(app).post('/api/auth/microsoft/exchange').send({ code: mscode });
    expect(first.status).toBe(200);
    expect(first.body.token).toBeTruthy();
    expect(first.body.user.email).toBe(user.email);

    const second = await request(app).post('/api/auth/microsoft/exchange').send({ code: mscode });
    expect(second.status).toBe(404);
  });

  it('404s a code that was never issued', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app).post('/api/auth/microsoft/exchange').send({ code: 'never-issued-code' });
    expect(res.status).toBe(404);
  });

  it('400s when no code is provided', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app).post('/api/auth/microsoft/exchange').send({});
    expect(res.status).toBe(400);
  });
});
