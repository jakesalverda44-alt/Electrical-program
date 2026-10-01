// Fewer-questions round Task 2 — the checklist's resolve route (test DB):
// rows answered one by one; "Confirm all" applies only the pre-filled rows
// (never a legend row or a row without a proposal) and the item stays
// blocking until every row is answered; no bulk shortcut without
// memberKey; multi-item calls with equipment still 400 (S16).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { reviewStatus, type ReviewItem } from '../ai/reviewItems';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

function items(): ReviewItem[] {
  return [
    {
      id: 'textzero:equipment', kind: 'count', category: 'equipment', group: 'textzero', title: '4 items from the notes / schedules weren\'t drawn as symbols — confirm counts', detail: '',
      actions: ['count', 'markers', 'not_on_job', 'confirm'], fingerprint: 'textzero|A|B|C|T',
      groupedTypes: [
        { key: 'TSTAT', type: 'TSTAT', description: 'Thermostats #1 and #2 (2)', rowKind: 'text', quote: { text: 'Thermostats #1 and #2 (2)', sheet: 'the equipment list', field: 'equipment list' }, proposal: { action: 'count', qty: 2, reason: 'Stated: "Thermostats #1 and #2 (2)" (the equipment list)', tier: 'stated' } },
        { key: 'PYLON SIGN', type: 'PYLON SIGN', description: 'Pylon sign connection, circuit A-18', rowKind: 'text', proposal: { action: 'not_on_job', reason: 'Covered by SIGNS (A-18) — already a counted line', tier: 'covered' } },
        { key: 'MB', type: 'MB', description: 'Meter base', rowKind: 'text' },
        { key: 'T', type: 'T', description: 'Thermostat', rowKind: 'legend', twinOf: 'TSTAT' },
      ],
    },
    { id: 'count:G', kind: 'count', category: 'equipment', title: 'Type G', detail: '', typeKey: 'G', actions: ['count', 'markers', 'not_on_job'] },
  ];
}

async function setup(): Promise<{ user: TestUser; bidId: string }> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1,'GC','Here',$2) RETURNING id`, [`Checklist ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  const its = items();
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1,'complete',$2,$3)`, [rows[0].id, JSON.stringify(its), reviewStatus(its)]);
  return { user, bidId: rows[0].id as string };
}

describe('the checklist resolve route', () => {
  it('Confirm all applies the pre-filled rows only; the item stays open and blocking', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const post = (body: object) => request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token)).send(body);
    expect((await post({ itemIds: ['textzero:equipment'], action: 'confirm', reason: 'ok' })).status).toBe(400);
    const r = await post({ itemIds: ['textzero:equipment'], action: 'confirm', reason: 'Confirmed the pre-filled checklist against the quotes' }).expect(200);
    expect(r.body.checklistOpen).toBe(2);
    const c = r.body.items.find((i: ReviewItem) => i.id === 'textzero:equipment') as ReviewItem;
    const by = new Map(c.groupedTypes!.map(m => [m.key, m.resolution]));
    expect(by.get('TSTAT')).toMatchObject({ action: 'count', qty: 2, reason: 'Stated: "Thermostats #1 and #2 (2)" (the equipment list)', by: user.name });
    expect(by.get('PYLON SIGN')).toMatchObject({ action: 'not_on_job', reason: 'Covered by SIGNS (A-18) — already a counted line' });
    expect(by.get('MB')).toBeUndefined();
    expect(by.get('T')).toBeUndefined();
    expect(c.resolution).toBeUndefined();
    expect(r.body.status).toBe('needs_review');
  });

  it('rows are answered one by one; a legend row cannot be confirmed; no memberKey = 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const post = (body: object) => request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token)).send(body);
    expect((await post({ itemIds: ['textzero:equipment'], action: 'not_on_job', reason: 'none of these on the job' })).body.error).toMatch(/Answer each checklist row on its own/);
    expect((await post({ itemIds: ['textzero:equipment'], action: 'confirm', memberKey: 'T', reason: 'Confirmed the pre-filled answer' })).status).toBe(400);
    await post({ itemIds: ['textzero:equipment'], action: 'confirm', memberKey: 'TSTAT', reason: 'Confirmed the pre-filled answer' }).expect(200);
    await post({ itemIds: ['textzero:equipment'], action: 'not_on_job', memberKey: 'T', reason: 'same item as TSTAT, counted once' }).expect(200);
    await post({ itemIds: ['textzero:equipment'], action: 'count', memberKey: 'MB', qty: 1 }).expect(200);
    const last = await post({ itemIds: ['textzero:equipment'], action: 'not_on_job', memberKey: 'PYLON SIGN', reason: 'covered by the SIGNS line' }).expect(200);
    const c = last.body.items.find((i: ReviewItem) => i.id === 'textzero:equipment') as ReviewItem;
    expect(c.resolution).toMatchObject({ action: 'confirm' });
    // count:G (equipment) still open
    expect(last.body.status).toBe('needs_review');
  });

  it('a multi-item call with the checklist (equipment) is still refused', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const r = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: ['textzero:equipment', 'count:G'], action: 'not_on_job', reason: 'none of these on the job' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Equipment is never resolved in bulk/);
  });
});
