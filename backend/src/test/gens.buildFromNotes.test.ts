// build-from-notes with a MOCKED Anthropic client (no live AI): an install-only extraction must
// not have battery forced on, must take prices from the company defaults, and must store
// totals that match the Install Only calc. New-install behavior is unchanged.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

let nextAiJson = '{}';
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async () => ({ content: [{ type: 'text', text: nextAiJson }] }) };
  },
}));

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
const prevKey = process.env.ANTHROPIC_API_KEY;
beforeAll(async () => { ok = await dbAvailable(); process.env.ANTHROPIC_API_KEY = 'test-key'; }, 30_000);
afterAll(() => { if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });

async function createGen(token: string) {
  const res = await request(app).post('/api/gens').set(auth(token))
    .send({ customer: `BFN ${Date.now()}`, mfr: 'Kohler', model: '14KW', kw: 14, amount: 1 }).expect(200);
  return res.body as { id: string };
}

describe('POST /gens/:id/build-from-notes — install-only', () => {
  it('does not force battery on, zeroes the generator price, and uses io pricing', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    nextAiJson = JSON.stringify({
      customer: 'Pat Owner', jobType: 'install-only', brand: 'Generac', coolingType: 'air-cooled', size: '22KW',
      battery: false, pad: true, labor: 3000, permit: 1250, genPriceOverride: 9999, extWarranty: 'paid',
      installOnly: { setGenerator: true, ats: 'existing', conduit: 'wire-only', runFt: 30, gas: false, permit: true, prices: { connect: 1 } },
    });
    const res = await request(app).post(`/api/gens/${gen.id}/build-from-notes`).set(auth(u.token))
      .send({ notes: 'Customer supplies the generator, wire pull only, 30 ft' }).expect(200);
    const f = res.body.form_data;
    expect(f.jobType).toBe('install-only');
    expect(f.battery).toBe(false);                 // an explicit "no" is honored, not forced to true
    expect(f.genPriceOverride).toBeNull();
    expect(f.extWarranty).toBe('none');
    expect(f.installOnly).toMatchObject({ ats: 'existing', conduit: 'wire-only', runFt: 30 });
    expect(f.installOnly.prices.connect).toBe(450);  // AI-supplied prices are ignored
    const t = res.body.totals_data;
    expect(t.genP).toBe(0);
    expect(t.batteryAmt).toBe(0);
    expect(t.ioConduitAmt).toBe(250 + 30 * 12);
    // The AI stated labor 3000 / permit 1250 (the new-install defaults it knows): ignored.
    expect(t.laborAmt).toBe(0);
    expect(t.permitAmt).toBe(475);
    expect(f.labor).toBe(0);
    expect(f.permit).toBe(475);
  });

  it('new-install still forces battery on', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    nextAiJson = JSON.stringify({ customer: 'Ann', jobType: 'new-install', brand: 'Kohler', size: '20KW', battery: false });
    const res = await request(app).post(`/api/gens/${gen.id}/build-from-notes`).set(auth(u.token))
      .send({ notes: 'standard install' }).expect(200);
    expect(res.body.form_data.battery).toBe(true);
    expect(res.body.totals_data.batteryAmt).toBe(185);
    expect(res.body.form_data.installOnly).toBeUndefined();
  });
});

afterAll(async () => { await pool.query(`DELETE FROM generator_proposals WHERE customer LIKE 'BFN %'`).catch(() => {}); });
