// Audit batch 3, Task 5 (audit-data-perf.md #6) — GET /documents gained
// optional q (name/display_name ILIKE), category, and limit filters so
// callers don't have to fetch the whole table and filter client-side.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function upload(token: string, opts: { linked_id?: string; linked_name?: string; display_name: string; category: string }) {
  const res = await request(app).post('/api/documents').set(auth(token))
    .field('display_name', opts.display_name)
    .field('category', opts.category)
    .field('div', 'elec')
    .field('linked_id', opts.linked_id ?? '')
    .field('linked_name', opts.linked_name ?? '')
    .attach('file', Buffer.from('test file bytes'), 'file.txt')
    .expect(200);
  return res.body.id as string;
}

describe('GET /api/documents — q/category/linked_id filters (Task 5)', () => {
  it('filters by linked_id', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidA = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `Filt A ${Date.now()}`, gc: 'G' }).expect(200);
    const bidB = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `Filt B ${Date.now()}`, gc: 'G' }).expect(200);
    await upload(u.token, { linked_id: bidA.body.id, display_name: 'Doc A', category: 'plans' });
    await upload(u.token, { linked_id: bidB.body.id, display_name: 'Doc B', category: 'plans' });

    const res = await request(app).get('/api/documents').set(auth(u.token))
      .query({ linked_id: bidA.body.id }).expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].linked_id).toBe(bidA.body.id);
  });

  it('filters by q against name/display_name', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const marker = `Zephyr${Date.now()}`;
    await upload(u.token, { display_name: `${marker} Contract.pdf`, category: 'contract' });
    await upload(u.token, { display_name: `Unrelated ${Date.now()}.pdf`, category: 'contract' });

    const res = await request(app).get('/api/documents').set(auth(u.token))
      .query({ q: marker }).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((d: { display_name: string }) => d.display_name.includes(marker))).toBe(true);
  });

  it('filters by q against linked_name (post-review B1 — the project/GC name a doc is attached to)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const marker = `AcmeGC${Date.now()}`;
    await upload(u.token, { display_name: 'Signed Contract.pdf', linked_name: marker, category: 'contract' });
    await upload(u.token, { display_name: 'Unrelated.pdf', linked_name: `Other GC ${Date.now()}`, category: 'contract' });

    const res = await request(app).get('/api/documents').set(auth(u.token))
      .query({ q: marker }).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((d: { linked_name: string }) => d.linked_name.includes(marker))).toBe(true);
  });

  it('filters by category', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const marker = `CatFilt${Date.now()}`;
    await upload(u.token, { display_name: `${marker} plans`, category: 'plans' });
    await upload(u.token, { display_name: `${marker} invoice`, category: 'invoice' });

    const res = await request(app).get('/api/documents').set(auth(u.token))
      .query({ q: marker, category: 'plans' }).expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].category).toBe('plans');
  });

  it('applies an opt-in limit', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const marker = `LimFilt${Date.now()}`;
    await upload(u.token, { display_name: `${marker} one`, category: 'other' });
    await upload(u.token, { display_name: `${marker} two`, category: 'other' });
    await upload(u.token, { display_name: `${marker} three`, category: 'other' });

    const res = await request(app).get('/api/documents').set(auth(u.token))
      .query({ q: marker, limit: 2 }).expect(200);
    expect(res.body.length).toBe(2);
  });

  // Hardening 5b — an explicit limit above the cap is clamped, not honored.
  it('clamps an oversized limit to 200', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const res = await request(app).get('/api/documents').set(auth(u.token))
      .query({ limit: 999999 }).expect(200);
    expect(res.body.length).toBeLessThanOrEqual(200);
  });

  // Hardening 5b — a literal `%`/`_` in the search text must match that
  // literal character, not act as an ILIKE wildcard.
  it('treats a literal % in q as a literal character, not an ILIKE wildcard', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const stamp = Date.now();
    await upload(u.token, { display_name: `50% Off Electric ${stamp}.pdf`, category: 'other' });
    await upload(u.token, { display_name: `50X Off Electric ${stamp}.pdf`, category: 'other' });

    const res = await request(app).get('/api/documents').set(auth(u.token))
      .query({ q: `50% Off Electric ${stamp}` }).expect(200);
    const names = res.body.map((d: { display_name: string }) => d.display_name);
    expect(names).toContain(`50% Off Electric ${stamp}.pdf`);
    expect(names).not.toContain(`50X Off Electric ${stamp}.pdf`);
  });
});
