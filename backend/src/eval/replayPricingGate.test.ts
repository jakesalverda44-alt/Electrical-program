// Fix round (Opus review of Builder P) — the pricing policy, tested without any
// rendering (no pdftoppm): a submitted, non-calibration bid keeps its price; an
// estimating or calibration bid gets the new rows / units.
import { describe, it, expect } from 'vitest';
import { replayPricing, silentZeroLines } from './replayEval';
import { loadKissimmeeLive0930, load36th0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { textSheets0930 } from '../test/fixtures/realrun/feeders0930';

describe('B1 — the stage gate covers the equipment-unit decisions', () => {
  const live = loadKissimmeeLive0930();
  const lib = loadLiveLibrary0930();
  const feeders = { textSheets: textSheets0930() };

  it('Kissimmee live@submitted, calibration=false: the stored proposal price does not move ($42,916.83 / 364.5375 h)', async () => {
    const r = await replayPricing(live, lib, { rows: 'live', feeders });
    expect(r.sellingPrice).toBe(42916.83);
    expect(r.hours).toBeCloseTo(364.5375, 4);
  });

  it('with calibration=true the same bid gets the new rows (units by code, site poles, heads)', async () => {
    const off = await replayPricing(live, lib, { rows: 'live', feeders });
    const on = await replayPricing(live, lib, { rows: 'live', feeders, calibration: true });
    expect(on.sellingPrice).toBeGreaterThan(off.sellingPrice + 5000);
    expect(on.hours).toBeGreaterThan(off.hours + 20);
  });
});

describe('B5 — owner-furnished site poles / heads carry no library material', () => {
  it('Kissimmee (calibration): the pole / head lines have Chris\'s labor and $0 material; the gate scenario no longer adds ~$9.5k of pole material', async () => {
    const live = loadKissimmeeLive0930();
    const r = await replayPricing(live, loadLiveLibrary0930(), { rows: 'live', feeders: { textSheets: textSheets0930() }, calibration: true, detail: true });
    const poles = (r.lineDetail ?? []).filter(l => /^Exterior/i.test(l.category) && /pole|fixture heads/i.test(l.description) && l.qty > 0 && !/^Wall/i.test(l.description));
    expect(poles.length).toBeGreaterThanOrEqual(4);
    for (const l of poles.filter(l => l.hours > 0)) expect(l.material, l.description).toBe(0);
    expect(poles.some(l => l.hours > 0)).toBe(true);
  });
});

// Fix round S7 — the "no silent $0" check, runnable everywhere (no rendering) and able to FAIL.
describe('S7 — no $0 line without a specific reason', () => {
  const line = (over: Record<string, unknown>) => ({ key: 'Cat||X', category: 'Cat', description: 'X', qty: 2, unit: 'EA', hours: 0, material: 0, note: null, hold: null, matched: null, excluded: false, ...over }) as never;
  it('the detector can fail: no reason, a no_unit fallback on a generated row, a no_unit on a matched library item', () => {
    expect(silentZeroLines([line({}), line({ hold: 'no_unit', key: 'Feeders||Feeder — A → B: 2" EMT' }), line({ hold: 'no_unit', matched: 'EMT 3/4' })])).toHaveLength(3);
    expect(silentZeroLines([line({ hold: 'no_unit' }), line({ hold: 'needs_length' }), line({ note: 'circuit_list' }), line({ hours: 1 }), line({ excluded: true })])).toEqual([]);
  });
  it('both jobs, due-fresh (live rows): none; the hold counts are pinned (plan target <= 12 automatic; reported, not met)', async () => {
    const lib = loadLiveLibrary0930();
    const k = await replayPricing(loadKissimmeeLive0930(), lib, { rows: 'live', stage: 'due', ignoreCostLineSeeds: true, feeders: { textSheets: textSheets0930() }, detail: true });
    const s = await replayPricing(load36th0930(), lib, { rows: 'live', stage: 'due', ignoreCostLineSeeds: true, feeders: { textSheets: [] }, detail: true });
    expect(silentZeroLines(k.lineDetail ?? [])).toEqual([]);
    expect(silentZeroLines(s.lineDetail ?? [])).toEqual([]);
    expect([k.heldCount, s.heldCount]).toEqual([16, 5]);
  });
});
