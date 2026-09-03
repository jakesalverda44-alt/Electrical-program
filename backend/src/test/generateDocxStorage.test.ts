// Task 5 (phase 1 estimating chain): generate-docx now files the generated
// proposal via storeDocument before sending the file. That persistence must
// never block the download — losing the download is worse than a missed filing
// (same trade-off as import-prebid's keep()). storeDocument is mocked here (this
// file's module registry is isolated from prebid.test.ts's) specifically so the
// storage step can be forced to throw and prove the route still 200s.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

vi.mock('../utils/storeDocument', () => ({
  storeDocument: vi.fn().mockRejectedValue(new Error('simulated storage failure')),
}));

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('generate-docx — storage failure does not block the download', () => {
  it('still 200s and returns the docx buffer when storeDocument throws', async (ctx) => {
    if (!ok) return ctx.skip();
    // Imported after the mock is registered (vi.mock is hoisted above these
    // imports by vitest regardless of source order) so `app` picks up the
    // mocked storeDocument.
    const { app } = await import('../index');

    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `StorageFail ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;
    // Task 6 — generate-docx hard-gates on verifyBidDocx, so agent4_output
    // must be gate-passing content (Agent 4's new data-only shape) rather
    // than '{}', or the route 422s before ever reaching storeDocument.
    const agent4Output = JSON.stringify({
      sections: [
        { title: 'A. Service & Distribution', bullets: [
          'Service entrance assembly and MDP (ECFECI).',
          'Distribution gear (ECFECI): panels A, B.',
        ] },
        { title: 'B. Branch Power', bullets: ['Branch circuit wiring per plan.'] },
        { title: 'C. Lighting & Controls', bullets: [
          'Complete lighting package (ECFECI) — Southern Lighting Source.',
        ] },
        { title: 'D. Site Lighting, Underground Work & Allowances', bullets: ['Site lighting per photometric plan.'] },
      ],
      exclusions: ['Standard exclusions apply.'],
      takeoff: [{ name: 'Service & Distribution', items: [
        { item: '1.1', description: 'Panel (ECFECI)', unit: 'EA', qty: 1, source: 'E1.0 Riser' },
      ] }],
    });
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, agent4_output, agent4_price, agent4_status)
       VALUES ($1,'{}',$2,425000,'complete')`,
      [bidId, agent4Output]
    );

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml/);

    // And, since storeDocument was mocked to always throw, no documents row exists —
    // confirming the 200 above really did route through the failing call, not around it.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM documents WHERE linked_id=$1 AND category='proposal'`,
      [bidId]
    );
    expect(rows[0].n).toBe(0);
  });
});
