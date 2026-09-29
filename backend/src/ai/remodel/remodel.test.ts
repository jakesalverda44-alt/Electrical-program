// Remodel round A1-A3 — the pure pieces, on real 36th Street / Kissimmee
// shapes (the live exports in test/fixtures/realrun).
import { describe, it, expect } from 'vitest';
import { classifySheetTitles, conventionFromAnswer, CONVENTION_OPTIONS, isDemolitionTitle, isInstallStatus, normalizeMarkStatus, parseConventions, remodelSignal, statusPromptBlock, demolitionPromptBlock, textConventions } from './status';
import { buildDemolition, demoClassOf, demolitionRows, GENERIC_DEMO_TARGETS, isDemoEligibleTarget } from './demolition';
import { buildCountTargets, type CountTarget } from '../countTargets';
import { parseCounterResponse, splitByStatus, targetsForSheet, type PlacedMark } from '../counter';
import type { CountSheet } from '../countSheets';
import { load36th, agent1Input } from '../../test/fixtures/realrun/replay36th';
import { loadKissimmeeLive0928, loadKissimmeeLive } from '../../test/fixtures/realrun/kissimmeeLive';

const run36 = load36th();
const targets36 = buildCountTargets(agent1Input(run36)).targets;
const t36 = (k: string) => targets36.find(t => t.key === k)!;
const id = (s: string) => s;

describe('A1 — statuses', () => {
  it('normalizes what the counter says; only new / relocated / unknown count as install work', () => {
    expect(['new', 'N', 'existing', '(E)', 'existing to remain', 'demo', 'to be removed', 'relocated', 'R', '???', ''].map(normalizeMarkStatus))
      .toEqual(['new', 'new', 'existing', 'existing', 'existing', 'demo', 'demo', 'relocated', 'relocated', 'unknown', undefined]);
    expect([undefined, 'new', 'relocated', 'unknown', 'existing', 'demo'].map(s => isInstallStatus(s as never))).toEqual([true, true, true, true, false, false]);
  });

  it('conventions need a printed quote; duplicates dropped', () => {
    const c = parseConventions([
      { status: 'new', rule: 'shaded symbol = new', quote: 'SHADED SYMBOL DENOTES NEW RECEPTACLE' },
      { status: 'new', rule: 'dup', quote: 'shaded symbol denotes new receptacle' },
      { status: 'existing', rule: 'no quote' },
      { status: 'bogus', quote: 'X' },
    ], { key: 'E1', label: 'E1.0' }, 'counter');
    expect(c.map(x => [x.status, x.quote])).toEqual([['new', 'SHADED SYMBOL DENOTES NEW RECEPTACLE']]);
  });

  it('the text layer: "SHADED SYMBOL DENOTES NEW RECEPTACLE", "(E) = EXISTING", "DASHED … TO BE REMOVED"', () => {
    const c = textConventions('GENERAL NOTES 1. SHADED SYMBOL DENOTES NEW RECEPTACLE. 2. (E) = EXISTING TO REMAIN 3. DASHED LINES INDICATE ITEMS TO BE REMOVED', { key: 'k', label: 'E1.0' });
    expect(c.map(x => x.status)).toEqual(['new', 'demo', 'existing']);
  });
});

describe('A1 — remodel signal (new builds never enter remodel mode)', () => {
  it('36th Street: the drawing analysis says interior build-out / existing building alteration', () => {
    const s = remodelSignal({ agent1: run36.agent1, inventory: run36.inventory });
    expect(s.remodel).toBe(true);
    expect(s.reasons[0]).toContain('Interior Build-Out');
  });

  it('Kissimmee (new build, a SITE demolition plan D0.1, "confirm demo of existing electrical"): no remodel', () => {
    for (const run of [loadKissimmeeLive0928(), loadKissimmeeLive()]) {
      expect(remodelSignal({ agent1: run.agent1, inventory: run.inventory }).remodel).toBe(false);
    }
  });

  it('the bid\'s build type decides when set: new switches it off, remodel / tenant on', () => {
    expect(remodelSignal({ buildType: 'new', agent1: run36.agent1, inventory: run36.inventory }).remodel).toBe(false);
    const k = loadKissimmeeLive0928();
    expect(remodelSignal({ buildType: 'tenant', agent1: k.agent1, inventory: k.inventory }).reasons).toEqual(["the bid's build type is tenant"]);
  });
});

describe('A1.3 — demolition titles', () => {
  it('the real A2.0 / A3.0 drawing titles are demolition plans; notes and the title block are not', () => {
    expect(isDemolitionTitle('EXISTING FLOOR PLAN - DEMOLITIONS')).toBe(true);
    expect(isDemolitionTitle('EXISTING REFLECTIVE CEILING PLAN - DEMOLITIONS')).toBe(true);
    expect(isDemolitionTitle('Demolition Plan')).toBe(true);
    expect(isDemolitionTitle('DEMOLITION NOTES')).toBe(false);
    expect(classifySheetTitles(['EXISTING FLOOR PLAN - DEMOLITIONS', 'DEMOLITION NOTES', 'INTERIOR BUILD-OUT FOR 36TH STREET WAREHOUSE']).kind).toBe('demolition');
    expect(classifySheetTitles(['ELECTRICAL DEMOLITION PLAN', 'ELECTRICAL NEW WORK PLAN']).kind).toBe('mixed');
    // E1.0's real viewports
    expect(classifySheetTitles(['ELECTRICAL POWER LEGEND', 'ELECTRICAL LIGHTING LEGEND', 'ELECTRICAL POWER PLAN - ALTERATIONS']).kind).toBe('none');
  });

  it('the counter notes never look like a target line ("- tag | …")', () => {
    for (const block of [statusPromptBlock([{ status: 'new', rule: 'shaded = new', quote: 'SHADED SYMBOL DENOTES NEW', source: 'text' }], id), demolitionPromptBlock(['EXISTING FLOOR PLAN - DEMOLITIONS'], id)]) {
      expect(block.split('\n').some(l => l.startsWith('- ') && l.includes(' | '))).toBe(false);
    }
  });

  it('the estimator\'s answer becomes a rule on the next run (all-new / something-else do not)', () => {
    expect(conventionFromAnswer(CONVENTION_OPTIONS[1])?.status).toBe('new');
    expect(conventionFromAnswer(CONVENTION_OPTIONS[0])).toBeNull();
    expect(conventionFromAnswer(CONVENTION_OPTIONS[4])).toBeNull();
  });
});

describe('A1.5 — demolition classes and lines', () => {
  it('the job\'s real types map to the removal classes Chris prices', () => {
    const cls = (k: string) => demoClassOf(t36(k)).key;
    expect(['A', 'B', 'E2', 'G', 'DUPLEX RECEPTACLE', 'GFI', 'WP', '$', '$3', '$4', 'OS', 'TC', 'TRIANGLE', 'DISCONNECT']
      .map(k => [k, cls(k)])).toEqual([
      ['A', 'DEMO-FIXTURE'], ['B', 'DEMO-FIXTURE'], ['E2', 'DEMO-EXIT'], ['G', 'DEMO-FIXTURE'], ['DUPLEX RECEPTACLE', 'DEMO-RECEPTACLE'],
      ['GFI', 'DEMO-RECEPTACLE'], ['WP', 'DEMO-RECEPTACLE'], ['$', 'DEMO-SWITCH'], ['$3', 'DEMO-SWITCH3'], ['$4', 'DEMO-SWITCH3'],
      ['OS', 'DEMO-CONTROL'], ['TC', 'DEMO-CONTROL'], ['TRIANGLE', 'DEMO-DEVICE'], ['DISCONNECT', 'DEMO-EQUIPMENT'],
    ]);
  });

  it('a demolition sheet is asked the schedule + legend types and the generic classes; other sheets never see DEMO- targets', () => {
    const all = [...targets36, ...GENERIC_DEMO_TARGETS];
    const demo = { key: 'k#4', demolition: true } as CountSheet;
    const plan = { key: 'k#15' } as CountSheet;
    expect(targetsForSheet(demo, all).every(isDemoEligibleTarget)).toBe(true);
    expect(targetsForSheet(demo, all).some(t => t.source === 'equipment_schedule')).toBe(false);
    expect(targetsForSheet(demo, all).filter(t => t.key.startsWith('DEMO-')).length).toBe(GENERIC_DEMO_TARGETS.length);
    expect(targetsForSheet(plan, all).some(t => t.key.startsWith('DEMO-'))).toBe(false);
    expect(targetsForSheet(plan, targets36)).toBe(targets36); // a new-build list is passed through untouched
  });

  it('same-size sheets: the same item drawn twice is counted once; different sizes ask (the line carries the sum)', () => {
    const g = { widthPt: 2592, heightPt: 1728, rotation: 0 };
    const r = buildDemolition([
      { key: 'A2', label: 'A2.0 "X"', demolition: true, geometry: g, marks: [{ typeKey: 'DEMO-EXIT', x: 100, y: 100 }, { typeKey: 'DEMO-EXIT', x: 900, y: 100 }, { typeKey: 'DUPLEX RECEPTACLE', x: 50, y: 50 }] },
      { key: 'A3', label: 'A3.0 "Y"', demolition: true, geometry: g, marks: [{ typeKey: 'DEMO-EXIT', x: 104, y: 97 }, { typeKey: 'DEMO-EXIT', x: 1500, y: 100 }] },
      { key: 'E1', label: 'E1.0 "Z"', demolition: false, geometry: { widthPt: 1728, heightPt: 2592, rotation: 270 }, marks: [{ typeKey: 'GFI', x: 10, y: 10 }] },
    ], targets36);
    const exit = r.lines.find(l => l.classKey === 'DEMO-EXIT')!;
    expect([exit.qty, exit.dedupedAcross, exit.sheets.map(s => s.count)]).toEqual([3, 1, [2, 1]]);
    const rec = r.lines.find(l => l.classKey === 'DEMO-RECEPTACLE')!;
    expect([rec.qty, rec.byType.map(b => b.type)]).toEqual([2, ['Duplex receptacle', 'GFI']]);
    expect(r.questions.map(q => [q.classKey, q.keep, q.sum])).toEqual([['DEMO-RECEPTACLE', 1, 2]]);
    const rows = demolitionRows(r);
    expect(rows.map(x => [x.category, x.item, x.qty, x.countType])).toContainEqual(['Demolition', 'Demolition — exit/em fixture', 3, 'DEMO-EXIT']);
    expect(String(rows.find(x => x.countType === 'DEMO-EXIT')!.spec)).toContain('1 shown on two sheets counted once');
  });
});

describe('A1 — the counter reply (mocked)', () => {
  const keys = new Set(['A', 'DUPLEX RECEPTACLE']);
  const tiles = new Set(['R1C1', 'R1C2']);
  it('a sixth element is the mark\'s status; "conventions" ride along', () => {
    const p = parseCounterResponse(JSON.stringify({
      marks: [['DUPLEX RECEPTACLE', 'R1C1', 0.1, 0.2, '', 'existing'], ['DUPLEX RECEPTACLE', 'R1C1', 0.3, 0.2, 'A-5', 'new'], ['A', 'R1C2', 0.5, 0.5]],
      unreadable: [],
      conventions: [{ status: 'new', rule: 'shaded = new', quote: 'SHADED SYMBOL DENOTES NEW RECEPTACLE' }],
      notes: [],
    }), keys, tiles)!;
    expect(p.marks.map(m => [m.typeKey, m.status ?? null, m.circuit ?? null])).toEqual([['DUPLEX RECEPTACLE', 'existing', null], ['DUPLEX RECEPTACLE', 'new', 'A5'], ['A', null, null]]);
    expect(p.conventions.length).toBe(1);
  });

  it('a reply without the new fields parses exactly as before', () => {
    const p = parseCounterResponse('{"marks":[["A","R1C1",0.5,0.5,"A-1"]],"unreadable":[],"notes":[]}', keys, tiles)!;
    expect(p.marks).toEqual([{ typeKey: 'A', tileId: 'R1C1', nx: 0.5, ny: 0.5, circuit: 'A1' }]);
    expect(p.conventions).toEqual([]);
  });

  it('existing / demo marks leave the install count; a demolition sheet\'s marks are all demolition; unstatused marks untouched', () => {
    const pm = (typeKey: string, status?: PlacedMark['status']): PlacedMark => ({ typeKey, tileIds: [], x: 1, y: 1, ...(status ? { status } : {}) });
    const r = { sheet: { key: 'E1' } as CountSheet, placed: [pm('D', 'new'), pm('D', 'existing'), pm('D', 'demo'), pm('D', 'unknown'), pm('D', 'relocated')] };
    splitByStatus(r);
    expect([r.placed.map(p => p.status), (r as { statusMarks?: PlacedMark[] }).statusMarks!.map(p => p.status)]).toEqual([['new', 'unknown', 'relocated'], ['existing', 'demo']]);
    const d = { sheet: { key: 'A2', demolition: true } as CountSheet, placed: [pm('D', 'new'), pm('D')] };
    splitByStatus(d);
    expect([d.placed.length, (d as { statusMarks?: PlacedMark[] }).statusMarks!.map(p => p.status)]).toEqual([0, ['demo', 'demo']]);
    const n = { sheet: { key: 'E2' } as CountSheet, placed: [pm('D'), pm('D')] };
    splitByStatus(n);
    expect([n.placed.length, 'statusMarks' in n]).toEqual([2, false]);
  });
});

describe('A1 — mixed sheets, unclear statuses, demolition questions (review items)', () => {
  const g = { widthPt: 2592, heightPt: 1728, originX: 0, originY: 0, rotation: 0 };
  const vp = (id: string, title: string, left: number, kind = 'main_plan') => ({ id, number: '', title, scale: '', kind, rectIn: { left, top: 0, width: 18, height: 24 }, bboxPt: { x0: 0, y0: 0, x1: 0, y1: 0 }, source: 'vision', inPerFt: null });

  it('a demolition drawing beside the new-work drawing: its marks move to demolition', async () => {
    const { moveDemoViewportMarks } = await import('./remodelStage');
    const r = { sheet: { key: 'E1', label: 'E1.0' } as CountSheet, status: 'counted' as const, geometry: g,
      placed: [{ typeKey: 'A', tileIds: [], x: 72 * 5, y: 1728 - 72 * 5 }, { typeKey: 'A', tileIds: [], x: 72 * 25, y: 1728 - 72 * 5 }] as PlacedMark[] };
    const out = moveDemoViewportMarks(r, [vp('E1@1', 'ELECTRICAL DEMOLITION PLAN', 0), vp('E1@2', 'ELECTRICAL NEW WORK PLAN', 18)] as never);
    expect(out).toEqual({ demoTitles: ['ELECTRICAL DEMOLITION PLAN'], moved: 1 });
    expect([r.placed.length, (r as { statusMarks?: PlacedMark[] }).statusMarks!.map(m => m.status)]).toEqual([1, ['demo']]);
  });

  it('marks whose status the counter could not tell: counted as new AND a blocking item; the answer is enforced', async () => {
    const { buildRemodelResult } = await import('./remodelStage');
    const { remodelItems, enforcedCounts, reviewItemIsOpen } = await import('../reviewItems');
    const rm = buildRemodelResult({ reasons: ['x'], known: [] }, [{
      sheet: { key: 'E1', label: 'E1.0 "Electrical Plan"' } as CountSheet, status: 'counted', geometry: g, placed: [],
      conventions: [{ status: 'new', rule: 'shaded = new', quote: 'SHADED SYMBOL DENOTES NEW RECEPTACLE' }],
      statusMarks: [{ typeKey: 'GFI', tileIds: [], x: 1, y: 1, status: 'existing' }],
    }], [{ sheetKey: 'E1', typeKey: 'DUPLEX RECEPTACLE', status: 'unknown' }, { sheetKey: 'E1', typeKey: 'DUPLEX RECEPTACLE', status: 'new' }, { sheetKey: 'E1', typeKey: 'DUPLEX RECEPTACLE' }], targets36);
    expect(rm.unknownStatus.map(u => [u.type, u.count, u.total])).toEqual([['Duplex receptacle', 1, 3]]);
    expect(rm.conventionQuestion).toBe(false);
    const cr = { targets: targets36, types: [{ key: 'DUPLEX RECEPTACLE', type: 'Duplex receptacle', status: 'counted', count: 3, category: 'device', sheets: [], flags: [] }], remodel: rm } as unknown as import('../countingStage').CountResult;
    const items = remodelItems(cr);
    const st = items.find(i => i.id === 'status:DUPLEX RECEPTACLE')!;
    expect([st.title, reviewItemIsOpen(st)]).toEqual(['Type Duplex receptacle: 1 of 3 could not be told new or existing', true]);
    expect(items.find(i => i.id === 'remodel:existing')!.blocking).toBe(false);
    expect(enforcedCounts(cr, items).byType.get('DUPLEX RECEPTACLE')).toBe(3);
    const answered = items.map(i => (i.id === st.id ? { ...i, resolution: { action: 'count' as const, qty: 2, by: 'Jake', at: 'now' } } : i));
    expect(enforcedCounts(cr, answered).byType.get('DUPLEX RECEPTACLE')).toBe(2);
  });

  it('a demolition class on two sheets that can\'t be compared asks; a demolition sheet that failed blocks', async () => {
    const { buildRemodelResult } = await import('./remodelStage');
    const { remodelItems, validateResolution } = await import('../reviewItems');
    const rm = buildRemodelResult({ reasons: ['x'], known: [{ status: 'new', rule: 'r', quote: 'q', sheetKey: '*', sheetLabel: 'every sheet', source: 'estimator' }] }, [
      { sheet: { key: 'E1', label: 'E1.0 "E"' } as CountSheet, status: 'counted', geometry: g, placed: [], statusMarks: [{ typeKey: 'GFI', tileIds: [], x: 5, y: 5, status: 'demo' }] },
      { sheet: { key: 'A2', label: 'A2.0 "D"', demolition: true, demolitionTitles: ['EXISTING FLOOR PLAN - DEMOLITIONS'] } as CountSheet, status: 'counted', geometry: { ...g, widthPt: 3024 }, placed: [], statusMarks: [{ typeKey: 'DUPLEX RECEPTACLE', tileIds: [], x: 5, y: 5 }] },
      { sheet: { key: 'A3', label: 'A3.0 "R"', demolition: true, demolitionTitles: ['DEMO RCP'] } as CountSheet, status: 'failed', error: 'render failed', geometry: null, placed: [] },
    ], [], targets36);
    const items = remodelItems({ remodel: rm } as unknown as import('../countingStage').CountResult);
    const q = items.find(i => i.id === 'demodup:DEMO-RECEPTACLE')!;
    expect([q.kind, q.options, q.keepQty, q.sumQty]).toEqual(['area', ['The same items — keep 1', 'Different items — sum 2'], 1, 2]);
    expect(validateResolution(q, { action: 'answer', answer: q.options![0] }, null)).toEqual({ ok: true, resolution: { action: 'answer', answer: q.options![0], qty: 1 } });
    expect(items.find(i => i.id === 'demosheet:A3')!.blocking).toBeUndefined();
    expect(rm.demolition.lines.find(l => l.classKey === 'DEMO-RECEPTACLE')!.qty).toBe(2);
  });
});
