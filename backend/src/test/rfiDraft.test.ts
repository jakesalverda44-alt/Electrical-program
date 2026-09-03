// Phase 4 Task 5.5 — POST /preconstruction/:bidId/rfi-draft: builds a real
// Outlook DRAFT (mocked at graphMailer level so the still-muted noop draft
// is reachable under test — see bidSendProposal.test.ts for the same
// technique) and marks only the open RFIs it actually drafted as
// submitted:true, never touching ones already submitted.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../email/graphMailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../email/graphMailer')>();
  return { ...actual, isGraphMailConfigured: () => true };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function createBidWithContact(token: string, contact: string) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `RFI Draft Test ${Date.now()}`, gc: `RFI Draft Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}` })
    .expect(200);
  const bid = res.body as { id: string };
  await request(app).patch(`/api/bids/${bid.id}`).set(auth(token)).send({ contact }).expect(200);
  return bid.id as string;
}

async function seedRfis(bidId: string, rfis: { id: string; question: string; submitted: boolean; answer: string }[]) {
  await pool.query(
    `INSERT INTO bid_workspaces (bid_id, rfis) VALUES ($1,$2)
     ON CONFLICT (bid_id) DO UPDATE SET rfis=$2`,
    [bidId, JSON.stringify(rfis)]
  );
}

describe('POST /preconstruction/:bidId/rfi-draft', () => {
  it('400s when there are no open RFIs', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBidWithContact(u.token, 'gc@example.com');
    await seedRfis(bidId, [{ id: '1', question: 'Already asked', submitted: true, answer: '' }]);
    const res = await request(app).post(`/api/preconstruction/${bidId}/rfi-draft`).set(auth(u.token)).expect(400);
    expect(res.body.error).toMatch(/No open RFIs/);
  });

  it('400s when the bid has no usable contact email', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBidWithContact(u.token, 'John Smith, 555-1234');
    await seedRfis(bidId, [{ id: '1', question: 'What is the fault current?', submitted: false, answer: '' }]);
    const res = await request(app).post(`/api/preconstruction/${bidId}/rfi-draft`).set(auth(u.token)).expect(400);
    expect(res.body.error).toMatch(/contact email/);
  });

  it('drafts the open RFIs and marks only those submitted, leaving already-submitted RFIs untouched', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBidWithContact(u.token, 'gc@example.com');
    await seedRfis(bidId, [
      { id: '1', question: 'Already asked', submitted: true, answer: '' },
      { id: '2', question: 'Confirm service entrance rating.', submitted: false, answer: '' },
      { id: '3', question: 'Is a photometric plan required?', submitted: false, answer: '' },
    ]);

    const res = await request(app).post(`/api/preconstruction/${bidId}/rfi-draft`).set(auth(u.token)).expect(200);
    expect(res.body.submittedCount).toBe(2);
    expect(res.body.draftWebLink).toBeDefined();

    const { rows } = await pool.query('SELECT rfis FROM bid_workspaces WHERE bid_id=$1', [bidId]);
    const rfis = rows[0].rfis as { id: string; submitted: boolean }[];
    expect(rfis.find(r => r.id === '1')!.submitted).toBe(true);
    expect(rfis.find(r => r.id === '2')!.submitted).toBe(true);
    expect(rfis.find(r => r.id === '3')!.submitted).toBe(true);
  });
});
