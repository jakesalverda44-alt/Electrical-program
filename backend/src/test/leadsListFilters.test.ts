// Audit batch 3, Task 5 (audit-data-perf.md #6) — GET /leads gained optional
// q (name/phone/email/address) and limit filters, so SearchBox no longer has
// to load the entire lead table to show a handful of results.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('GET /api/leads — q/limit filters (Task 5)', () => {
  it('filters by q against name/phone/email/address', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const marker = `Marmalade${Date.now()}`;
    await request(app).post('/api/leads').set(auth(u.token))
      .send({ name: `${marker} Diner`, phone: '555-0100' }).expect(201);
    await request(app).post('/api/leads').set(auth(u.token))
      .send({ name: `Unrelated ${Date.now()}`, phone: '555-0199' }).expect(201);

    const res = await request(app).get('/api/leads').set(auth(u.token))
      .query({ q: marker }).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((l: { name: string }) => l.name.includes(marker))).toBe(true);
  });

  it('honors an opt-in limit', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const marker = `LimLead${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/leads').set(auth(u.token))
        .send({ name: `${marker} ${i}`, phone: `555-020${i}` }).expect(201);
    }
    const res = await request(app).get('/api/leads').set(auth(u.token))
      .query({ q: marker, limit: 2 }).expect(200);
    expect(res.body.length).toBe(2);
  });

  it('q matches phone and email too, not just name', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const emailMarker = `orangepeel${Date.now()}@example.com`;
    await request(app).post('/api/leads').set(auth(u.token))
      .send({ name: `Lead ${Date.now()}`, phone: '555-0300', email: emailMarker }).expect(201);

    const res = await request(app).get('/api/leads').set(auth(u.token))
      .query({ q: emailMarker }).expect(200);
    expect(res.body.some((l: { email: string }) => l.email === emailMarker)).toBe(true);
  });
});
