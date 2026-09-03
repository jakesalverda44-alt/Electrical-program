// Task 6 (phase 1 estimating chain): PATCH /bids/:id/stage used to null out
// loss_reason and competitor on ANY stage move, not just moves that set the new
// stage away from 'lost' deliberately — a bid marked lost -> due (reopened) -> lost
// again lost the reason recorded the first time, because the UPDATE wrote
// loss_reason/competitor unconditionally from request body fields that are only
// ever populated when the caller is setting stage to 'lost'.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('PATCH /bids/:id/stage — loss_reason and competitor survive a reopen', () => {
  it('keeps loss_reason/competitor when a lost bid moves off lost, and restores them on a second loss', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Reopen ${Date.now()}`, gc: 'G' }).expect(200);
    const id = bid.body.id as string;

    const lost1 = await request(app).patch(`/api/bids/${id}/stage`).set(auth(u.token))
      .send({ stage: 'lost', loss_reason: 'Price too high', competitor: 'Acme Electric' })
      .expect(200);
    expect(lost1.body.bid.loss_reason).toBe('Price too high');
    expect(lost1.body.bid.competitor).toBe('Acme Electric');

    // Reopen — moving off 'lost' must not erase what was just recorded.
    const reopened = await request(app).patch(`/api/bids/${id}/stage`).set(auth(u.token))
      .send({ stage: 'due' })
      .expect(200);
    expect(reopened.body.bid.loss_reason).toBe('Price too high');
    expect(reopened.body.bid.competitor).toBe('Acme Electric');

    // Move to submitted too — same guarantee for any non-'lost' stage, not just 'due'.
    const submitted = await request(app).patch(`/api/bids/${id}/stage`).set(auth(u.token))
      .send({ stage: 'submitted' })
      .expect(200);
    expect(submitted.body.bid.loss_reason).toBe('Price too high');
    expect(submitted.body.bid.competitor).toBe('Acme Electric');

    // Lost again with a new reason — this write is deliberate and should replace it.
    const lost2 = await request(app).patch(`/api/bids/${id}/stage`).set(auth(u.token))
      .send({ stage: 'lost', loss_reason: 'Lost on schedule', competitor: 'Beta Electric' })
      .expect(200);
    expect(lost2.body.bid.loss_reason).toBe('Lost on schedule');
    expect(lost2.body.bid.competitor).toBe('Beta Electric');
  });

  // FIX-9 (post-review) — a same-day rewrite of this shared stage path
  // switched `|| null` to `?? null`, which only falls back on
  // null/undefined, not ''. An empty-string loss_reason/competitor (a form
  // field cleared before submitting the "lost" move) then stored '' in the
  // column instead of NULL — restored the `||` semantics.
  it('stores NULL, not empty string, for an empty-string loss_reason/competitor', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `EmptyLoss ${Date.now()}`, gc: 'G' }).expect(200);
    const id = bid.body.id as string;

    const lost = await request(app).patch(`/api/bids/${id}/stage`).set(auth(u.token))
      .send({ stage: 'lost', loss_reason: '', competitor: '' })
      .expect(200);
    expect(lost.body.bid.loss_reason).toBeNull();
    expect(lost.body.bid.competitor).toBeNull();
  });

  it('a bid never marked lost has null loss_reason/competitor through ordinary stage moves', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `NeverLost ${Date.now()}`, gc: 'G' }).expect(200);
    const id = bid.body.id as string;

    const submitted = await request(app).patch(`/api/bids/${id}/stage`).set(auth(u.token))
      .send({ stage: 'submitted' })
      .expect(200);
    expect(submitted.body.bid.loss_reason).toBeNull();
    expect(submitted.body.bid.competitor).toBeNull();
  });
});
