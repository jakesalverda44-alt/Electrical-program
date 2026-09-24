// Real-run fix 6 — the last three blocking items of the replayed live run that
// were not real questions, each with the case that must STAY a question.
import { describe, it, expect } from 'vitest';
import { mergeCountsIntoTakeoff, type SheetCountInput } from './countMerge';
import { buildCountTargets } from './countTargets';
import { selectCountSheets, type CountSheet } from './countSheets';
import { expandTypicals } from './evidence/typicals';
import { buildReviewItems, reviewItemIsOpen } from './reviewItems';
import type { CountResult } from './countingStage';
import { loadKissimmeeLive } from '../test/fixtures/realrun/kissimmeeLive';

const selection = selectCountSheets([
  { file: 'set.pdf', page: 1, sheetNo: 'E-7', title: 'SITE LIGHTING PLAN', discipline: 'electrical', cls: 'plan', included: true },
]);
const site: CountSheet = selection.counted[0];

describe('real-run fix 6 — the site-pole spec row is the counted poles when its quantity is theirs', () => {
  const a1 = (qty: number, item: string) => ({
    fixtureSchedule: [
      { type: 'S1', description: 'Lithonia DSX1 LED P8 40K T4M, full cutoff, 28 ft MH', location: 'site', wattage: 207, headsPerPole: 1 },
      { type: 'S2', description: 'Lithonia DSX1 LED P8 40K T4M twin head, 28 ft MH', location: 'site', wattage: 414, headsPerPole: 2 },
    ],
    quantities: [{ category: 'Exterior Site Lighting', item, qty, unit: 'EA', sourceSheet: 'PH0.1' }],
  });
  const sheets: SheetCountInput[] = [{ sheet: site, status: 'counted', placed: [{ typeKey: 'S1' }, { typeKey: 'S1' }, { typeKey: 'S2' }], unreadable: [] }];
  const run = (qty: number, item: string) => {
    const agent1 = a1(qty, item);
    return mergeCountsIntoTakeoff(agent1, buildCountTargets(agent1).targets, sheets, { countingRan: true, evidence: {} });
  };

  it('"25\' 5in square steel pole, dark bronze, 3\' conc base" x 3 = the 3 counted poles (S1 x2 + S2 x1): not a second pole line', () => {
    const r = run(3, "25' 5in square steel pole, dark bronze, 3' conc base");
    const row = r.removedRows.find(x => String(x.row.item).startsWith("25' 5in"))!;
    expect(row.unscheduled).toBeUndefined();
    expect(row.reason).toMatch(/the site light poles \(3 — the counted S1 ×2 \+ S2 ×1/);
  });

  it('review fix S10 — a flag pole or a camera pole of the same quantity is never "the site light poles"', () => {
    expect(run(3, "30' aluminum flag pole").removedRows[0]).toMatchObject({ unscheduled: true });
    expect(run(3, "20' camera pole, square steel").removedRows[0]).toMatchObject({ unscheduled: true });
  });

  it('a different quantity stays a question; a base row is an accessory (held, as before)', () => {
    expect(run(4, "25' 5in square steel pole, dark bronze").removedRows[0]).toMatchObject({ unscheduled: true });
    expect(run(3, 'Light pole concrete base w/ anchor bolts').removedRows[0]).toMatchObject({ unscheduled: true });
  });
});

describe('real-run fix 6 — a notes block naming the baseflex receptacle again is the same assembly', () => {
  const live = loadKissimmeeLive();
  const { targets } = buildCountTargets(live.agent1);
  const pk = (id: string) => live.countResult.evidence.typicals.find(t => t.id.endsWith(id))!;
  it('E-1 #6 "outlet on flex … in fixture base" at the FLEX+J host: part of the FLEX+J assembly (E-1 #5), no "how many?"', () => {
    const r = expandTypicals([pk('@5#1'), pk('@6#3')], new Map([['FLEX+J', { count: 3, sheets: ['E-1'], marks: [] }]]), [], targets);
    expect(r.expansions.map(e => [e.packageId.split('@').pop(), e.status])).toEqual([['5#1', 'assembly'], ['6#3', 'assembly']]);
  });
  it('review fix N5 — the restatement is shown as information, never swallowed; an "additional outlet" note is a new device (asked)', () => {
    const r = expandTypicals([pk('@5#1'), pk('@6#3')], new Map([['FLEX+J', { count: 3, sheets: ['E-1'], marks: [] }]]), [], targets);
    expect(r.expansions[1].restated).toBe(true);
    const extra = { ...pk('@6#3'), quote: 'PROVIDE AN ADDITIONAL OUTLET IN THE FIXTURE BASE.' };
    const r2 = expandTypicals([pk('@5#1'), extra], new Map([['FLEX+J', { count: 3, sheets: ['E-1'], marks: [] }]]), [], targets);
    expect(r2.expansions[1].status).toBe('qty_unstated');
  });
  it('alone (no assembly package for that host and device), the unstated quantity is still asked', () => {
    const r = expandTypicals([pk('@6#3')], new Map([['FLEX+J', { count: 3, sheets: ['E-1'], marks: [] }]]), [], targets);
    expect(r.expansions.map(e => e.status)).toEqual(['qty_unstated']);
  });
});

describe('real-run fix 6 — "two 209W fixtures per site pole, typically": the schedule\'s heads are used', () => {
  const u = live209();
  function live209() {
    return loadKissimmeeLive().countResult.evidence.unmappedTypical[0] as { packageId: string; host: string; text: string; qty: number; quote: string };
  }
  const cr = (heads: Array<number | null>) => ({
    version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], loadCheck: null, removedRows: [], flags: [], marks: [],
    types: heads.map((h, i) => ({ key: `S${i + 1}`, type: `S${i + 1}`, description: 'site', category: 'site_lighting', count: i ? 1 : 2, heads: h, status: 'counted', reason: '', sheets: [], flags: [], wattage: 207 })),
    evidence: { tables: [], expansions: [], families: [], typicals: [], unmappedTypical: [u] },
  }) as unknown as CountResult;
  it('review fix S11 — the note agrees (2 per pole = every type\'s heads per pole) -> information', () => {
    const i = buildReviewItems(cr([4, 2])).find(x => x.id.startsWith('typicalheads:'))!;
    expect(reviewItemIsOpen(i)).toBe(false);
    expect(i.detail).toContain('= 6 heads');
    expect(buildReviewItems(cr([4, 2])).some(x => x.id.startsWith('unscheduled:TYPICAL'))).toBe(false);
  });
  it('review fix S11 — Kissimmee: the note says 2 per pole x 3 poles = 6, the schedule 4 (S1 has 1 per pole) -> BLOCKING, both numbers', () => {
    const i = buildReviewItems(cr([2, 2])).find(x => x.id.startsWith('typicalheads:'))!;
    expect(reviewItemIsOpen(i)).toBe(true);
    expect(i.title).toBe('Site light heads: a note says 2 per pole (6), the fixture schedule 4');
  });
  it('heads not known from the schedule -> still a blocking question', () => {
    const items = buildReviewItems(cr([2, null]));
    expect(items.some(x => x.id.startsWith('typicalheads:'))).toBe(false);
    expect(reviewItemIsOpen(items.find(x => x.id.startsWith('unscheduled:TYPICAL'))!)).toBe(true);
  });
});


describe('review fix N2 — PP#5 (data / security pipes) is raceway, not a pole connection', () => {
  it('its takeoff line says so', async () => {
    const { countedRowItem } = await import('./countMerge');
    expect(countedRowItem({ type: 'PP#5', key: 'PP#5', description: 'Two 3in PVC pipes labeled DATA and SECURITY adjacent to PP#1', symbolHint: '', wattage: null, category: 'equipment', source: 'equipment_schedule', sourceSheet: '', headsPerPole: null, emergency: false }))
      .toBe('PP#5 — Two 3in PVC pipes labeled DATA and SECURITY adjacent to PP#1 (conduit / raceway — no power connection)');
    expect(countedRowItem({ type: 'PP#6', key: 'PP#6', description: 'Commercial counter power pole, 2 duplex, circuits A-40,42', symbolHint: '', wattage: null, category: 'equipment', source: 'equipment_schedule', sourceSheet: '', headsPerPole: null, emergency: false }))
      .toMatch(/\(connection\)$/);
  });
});

describe('review fix S11 — a zero-count type APT connects is blocking (the connection labour is APT\'s)', () => {
  it('"HVAC install, EC wire" at zero blocks; "by vendor" (nothing of it APT\'s) stays information', () => {
    const cr = (assignment: unknown) => ({ version: 2, ran: true, model: 'm', targetNotes: [], sheets: [], skippedSheets: [], loadCheck: null, removedRows: [], flags: [], marks: [],
      targets: [{ type: 'EF', key: 'EF', description: 'Exhaust fan', symbolHint: '', wattage: null, category: 'equipment', source: 'legend', sourceSheet: '', headsPerPole: null, emergency: false, assignment }],
      types: [{ key: 'EF', type: 'EF', description: 'Exhaust fan', category: 'equipment', count: 0, heads: null, status: 'zero', reason: 'not found on any counted plan sheet', sheets: [], flags: [], wattage: null }],
    }) as unknown as CountResult;
    const conn = buildReviewItems(cr({ furnish: null, install: 'OtherTrade', otherTrade: 'HVAC', aptConnects: true, viaGc: false, gcHalves: { furnish: false, install: false }, aptScope: 'connection' })).find(i => i.id === 'count:EF')!;
    expect(reviewItemIsOpen(conn)).toBe(true);
    expect(conn.detail).toContain("the connection is APT's to price");
    const none = buildReviewItems(cr({ furnish: 'Vendor', install: 'Vendor', aptConnects: false, viaGc: false, gcHalves: { furnish: false, install: false }, aptScope: 'none' })).find(i => i.id === 'count:EF')!;
    expect(reviewItemIsOpen(none)).toBe(false);
  });
});
