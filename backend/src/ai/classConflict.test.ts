// Review fix S1 — B-32 drawn as a DUPLEX on E-1 and as a SIMPLEX on E-2 #11
// (the live counter's own marks and circuits): one receptacle, counted once,
// with a class question. Never a GFCI / WP, never two different circuits,
// never a same-class pair (the sheet-pair rule's), never an ambiguous one.
import { describe, it, expect } from 'vitest';
import { pairReceptacleClasses, type SheetCountInput } from './countMerge';
import { buildCountTargets } from './countTargets';
import { consolidateTargets } from './evidence/consolidate';
import { pdfToDisplayedIn, viewportAt } from './evidence/viewports';
import { buildReviewItems, enforcedCounts } from './reviewItems';
import type { CountResult } from './countingStage';
import { loadKissimmeeLive } from '../test/fixtures/realrun/kissimmeeLive';

const live = loadKissimmeeLive();
const targets = consolidateTargets(buildCountTargets(live.agent1).targets, { panels: ['A', 'B'] }).targets;
function sheets(mutate: (m: { typeKey: string; circuit?: string }) => void = () => {}): SheetCountInput[] {
  return [49, 50].map(page => {
    const s = live.countResult.sheets.find(x => x.page === page)!;
    return {
      sheet: { key: s.key, file: s.file, page, label: s.label, role: 'building', focus: 'power', level: '', sheetNo: '', title: '' },
      status: 'counted' as const, unreadable: [], geometry: s.geometry!, viewports: s.viewports!,
      placed: live.countResult.marks.filter(m => m.sheetKey === s.key).map(m => {
        const p = pdfToDisplayedIn(m.x, m.y, s.geometry!);
        const mm = { ...m, viewportId: viewportAt(s.viewports!, p.x, p.y)?.id ?? null };
        mutate(mm);
        return mm;
      }),
    } as SheetCountInput;
  });
}

describe('review fix S1 — one receptacle under two class names on two sheets', () => {
  it('B-32: E-1 main plan DUPLEX + E-2 #11 SIMPLEX, same circuit, same place -> one (kept as the main plan\'s DUPLEX), a class question', () => {
    const ss = sheets();
    const before = ss[1].placed.filter(m => m.typeKey === 'SIMPLEX').length;
    const c = pairReceptacleClasses(targets, ss);
    expect(c).toEqual([{ circuit: 'B32', kept: { sheetLabel: 'E-1 "Power Plan & General Notes"', typeKey: 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE' }, dropped: { sheetLabel: 'E-2 "Power Plan & Details"', typeKey: 'SIMPLEX' } }]);
    expect(ss[1].placed.filter(m => m.typeKey === 'SIMPLEX').length).toBe(before - 1);
    // The question, and its enforced answer.
    const cr = { version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], loadCheck: null, removedRows: [], flags: [], marks: [],
      types: [{ key: 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE', type: 'Duplex', description: '', category: 'device', count: 14, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: null },
        { key: 'SIMPLEX', type: 'simplex', description: '', category: 'device', count: 8, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: null }],
      evidence: { tables: [], expansions: [], families: [], typicals: [], classConflicts: c } } as unknown as CountResult;
    const q = buildReviewItems(cr).find(i => i.id.startsWith('classconflict:'))!;
    expect(q.options).toEqual(['Duplex (as counted)', 'simplex', 'Two different receptacles — count both']);
    const e = enforcedCounts(cr, [{ ...q, resolution: { action: 'answer', answer: 'simplex', by: 'x', at: 'y' } }]);
    expect([e.byType.get('DUPLEX RECEPTACLE / FLOOR RECEPTACLE'), e.byType.get('SIMPLEX')]).toEqual([13, 9]);
  });
  it('different circuits, or the same class, are never paired here', () => {
    expect(pairReceptacleClasses(targets, sheets(m => { if (m.circuit === 'B32' && m.typeKey === 'SIMPLEX') m.circuit = 'B34'; }))).toEqual([]);
    expect(pairReceptacleClasses(targets, sheets(m => { if (m.circuit === 'B32') m.typeKey = 'SIMPLEX'; }))).toEqual([]);
  });
  it('a GFCI is never a plain receptacle', () => {
    expect(pairReceptacleClasses(targets, sheets(m => { if (m.circuit === 'B32' && m.typeKey === 'SIMPLEX') m.typeKey = 'GFCI'; }))).toEqual([]);
  });
});
