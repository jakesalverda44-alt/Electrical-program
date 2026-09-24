// Evidence round 4.2 — reconciliation against independent second sources.
// Uses the real Kissimmee LUMINAIRE SCHEDULE / PANEL B transcriptions
// (kissimmeeReplies.ts) so the fixture-derived shortfall (QTY 4 vs 3 site
// poles) is the genuine one the fixture test also proves end to end.
import { describe, it, expect } from 'vitest';
import type { CountTarget } from '../countTargets';
import type { TypeCountResult } from '../countMerge';
import { parseScheduleReply, type ScheduleTable } from './schedules';
import { TABLE_REPLIES } from '../../test/fixtures/evidence/kissimmeeReplies';
import { scheduleQtyFindings, circuitDescFindings, gfciConfirmFindings, reconcile } from './reconcile';

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
    count: over.count ?? 0, heads: null, status: over.status ?? 'counted', reason: '', sheets: over.sheets ?? [{ sheetKey: SHEET, label: 'PH0.1', count: over.count ?? 0, used: true }],
    flags: [], wattage: null, ...over,
  };
}

const DSX1 = 'Lithonia DSX1 LED P8 40K T4M MVOLT HS';

describe('4.2(a) — a fixture-schedule QTY column vs the plans (real Kissimmee LUMINAIRE SCHEDULE)', () => {
  const lum = table('LUMINAIRE SCHEDULE');
  const s1 = target({ key: 'S1', type: 'S1', description: DSX1, category: 'site_lighting' });
  const s2 = target({ key: 'S2', type: 'S2', description: DSX1, category: 'site_lighting' });

  it('QTY 4 vs S1(2) + S2(1) = 3 counted: one finding, shortfall 1, both types named', () => {
    const t1 = type({ key: 'S1', type: 'S1', description: DSX1, count: 2 });
    const t2 = type({ key: 'S2', type: 'S2', description: DSX1, count: 1 });
    const f = scheduleQtyFindings([t1, t2], [s1, s2], [lum]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ typeKey: 'S1+S2', kind: 'schedule_qty', expected: 4, actual: 3, shortfall: 1 });
    expect(f[0].source).toContain('LUMINAIRE SCHEDULE');
  });

  it('no shortfall once the plans account for the whole QTY', () => {
    const t1 = type({ key: 'S1', type: 'S1', description: DSX1, count: 3 });
    const t2 = type({ key: 'S2', type: 'S2', description: DSX1, count: 1 });
    expect(scheduleQtyFindings([t1, t2], [s1, s2], [lum])).toEqual([]);
  });

  it('host and merged types are never findings on their own', () => {
    const merged = type({ key: 'SITE LIGHT', type: 'SITE LIGHT', description: DSX1, count: 0, status: 'merged' as TypeCountResult['status'] });
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
    expect(f[0]).toMatchObject({ typeKey: 'BATT CHGR', kind: 'circuit_desc' });
    expect(f[0].expected!).toBeGreaterThan(f[0].actual);
  });
  it('a type already owned by a schedule row is never re-flagged here', () => {
    const t = target({ key: 'BATT CHGR', description: 'Battery charger', category: 'device' });
    const bc = { ...type({ key: 'BATT CHGR', type: 'BATT CHGR', description: 'Battery charger', category: 'device', count: 1 }), scheduleRows: [{ sheetKey: SHEET, sheetLabel: 'E-4', tableId: 'x', table: 'PANEL B', rowIdx: 0, cells: [], qty: 5 }] };
    expect(circuitDescFindings([bc], [t], [B])).toEqual([]);
  });
});

describe('4.2(e) — GFCI-family confirmatory pass on a raster (no text layer) sheet', () => {
  const raster = new Set(['set.pdf#49']);
  it('a counted GFCI on a raster sheet, no schedule row, is flagged (never a numeric target)', () => {
    const t = type({ key: 'GFCI', type: 'GFCI', description: 'GFCI receptacle', category: 'device', count: 7, sheets: [{ sheetKey: 'set.pdf#49', label: 'E-1', count: 7, used: true }] });
    const f = gfciConfirmFindings([t], raster);
    expect(f).toEqual([{ typeKey: 'GFCI', kind: 'gfci_confirm', source: 'E-1', expected: null, actual: 7, shortfall: null, reason: expect.stringContaining('undercount risk') }]);
  });
  it('never flagged on a text-layer sheet, when zero, or when a schedule row already owns it', () => {
    const onText = type({ key: 'GFCI', description: 'GFCI', category: 'device', count: 3, sheets: [{ sheetKey: 'text.pdf#1', label: 'E-9', count: 3, used: true }] });
    expect(gfciConfirmFindings([onText], raster)).toEqual([]);
    const zero = type({ key: 'GFCI', description: 'GFCI', category: 'device', count: 0, status: 'zero', sheets: [{ sheetKey: 'set.pdf#49', label: 'E-1', count: 0, used: false }] });
    expect(gfciConfirmFindings([zero], raster)).toEqual([]);
    const owned = { ...type({ key: 'GFCI', description: 'GFCI', category: 'device', count: 4, sheets: [{ sheetKey: 'set.pdf#49', label: 'E-1', count: 4, used: true }] }), scheduleRows: [{ sheetKey: SHEET, sheetLabel: 'x', tableId: 'x', table: 'x', rowIdx: 0, cells: [], qty: 4 }] };
    expect(gfciConfirmFindings([owned], raster)).toEqual([]);
  });
  it('a non-GFCI device is never swept in', () => {
    const dup = type({ key: 'DUPLEX', description: 'Duplex receptacle', category: 'device', count: 10, sheets: [{ sheetKey: 'set.pdf#49', label: 'E-1', count: 10, used: true }] });
    expect(gfciConfirmFindings([dup], raster)).toEqual([]);
  });
});

describe('reconcile() — combines every check', () => {
  it('runs all three checks and returns their union', () => {
    const lum = table('LUMINAIRE SCHEDULE');
    const s1 = target({ key: 'S1', description: DSX1 });
    const gfciTarget = target({ key: 'GFCI', description: 'GFCI', category: 'device' });
    const t1 = type({ key: 'S1', description: DSX1, count: 2 });
    const gfci = type({ key: 'GFCI', description: 'GFCI', category: 'device', count: 5, sheets: [{ sheetKey: 'set.pdf#49', label: 'E-1', count: 5, used: true }] });
    const f = reconcile([t1, gfci], [s1, gfciTarget], [lum], new Set(['set.pdf#49']));
    expect(f.map(x => x.kind).sort()).toEqual(['gfci_confirm', 'schedule_qty']);
  });
});
