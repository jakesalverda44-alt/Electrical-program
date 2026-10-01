// Gap-closing T1 / T11 / T12 — Jake's pricing policy through the round's library changes: a submitted,
// non-calibration bid prices at the library as of its submission (to the cent); a due or Calibration bid sees the
// new units. The replay applies 165–167 the way the SQL does and reverts them with libraryAsOf.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { replayPricing, libraryAfterMigrations, FOOTAGE_RATIOS_150, FOOTAGE_RATIOS_168_PATCH, BOX_FITTING_168 } from './replayEval';
import { applyGapMigrations, GAP_MIGRATION_AT, GAP_UNIT_MOVES, GAP_PRICE_MOVES } from './gapMigrations';
import { libraryAsOf } from '../estimating/libraryAsOf';
import { COST_LINE_DEFAULTS_V2, COST_LINE_DEFAULTS_V2_OXBLUE } from '../estimating/costLineDefaults';
import { loadKissimmeeLive0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { textSheets0930 } from '../test/fixtures/realrun/feeders0930';

describe('the round\'s library changes vs the pricing policy', () => {
  const lib = loadLiveLibrary0930();
  it('every move lands on the untouched seed row; libraryAsOf before the migration gives back exactly the old library', () => {
    const before = libraryAfterMigrations(lib.library);
    const { library: after, history } = applyGapMigrations(before);
    for (const m of GAP_UNIT_MOVES) expect(after.items.find(i => i.code === m.code)!.labor_hours, m.code).toBe(m.to);
    const asOf = libraryAsOf(after, history, '2026-09-30T00:00:00.000Z');
    const pick = (l: typeof before) => l.items.map(i => [i.code, i.labor_hours, i.material_cost, i.material_price_date]).sort();
    expect(pick(asOf)).toEqual(pick(before));
    expect(libraryAsOf(after, history, '2026-10-02T00:00:00.000Z').items.find(i => i.code === 'DISC-200')!.labor_hours).toBe(3.1);
    expect(GAP_MIGRATION_AT > '2026-09-30').toBe(true);
  });
  it('Kissimmee live@submitted (calibration off) is still $42,916.83 / 364.5375 h; with calibration on it sees the new units', async () => {
    const live = loadKissimmeeLive0930();
    const off = await replayPricing(live, lib, { rows: 'live', feeders: { textSheets: textSheets0930() } });
    expect([off.sellingPrice, Math.round(off.hours * 10000) / 10000]).toEqual([42916.83, 364.5375]);
    const on = await replayPricing(live, lib, { rows: 'live', feeders: { textSheets: textSheets0930() }, calibration: true, detail: true });
    expect(on.lineDetail!.find(l => /Panels A & B/.test(l.description))!.hours).toBe(9); // PNL-225F flush 2 × 4.5
  });
  it('migration 167 = the replay mirror (code, $, 2026-06-18), guarded, never $0', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/167_gap_closing_price_refresh.sql'), 'utf8');
    const ups = [...sql.matchAll(/SET material_cost = ([\d.]+), material_price_date = DATE '(\d{4}-\d{2}-\d{2})', updated_at = now\(\)\n WHERE code = '([A-Z0-9_-]+)' AND source = 'seed' AND accubid_reconciled_at IS NULL/g)];
    expect(ups.map(m => [m[3], Number(m[1]), m[2]])).toEqual(GAP_PRICE_MOVES.map(m => [m.code, m.to, m.date]));
    expect(GAP_PRICE_MOVES.every(m => m.to > 0)).toBe(true);
    const { library } = applyGapMigrations(libraryAfterMigrations(lib.library));
    expect(library.items.find(i => i.code === 'THHN-3_0')!.material_cost).toBe(4735);
  });
  it('migration 168\'s JSON = the replay mirror (footage ratios patch, box / fitting basis, OxBlue v2)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/168_gap_closing_settings.sql'), 'utf8');
    const lits = [...sql.matchAll(/'(\{[^']*(?:''[^']*)*\})'/g)].map(m => JSON.parse(m[1].replace(/''/g, "'")));
    expect(lits).toContainEqual({ ...FOOTAGE_RATIOS_168_PATCH });
    expect(lits).toContainEqual(JSON.parse(FOOTAGE_RATIOS_150));
    expect(lits).toContainEqual({ ...BOX_FITTING_168 });
    expect(lits).toContainEqual(JSON.parse(JSON.stringify(COST_LINE_DEFAULTS_V2_OXBLUE)));
    expect(lits).toContainEqual(JSON.parse(JSON.stringify(COST_LINE_DEFAULTS_V2)));
    expect(sql).toMatch(/SELECT 'est_receptacle_device_only', 'true'/);
  });
});
