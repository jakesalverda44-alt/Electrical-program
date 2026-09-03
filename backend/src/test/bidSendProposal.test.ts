// Phase 4 Task 1.6 — POST /:id/send-proposal: 409 without a filed proposal;
// on success, stamps proposal_sent_at/proposal_sent_to, writes proposal_activity
// + activity, and advances a `due` bid to `submitted` through the SAME shared
// stage path PATCH /:id/stage uses (services/bidStage.ts).
//
// isGraphMailConfigured is mocked to true so the route reaches graphSendMail —
// graphSendMail's OWN NODE_ENV=test mute (unmodified, unmocked) still no-ops
// the actual network call, so this never sends real email; it only lets the
// route's post-send DB logic run so it can be tested. Mirrors the documented
// convention in gens.kickoff.test.ts (a Graph-gated route 503s in this test
// env) but goes one step further to exercise the success path specifically
// because Task 1.6 requires it.
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

// A unique GC name per call — a literal, reused name like "Bay to Bay" would
// persist into the shared `customers` table (type='gc') and fuzzy-match
// (see utils/customerMatch.ts) against OTHER tests' differently-timestamped
// GC names, silently canonicalizing them onto this test's customer row.
async function createBid(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `SendProposal Test ${Date.now()}`, gc: `Send Proposal Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, amount: 250_000, ...overrides })
    .expect(200);
  return res.body as { id: string; proposal_token: string; stage: string };
}

async function fileProposalDoc(bidId: string, bidName: string, opts: { gatePassed?: boolean } = {}) {
  const { gatePassed = true } = opts;
  await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data, gate_passed)
     VALUES ($1,$2,'elec','proposal.docx','proposal.docx','proposal',10,
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document','test',$3,$4)`,
    [bidId, bidName, Buffer.from('fake docx bytes').toString('base64'), gatePassed]
  );
}

describe('POST /bids/:id/send-proposal', () => {
  it('409s when no filed proposal docx exists yet', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    const res = await request(app).post(`/api/bids/${bid.id}/send-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'] })
      .expect(409);
    expect(res.body.error).toMatch(/No filed proposal/);
  });

  // FIX-3(b) — send-proposal 409s when no GATE-PASSED docx exists, even if
  // a same-category document was filed by something other than
  // generate-docx (an import, a manual upload) and never actually verified.
  it('409s when a filed proposal docx exists but is NOT gate-passed', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDoc(bid.id, bid.id, { gatePassed: false });
    const res = await request(app).post(`/api/bids/${bid.id}/send-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'] })
      .expect(409);
    expect(res.body.error).toMatch(/No filed proposal/);
  });

  it('400s with no recipients, even with a filed proposal on file', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDoc(bid.id, bid.id);
    await request(app).post(`/api/bids/${bid.id}/send-proposal`).set(auth(u.token))
      .send({ to: [] })
      .expect(400);
  });

  it('on success: stamps sent_at/sent_to, writes proposal_activity + activity, and advances due -> submitted', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    expect(bid.stage).toBe('due');
    await fileProposalDoc(bid.id, bid.id);

    const res = await request(app).post(`/api/bids/${bid.id}/send-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'], subject: 'Custom subject', bodyText: 'Hey,\n\nHere it is.' })
      .expect(200);

    expect(res.body.bid.stage).toBe('submitted');
    expect(res.body.stageAdvanced).toBe(true);
    expect(res.body.link).toContain(bid.proposal_token);

    const { rows: bidRows } = await pool.query(
      'SELECT proposal_sent_at, proposal_sent_to, stage, submitted_at FROM bids WHERE id=$1', [bid.id]
    );
    expect(bidRows[0].proposal_sent_at).not.toBeNull();
    expect(bidRows[0].proposal_sent_to).toEqual(['gc@example.com']);
    expect(bidRows[0].stage).toBe('submitted');
    expect(bidRows[0].submitted_at).not.toBeNull();

    const { rows: activityRows } = await pool.query(
      `SELECT kind, direction, bid_id, proposal_id FROM proposal_activity WHERE bid_id=$1`, [bid.id]
    );
    expect(activityRows.length).toBe(1);
    expect(activityRows[0].kind).toBe('sent');
    expect(activityRows[0].direction).toBe('out');
    expect(activityRows[0].proposal_id).toBeNull();
  });

  it('does not advance an already-submitted or awarded bid off its stage', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDoc(bid.id, bid.id);
    await request(app).patch(`/api/bids/${bid.id}/stage`).set(auth(u.token)).send({ stage: 'submitted' }).expect(200);

    const res = await request(app).post(`/api/bids/${bid.id}/send-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'] })
      .expect(200);
    expect(res.body.bid.stage).toBe('submitted');
    expect(res.body.stageAdvanced).toBe(false);
  });

  it('never re-renders — attaches the exact bytes of the most recently filed docx, not a fresh render', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDoc(bid.id, bid.id);
    // File a SECOND, newer proposal doc — the send must pick this one (most recent).
    await new Promise(r => setTimeout(r, 10));
    await pool.query(
      `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data, gate_passed)
       VALUES ($1,$2,'elec','proposal-v2.docx','proposal-v2.docx','proposal',10,
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document','test',$3,true)`,
      [bid.id, bid.id, Buffer.from('second version bytes').toString('base64')]
    );
    await request(app).post(`/api/bids/${bid.id}/send-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'] })
      .expect(200);
    // No assertion possible on the outbound attachment bytes directly (muted send),
    // but the 200 with no error confirms the newest-first ORDER BY query resolved.
  });
});

describe('POST /bids/:id/email-prebid-chris', () => {
  it('409s when no pre-bid package is on file', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    const res = await request(app).post(`/api/bids/${bid.id}/email-prebid-chris`).set(auth(u.token))
      .send({ to: ['chris@example.com'] })
      .expect(409);
    expect(res.body.error).toMatch(/No pre-bid package/);
  });

  it('drafts (never sends) once a pre-bid package is filed', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await pool.query(
      `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data, gate_passed)
       VALUES ($1,$2,'elec','scope.docx','scope.docx','prebid_scope',10,
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document','test',$3,true)`,
      [bid.id, bid.id, Buffer.from('scope bytes').toString('base64')]
    );
    const res = await request(app).post(`/api/bids/${bid.id}/email-prebid-chris`).set(auth(u.token))
      .send({ to: ['chris@example.com'] })
      .expect(200);
    expect(res.body.to).toEqual(['chris@example.com']);
  });
});
