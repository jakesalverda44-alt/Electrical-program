// Phase 4 Task 3.4 — POST /bids/p/:token/sign: stamps + awards + won_job
// created, through the SAME shared stage-transition path (services/bidStage.ts)
// PATCH /:id/stage uses; double-sign is idempotent (never re-stamps/re-awards);
// an oversized signature data URL is rejected.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function createBid(token: string, amount = 250_000) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({
      name: `Sign Test ${Date.now()}`,
      gc: `Sign Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      amount,
    })
    .expect(200);
  return res.body as { id: string; proposal_token: string; stage: string; salesperson_id: string };
}

const SMALL_SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('POST /bids/p/:token/sign', () => {
  it('400s with no signature', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    const res = await request(app).post(`/api/bids/p/${bid.proposal_token}/sign`)
      .send({ signerName: 'John Smith' })
      .expect(400);
    expect(res.body.error).toMatch(/Signature required/);
  });

  it('400s with no typed name', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await request(app).post(`/api/bids/p/${bid.proposal_token}/sign`)
      .send({ signatureDataUrl: SMALL_SIG })
      .expect(400);
  });

  it('rejects an oversized signature data URL', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    const oversized = 'data:image/png;base64,' + 'A'.repeat(70_000);
    const res = await request(app).post(`/api/bids/p/${bid.proposal_token}/sign`)
      .send({ signerName: 'John Smith', signatureDataUrl: oversized })
      .expect(400);
    expect(res.body.error).toMatch(/too large/);
    const { rows } = await pool.query('SELECT proposal_signed_at FROM bids WHERE id=$1', [bid.id]);
    expect(rows[0].proposal_signed_at).toBeNull();
  });

  it('404s on an unknown token', async (ctx) => {
    if (!ok) return ctx.skip();
    await request(app).post('/api/bids/p/00000000-0000-0000-0000-000000000000/sign')
      .send({ signerName: 'John Smith', signatureDataUrl: SMALL_SIG })
      .expect(404);
  });

  it('stamps signature/signer, writes proposal_activity, awards through the shared stage path, and creates won_jobs', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token, 300_000);
    expect(bid.stage).toBe('due');

    const res = await request(app).post(`/api/bids/p/${bid.proposal_token}/sign`)
      .send({ signerName: 'John Smith', signatureDataUrl: SMALL_SIG })
      .expect(200);

    expect(res.body.bid.stage).toBe('awarded');
    expect(res.body.wonJob).toBeTruthy();
    expect(res.body.wonJob.value).toBe('300000.00');

    const { rows: bidRows } = await pool.query(
      `SELECT proposal_signed_at, signer_name, signature_data, stage, awarded_at FROM bids WHERE id=$1`, [bid.id]
    );
    expect(bidRows[0].proposal_signed_at).not.toBeNull();
    expect(bidRows[0].signer_name).toBe('John Smith');
    expect(bidRows[0].signature_data).toBe(SMALL_SIG);
    expect(bidRows[0].stage).toBe('awarded');
    expect(bidRows[0].awarded_at).not.toBeNull();

    // won_job created (same effect a manual award produces).
    const { rows: wonJobRows } = await pool.query(`SELECT * FROM won_jobs WHERE proposal_id=$1`, [bid.id]);
    expect(wonJobRows.length).toBe(1);
    expect(wonJobRows[0].proposal_type).toBe('Electrical');

    // A project registry row exists (ensureProject side effect of transitionBidStage).
    const { rows: projectRows } = await pool.query(`SELECT * FROM projects WHERE id=$1`, [bid.id]);
    expect(projectRows.length).toBe(1);

    // proposal_activity timeline has a 'signed' row.
    const { rows: activityRows } = await pool.query(
      `SELECT kind, direction FROM proposal_activity WHERE bid_id=$1 AND kind='signed'`, [bid.id]
    );
    expect(activityRows.length).toBe(1);
    expect(activityRows[0].direction).toBe('in');
  });

  it('a second sign attempt is idempotent — returns the signed state unchanged, never re-stamps or re-awards', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token, 150_000);
    await request(app).post(`/api/bids/p/${bid.proposal_token}/sign`)
      .send({ signerName: 'John Smith', signatureDataUrl: SMALL_SIG })
      .expect(200);
    const { rows: firstStamp } = await pool.query('SELECT proposal_signed_at FROM bids WHERE id=$1', [bid.id]);

    await new Promise(r => setTimeout(r, 20));
    const second = await request(app).post(`/api/bids/p/${bid.proposal_token}/sign`)
      .send({ signerName: 'Someone Else', signatureDataUrl: SMALL_SIG })
      .expect(200);
    expect(second.body.alreadySigned).toBe(true);

    const { rows: afterSecond } = await pool.query('SELECT proposal_signed_at, signer_name FROM bids WHERE id=$1', [bid.id]);
    expect(new Date(afterSecond[0].proposal_signed_at).getTime()).toBe(new Date(firstStamp[0].proposal_signed_at).getTime());
    // Original signer name is untouched by the second attempt.
    expect(afterSecond[0].signer_name).toBe('John Smith');

    // Still exactly one won_job and one 'signed' activity row — no duplicate award.
    const { rows: wonJobRows } = await pool.query(`SELECT * FROM won_jobs WHERE proposal_id=$1`, [bid.id]);
    expect(wonJobRows.length).toBe(1);
    const { rows: activityRows } = await pool.query(
      `SELECT 1 FROM proposal_activity WHERE bid_id=$1 AND kind='signed'`, [bid.id]
    );
    expect(activityRows.length).toBe(1);
  });

  it('signing a bid already manually awarded stamps the signature without double-awarding', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token, 90_000);
    await request(app).patch(`/api/bids/${bid.id}/stage`).set(auth(u.token)).send({ stage: 'awarded' }).expect(200);

    const res = await request(app).post(`/api/bids/p/${bid.proposal_token}/sign`)
      .send({ signerName: 'John Smith', signatureDataUrl: SMALL_SIG })
      .expect(200);
    expect(res.body.bid.stage).toBe('awarded');

    const { rows: wonJobRows } = await pool.query(`SELECT * FROM won_jobs WHERE proposal_id=$1`, [bid.id]);
    expect(wonJobRows.length).toBe(1);
  });
});
