// The per-kW price benchmark must not average in install-only proposals (no generator in
// the price), or real installs get false "% above avg" flags in the builder.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { BENCHMARK_SQL } from '../routes/gens';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('benchmark excludes install-only', () => {
  it('the SQL filters on jobType', () => {
    expect(BENCHMARK_SQL).toContain(`COALESCE(form_data->>'jobType','') <> 'install-only'`);
    expect(BENCHMARK_SQL).toContain(`stage = 'awarded'`);
  });

  it('GET /gens/benchmark ignores awarded install-only rows', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    // A kW no other test uses, so existing awarded rows can't interfere.
    const kw = 913;
    const insert = (jobType: string | null, amount: number) => pool.query(
      `INSERT INTO generator_proposals (customer, loc, mfr, model, kw, amount, stage, form_data, salesperson_id, salesperson_name)
       VALUES ($1,'x','Kohler','x',$2,$3,'awarded',$4::jsonb,$5,$6)`,
      [`Bench ${jobType}`, kw, amount, JSON.stringify(jobType ? { jobType } : {}), u.id, u.name],
    );
    await insert('new-install', 20000);
    await insert('swap-out', 10000);
    await insert('install-only', 1000);
    try {
      const res = await request(app).get('/api/gens/benchmark').set(auth(u.token)).expect(200);
      const row = (res.body as { kw: number; count: number; avgAmount: number }[]).find(r => r.kw === kw);
      expect(row).toBeTruthy();
      expect(row!.count).toBe(2);
      expect(row!.avgAmount).toBe(15000);
    } finally {
      await pool.query(`DELETE FROM generator_proposals WHERE kw = $1`, [kw]);
    }
  });
});
