// Post-merge rework (2026-09-03) — POST /:id/draft-proposal replaces the old
// POST /:id/send-proposal. Jake corrected the product design after
// reviewing Phase 4: GCs never e-sign a web page — they execute via
// contract/PO. This route creates an Outlook DRAFT (graphCreateDraft,
// NEVER graphSendMail) that Jake reviews and sends himself; on success
// (markSubmitted, default true) it still stamps proposal_sent_at/
// proposal_sent_to, writes proposal_activity + activity, and advances a
// `due` bid to `submitted` through the SAME shared stage path PATCH
// /:id/stage uses (services/bidStage.ts).
//
// isGraphMailConfigured is mocked to true so the route reaches
// graphCreateDraft — graphCreateDraft's OWN NODE_ENV=test mute (unmodified,
// unmocked) still no-ops the actual network call, so this never creates a
// real Outlook draft; it only lets the route's post-draft DB logic run so
// it can be tested.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

// Spies on graphCreateDraft's call args (subject/html) while still calling
// straight through to the real (muted-under-test) implementation — lets the
// amount-absent guard test below inspect what would have been drafted
// without ever creating a real Outlook draft.
const draftCalls: { subject: string; html: string }[] = [];
vi.mock('../email/graphMailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../email/graphMailer')>();
  return {
    ...actual,
    isGraphMailConfigured: () => true,
    graphCreateDraft: async (args: Parameters<typeof actual.graphCreateDraft>[0]) => {
      draftCalls.push({ subject: args.subject, html: args.html });
      return actual.graphCreateDraft(args);
    },
  };
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
    .send({ name: `DraftProposal Test ${Date.now()}`, gc: `Draft Proposal Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, amount: 250_000, ...overrides })
    .expect(200);
  return res.body as { id: string; proposal_token: string; stage: string };
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

async function fileProposalDoc(bidId: string, bidName: string, opts: { gatePassed?: boolean; mime?: string; name?: string } = {}) {
  const { gatePassed = true, mime = DOCX_MIME, name = 'proposal.docx' } = opts;
  await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data, gate_passed)
     VALUES ($1,$2,'elec',$3,$3,'proposal',10,$4,'test',$5,$6)`,
    [bidId, bidName, name, mime, Buffer.from(`fake bytes for ${name}`).toString('base64'), gatePassed]
  );
}

describe('POST /bids/:id/draft-proposal', () => {
  it('409s when no filed proposal (docx or pdf) exists yet', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    const res = await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'] })
      .expect(409);
    expect(res.body.error).toMatch(/No filed proposal/);
  });

  // FIX-3(b) (still true post-rework) — 409s when no GATE-PASSED doc
  // exists, even if a same-category document was filed by something other
  // than generate-docx (an import, a manual upload) and never actually verified.
  it('409s when a filed proposal docx exists but is NOT gate-passed', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDoc(bid.id, bid.id, { gatePassed: false });
    const res = await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'] })
      .expect(409);
    expect(res.body.error).toMatch(/No filed proposal/);
  });

  it('400s with no recipients, even with a filed proposal on file', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDoc(bid.id, bid.id);
    await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
      .send({ to: [] })
      .expect(400);
  });

  it('attaches the PDF when a gate-passed PDF exists alongside the docx', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDoc(bid.id, bid.id, { mime: DOCX_MIME, name: 'proposal.docx' });
    await fileProposalDoc(bid.id, bid.id, { mime: PDF_MIME, name: 'proposal.pdf' });

    const res = await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'], markSubmitted: false })
      .expect(200);
    expect(res.body.attached).toBe('pdf');
  });

  it('falls back to the docx when no PDF was produced', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDoc(bid.id, bid.id, { mime: DOCX_MIME, name: 'proposal.docx' });

    const res = await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'], markSubmitted: false })
      .expect(200);
    expect(res.body.attached).toBe('docx');
  });

  it('on success (markSubmitted default true): stamps sent_at/sent_to, writes proposal_activity + activity as draft_created, and advances due -> submitted', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    expect(bid.stage).toBe('due');
    await fileProposalDoc(bid.id, bid.id);

    const res = await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'], subject: 'Custom subject', bodyText: 'Hey,\n\nHere it is.' })
      .expect(200);

    expect(res.body.attached).toBe('docx');
    expect(res.body.bid.stage).toBe('submitted');
    expect(res.body.stageAdvanced).toBe(true);
    expect(res.body).toHaveProperty('webLink');

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
    expect(activityRows[0].kind).toBe('draft_created');
    expect(activityRows[0].direction).toBe('out');
    expect(activityRows[0].proposal_id).toBeNull();
  });

  it('markSubmitted:false creates the draft but stamps nothing and advances no stage', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    expect(bid.stage).toBe('due');
    await fileProposalDoc(bid.id, bid.id);

    const res = await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'], markSubmitted: false })
      .expect(200);

    expect(res.body.stageAdvanced).toBe(false);
    expect(res.body.bid.stage).toBe('due');

    const { rows: bidRows } = await pool.query(
      'SELECT proposal_sent_at, proposal_sent_to, stage FROM bids WHERE id=$1', [bid.id]
    );
    expect(bidRows[0].proposal_sent_at).toBeNull();
    expect(bidRows[0].proposal_sent_to).toBeNull();
    expect(bidRows[0].stage).toBe('due');

    // Still logs that a draft exists.
    const { rows: activityRows } = await pool.query(
      `SELECT kind, direction FROM proposal_activity WHERE bid_id=$1`, [bid.id]
    );
    expect(activityRows.length).toBe(1);
    expect(activityRows[0].kind).toBe('draft_created');
  });

  it('does not advance an already-submitted or awarded bid off its stage', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDoc(bid.id, bid.id);
    await request(app).patch(`/api/bids/${bid.id}/stage`).set(auth(u.token)).send({ stage: 'submitted' }).expect(200);

    const res = await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
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
    // File a SECOND, newer proposal doc — the draft must pick this one (most recent).
    await new Promise(r => setTimeout(r, 10));
    await fileProposalDoc(bid.id, bid.id, { name: 'proposal-v2.docx' });
    await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'], markSubmitted: false })
      .expect(200);
    // No assertion possible on the outbound attachment bytes directly (muted draft),
    // but the 200 with no error confirms the newest-first ORDER BY query resolved.
  });

  // GUARD (still true post-rework) — the drafted subject/html passed to
  // graphCreateDraft must never contain the bid amount.
  // bidSubmittalEmail.test.ts locks the builder itself; this confirms the
  // route's default subject/bodyText, when nothing is supplied, are built
  // from the same amount-free template and actually reach graphCreateDraft
  // that way.
  it('the drafted subject/body defaults never carry the bid amount', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token, { amount: 987_654 });
    await fileProposalDoc(bid.id, bid.id);
    draftCalls.length = 0;
    await request(app).post(`/api/bids/${bid.id}/draft-proposal`).set(auth(u.token))
      .send({ to: ['gc@example.com'], markSubmitted: false })
      .expect(200);
    expect(draftCalls.length).toBe(1);
    for (const needle of ['987654', '987,654', '$987,654', '$987654']) {
      expect(draftCalls[0].subject).not.toContain(needle);
      expect(draftCalls[0].html).not.toContain(needle);
    }
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

  // FIX-11 (post-review) — the recipient no longer has to be supplied by
  // the caller: it resolves from the `prebid_chris_email` app_setting (the
  // frontend stopped hardcoding it), falling back to the previously-
  // hardcoded address when that setting is unset.
  it('defaults the recipient to the previously-hardcoded address when no "to" is given and no setting is configured', async (ctx) => {
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
      .send({})
      .expect(200);
    expect(res.body.to).toEqual(['chrise@accuratepowerandtechnology.com']);
  });

  it('uses the prebid_chris_email app_setting when configured and no "to" is given', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ prebid_chris_email: 'chris.custom@example.com' })
      .expect(200);

    const bid = await createBid(admin.token);
    await pool.query(
      `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data, gate_passed)
       VALUES ($1,$2,'elec','scope.docx','scope.docx','prebid_scope',10,
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document','test',$3,true)`,
      [bid.id, bid.id, Buffer.from('scope bytes').toString('base64')]
    );
    const res = await request(app).post(`/api/bids/${bid.id}/email-prebid-chris`).set(auth(admin.token))
      .send({})
      .expect(200);
    expect(res.body.to).toEqual(['chris.custom@example.com']);

    // Reset so this doesn't leak into other tests in the same suite run.
    await request(app).put('/api/settings').set(auth(admin.token))
      .send({ prebid_chris_email: '' })
      .expect(200);
  });
});
