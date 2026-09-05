// Audit: Security #2 (High) / Task 4 — GET /api/settings is requireAuth only (any
// role, including read_only), and used to return every app_settings row except
// jwt_secret. vapid_private_key let any logged-in user forge push notifications
// to staff phones. This locks INTERNAL_KEYS down and confirms masking still works.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

// This file seeds real-looking values into shared `app_settings` rows
// (vapid_private_key, jwt_secret, vapid_public_key, ai_anthropic_key) to
// prove they're masked/withheld. Other test files in the same run read
// ai_anthropic_key through getSetting() to assert AI routes 503 when no key
// is configured (e.g. prebid.test.ts's "passes validation but 503s..."); since
// the test DB is not reset between files, an unclean ai_anthropic_key row left
// behind here made that test order-dependent. Delete every row this file
// seeds once its own tests are done, so it never leaks into another file.
afterAll(async () => {
  if (!ok) return;
  await pool.query(
    `DELETE FROM app_settings WHERE key IN ('vapid_private_key','jwt_secret','vapid_public_key','ai_anthropic_key')`
  );
});

describe('GET /api/settings — internal keys never leave the server (Task 4)', () => {
  it('a non-admin authenticated GET never returns vapid_private_key or jwt_secret', async (ctx) => {
    if (!ok) return ctx.skip();
    // Seed both — vapid_private_key mirrors what integrations/webPush.ts writes on
    // first run; jwt_secret mirrors middleware/auth.ts's bootstrap.
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('vapid_private_key', 'super-secret-vapid-key')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    );
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('jwt_secret', 'super-secret-jwt-key')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    );

    const salesperson = await makeUser('salesperson');
    const res = await request(app).get('/api/settings').set(auth(salesperson.token)).expect(200);
    const keys = (res.body as { key: string; value: string }[]).map(r => r.key);
    expect(keys).not.toContain('vapid_private_key');
    expect(keys).not.toContain('jwt_secret');
  });

  it('vapid_public_key is still returned (it is meant to be public)', async (ctx) => {
    if (!ok) return ctx.skip();
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('vapid_public_key', 'a-public-vapid-key')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    );
    const salesperson = await makeUser('salesperson');
    const res = await request(app).get('/api/settings').set(auth(salesperson.token)).expect(200);
    const byKey = Object.fromEntries((res.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    expect(byKey.vapid_public_key).toBe('a-public-vapid-key');
  });

  it('masked keys (e.g. ai_anthropic_key) are returned obscured, not in the clear', async (ctx) => {
    if (!ok) return ctx.skip();
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('ai_anthropic_key', 'sk-ant-realsecretvalue1234')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    );
    const salesperson = await makeUser('salesperson');
    const res = await request(app).get('/api/settings').set(auth(salesperson.token)).expect(200);
    const byKey = Object.fromEntries((res.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    expect(byKey.ai_anthropic_key).toBeDefined();
    expect(byKey.ai_anthropic_key).not.toBe('sk-ant-realsecretvalue1234');
    expect(byKey.ai_anthropic_key.startsWith('••••••••')).toBe(true);
    expect(byKey.ai_anthropic_key.endsWith('1234')).toBe(true);
  });

  it('PUT /api/settings cannot be used to set or read back vapid_private_key (not in ALLOWED_KEYS)', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ vapid_private_key: 'attacker-supplied-value' })
      .expect(200);
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key='vapid_private_key'`);
    // Unchanged from whatever was seeded above — the PUT loop only ever writes
    // keys present in ALLOWED_KEYS, and vapid_private_key is not one of them.
    expect(rows[0]?.value).not.toBe('attacker-supplied-value');
  });
});
