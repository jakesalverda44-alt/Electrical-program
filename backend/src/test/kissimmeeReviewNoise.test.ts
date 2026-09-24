// Next round A7 — review noise on a Kissimmee-SHAPED fixture: the live
// AutoZone #10077 run (2026-09-23, Sonnet) raised 37 review items, 33 of them
// count items. The causes the plan names are all here, built on the real
// two-batch Kissimmee Agent 1 output (agent1Fixtures) plus the live legend
// strings, run through the REAL target builder, sheet selection, merge and
// review builder:
//   * site types W1/W2 drawn only on the photometric sheet PH0.1 (never sent
//     before A2/A3);
//   * a dense strip area on E-3 that could not be read reliably (A5 retry);
//   * legend devices by others / the Owner's vendor, and an exhaust fan
//     installed by HVAC (A6);
//   * "G.C. furnished/installed" receptacles (A6: APT, counted);
//   * the power plan and a systems plan of one level both showing devices
//     (one "same area?" group);
//   * the power-pole scope question (AutoZone asks; E-2 says "by GC").
// "Before" runs the SAME drawings the old way (no photometric fallback, no
// trade assignment, the first — unreadable — pass on E-3); "after" is this
// branch. Target: <= 8 blocking items.
import { describe, it, expect } from 'vitest';
import { kissimmeeAgent1 } from './fixtures/takeoff/agent1Fixtures';
import { buildCountTargets, type CountTarget } from '../ai/countTargets';
import { selectCountSheets, type InventoryPage } from '../ai/countSheets';
import { mergeCountsIntoTakeoff, type SheetCountInput } from '../ai/countMerge';
import { buildReviewItems, reviewItemIsOpen, type ReviewItem } from '../ai/reviewItems';
import { resolveAccountTerms } from '../bidstd/accountRules';
import { scopeQuestionsFor } from '../bidstd/accountRulesDb';
import { AUTOZONE_SEED } from './fixtures/bidstd/kissimmeeProposal';
import type { CountResult } from '../ai/countingStage';

function agent1(): Record<string, unknown> {
  const a1 = kissimmeeAgent1();
  (a1.fixtureSchedule as unknown[]).push(
    { type: 'W1', description: 'LED wall pack, full cutoff, rear', wattage: 40, location: 'exterior_building', headsPerPole: 0, emergency: false, symbol: 'W1 wall pack', sourceSheet: 'PH0.1' },
    { type: 'W2', description: 'LED wall pack, forward throw, front', wattage: 60, location: 'exterior_building', headsPerPole: 0, emergency: false, symbol: 'W2 wall pack', sourceSheet: 'PH0.1' },
  );
  // The live legend strings (plan A6) and the usual by-others devices.
  (a1.symbolLegend as unknown[]).push(
    { symbol: 'SX', description: 'Simplex receptacle, G.C. furnished/installed', category: 'device', sourceSheet: 'E-0.1' },
    { symbol: 'DF', description: 'Duplex receptacle / floor receptacle, G.C.', category: 'device', sourceSheet: 'E-0.1' },
    { symbol: 'EF', description: 'Exhaust fan recessed, installed by HVAC, wired by EC', category: 'equipment', sourceSheet: 'E-0.1' },
    { symbol: 'D1', description: 'Data outlet (by owner\'s vendor)', category: 'device', sourceSheet: 'E-0.1' },
    { symbol: 'T1', description: 'Telephone outlet, by others', category: 'device', sourceSheet: 'E-0.1' },
    { symbol: 'CM', description: 'Security camera, by owner', category: 'device', sourceSheet: 'E-0.1' },
    { symbol: 'FA', description: 'Fire alarm pull station, N.I.C.', category: 'device', sourceSheet: 'E-0.1' },
  );
  return a1;
}

const INVENTORY: InventoryPage[] = [
  { file: 'set.pdf', page: 1, sheetNo: 'E-0.1', title: 'ELECTRICAL LEGEND & FIXTURE SCHEDULE', discipline: 'electrical', cls: 'schedule', included: true },
  { file: 'set.pdf', page: 2, sheetNo: 'E-1', title: 'ELECTRICAL SITE PLAN', discipline: 'electrical', cls: 'plan', included: true },
  { file: 'set.pdf', page: 3, sheetNo: 'E-2', title: 'POWER PLAN', discipline: 'electrical', cls: 'plan', included: true },
  { file: 'set.pdf', page: 4, sheetNo: 'E-2.1', title: 'SYSTEMS PLAN', discipline: 'electrical', cls: 'plan', included: true },
  { file: 'set.pdf', page: 5, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'plan', included: true },
  { file: 'set.pdf', page: 6, sheetNo: 'E-3.1', title: 'ENLARGED RESTROOM LIGHTING PLAN', discipline: 'electrical', cls: 'plan', included: true },
  { file: 'set.pdf', page: 7, sheetNo: 'E-7', title: 'ELECTRICAL DETAILS', discipline: 'electrical', cls: 'detail', included: true },
  // Classified civil; sent as a reference page (referenced by E-7 note 3).
  { file: 'set.pdf', page: 8, sheetNo: 'PH0.1', title: 'PHOTOMETRIC SITE PLAN', discipline: 'civil', cls: 'plan', included: true, role: 'reference' },
];

const marks = (c: Record<string, number>) => Object.entries(c).flatMap(([k, n]) => Array.from({ length: n }, () => ({ typeKey: k })));

/** What the counter reports per sheet. `pass: 'first'` = E-3's first pass
 *  (dense strips unreadable); 'retry' = after the A5 retry. */
function sheetResults(pass: 'first' | 'retry', withPhotometric: boolean): SheetCountInput[] {
  const sel = selectCountSheets(INVENTORY);
  const sheet = (no: string) => sel.counted.find(s => s.sheetNo === no)!;
  const e3 = pass === 'first'
    ? { placed: marks({ A: 55, B: 46, C: 2, M: 6, G: 9, E: 10, F: 6, K: 6, J: 2, D: 4 }), unreadable: [{ typeKey: 'A', tileId: 'R2C2', note: 'dense strip area' }, { typeKey: 'B', tileId: 'R2C2', note: 'dense strip area' }] }
    : { placed: marks({ A: 73, B: 52, C: 2, M: 6, G: 11, E: 10, F: 6, K: 6, J: 2, D: 5 }), unreadable: [] };
  const out: SheetCountInput[] = [
    { sheet: sheet('E-1'), status: 'counted', placed: marks({ S1: 2, S2: 1, D: 3 }), unreadable: [] },
    // Fix round S9 — owner-furnished devices (D1 data, CM camera) are
    // APT-installed, so the counter counts them on the power plan like any
    // device (a zero would rightly block).
    { sheet: sheet('E-2'), status: 'counted', placed: marks({ A: 70, GFI: 16, 'DUPLEX RECEPTACLE': 11, S: 8, SX: 8, DF: 3, 'RTU-1': 1, D1: 12, CM: 6 }), unreadable: [] },
    { sheet: sheet('E-2.1'), status: 'counted', placed: marks({ GFI: 4, 'DUPLEX RECEPTACLE': 2 }), unreadable: [] },
    { sheet: sheet('E-3'), status: 'counted', ...e3 },
    { sheet: sheet('E-3.1'), status: 'counted', placed: marks({ M: 6 }), unreadable: [] },
  ];
  if (withPhotometric && sel.counted.some(s => s.sheetNo === 'PH0.1')) {
    out.push({ sheet: sheet('PH0.1'), status: 'counted', placed: marks({ W1: 2, W2: 2, S1: 2, S2: 1 }), unreadable: [] });
  }
  return out;
}

function review(mode: 'before' | 'after'): ReviewItem[] {
  const a1 = agent1();
  let { targets } = buildCountTargets(a1);
  if (mode === 'before') targets = targets.map(t => { const { assignment: _drop, ...rest } = t as CountTarget & { assignment?: unknown }; return rest as CountTarget; });
  const sheets = sheetResults(mode === 'before' ? 'first' : 'retry', mode === 'after');
  const merged = mergeCountsIntoTakeoff(a1, targets, sheets, { countingRan: true });
  const cr: CountResult = {
    version: 2, ran: true, model: 'claude-opus-5-5', targets, targetNotes: [], sheets: [], skippedSheets: [],
    types: merged.types, loadCheck: merged.loadCheck, removedRows: merged.removedRows, flags: merged.flags, marks: [],
  };
  const snap = resolveAccountTerms(AUTOZONE_SEED, 'brand', a1.furnishStatements, false);
  return buildReviewItems(cr, scopeQuestionsFor(snap));
}

describe('A7 — Kissimmee-shaped review noise', () => {
  const before = review('before');
  const after = review('after');
  const blocking = (items: ReviewItem[]) => items.filter(reviewItemIsOpen);

  it('after: <= 8 blocking items, every one a real decision', () => {
    const b = blocking(after);
    // eslint-disable-next-line no-console
    console.log(`[A7] blocking before=${blocking(before).length} (of ${before.length} items) after=${b.length} (of ${after.length} items): ${b.map(i => i.id).join(', ')}`);
    expect(b.length).toBeLessThanOrEqual(8);
    expect(b.map(i => i.id).sort()).toEqual([
      // Real-run review fix S11 — the HVAC-installed fan at zero blocks: its
      // connection (wired by EC) is APT's labour.
      'area:DUPLEX RECEPTACLE', 'area:GFI', 'count:EF', 'count:L', 'count:OS',
      'scope:power_poles:furnish', 'scope:power_poles:install', 'unscheduled:SITE-LIGHTS-E-7',
    ]);
  });

  it('before (same drawings, old behaviour) was noisy for the causes the plan names', () => {
    const ids = blocking(before).map(i => i.id);
    for (const id of ['count:W1', 'count:W2', 'count:A', 'count:B', 'count:EF', 'count:T1', 'count:FA']) expect(ids).toContain(id);
    // Real-run review fix S11 adds the EF connection back as a block (8), so
    // "before" (14) is no longer twice "after"; it is still far noisier.
    expect(blocking(before).length).toBeGreaterThan(blocking(after).length + 5);
  });

  it('by others / N.I.C. types are information, not blocks; the HVAC-installed fan APT wires blocks (S11); owner-furnished and G.C. items are counted', () => {
    const info = after.filter(i => i.blocking === false).map(i => i.id);
    expect(info).toEqual(expect.arrayContaining(['count:T1', 'count:FA', 'photo:W1', 'photo:W2']));
    expect(info).not.toContain('count:EF');
    expect(info).not.toContain('count:D1');
    expect(info).not.toContain('count:CM');
    expect(after.find(i => i.id === 'count:SX')).toBeUndefined();
    expect(after.find(i => i.id === 'count:DF')).toBeUndefined();
  });

  it('grouped by cause: one "same area?" group (E-2 / E-2.1), one scope group with APT pre-filled, one photometric info group', () => {
    const groups = new Map<string, string[]>();
    for (const i of after) groups.set(i.group!, [...(groups.get(i.group!) ?? []), i.id]);
    expect(groups.get('area:E-2 / E-2.1')).toEqual(['area:GFI', 'area:DUPLEX RECEPTACLE']);
    expect(groups.get('scope')).toEqual(['scope:power_poles:furnish', 'scope:power_poles:install']);
    expect(after.filter(i => i.group === 'scope').every(i => i.suggested === 'APT')).toBe(true);
    expect(groups.get('photometric')).toEqual(['photo:W1', 'photo:W2']);
  });
});
