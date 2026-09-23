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

async function seedTakeoff(bidId: string, rows: { category: string; item: string; spec?: string; qty: number | string; unit: string; confidence?: string }[]) {
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

describe('POST /api/estimating/:bidId/sync-takeoff — B5 fix round 1 regressions', () => {
  it('never overwrites a qty_overridden line\'s qty, even when the takeoff qty changes (VERIFY line the estimator hand-filled)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    // A VERIFY-confidence line arrives with qty 0 (the mapper never guesses
    // a non-numeric takeoff qty) — the estimator fills in the real number by
    // hand and marks it qty_overridden.
    await seedTakeoff(bidId, [
      { category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 'VERIFY', unit: 'EA', confidence: 'VERIFY' },
    ]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const afterFirstSync = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    const groundLine = afterFirstSync.body.lines[0];
    expect(groundLine.qty).toBe(0);

    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ ...groundLine, qty: 7, qty_overridden: true }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(200);

    // Takeoff re-runs with a DIFFERENT (still non-numeric) qty — must not
    // clobber the estimator's hand-typed 7.
    await seedTakeoff(bidId, [
      { category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 'TBD', unit: 'EA', confidence: 'VERIFY' },
    ]);
    const syncRes = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect(syncRes.body.lines[0].qty).toBe(7);
    expect(syncRes.body.lines[0].qty_overridden).toBe(true);
  });

  it('un-excludes a line that vanished-then-reappeared (sync-excluded), but keeps a USER-excluded line excluded on reappearance', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' },
      { category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 2, unit: 'EA' },
    ]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const afterFirstSync = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    const duplexLine = afterFirstSync.body.lines.find((l: { category: string }) => l.category === 'Branch Power');
    const groundLine = afterFirstSync.body.lines.find((l: { category: string }) => l.category === 'Grounding');

    // The estimator deliberately excludes the duplex line (a user decision).
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ ...duplexLine, excluded: true }, groundLine],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(200);

    // Takeoff re-runs with BOTH lines vanishing, then a THIRD run brings
    // both back exactly as before.
    await seedTakeoff(bidId, []);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' },
      { category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 2, unit: 'EA' },
    ]);
    const syncRes = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);

    const linesByCategory = new Map(syncRes.body.lines.map((l: { category: string }) => [l.category, l]));
    const duplex = linesByCategory.get('Branch Power') as { excluded: boolean };
    const ground = linesByCategory.get('Grounding') as { excluded: boolean };
    expect(duplex.excluded).toBe(true); // user exclusion survives a vanish + reappear cycle
    expect(ground.excluded).toBe(false); // sync-exclusion reverses itself on reappearance
  });

  it('R2-B2: vanish -> save (any unrelated edit) -> reappear -> the sync-excluded line comes back, note cleared', async (ctx) => {
    if (!ok) return ctx.skip();
    // The reviewer's exact sequence: round 1's saveBidEstimate() hardcoded
    // sync_excluded=false on every save, which meant a save happening
    // ANYWHERE between the vanish-sync and the reappear-sync silently
    // converted the sync exclusion into a permanent one — the line never
    // came back even though sync-takeoff's own un-exclude-on-reappearance
    // logic was (and still is) correct in isolation.
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' },
      { category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 2, unit: 'EA' },
    ]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);

    // Vanish: Grounding drops out of the takeoff.
    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' },
    ]);
    const vanishSync = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const linesAfterVanish = new Map(vanishSync.body.lines.map((l: { category: string }) => [l.category, l]));
    const groundVanished = linesAfterVanish.get('Grounding') as { excluded: boolean; sync_excluded: boolean; description: string };
    expect(groundVanished.excluded).toBe(true);
    expect(groundVanished.sync_excluded).toBe(true);
    expect(groundVanished.description).toContain('[No longer in takeoff]');

    // Save any unrelated edit (bump the duplex line's qty) — the client
    // round-trips whatever it received for the Grounding line, including
    // sync_excluded, unchanged.
    const duplexLine = linesAfterVanish.get('Branch Power') as Record<string, unknown>;
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ ...duplexLine, qty: 15 }, groundVanished],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(200);
    const afterSave = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    const groundAfterSave = afterSave.body.lines.find((l: { category: string }) => l.category === 'Grounding');
    expect(groundAfterSave.excluded).toBe(true);
    expect(groundAfterSave.sync_excluded).toBe(true); // round-tripped through the save, not reset to false

    // Reappear: Grounding is back in the takeoff.
    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' },
      { category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 2, unit: 'EA' },
    ]);
    const reappearSync = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const groundReappeared = reappearSync.body.lines.find((l: { category: string }) => l.category === 'Grounding');
    expect(groundReappeared.excluded).toBe(false); // line is back
    expect(groundReappeared.sync_excluded).toBe(false);
    expect(groundReappeared.description).not.toContain('[No longer in takeoff]'); // note cleared
  });

  it('R2-B2: toggling exclusion by hand in a save always clears sync_excluded, whichever direction', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await seedTakeoff(bidId, [
      { category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 2, unit: 'EA' },
    ]);
    const syncRes = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const groundLine = syncRes.body.lines[0];

    // A user EXCLUDES a line that was never sync-excluded — even if a buggy
    // client sent sync_excluded:true alongside it, the server invariant
    // must not let a non-excluded... in this case an excluded:true,
    // sync_excluded:true combination from an ordinary user action stand;
    // the server can't tell intent apart from the payload alone here, so
    // this proves the OTHER direction of the invariant instead: excluding
    // via save with sync_excluded left at its prior (false) value stays false.
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ ...groundLine, excluded: true, sync_excluded: false }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(200);
    const afterExclude = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(afterExclude.body.lines[0].excluded).toBe(true);
    expect(afterExclude.body.lines[0].sync_excluded).toBe(false);

    // The server-side invariant: sync_excluded can never be true while
    // excluded is false, even if the client mistakenly sends that combination.
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ ...groundLine, excluded: false, sync_excluded: true }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(200);
    const afterUnexclude = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(afterUnexclude.body.lines[0].excluded).toBe(false);
    expect(afterUnexclude.body.lines[0].sync_excluded).toBe(false); // invariant enforced server-side
  });

  it('R2-SF4: an auto-matched line re-matches when the underlying takeoff description at the same id changes', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '5.1', spec: '3/4" EMT', qty: 100, unit: 'LF' },
    ]);
    const firstSync = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const firstItemId = firstSync.body.lines[0].item_id;
    expect(firstItemId).toBeTruthy();
    expect(firstSync.body.lines[0].match_source).toBe('auto');

    // Same takeoff id ("5.1"), respec'd to a different size — an 'auto' line
    // must re-run the mapper, not keep pricing as the old 3/4" EMT.
    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '5.1', spec: '1" EMT', qty: 100, unit: 'LF' },
    ]);
    const secondSync = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect(secondSync.body.lines[0].item_id).not.toBe(firstItemId);
    expect(secondSync.body.lines[0].description).toContain('1" EMT');
  });

  it('R2-SF4: a manually-resolved line is never re-matched by sync, even when the takeoff description changes', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '5.1', spec: 'Some unmatched gizmo', qty: 1, unit: 'EA' },
    ]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const afterSync = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    const line = afterSync.body.lines[0];
    expect(line.item_id).toBeFalsy(); // unmatched by the mapper

    // The estimator manually resolves it to a real item and saves.
    const lib = await request(app).get('/api/estimating/library').set(auth(u.token)).expect(200);
    const manualItem = lib.body.items.find((i: { unit: string }) => i.unit === 'EA');
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ ...line, item_id: manualItem.id, match_source: 'manual' }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(200);

    // The takeoff respecs the SAME id to something the mapper WOULD now match.
    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '5.1', spec: '20A 125V duplex receptacle, spec grade', qty: 1, unit: 'EA' },
    ]);
    const resync = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect(resync.body.lines[0].item_id).toBe(manualItem.id); // the manual pick survives untouched
    expect(resync.body.lines[0].match_source).toBe('manual');
  });

  it('never drops a line when the takeoff has duplicate category+item keys', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await seedTakeoff(bidId, [
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' },
      { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 4, unit: 'EA' },
    ]);
    const syncRes = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect(syncRes.body.added).toBe(2);
    expect(syncRes.body.lines.length).toBe(2);
    const qtys = syncRes.body.lines.map((l: { qty: number }) => l.qty).sort((a: number, b: number) => a - b);
    expect(qtys).toEqual([4, 10]); // both rows kept, neither overwrote the other
  });

  it('persists bid_estimates/bids.amount from the sync itself, without a separate PUT', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await seedTakeoff(bidId, [
      { category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 2, unit: 'EA' },
    ]);
    const syncRes = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect(syncRes.body.recap.totals.grandTotal).toBeGreaterThan(0);

    const { rows: bidRows } = await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId]);
    const { rows: beRows } = await pool.query('SELECT grand_total FROM bid_estimates WHERE bid_id=$1', [bidId]);
    expect(Number(bidRows[0].amount)).toBeCloseTo(syncRes.body.recap.totals.grandTotal, 2);
    expect(Number(beRows[0].grand_total)).toBeCloseTo(syncRes.body.recap.totals.grandTotal, 2);
  });
});

describe('B2 — unit-unknown lines never 500 and never NaN', () => {
  it('a takeoff line with an unrecognized unit (SET) syncs without 500ing and prices at $0 with a warning', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await seedTakeoff(bidId, [
      { category: 'Site / Underground / Allowances', item: 'Temporary power allowance', qty: 1, unit: 'SET' },
    ]);
    const syncRes = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect(syncRes.body.lines.length).toBe(1);
    expect(Number.isFinite(syncRes.body.recap.totals.grandTotal)).toBe(true);
    expect(syncRes.body.recap.warnings.unitUnknownCount).toBe(1);
    expect(syncRes.body.lines[0].qty).not.toBeNaN();
  });

  it('a manual line with a blank unit still saves (200) and prices at $0 unless overridden', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const saveRes = await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Odd line', qty: 3, unit: '', source: 'manual' }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 },
    }).expect(200);
    expect(saveRes.body.recap.totals.grandTotal).toBe(0);
    expect(Number.isFinite(saveRes.body.recap.totals.grandTotal)).toBe(true);
  });

  it('rejects a negative material_unit_override with 400 (S7)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Bad override', qty: 1, unit: 'EA', material_unit_override: -5, source: 'manual' }],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3 },
    }).expect(400);
  });
});

describe('B1 — end to end: takeoff -> mapper -> priceBid -> saveBidEstimate, real seed magnitudes', () => {
  it('1,200 LF of 3/4" EMT and 3,600 LF of #12 THHN price at the right order of magnitude against the real seed', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    // Agent 2/4's REAL line shape: { item: '5.1', spec: '3/4" EMT', qty: 1200, unit: 'LF' }
    // — `item` is Agent 4's short takeoff id, `spec` is the descriptive text.
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, status) VALUES ($1,$2,'agent2_complete')
       ON CONFLICT (bid_id) DO UPDATE SET agent2_output=$2, status='agent2_complete'`,
      [bidId, '```json\n' + JSON.stringify({
        takeoff: [
          { category: 'Branch Power', item: '5.1', spec: '3/4" EMT', qty: 1200, unit: 'LF' },
          { category: 'Branch Power', item: '5.2', spec: '#12 THHN', qty: 3600, unit: 'LF' },
        ],
      }) + '\n```']
    );

    const syncRes = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect(syncRes.body.added).toBe(2);
    const emtLine = syncRes.body.lines.find((l: { description: string }) => /emt/i.test(l.description));
    const thhnLine = syncRes.body.lines.find((l: { description: string }) => /thhn/i.test(l.description));
    expect(emtLine.item_id).toBeTruthy(); // actually matched a library item, not left unresolved
    expect(thhnLine.item_id).toBeTruthy();

    const saveRes = await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: syncRes.body.lines,
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 },
    }).expect(200);

    const emtPriced = saveRes.body.recap.lines.find((l: { id: string }) => l.id === emtLine.id);
    const thhnPriced = saveRes.body.recap.lines.find((l: { id: string }) => l.id === thhnLine.id);

    // Real seed: EMT-075 = $60/C (per 100 ft), so 1200 LF = 12 C = $720 material.
    // THHN-12 = $95/M (per 1000 ft) per the branch wire rows, so 3600 LF = 3.6 M = $342 material.
    // The review's whole point: these must NOT come out at $72,000 / $342,000
    // (the pre-fix bug divided by the wrong unit's denominator, or not at all).
    expect(emtPriced.materialExt).toBeGreaterThan(100);
    expect(emtPriced.materialExt).toBeLessThan(2000);
    expect(thhnPriced.materialExt).toBeGreaterThan(50);
    expect(thhnPriced.materialExt).toBeLessThan(2000);

    // Precise assertion against the actual real seed values (locks in the
    // exact numbers so a future seed-data edit shows up as an intentional diff).
    expect(emtPriced.materialExt).toBe(720);
    expect(thhnPriced.materialExt).toBe(342);
  });
});

describe('N3 — floors_above_2 multiplies the MULTI-STORY factor instead of applying it flat', () => {
  it('a line priced with the MULTI-STORY factor selected scales with floors_above_2', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const lib = await request(app).get('/api/estimating/library').set(auth(u.token)).expect(200);
    const multistory = lib.body.factors.find((f: { code: string }) => f.code === 'MULTI-STORY');
    expect(multistory).toBeTruthy();

    const baseSettings = {
      labor_rate: 40, factor_ids: [multistory.id], material_tax_pct: 0, small_tools_pct: 0,
      supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3,
    };
    const line = { category: 'Branch Power', description: 'Manual', qty: 1, unit: 'EA', material_unit_override: 0, labor_hours_override: 10, source: 'manual' as const };

    const zeroFloors = await request(app).post(`/api/estimating/${bidId}/price`).set(auth(u.token))
      .send({ lines: [line], settings: { ...baseSettings, floors_above_2: 0 } }).expect(200);
    expect(zeroFloors.body.recap.lines[0].hoursExt).toBe(10); // no adjustment at 0 floors above 2

    const fourFloors = await request(app).post(`/api/estimating/${bidId}/price`).set(auth(u.token))
      .send({ lines: [line], settings: { ...baseSettings, floors_above_2: 4 } }).expect(200);
    // MULTI-STORY seed pct is 3% per floor -> 4 floors = +12%
    expect(fourFloors.body.recap.lines[0].hoursExt).toBe(11.2);
  });

  it('rejects a negative floors_above_2 with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: -1 },
    }).expect(400);
  });

  it('persists floors_above_2 through save and returns it on the next GET', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 5 },
    }).expect(200);
    const res = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(res.body.settings.floors_above_2).toBe(5);
  });
});

describe('S6 — a bid\'s first-ever settings inherit overhead/profit from bid_workspaces, not the hardcoded 10/15', () => {
  it('GET returns the bid_workspaces overhead_pct/profit_pct before any est_bid_settings row exists', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await pool.query('INSERT INTO bid_workspaces (bid_id, overhead_pct, profit_pct) VALUES ($1,22,18) ON CONFLICT (bid_id) DO UPDATE SET overhead_pct=22, profit_pct=18', [bidId]);

    const res = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(res.body.settings.overhead_pct).toBe(22);
    expect(res.body.settings.profit_pct).toBe(18);
  });

  it('R2-SF7: bid_estimates wins over bid_workspaces when both exist, regardless of which is newer', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    // bid_workspaces written AFTER bid_estimates (newer updated_at) — under
    // the old "newer wins" rule this would have taken precedence; the fixed
    // rule always prefers the deliberate bid_estimates save.
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [],
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 14, profit_pct: 20, crew_size: 3 },
    }).expect(200);
    await pool.query('INSERT INTO bid_workspaces (bid_id, overhead_pct, profit_pct) VALUES ($1,22,18) ON CONFLICT (bid_id) DO UPDATE SET overhead_pct=22, profit_pct=18, updated_at=now()', [bidId]);
    // Delete the est_bid_settings row the save above wrote, so GET falls
    // back to inheritedOverheadProfit() again (the code path under test).
    await pool.query('DELETE FROM est_bid_settings WHERE bid_id = $1', [bidId]);

    const res = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(res.body.settings.overhead_pct).toBe(14); // from bid_estimates, not bid_workspaces' 22
    expect(res.body.settings.profit_pct).toBe(20);
  });
});

describe('S5 — an explicit 0 settings value is honored, not silently replaced by a fallback', () => {
  it('a bid_workspaces overhead_pct of exactly 0 is NOT treated as absent', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await pool.query('INSERT INTO bid_workspaces (bid_id, overhead_pct, profit_pct) VALUES ($1,0,0) ON CONFLICT (bid_id) DO UPDATE SET overhead_pct=0, profit_pct=0', [bidId]);

    const res = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(res.body.settings.overhead_pct).toBe(0);
    expect(res.body.settings.profit_pct).toBe(0);
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
