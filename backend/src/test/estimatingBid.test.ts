// Task 5 — /api/estimating/:bidId: proposed mapping, sync-takeoff preserving
// estimator edits, save writing bid_estimates + bids.amount consistently
// with the recap, bid-access auth, and validation 400s.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(app: import('express').Express, user: TestUser, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `Est ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC', ...extra })
    .expect(200);
  return res.body.id as string;
}

async function seedTakeoff(bidId: string, rows: { category: string; item: string; qty: number | string; unit: string; confidence?: string }[]) {
  const json = JSON.stringify({ takeoff: rows });
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, agent2_output, status) VALUES ($1,$2,'agent2_complete')
     ON CONFLICT (bid_id) DO UPDATE SET agent2_output=$2, status='agent2_complete'`,
    [bidId, '```json\n' + json + '\n```']
  );
}

describe('GET /api/estimating/:bidId — proposed mapping', () => {
  it('returns an unsaved proposed mapping when the bid has takeoff output but no saved lines', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' },
    ]);

    const res = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(res.body.proposed).toBe(true);
    expect(res.body.lines.length).toBe(1);
    expect(res.body.lines[0].source).toBe('takeoff');
    expect(res.body.recap.totals).toBeTruthy();
  });

  it('returns proposed:false with an empty recap for a bid with no takeoff and no saved lines', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const res = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(res.body.proposed).toBe(false);
    expect(res.body.lines).toEqual([]);
    expect(res.body.recap.totals.grandTotal).toBe(0);
  });
});

describe('PUT /api/estimating/:bidId — save', () => {
  it('writes bid_estimates and bids.amount consistently with the returned recap', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const lib = await request(app).get('/api/estimating/library').set(auth(u.token)).expect(200);
    const item = lib.body.items.find((i: { unit: string }) => i.unit === 'EA');

    const payload = {
      lines: [
        { category: 'Branch Power', description: item.name, qty: 10, unit: 'EA', item_id: item.id, source: 'manual' },
        { category: 'Grounding', description: 'Manual line', qty: 1, unit: 'EA', material_unit_override: 50, labor_hours_override: 1, source: 'manual' },
      ],
      settings: {
        labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3,
        supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3,
      },
    };
    const saveRes = await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send(payload).expect(200);
    const grandTotal = saveRes.body.recap.totals.grandTotal;
    expect(grandTotal).toBeGreaterThan(0);
    expect(saveRes.body.bidEstimate.grand_total).toBeCloseTo(grandTotal, 2);

    const { rows: bidRows } = await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId]);
    expect(Number(bidRows[0].amount)).toBeCloseTo(grandTotal, 2);

    const { rows: beRows } = await pool.query('SELECT grand_total, total_direct, total_overhead, total_profit, line_items, subtotals FROM bid_estimates WHERE bid_id=$1', [bidId]);
    expect(Number(beRows[0].grand_total)).toBeCloseTo(grandTotal, 2);
    expect(beRows[0].line_items.length).toBe(2);
    expect(Object.keys(beRows[0].subtotals).sort()).toEqual(['Branch Power', 'Grounding']);

    // GET after save reflects the saved (not proposed) state.
    const getRes = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(getRes.body.proposed).toBe(false);
    expect(getRes.body.lines.length).toBe(2);
    expect(getRes.body.recap.totals.grandTotal).toBeCloseTo(grandTotal, 2);
  });

  it('carries takeoff_item_id through into bid_estimates.line_items.item, and a manual line falls back to its description', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [
        { category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', material_unit_override: 5, labor_hours_override: 0.3, takeoff_item_id: '5.1', confidence: 'FIRM', source: 'takeoff' },
        { category: 'Grounding', description: 'Hand-typed manual line', qty: 1, unit: 'EA', material_unit_override: 20, labor_hours_override: 1, source: 'manual' },
      ],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 },
    }).expect(200);

    const { rows: beRows } = await pool.query('SELECT line_items FROM bid_estimates WHERE bid_id=$1', [bidId]);
    const items = beRows[0].line_items as { category: string; item: string }[];
    expect(items.find(i => i.category === 'Branch Power')!.item).toBe('5.1');
    expect(items.find(i => i.category === 'Grounding')!.item).toBe('Hand-typed manual line');

    const { rows: lineRows } = await pool.query(
      `SELECT takeoff_item_id FROM est_bid_lines WHERE bid_id=$1 AND category='Branch Power'`, [bidId]
    );
    expect(lineRows[0].takeoff_item_id).toBe('5.1');
  });

  it('does not misattribute overridden/item to the wrong line when an earlier line is excluded (index-alignment regression)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    // Line 1 is excluded; line 2 (which follows it) has an override and a
    // takeoff_item_id. Building line_items by re-indexing the ORIGINAL input
    // against the recap AFTER filtering out excluded lines shifts every
    // line after the first excluded one by one position — this proves
    // line 2's own item id/overridden flag land on line 2, not line 1's.
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [
        { category: 'Grounding', description: 'Excluded line', qty: 1, unit: 'EA', material_unit_override: 999, labor_hours_override: 999, takeoff_item_id: '8.1', excluded: true, source: 'takeoff' },
        { category: 'Branch Power', description: 'Kept line', qty: 1, unit: 'EA', material_unit_override: 7, labor_hours_override: 0.5, takeoff_item_id: '5.1', source: 'takeoff' },
      ],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 },
    }).expect(200);

    const { rows: beRows } = await pool.query('SELECT line_items FROM bid_estimates WHERE bid_id=$1', [bidId]);
    const items = beRows[0].line_items as { category: string; item: string; overridden: boolean; total: number }[];
    expect(items.length).toBe(1); // the excluded line never appears
    expect(items[0].category).toBe('Branch Power');
    expect(items[0].item).toBe('5.1'); // NOT '8.1' — the excluded line's id
    expect(items[0].overridden).toBe(true);
    expect(items[0].total).toBeCloseTo(7 + 0.5 * 40, 2); // NOT the excluded line's 999s
  });

  it('rejects a negative qty with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Bad', qty: -1, unit: 'EA', source: 'manual' }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(400);
  });

  it('rejects an overhead_pct outside 0-100 with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 150, profit_pct: 15, crew_size: 3 },
    }).expect(400);
  });

  it('rejects a line with both assembly_id and item_id with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const lib = await request(app).get('/api/estimating/library').set(auth(u.token)).expect(200);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Bad', qty: 1, unit: 'EA', item_id: lib.body.items[0].id, assembly_id: lib.body.assemblies[0].id, source: 'manual' }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(400);
  });
});

describe('POST /api/estimating/:bidId/sync-takeoff — preserves estimator edits', () => {
  it('keeps overrides/exclusions on surviving lines, adds new ones, excludes vanished ones with a note (never deletes)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' },
      { category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 2, unit: 'EA' },
    ]);

    // First sync creates both lines from scratch.
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const afterFirstSync = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(afterFirstSync.body.proposed).toBe(false);
    expect(afterFirstSync.body.lines.length).toBe(2);

    // Save with the duplex line overridden and add a manual line.
    const duplexLine = afterFirstSync.body.lines.find((l: { category: string }) => l.category === 'Branch Power');
    const groundLine = afterFirstSync.body.lines.find((l: { category: string }) => l.category === 'Grounding');
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [
        { ...duplexLine, material_unit_override: 99 },
        groundLine,
        { category: 'Site / Underground / Allowances', description: 'Hand-added manual line', qty: 1, unit: 'EA', material_unit_override: 20, labor_hours_override: 0.5, source: 'manual' },
      ],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(200);

    // Takeoff changes: duplex line's qty changes, ground rod line vanishes, a new line appears.
    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 15, unit: 'EA' },
      { category: 'Interior Lighting', item: 'Type A - 2x4 LED recessed troffer', qty: 5, unit: 'EA' },
    ]);

    const syncRes = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect(syncRes.body.added).toBe(1);
    expect(syncRes.body.updated).toBe(1);
    expect(syncRes.body.vanished).toBe(1);

    const linesByCategory = new Map(syncRes.body.lines.map((l: { category: string }) => [l.category, l]));
    const duplex = linesByCategory.get('Branch Power') as { qty: number; material_unit_override: number | null; excluded: boolean };
    expect(duplex.qty).toBe(15); // refreshed from the new takeoff
    expect(duplex.material_unit_override).toBe(99); // the override survived the sync
    expect(duplex.excluded).toBe(false);

    const ground = linesByCategory.get('Grounding') as { excluded: boolean; description: string };
    expect(ground.excluded).toBe(true); // vanished from the takeoff
    expect(ground.description).toContain('[No longer in takeoff]');

    const manual = syncRes.body.lines.find((l: { source: string }) => l.source === 'manual');
    expect(manual).toBeTruthy();
    expect(manual.description).toBe('Hand-added manual line'); // untouched by sync

    const troffer = linesByCategory.get('Interior Lighting') as { qty: number; source: string };
    expect(troffer.qty).toBe(5); // the newly-appeared takeoff line
    expect(troffer.source).toBe('takeoff');
  });
});

describe('bid-level auth', () => {
  it("forbids a salesperson from reading or pricing another rep's bid", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const a = await makeUser('salesperson');
    const b = await makeUser('salesperson');
    const bidId = await makeBid(app, b);
    await request(app).get(`/api/estimating/${bidId}`).set(auth(a.token)).expect(403);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(a.token)).send({
      lines: [], settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(403);
    // The owner (b) can still read/save it.
    await request(app).get(`/api/estimating/${bidId}`).set(auth(b.token)).expect(200);
  });

  it('returns 404 for a bid that does not exist', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    await request(app).get('/api/estimating/00000000-0000-0000-0000-000000000000').set(auth(u.token)).expect(404);
  });
});

describe('POST /api/estimating/:bidId/price — no writes', () => {
  it('prices a payload without persisting anything', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const res = await request(app).post(`/api/estimating/${bidId}/price`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Manual', qty: 2, unit: 'EA', material_unit_override: 10, labor_hours_override: 1, source: 'manual' }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 },
    }).expect(200);
    expect(res.body.recap.totals.materialSubtotal).toBe(20);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM est_bid_lines WHERE bid_id=$1', [bidId]);
    expect(rows[0].cnt).toBe(0); // nothing written
  });
});
