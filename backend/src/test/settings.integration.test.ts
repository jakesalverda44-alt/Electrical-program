import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

// These hit a real Postgres via supertest (CI postgres service) and skip
// automatically when no database is reachable locally.
let ok = false;
beforeAll(async () => {
  ok = await dbAvailable();
  if (!ok) return;
  // Seed a mix of app-required and sensitive settings.
  const seed: Array<[string, string]> = [
    ['company_name', 'IT Test Co'],
    ['currency_code', 'USD'],
    ['ai_enabled', 'true'],
    ['ai_anthropic_key', 'sk-ant-secret-abcd1234'],
    ['email_resend_api_key', 're_secret_efgh5678'],
    ['ai_prompt_agent1', 'custom takeoff prompt'],
    ['unit_cost_library', '[{"item":"EMT 3/4","cost":4.2}]'],
    ['notifications_json', '{"reminders":{"recipients":["boss@test.local"]}}'],
  ];
  for (const [key, value] of seed) {
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  }
}, 30_000);

const keysOf = (body: Array<{ key: string }>) => body.map(r => r.key);

describe('settings access control (integration)', () => {
  it('gives a non-admin only the app-required keys — no secrets or config', async (ctx) => {
    if (!ok) return ctx.skip();
    const sales = await makeUser('salesperson');
    const res = await request(app).get('/api/settings').set(auth(sales.token)).expect(200);
    const keys = keysOf(res.body);

    expect(keys).toContain('company_name');
    expect(keys).toContain('currency_code');
    expect(keys).toContain('ai_enabled');

    for (const hidden of [
      'ai_anthropic_key', 'email_resend_api_key', 'ai_prompt_agent1',
      'unit_cost_library', 'notifications_json',
    ]) {
      expect(keys).not.toContain(hidden);
    }
  });

  it('gives an admin the full list with secret values masked', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    const res = await request(app).get('/api/settings').set(auth(admin.token)).expect(200);
    const byKey = Object.fromEntries(res.body.map((r: { key: string; value: string }) => [r.key, r.value]));

    expect(byKey.ai_prompt_agent1).toBe('custom takeoff prompt');
    expect(byKey.ai_anthropic_key).toBe('••••••••1234');
    expect(byKey.email_resend_api_key).toBe('••••••••5678');
    expect(Object.keys(byKey)).not.toContain('jwt_secret');
  });

  it('still blocks non-admin writes', async (ctx) => {
    if (!ok) return ctx.skip();
    const sales = await makeUser('salesperson');
    await request(app).put('/api/settings').set(auth(sales.token))
      .send({ company_name: 'Hacked' }).expect(403);
  });
});
