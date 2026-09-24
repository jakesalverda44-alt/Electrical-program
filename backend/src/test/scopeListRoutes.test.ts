// Takeoff accuracy Task 11 — the estimator's scope list through the routes,
// on the Lake City lines: a Not-included MCC/VFD blocks the GC takeoff, the
// HDPE pipe is blocked until overridden with a reason, excluded items become
// exclusion bullets, near-duplicates are warned in the preview.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const AGENT4 = {
  plan_date: 'September 2, 2025', sheets: ['E-1', 'E-2'],
  sections: [{ title: 'A. Service & Distribution', bullets: ['Service entrance assembly (ECFECI), 800A 480Y/277V.'] }],
  exclusions: [], allowances_bullets: [], fixture_types: [], alternates: [], takeoff_notes: [],
  takeoff: [
    { name: 'Service & Distribution', items: [
      { item: 'MCC', description: '480V MCC', unit: 'EA', qty: 1, source: 'E-1' },
      { item: 'VFD panels', description: '3 VFD panels for vacuum motors', unit: 'EA', qty: 3, source: 'E-3' },
    ] },
    { name: 'Site / Underground / Allowances', items: [
      { item: 'HDPE pipe', description: 'Supply and install 12" HDPE pipe', unit: 'LF', qty: 500, source: 'C-3' },
    ] },
    { name: 'Interior Lighting', items: [
      { item: 'Exit sign', description: 'Exit sign', unit: 'EA', qty: 2, source: 'E-2' },
      { item: 'Exit sign', description: 'LED exit sign w/ battery', unit: 'EA', qty: 2, source: 'E-2' },
    ] },
  ],
};

async function setup(): Promise<{ user: TestUser; bidId: string }> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1, 'Bay To Bay Properties', 'Lake City, FL 32055', $2) RETURNING id`,
    [`LakeCity ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]
  );
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, agent4_output, agent4_price) VALUES ($1,'complete',$2,86000)`, [rows[0].id, JSON.stringify(AGENT4)]);
  return { user, bidId: rows[0].id as string };
}

describe('scope list routes', () => {
  it('add / list / delete; validation', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const base = `/api/preconstruction/${bidId}`;
    await request(app).post(`${base}/scope-items`).set(auth(user.token)).send({ kind: 'maybe', text: 'x' }).expect(400);
    await request(app).post(`${base}/scope-items`).set(auth(user.token)).send({ kind: 'exclude', text: '600A MCC — not included' }).expect(200);
    const r = await request(app).post(`${base}/scope-items`).set(auth(user.token)).send({ kind: 'include', text: 'F/A: conduit + pull strings only' }).expect(200);
    expect(r.body.items.map((i: { kind: string; text: string }) => `${i.kind}:${i.text}`)).toEqual(['exclude:600A MCC — not included', 'include:F/A: conduit + pull strings only']);
    const d = await request(app).delete(`${base}/scope-items/${r.body.items[1].id}`).set(auth(user.token)).expect(200);
    expect(d.body.items).toHaveLength(1);
  });

  it('the GC takeoff is blocked by the Not-included MCC/VFD and the HDPE pipe; an override (with a reason) clears the pipe', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const base = `/api/preconstruction/${bidId}`;
    await request(app).post(`${base}/scope-items`).set(auth(user.token)).send({ kind: 'exclude', text: '600A MCC — not included' }).expect(200);
    await request(app).post(`${base}/scope-items`).set(auth(user.token)).send({ kind: 'exclude', text: 'VFDs for vacuums — not included' }).expect(200);

    const x = await request(app).get(`${base}/generate-takeoff-xlsx`).set(auth(user.token)).expect(422);
    const checks = (x.body.failures as Array<{ check: string; detail: string }>).map(f => `${f.check}: ${f.detail}`);
    expect(checks).toContain('excluded_scope: Takeoff Service & Distribution: "MCC 480V MCC" is on the Not-included list ("600A MCC — not included")');
    expect(checks).toContain('excluded_scope: Takeoff Service & Distribution: "VFD panels 3 VFD panels for vacuum motors" is on the Not-included list ("VFDs for vacuums — not included")');
    expect(checks).toContain('non_electrical: Site / Underground / Allowances: "HDPE pipe Supply and install 12" HDPE pipe" (LF) looks like site piping (HDPE / storm / sanitary / water)');

    await request(app).post(`${base}/non-electrical-overrides`).set(auth(user.token)).send({ category: 'Site / Underground / Allowances', line: 'HDPE pipe Supply and install 12" HDPE pipe', reason: '' }).expect(400);
    await request(app).post(`${base}/non-electrical-overrides`).set(auth(user.token))
      .send({ category: 'Site / Underground / Allowances', line: 'HDPE pipe Supply and install 12" HDPE pipe', reason: 'EC carries the utility sleeve per civil note 4' }).expect(200);
    const x2 = await request(app).get(`${base}/generate-takeoff-xlsx`).set(auth(user.token)).expect(422);
    expect((x2.body.failures as Array<{ check: string }>).some(f => f.check === 'non_electrical')).toBe(false);

    // Preview: exclusions added from the list, duplicates and the kept line warned.
    const p = await request(app).get(`${base}/proposal-preview`).set(auth(user.token)).expect(200);
    expect(p.body.exclusions).toEqual(['600A MCC — not included.', 'VFDs for vacuums — not included.']);
    expect(p.body.hygieneWarnings).toContain('Possible duplicate lines in Interior Lighting: "Exit sign Exit sign" / "Exit sign LED exit sign w/ battery"');
    expect(p.body.hygieneWarnings.some((w: string) => w.startsWith('Kept by the estimator: Site / Underground / Allowances "HDPE pipe'))).toBe(true);
  });
});
