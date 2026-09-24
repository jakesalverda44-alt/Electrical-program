// Takeoff accuracy Task 7 — the zero-count gate. A takeoff with open review
// items blocks Agent 4, the proposal .docx, the GC takeoff .xlsx and the
// proposal send (409 with the open items); resolving every item (a count,
// confirmed markers, or "Not on this job" + reason) clears it.
//
// Safety: the Anthropic SDK and the Graph mailer are mocked to THROW if
// anything reaches them — no test here can make a paid call or a draft.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));
vi.mock('../email/graphMailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../email/graphMailer')>();
  return {
    ...actual,
    isGraphMailConfigured: () => true,
    graphCreateDraft: async () => { throw new Error('graphCreateDraft must not be called in this test'); },
    graphSendMail: async () => { throw new Error('graphSendMail must not be called in this test'); },
  };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { buildReviewItems, reviewStatus } from '../ai/reviewItems';
import { mergeCountsIntoTakeoff } from '../ai/countMerge';
import { buildCountTargets } from '../ai/countTargets';
import type { CountResult } from '../ai/countingStage';
import type { CountSheet } from '../ai/countSheets';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

/** A count_result where A was counted (12), G is zero, and S1 poles were
 *  counted with no heads-per-pole on the schedule. */
function countResult(): CountResult {
  const agent1 = { fixtureSchedule: [
    { type: 'A', description: '4 ft wrap', wattage: 32, location: 'interior' },
    { type: 'G', description: 'Downlight', wattage: 15, location: 'interior' },
    { type: 'S1', description: 'Pole light', wattage: 150, location: 'site' },
  ] };
  const { targets } = buildCountTargets(agent1);
  const e3: CountSheet = { key: 'f#2', file: 'f', page: 2, sheetNo: 'E-3', title: 'LIGHTING PLAN', label: 'E-3 "LIGHTING PLAN"', role: 'building', focus: 'lighting', level: '' };
  const e1: CountSheet = { ...e3, key: 'f#1', page: 1, sheetNo: 'E-1', title: 'SITE PLAN', label: 'E-1 "SITE PLAN"', role: 'site', focus: 'combined' };
  const marks = (k: string, n: number) => Array.from({ length: n }, () => ({ typeKey: k }));
  const sheets = [
    { sheet: e3, status: 'counted' as const, placed: marks('A', 12), unreadable: [] },
    { sheet: e1, status: 'counted' as const, placed: marks('S1', 2), unreadable: [] },
  ];
  const merged = mergeCountsIntoTakeoff(agent1, targets, sheets, { countingRan: true });
  return { version: 1, ran: true, model: 'claude-opus-5-5', targets, targetNotes: [], sheets: [], skippedSheets: [], types: merged.types, loadCheck: merged.loadCheck, removedRows: [], flags: merged.flags, marks: [] };
}

async function setup(): Promise<{ user: TestUser; bidId: string }> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1, 'Summit General Contractors', 'Kissimmee, FL', $2) RETURNING id`,
    [`Gate ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]
  );
  const bidId = rows[0].id as string;
  const cr = countResult();
  const items = buildReviewItems(cr, []);
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, status, count_result, review_items, review_status) VALUES ($1,'complete',$2,$3,$4)`,
    [bidId, JSON.stringify(cr), JSON.stringify(items), reviewStatus(items)]
  );
  return { user, bidId };
}

describe('review items', () => {
  it('a zero type and a pole type without heads-per-pole are open; the counted type is not', () => {
    const items = buildReviewItems(countResult(), []);
    expect(items.map(i => i.id)).toEqual(['count:G', 'count:S1:heads']);
    expect(items[0].detail).toBe('Counted 0: not found on any counted plan sheet.');
    expect(reviewStatus(items)).toBe('needs_review');
  });
});

describe('the gate (409) on every proposal path while items are open', () => {
  it('run-agent4, generate-docx, generate-takeoff-xlsx and draft-proposal are all blocked', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const a4 = await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '79112.23' }).expect(409);
    expect(a4.body.error).toMatch(/^The takeoff needs review before a proposal can be generated or sent: 2 items open \(Type G — Downlight; Type S1 — fixture heads\)/);
    expect(a4.body.reviewItems.map((i: { id: string }) => i.id)).toEqual(['count:G', 'count:S1:heads']);
    await request(app).get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(user.token)).expect(409);
    await request(app).get(`/api/preconstruction/${bidId}/generate-takeoff-xlsx`).set(auth(user.token)).expect(409);
    const send = await request(app).post(`/api/bids/${bidId}/draft-proposal`).set(auth(user.token)).send({ to: ['gc@example.com'] }).expect(409);
    expect(send.body.error).toMatch(/needs review/);
    // Nothing was stamped as sent.
    const { rows } = await pool.query('SELECT proposal_sent_at FROM bids WHERE id=$1', [bidId]);
    expect(rows[0].proposal_sent_at).toBeNull();
  });

  it('a pre-counting-stage run (review_status NULL) is never gated', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    await pool.query('UPDATE takeoff_results SET review_status=NULL, review_items=NULL WHERE bid_id=$1', [bidId]);
    const r = await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '1000' });
    // Past the gate: it now fails on the missing Agent 2 output, not on review.
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No scope data found/);
  });
});

describe('resolving items', () => {
  it('validates each action; a count must be a whole number >= 1, "Not on this job" needs a reason, markers need confirmed markers', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const post = (body: object) => request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token)).send(body);
    expect((await post({ itemIds: ['count:G'], action: 'count', qty: 0 })).body.error).toMatch(/whole-number count of at least 1/);
    expect((await post({ itemIds: ['count:G'], action: 'count', qty: 2.5 })).status).toBe(400);
    expect((await post({ itemIds: ['count:G'], action: 'not_on_job', reason: ' ' })).body.error).toBe('Say why this is not on this job (at least 10 characters).');
    expect((await post({ itemIds: ['count:G'], action: 'markers' })).body.error).toMatch(/No confirmed markers for this type on the sheets it is counted from/);
    expect((await post({ itemIds: ['count:S1:heads'], action: 'markers' })).body.error).toMatch(/Heads are not marked/);
    expect((await post({ itemIds: ['count:NOPE'], action: 'count', qty: 3 })).status).toBe(404);
    // Nothing was saved by any failed attempt.
    const { rows } = await pool.query('SELECT review_status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].review_status).toBe('needs_review');
  });

  it('confirmed markers labeled with the type resolve it with their count; resolving everything clears the gate', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const doc = await pool.query(
      `INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by) VALUES ($1,'p.pdf','plans','application/pdf','x','t') RETURNING id`, [bidId]);
    for (let i = 0; i < 11; i++) {
      await pool.query(
        `INSERT INTO est_markups (bid_id, document_id, page_index, kind, points, status, label) VALUES ($1,$2,0,'count',$3::jsonb,$4,'G')`,
        [bidId, doc.rows[0].id, JSON.stringify([{ x: i * 30, y: 10 }]), i < 10 ? 'confirmed' : 'suggested']);
    }
    const post = (body: object) => request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token)).send(body);
    const r1 = await post({ itemIds: ['count:G'], action: 'markers' }).expect(200);
    expect(r1.body.items.find((i: { id: string }) => i.id === 'count:G').resolution).toMatchObject({ action: 'markers', qty: 10, by: user.name });
    expect(r1.body.status).toBe('needs_review');
    const r2 = await post({ itemIds: ['count:S1:heads'], action: 'count', qty: 4 }).expect(200);
    expect(r2.body.status).toBe('clear');

    // Gate lifted: run-agent4 gets past it (and stops on the missing Agent 2 output).
    const a4 = await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '1000' });
    expect(a4.status).toBe(400);
    expect(a4.body.error).toMatch(/No scope data found/);

    // Reopen puts it back in review.
    const re = await request(app).post(`/api/preconstruction/${bidId}/review/reopen`).set(auth(user.token)).send({ itemId: 'count:G' }).expect(200);
    expect(re.body.status).toBe('needs_review');
  });

  it('bulk "Not on this job" with one reason resolves several items at once', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const r = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: ['count:G', 'count:S1:heads'], action: 'not_on_job', reason: 'Legend is generic to the prototype' }).expect(200);
    expect(r.body.status).toBe('clear');
    expect(r.body.items.every((i: { resolution?: { reason: string } }) => i.resolution?.reason === 'Legend is generic to the prototype')).toBe(true);
  });

  it('another user without access to the bid gets 403/404, never a resolution', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await setup();
    const rep = await makeUser('salesperson');
    const r = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(rep.token))
      .send({ itemIds: ['count:G'], action: 'count', qty: 3 });
    expect([403, 404]).toContain(r.status);
    const { rows } = await pool.query('SELECT review_status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].review_status).toBe('needs_review');
  });
});

describe('Fix round 2 / B5 — a budget-pending vendor quote blocks every GC path on the server', () => {
  /** A "clear" review setup (unlike setup() above, which starts needs_review)
   *  so these tests isolate the NEW budget gate from the existing review gate. */
  async function clearSetup(): Promise<{ user: TestUser; bidId: string }> {
    const user = await makeUser('owner');
    const { rows } = await pool.query(
      `INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1, 'Summit General Contractors', 'Kissimmee, FL', $2) RETURNING id`,
      [`Budget ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]
    );
    const bidId = rows[0].id as string;
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1,'complete','[]','clear')`,
      [bidId]
    );
    return { user, bidId };
  }

  it('run-agent4, generate-docx, generate-takeoff-xlsx and draft-proposal are all blocked while a quote is budget-pending', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await clearSetup();
    const quote = await request(app).post(`/api/estimating/${bidId}/accubid/quotes`).set(auth(user.token)).send({
      description: 'Switchgear (CES)', amount: 45000, markupPct: 0, status: 'budget_pending',
    }).expect(200);

    const a4 = await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '79112.23' }).expect(409);
    expect(a4.body.error).toMatch(/budget-pending/);
    expect(a4.body.error).toMatch(/Switchgear \(CES\)/);
    await request(app).get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(user.token)).expect(409);
    await request(app).get(`/api/preconstruction/${bidId}/generate-takeoff-xlsx`).set(auth(user.token)).expect(409);
    const send = await request(app).post(`/api/bids/${bidId}/draft-proposal`).set(auth(user.token)).send({ to: ['gc@example.com'] }).expect(409);
    expect(send.body.error).toMatch(/budget-pending/);
    // Nothing was stamped as sent.
    const { rows } = await pool.query('SELECT proposal_sent_at FROM bids WHERE id=$1', [bidId]);
    expect(rows[0].proposal_sent_at).toBeNull();

    // Firming the quote up lifts the gate (each path now fails further along,
    // on missing Agent 2/4 output rather than the budget check).
    await request(app).put(`/api/estimating/${bidId}/accubid/quotes/${quote.body.id}`).set(auth(user.token))
      .send({ status: 'firm' }).expect(200);
    const a4After = await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '1000' });
    expect(a4After.status).toBe(400);
    expect(a4After.body.error).not.toMatch(/budget-pending/);
  });

  it('the internal pre-bid package (generate-prebid-package / email-prebid-chris) stays allowed while a quote is budget-pending', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await clearSetup();
    await request(app).post(`/api/estimating/${bidId}/accubid/quotes`).set(auth(user.token)).send({
      description: 'Switchgear (CES)', amount: 45000, markupPct: 0, status: 'budget_pending',
    }).expect(200);

    // Neither route's failure ever mentions the budget-pending quote — both
    // still fail for their own ordinary reasons ("no draft composed yet" /
    // "nothing on file"), never on pricing.
    const pkg = await request(app).post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(user.token)).send({});
    expect(pkg.body.error).not.toMatch(/budget-pending/);
    const email = await request(app).post(`/api/bids/${bidId}/email-prebid-chris`).set(auth(user.token)).send({});
    expect(email.body.error).not.toMatch(/budget-pending/);
  });
});

describe('Task 9 — zero-quantity lines never reach a GC document', () => {
  it('generate-takeoff-xlsx and generate-docx 422 with the zero lines listed', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const agent4 = {
      plan_date: 'Feb 7, 2025', sheets: ['E-1'], sections: [{ title: 'A. Service & Distribution', bullets: ['Service (ECFECI).'] }],
      exclusions: [], allowances_bullets: [], fixture_types: [], alternates: [], takeoff_notes: [],
      takeoff: [{ name: 'Site / Underground / Allowances', items: [{ item: 'Site underground', description: 'Allowance', unit: 'LF', qty: 0, source: 'E-1' }] }],
    };
    await pool.query(`UPDATE takeoff_results SET review_status=NULL, review_items=NULL, agent4_output=$2, agent4_price=1000 WHERE bid_id=$1`, [bidId, JSON.stringify(agent4)]);
    const x = await request(app).get(`/api/preconstruction/${bidId}/generate-takeoff-xlsx`).set(auth(user.token)).expect(422);
    expect(x.body.failures[0]).toEqual({ check: 'zero_quantity', detail: 'Site / Underground / Allowances: "Site underground — Allowance" has quantity 0' });
    const d = await request(app).get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(user.token)).expect(422);
    expect(d.body.failures[0].check).toBe('zero_quantity');
  });
});
