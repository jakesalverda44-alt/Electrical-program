// Evidence round 4.2 — reconciliation against independent second sources.
// Fix round (B2): a site fixture-schedule QTY column is HEADS, never poles;
// there is a tolerance; both directions are reported; the always-on GFCI
// pass is gone (S5) — reconcile() only ever answers a real number.
// Uses the real Kissimmee LUMINAIRE SCHEDULE / PANEL B transcriptions
// (kissimmeeReplies.ts) so the fixture-derived case is the genuine one the
// fixture test also proves end to end.
import { describe, it, expect } from 'vitest';
import type { CountTarget } from '../countTargets';
import type { TypeCountResult } from '../countMerge';
import { parseScheduleReply, type ScheduleTable } from './schedules';
import { TABLE_REPLIES } from '../../test/fixtures/evidence/kissimmeeReplies';
import { scheduleQtyFindings, circuitDescFindings, reconcile, RECONCILE_TOLERANCE } from './reconcile';

const SHEET = 'set.pdf#55';
const table = (title: string, sheetLabel = 'PH0.1 "Site Lighting Plan"'): ScheduleTable =>
  parseScheduleReply(TABLE_REPLIES[title], { sheetKey: SHEET, sheetLabel, viewportId: `${SHEET}@u`, viewportTitle: title })!;

function target(over: Partial<CountTarget>): CountTarget {
  return {
    type: over.key ?? 'X', key: over.key ?? 'X', description: '', symbolHint: '', wattage: null,
    category: 'site_lighting', source: 'fixture_schedule', sourceSheet: '', headsPerPole: null, emergency: false,
    ...over,
  };
}

function type(over: Partial<TypeCountResult>): TypeCountResult {
  return {
    key: over.key ?? 'X', type: over.type ?? over.key ?? 'X', description: over.description ?? '', category: over.category ?? 'site_lighting',
    count: over.count ?? 0, heads: over.heads !== undefined ? over.heads : null, status: over.status ?? 'counted', reason: '',
    sheets: over.sheets ?? [{ sheetKey: SHEET, label: 'PH0.1', count: over.count ?? 0, used: true }],
    flags: [], wattage: null, ...over,
  };
}

const DSX1 = 'Lithonia DSX1 LED P8 40K T4M MVOLT HS';

describe('4.2(a) — a fixture-schedule QTY column vs the plans, in HEADS for site lighting (B2)', () => {
  const lum = table('LUMINAIRE SCHEDULE');
  const s1 = target({ key: 'S1', type: 'S1', description: DSX1, category: 'site_lighting' });
  const s2 = target({ key: 'S2', type: 'S2', description: DSX1, category: 'site_lighting' });

  it('QTY 4 heads vs S1 (2 poles x 1 head) + S2 (1 pole x 2 heads) = 4 heads: no finding (this was the false alarm)', () => {
    const t1 = type({ key: 'S1', type: 'S1', description: DSX1, count: 2, heads: 2 });
    const t2 = type({ key: 'S2', type: 'S2', description: DSX1, count: 1, heads: 2 });
    expect(scheduleQtyFindings([t1, t2], [s1, s2], [lum])).toEqual([]);
  });

  it('comparing POLES (not heads) would have found a false shortfall — heads is what must be compared', () => {
    // Poles alone: 2 + 1 = 3 vs QTY 4 -> would be a finding if actualUnitsOf used count. It must not.
    const t1 = type({ key: 'S1', type: 'S1', description: DSX1, count: 2, heads: 2 });
    const t2 = type({ key: 'S2', type: 'S2', description: DSX1, count: 1, heads: 2 });
    const f = scheduleQtyFindings([t1, t2], [s1, s2], [lum]);
    expect(f).toEqual([]); // heads (4) match; the pole total (3) is irrelevant here
  });

  it('a real heads shortfall beyond tolerance is still a finding, with direction', () => {
    const t1 = type({ key: 'S1', type: 'S1', description: DSX1, count: 1, heads: 1 });
    const t2 = type({ key: 'S2', type: 'S2', description: DSX1, count: 0, heads: 0 });
    const f = scheduleQtyFindings([t1, t2], [s1, s2], [lum]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ typeKey: 'S1+S2', kind: 'schedule_qty', direction: 'under', expected: 4, actual: 1, diff: 3 });
  });

  it('within tolerance is not a finding', () => {
    expect(RECONCILE_TOLERANCE).toBeGreaterThanOrEqual(1);
    const t1 = type({ key: 'S1', type: 'S1', description: DSX1, count: 1, heads: 1 });
    const t2 = type({ key: 'S2', type: 'S2', description: DSX1, count: 1, heads: 2 });
    // diff = |4-3| = 1 <= tolerance -> no finding (only fires when diff exceeds tolerance)
    expect(scheduleQtyFindings([t1, t2], [s1, s2], [lum])).toEqual([]);
  });

  it('an OVER count is reported too, with direction "over", never sent to gap-fill', () => {
    const t1 = type({ key: 'S1', type: 'S1', description: DSX1, count: 6, heads: 6 });
    const f = scheduleQtyFindings([t1], [s1], [lum]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ direction: 'over', expected: 4, actual: 6, diff: 2 });
  });

  it('host and merged types are never findings on their own', () => {
    const merged = type({ key: 'SITE LIGHT', type: 'SITE LIGHT', description: DSX1, count: 0, heads: 0, status: 'merged' as TypeCountResult['status'] });
    const host = { ...type({ key: 'POLE TAG 4', description: DSX1, count: 3 }), host: true };
    const t = target({ key: 'SITE LIGHT', description: DSX1 });
    expect(scheduleQtyFindings([merged, host], [t], [lum])).toEqual([]);
  });

  it('a device/equipment category is never matched by a fixture QTY column', () => {
    const t1 = type({ key: 'GFCI', type: 'GFCI', description: 'GFCI receptacle', category: 'device', count: 0 });
    const t = target({ key: 'GFCI', description: 'GFCI receptacle', category: 'device' });
    expect(scheduleQtyFindings([t1], [t], [lum])).toEqual([]);
  });
});

describe('4.2(b) — a panel circuit description naming a device, multiplier vs drawn count', () => {
  const B = table('PANEL B', 'E-4 "Panelboard / 1-Line"');
  it('"BATTERY CHARGER" appears 5 times, but it is equipment (schedule-owned already) — no finding', () => {
    const bc = type({ key: 'BATT CHGR', type: 'BATT CHGR', description: 'Battery charger', category: 'equipment', count: 0 });
    const t = target({ key: 'BATT CHGR', description: 'Battery charger', category: 'equipment' });
    expect(circuitDescFindings([bc], [t], [B])).toEqual([]);
  });
  it('a DEVICE type a circuit description names with a higher multiplier than drawn is a finding', () => {
    const t = target({ key: 'BATT CHGR', description: 'Battery charger', category: 'device' });
    const bc = type({ key: 'BATT CHGR', type: 'BATT CHGR', description: 'Battery charger', category: 'device', count: 1 });
    const f = circuitDescFindings([bc], [t], [B]);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]).toMatchObject({ typeKey: 'BATT CHGR', kind: 'circuit_desc', direction: 'under' });
    expect(f[0].expected).toBeGreaterThan(f[0].actual);
  });
  it('a type already owned by a schedule row is never re-flagged here', () => {
    const t = target({ key: 'BATT CHGR', description: 'Battery charger', category: 'device' });
    const bc = { ...type({ key: 'BATT CHGR', type: 'BATT CHGR', description: 'Battery charger', category: 'device', count: 1 }), scheduleRows: [{ sheetKey: SHEET, sheetLabel: 'E-4', tableId: 'x', table: 'PANEL B', rowIdx: 0, cells: [], qty: 5 }] };
    expect(circuitDescFindings([bc], [t], [B])).toEqual([]);
  });
});

describe('reconcile() — no always-on GFCI pass (S5); only real numeric findings', () => {
  it('a GFCI-family device with no schedule/circuit source is never flagged, on any sheet', () => {
    const gfciTarget = target({ key: 'GFCI', description: 'GFCI', category: 'device' });
    const gfci = type({ key: 'GFCI', description: 'GFCI', category: 'device', count: 5, sheets: [{ sheetKey: 'set.pdf#49', label: 'E-1', count: 5, used: true }] });
    expect(reconcile([gfci], [gfciTarget], [])).toEqual([]);
  });
  it('combines schedule_qty and circuit_desc findings', () => {
    const lum = table('LUMINAIRE SCHEDULE');
    const s1 = target({ key: 'S1', description: DSX1 });
    const t1 = type({ key: 'S1', description: DSX1, count: 2, heads: 2 });
    const f = reconcile([t1], [s1], [lum]);
    expect(f.map(x => x.kind)).toEqual(['schedule_qty']);
  });
});
