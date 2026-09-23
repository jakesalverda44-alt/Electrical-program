// Takeoff accuracy fix round 1 — B5 (a re-analysis never lets the previous
// run's documents reach the GC or Chris), S12 (a stale draft is never used),
// S13 (auto-drafting needs run_analysis and is one-in-flight per bid).
//
// The Anthropic SDK is mocked for this whole file (a fake whose calls are
// counted); the dummy key below lives only in this worker's env. Drive is
// mocked. No network, no email (Graph is muted under test).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

const sdkCalls: string[] = [];
let sdkResponder: () => Promise<{ text: string }> = async () => ({ text: '{}' });
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: () => ({
        finalMessage: async () => {
          sdkCalls.push('stream');
          const r = await sdkResponder();
          return { content: [{ type: 'text', text: r.text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
        },
      }),
    };
  },
}));
vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return { ...actual, uploadFile: async () => null, ensureSubfolder: async () => null };
});

import Anthropic from '@anthropic-ai/sdk';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { startAnalysisRun, runDraftComposition, loadAIConfig, scopeInputsHash } from '../routes/preconstruction';
import { hasAIPermission } from '../middleware/auth';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); process.env.ANTHROPIC_API_KEY = 'test-dummy-not-a-key'; }, 30_000);

const AGENT4 = {
  sections: [
    { title: 'A. Service & Distribution', bullets: ['Service entrance assembly (ECFECI).', 'Distribution gear (ECFECI): panels A, B.'] },
    { title: 'B. Branch Power', bullets: ['Branch circuit wiring per plan.'] },
    { title: 'C. Lighting & Controls', bullets: ['Complete lighting package (ECFECI).', 'Controls & testing: occupancy sensors and photocells.'] },
    { title: 'D. Site Lighting, Underground Work & Allowances', bullets: ['Site lighting per plan.'] },
  ],
  exclusions: ['Painting excluded.'], fixture_types: ['A'], allowances_bullets: [],
  takeoff: [{ name: 'Service & Distribution', items: [{ item: '1.1', description: '800A service entrance (ECFECI)', unit: 'EA', qty: 1, source: 'E1.6' }] }],
};
const OLD_PDF = Buffer.from('%PDF-1.4\n% the OLD Kissimmee proposal: 0 fixtures, Southern Lighting Source\n');

/** A bid whose first analysis run produced a proposal and filed its PDF. */
async function analyzedWithFiledPdf(role = 'owner'): Promise<{ user: TestUser; bidId: string; run1: string }> {
  const user = await makeUser(role);
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1, 'Summit General Contractors', '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747', $2) RETURNING id`,
    [`Stale ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]
  );
  const bidId = rows[0].id as string;
  const run1 = await startAnalysisRun(bidId);
  await pool.query(
    `UPDATE takeoff_results SET status='complete', agent2_output='{}', review_items='[]', review_status='clear',
       agent4_output=$2, agent4_price=81485.60, agent4_status='complete', agent4_run_id=run_id WHERE bid_id=$1`,
    [bidId, JSON.stringify(AGENT4)]
  );
  await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data, gate_passed, takeoff_run_id)
     VALUES ($1,'x','elec','Proposal - old.pdf','Proposal - old.pdf','proposal',$2,'application/pdf','test',$3,true,$4)`,
    [bidId, OLD_PDF.length, OLD_PDF.toString('base64'), run1]
  );
  return { user, bidId, run1 };
}

describe('B5 — a re-analysis never lets the previous run reach the GC', () => {
  it('the Kissimmee stale-PDF scenario: re-analyze, resolve everything, "Draft email to GC" refuses the old PDF', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId, run1 } = await analyzedWithFiledPdf();
    const draft = () => request(app).post(`/api/bids/${bidId}/draft-proposal`).set(auth(user.token)).send({ to: ['gc@example.com'], markSubmitted: false });

    const run2 = await startAnalysisRun(bidId);
    expect(run2).not.toBe(run1);
    // Everything from run 1 is cleared; the review is pending until counting writes it.
    const { rows } = await pool.query('SELECT agent4_output, agent4_price, draft_output, review_status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0]).toEqual({ agent4_output: null, agent4_price: null, draft_output: null, review_status: 'pending' });

    // While the run is in progress: every GC path is blocked.
    const during = await draft();
    expect(during.status).toBe(409);
    expect(during.body.error).toMatch(/analysis is running or did not finish/);
    await request(app).get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(user.token)).expect(409);

    // The run finishes and the estimator clears the review: still no old PDF.
    await pool.query(`UPDATE takeoff_results SET status='complete', agent2_output='{}', review_status='clear' WHERE bid_id=$1`, [bidId]);
    const after = await draft();
    expect(after.status).toBe(409);
    expect(after.body.error).toMatch(/No proposal PDF from the current analysis/);
    // generate-docx can't render the old agent4_output either — there is none for this run.
    const gen = await request(app).get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(user.token));
    expect(gen.status).toBe(404);
    expect(gen.body.error).toMatch(/current analysis/);
  });

  it('an Agent 4 output from an earlier run is never composed, even if something left it behind', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await analyzedWithFiledPdf();
    await pool.query(`UPDATE takeoff_results SET run_id=gen_random_uuid() WHERE bid_id=$1`, [bidId]); // agent4_run_id is now the OLD run
    const res = await request(app).get(`/api/preconstruction/${bidId}/proposal-preview`).set(auth(user.token));
    expect(res.status).toBe(404);
  });

  it('the pre-bid package is gated by the review and never falls back to an earlier run', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await analyzedWithFiledPdf();
    await pool.query(`UPDATE takeoff_results SET review_status='needs_review', review_items=$2 WHERE bid_id=$1`,
      [bidId, JSON.stringify([{ id: 'count:A', kind: 'count', title: 'Type A', detail: 'Counted 0' }])]);
    const gated = await request(app).post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(user.token));
    expect(gated.status).toBe(409);
    const chris = await request(app).post(`/api/bids/${bidId}/email-prebid-chris`).set(auth(user.token)).send({});
    expect(chris.status).toBe(409);

    // Review clear, but no draft for this run: refuse rather than use Agent 4's output.
    await pool.query(`UPDATE takeoff_results SET review_status='clear', review_items='[]' WHERE bid_id=$1`, [bidId]);
    const noDraft = await request(app).post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(user.token));
    expect(noDraft.status).toBe(400);
    expect(noDraft.body.error).toMatch(/pre-bid draft is not ready/);
  });

  it('a draft that finishes after a new analysis started is discarded', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await analyzedWithFiledPdf();
    sdkResponder = async () => { await startAnalysisRun(bidId); return { text: JSON.stringify(AGENT4) }; };
    await runDraftComposition(bidId, new Anthropic(), await loadAIConfig());
    const { rows } = await pool.query('SELECT draft_output, draft_status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0]).toEqual({ draft_output: null, draft_status: null });
  });
});

describe('S12 — a stale draft is never used', () => {
  it('a scope-list change after the draft: the package refuses, results say draft_stale', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await analyzedWithFiledPdf();
    sdkResponder = async () => ({ text: JSON.stringify(AGENT4) });
    await runDraftComposition(bidId, new Anthropic(), await loadAIConfig());
    const { rows } = await pool.query('SELECT draft_status, draft_inputs_hash FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].draft_status).toBe('complete');
    expect(rows[0].draft_inputs_hash).toBe(await scopeInputsHash(bidId));

    await request(app).post(`/api/preconstruction/${bidId}/scope-items`).set(auth(user.token)).send({ kind: 'exclude', text: 'Generator — not included' }).expect(200);
    const results = await request(app).get(`/api/preconstruction/${bidId}/results`).set(auth(user.token)).expect(200);
    expect(results.body.draft_stale).toBe(true);
    const pkg = await request(app).post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(user.token));
    expect(pkg.status).toBe(400);
    expect(pkg.body.error).toMatch(/out of date/);
  });
});

describe('S13 — auto-drafting: run_analysis only, one in flight per bid', () => {
  it('two drafts started at once make ONE model call', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await analyzedWithFiledPdf();
    sdkCalls.length = 0;
    sdkResponder = async () => { await new Promise(r => setTimeout(r, 50)); return { text: JSON.stringify(AGENT4) }; };
    const cfg = await loadAIConfig();
    await Promise.all([runDraftComposition(bidId, new Anthropic(), cfg), runDraftComposition(bidId, new Anthropic(), cfg)]);
    expect(sdkCalls).toHaveLength(1);
  });

  it('resolving the last item starts a draft for an estimator, never for a user without run_analysis', async (ctx) => {
    if (!ok) return ctx.skip();
    const sales = await makeUser('sales_manager');
    expect(await hasAIPermission(sales as never, 'run_analysis')).toBe(false);
    const est = await makeUser('estimator');
    expect(await hasAIPermission(est as never, 'run_analysis')).toBe(true);

    const { bidId } = await analyzedWithFiledPdf();
    await pool.query(`UPDATE bids SET salesperson_id=NULL WHERE id=$1`, [bidId]);
    const item = { id: 'count:A', kind: 'count', title: 'Type A', detail: 'Counted 0', actions: ['count', 'not_on_job'] };
    const reset = () => pool.query(`UPDATE takeoff_results SET review_status='needs_review', review_items=$2, draft_status=NULL WHERE bid_id=$1`, [bidId, JSON.stringify([item])]);
    sdkResponder = async () => ({ text: JSON.stringify(AGENT4) });

    await reset();
    const bySales = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(sales.token)).send({ itemIds: ['count:A'], action: 'count', qty: 4 });
    if (bySales.status === 200) expect(bySales.body.draftStarted).toBe(false); // (or the bid isn't visible to that role at all)

    await reset();
    const byEst = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(est.token)).send({ itemIds: ['count:A'], action: 'count', qty: 4 }).expect(200);
    expect(byEst.body.draftStarted).toBe(true);
  });
});

describe('S5 — a bid analysed before the accuracy checks', () => {
  it('is not blocked, but the Takeoff step says so and shows its AutoZone questions', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('owner');
    const { rows } = await pool.query(
      `INSERT INTO bids (name, gc, loc, brand, salesperson_id) VALUES ($1, 'Summit General Contractors', 'Kissimmee, FL 34747', 'AutoZone', $2) RETURNING id`,
      [`Legacy ${Date.now()}`, user.id]
    );
    const bidId = rows[0].id as string;
    // No run id, no review, no count_result: the pre-branch shape.
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, status, agent1_output, agent2_output, agent4_output, agent4_price, agent4_status)
       VALUES ($1,'complete',$2,'{}',$3,81485.60,'complete')`,
      [bidId, JSON.stringify({ project: { name: 'AutoZone #10077' }, quantities: [] }), JSON.stringify(AGENT4)]
    );
    const review = await request(app).get(`/api/preconstruction/${bidId}/review`).set(auth(user.token)).expect(200);
    expect(review.body.status).toBeNull();
    expect(review.body.legacy.message).toBe('Analyzed before accuracy checks — re-run analysis to enable counting and account rules.');
    expect(review.body.legacy.accountRule).toMatch(/^AutoZone/);
    expect(review.body.legacy.questions.map((q: { label: string }) => q.label)).toEqual(['Power poles — furnished by', 'Power poles — installed by']);
    // Its existing flow is not blocked.
    await request(app).get(`/api/preconstruction/${bidId}/proposal-preview`).set(auth(user.token)).expect(200);
  });
});

describe('S15 — "Use confirmed markers" counts only the sheets a type is counted from', () => {
  it('70 A markers on the power plan background + 73 on the lighting plan -> 73, the 70 listed as not counted', async (ctx) => {
    if (!ok) return ctx.skip();
    const { confirmedMarkersForType } = await import('../estimating/takeoffReview');
    const user = await makeUser('owner');
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1,'G','Ocala, FL',$2) RETURNING id`, [`Markers ${Date.now()}`, user.id]);
    const bidId = rows[0].id as string;
    const doc = await pool.query(
      `INSERT INTO documents (linked_id, name, category, file_type, file_data, file_size, uploaded_by) VALUES ($1,'set.pdf','plans','application/pdf','',0,'t') RETURNING id`, [bidId]);
    const docId = doc.rows[0].id as string;
    const countResult = {
      targets: [{ type: 'A', key: 'A', description: 'Troffer', category: 'interior_lighting' }],
      types: [{ key: 'A', type: 'A', sheets: [
        { sheetKey: 'set.pdf#2', label: 'E-2 "POWER PLAN"', count: 70, used: false, eligible: false },
        { sheetKey: 'set.pdf#3', label: 'E-3 "LIGHTING PLAN"', count: 73, used: true, eligible: true },
      ] }],
      markers: { sheetDocuments: [
        { sheetKey: 'set.pdf#2', label: 'E-2 "POWER PLAN"', documentId: docId, pageIndex: 1 },
        { sheetKey: 'set.pdf#3', label: 'E-3 "LIGHTING PLAN"', documentId: docId, pageIndex: 2 },
      ] },
    };
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, count_result) VALUES ($1,'complete',$2)`, [bidId, JSON.stringify(countResult)]);
    const values: string[] = [];
    const params: unknown[] = [bidId, docId];
    for (const [page, n] of [[1, 70], [2, 73]] as const) {
      for (let k = 0; k < n; k++) values.push(`($1, $2, ${page}, 'count', '[{"x":${k},"y":${page}}]'::jsonb, 'confirmed', 'A', 't')`);
    }
    await pool.query(`INSERT INTO est_markups (bid_id, document_id, page_index, kind, points, status, label, created_by) VALUES ${values.join(',')}`, params);
    const tally = await confirmedMarkersForType(bidId, 'A');
    expect(tally.counted).toBe(73);
    expect(tally.excluded).toEqual([{ label: 'E-2 "POWER PLAN" (not a sheet A is counted from)', count: 70 }]);
  });
});
