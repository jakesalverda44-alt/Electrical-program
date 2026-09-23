// Part 1 follow-up: closes the gap flagged in the original estimating report
// — bid_estimates.line_items.item now carries Agent 4's short takeoff item
// id (e.g. "5.1") when a line has one (est_bid_lines.takeoff_item_id,
// migration 103), instead of the line's description. This proves the full
// round trip: save a bid through the NEW engine, read back
// bid_estimates.line_items exactly as preconstruction.ts's
// composeCurrentBidData does, and feed it into the real (pure) composeBidData
// — its per-line confidence lookup (SavedConfidenceItem, keyed on
// `${category}::${item}`) must resolve for a new-engine-saved bid, not just
// for the hand-built fixtures composeBidData.test.ts already covers.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { composeBidData, ComposeBidRow, SavedConfidenceItem } from '../bidstd/composeBidData';
import { Agent4Output } from '../ai/agent4Message';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('composeBidData resolves per-line confidence for a new-engine-saved bid', () => {
  it("prefers the saved estimate's confidence over Agent 4's own echo, keyed on the takeoff item id saved via the estimating engine", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `ComposeFix ${Date.now()}`, gc: 'GC' }).expect(200);
    const bidId = bid.body.id as string;

    // Save through the NEW engine with the takeoff item id Agent 4 would have
    // used for this same line ("1.1") and a confidence the estimator
    // corrected to VERIFY — deliberately different from what Agent 4 itself
    // echoed on the item below ('VERIFIED' -> normalizes to FIRM), so the
    // assertion below can only pass if OUR saved value actually won.
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{
        category: 'Service & Distribution', description: '800A service entrance assembly',
        qty: 1, unit: 'EA', material_unit_override: 1200, labor_hours_override: 10,
        takeoff_item_id: '1.1', confidence: 'VERIFY', source: 'takeoff',
      }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 },
    }).expect(200);

    // Read line_items exactly as composeCurrentBidData does (preconstruction.ts ~1830).
    const { rows } = await pool.query('SELECT line_items FROM bid_estimates WHERE bid_id=$1', [bidId]);
    const savedLineItems = rows[0].line_items as SavedConfidenceItem[];
    expect(savedLineItems).toEqual([
      expect.objectContaining({ category: 'Service & Distribution', item: '1.1', confidence: 'VERIFY' }),
    ]);

    const bidRow: ComposeBidRow = { name: 'Test Co', loc: '123 Main St', gc: 'GC', sq_ft: 1000, job_number: null };
    const agent4: Agent4Output = {
      sections: [{ title: 'A. Service & Distribution', bullets: ['x'] }],
      takeoff: [{
        name: 'Service & Distribution',
        items: [{ item: '1.1', description: '800A service entrance assembly (ECFECI)', unit: 'EA', qty: 1, conf: 'VERIFIED' }],
      }],
    };

    const { data } = composeBidData(bidRow, agent4, '$50,000.00', { savedLineItems });
    const svc = data.takeoff.find(c => c.name === 'Service & Distribution')!;
    // Agent 4's own 'VERIFIED' would normalize to FIRM — our saved VERIFY must win.
    expect(svc.items[0].conf).toBe('VERIFY');
  });

  it('falls back to the manual line\'s description as `item` (no takeoff id to key on)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `ComposeFixManual ${Date.now()}`, gc: 'GC' }).expect(200);
    const bidId = bid.body.id as string;

    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Grounding', description: 'Hand-added allowance', qty: 1, unit: 'EA', material_unit_override: 20, labor_hours_override: 1, source: 'manual' }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 },
    }).expect(200);

    const { rows } = await pool.query('SELECT line_items FROM bid_estimates WHERE bid_id=$1', [bidId]);
    expect(rows[0].line_items[0].item).toBe('Hand-added allowance');
  });
});
