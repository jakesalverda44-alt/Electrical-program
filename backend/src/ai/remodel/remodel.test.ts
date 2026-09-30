// Remodel round A1-A3 — the pure pieces, on real 36th Street / Kissimmee
// shapes (the live exports in test/fixtures/realrun).
import { describe, it, expect } from 'vitest';
import { classifySheetTitles, conventionFromAnswer, CONVENTION_OPTIONS, isDemolitionTitle, isInstallStatus, normalizeMarkStatus, parseConventions, remodelSignal, statusPromptBlock, demolitionPromptBlock, textConventions } from './status';
import { buildDemolition, demoClassOf, demolitionRows, GENERIC_DEMO_TARGETS, isDemoEligibleTarget } from './demolition';
import { aggregateUnlisted, unlistedTagRejection, normalizeUnlistedTag } from './unlisted';
import { evidenceCorpus, legendUnusedKeys, mentionOf } from './legendUnused';
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

describe('A1 / fix B1 — remodel signal: build type, electrical plan titles, printed rules only', () => {
  const sig = (titles: Array<[string, string]>, extra: Partial<Parameters<typeof remodelSignal>[0]> = {}) =>
    remodelSignal({ electricalTitles: titles.map(([sheet, title]) => ({ sheet, title })), ...extra });

  it('36th Street: E1.0 / E2.0 draw "ELECTRICAL POWER PLAN - ALTERATIONS"', () => {
    const vps = (run36.countResult.sheets as Array<{ label: string; viewports?: Array<{ title: string }> }>).flatMap(s => (s.viewports ?? []).map(v => [s.label, v.title] as [string, string]));
    const s = sig(vps);
    expect(s.remodel).toBe(true);
    expect(s.reasons[0]).toContain('ELECTRICAL POWER PLAN - ALTERATIONS');
  });

  it('the reviewer\'s new-build titles never trigger it', () => {
    for (const t of ['Boundary & Existing Conditions Survey', 'Existing Conditions and Demolition Plan', 'DIVISION 02 - EXISTING CONDITIONS',
      'Electrical Site Plan - Existing Utility', 'ELECTRICAL SITE DEMOLITION PLAN - EXISTING TO BE REMOVED', 'Power Plan & General Notes', 'Demolition Plan']) {
      expect(sig([['X', t]]).remodel, t).toBe(false);
    }
    for (const t of ['ELECTRICAL RENOVATION PLAN', 'EXISTING ELECTRICAL PLAN - DEMOLITION', 'FIRST FLOOR REMODEL - POWER']) expect(sig([['E1', t]]).remodel, t).toBe(true);
  });

  it('Kissimmee 9/24 and 9/28 (real electrical titles + drawing titles): no remodel', () => {
    for (const run of [loadKissimmeeLive0928(), loadKissimmeeLive()]) {
      const titles: Array<[string, string]> = [
        ...run.inventory.filter(p => p.discipline === 'electrical' && p.cls === 'plan').map(p => [p.sheetNo, p.title] as [string, string]),
        ...run.countResult.sheets.flatMap(s => ((s.viewports ?? []) as Array<{ title: string }>).map(v => [s.label, v.title] as [string, string])),
      ];
      expect(sig(titles).remodel).toBe(false);
    }
  });

  it('build type decides when set; the estimator\'s answer turns it on; a printed rule never does (re-check N1)', () => {
    expect(sig([['E1', 'ELECTRICAL PLAN - ALTERATIONS']], { buildType: 'new' }).remodel).toBe(false);
    expect(sig([], { buildType: 'tenant' }).reasons).toEqual(["the bid's build type is tenant"]);
    expect(sig([], { answer: CONVENTION_OPTIONS[0] }).remodel).toBe(true);
    expect(sig([]).remodel).toBe(false);
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
    // fix S1 — combined titles and reference runs
    for (const t of ['ELECTRICAL DEMOLITION AND NEW WORK PLAN', 'DEMO / NEW WORK POWER PLAN']) {
      const c = classifySheetTitles([t]);
      expect([c.kind, c.demoTitles, c.combinedTitles], t).toEqual(['mixed', [], [t]]);
    }
    expect(classifySheetTitles(['REFER TO ARCHITECTURAL DEMOLITION PLAN FOR EXTENT']).kind).toBe('none');
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

  it('fix S8 — site poles, wall packs and J-boxes get their own classes; only classes with a demolition unit become lines', () => {
    const t = (category: CountTarget['category'], description: string, type = 'X') => ({ key: type, type, description, symbolHint: '', category, emergency: false });
    expect(demoClassOf(t('site_lighting', 'LED area light 25 ft pole', 'S1')).key).toBe('DEMO-SITE-POLE');
    expect(demoClassOf(t('exterior_building', 'LED wall pack', 'W1')).key).toBe('DEMO-EXTERIOR');
    expect(demoClassOf(t36('J')).key).toBe('DEMO-JBOX');
    const r = buildDemolition([{ key: 'A2', label: 'A2.0 "D"', demolition: true, geometry: null, marks: [{ typeKey: 'DEMO-SITE-POLE', x: 1, y: 1 }, { typeKey: 'J', x: 5, y: 5 }] }], targets36);
    expect(r.lines.map(l => l.classKey).sort()).toEqual(['DEMO-JBOX', 'DEMO-SITE-POLE']);
    // Price accuracy D4 — every class has a unit now (C5's site pole unit).
    expect(demolitionRows(r).map(x => x.item)).toEqual(['Demolition — junction box', 'Demolition — site pole light']);
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

  it('fix S2 — registered sheets (same size AND their marks line up) are de-duplicated; different sizes ask (the line carries the sum)', () => {
    const g = { widthPt: 2592, heightPt: 1728, rotation: 0 };
    const r = buildDemolition([
      { key: 'A2', label: 'A2.0 "X"', demolition: true, geometry: g, marks: [{ typeKey: 'DEMO-EXIT', x: 100, y: 100 }, { typeKey: 'DEMO-EXIT', x: 900, y: 100 }, { typeKey: 'DUPLEX RECEPTACLE', x: 50, y: 50 }] },
      { key: 'A3', label: 'A3.0 "Y"', demolition: true, geometry: g, marks: [{ typeKey: 'DEMO-EXIT', x: 104, y: 97 }, { typeKey: 'DEMO-EXIT', x: 897, y: 104 }, { typeKey: 'DEMO-EXIT', x: 1500, y: 100 }] },
      { key: 'E1', label: 'E1.0 "Z"', demolition: false, geometry: { widthPt: 1728, heightPt: 2592, rotation: 270 }, marks: [{ typeKey: 'GFI', x: 10, y: 10 }] },
    ], targets36);
    const exit = r.lines.find(l => l.classKey === 'DEMO-EXIT')!;
    expect([exit.qty, exit.dedupedAcross, exit.sheets.map(s => s.count)]).toEqual([3, 2, [2, 1]]);
    const rec = r.lines.find(l => l.classKey === 'DEMO-RECEPTACLE')!;
    expect([rec.qty, rec.byType.map(b => b.type)]).toEqual([2, ['Duplex receptacle', 'GFI']]);
    expect(r.questions.map(q => [q.classKey, q.keep, q.sum])).toEqual([['DEMO-RECEPTACLE', 1, 2]]);
    const rows = demolitionRows(r);
    expect(rows.map(x => [x.category, x.item, x.qty, x.countType])).toContainEqual(['Demolition', 'Demolition — exit/emergency light', 3, 'DEMO-EXIT']);
    expect(String(rows.find(x => x.countType === 'DEMO-EXIT')!.spec)).toContain('2 shown on two sheets counted once');
  });

  it('fix S2 — the reviewer\'s repro: two same-size sheets, the same 10 fixtures drawn 900 pt apart -> NOT de-duplicated, ONE question with both counts', () => {
    const g = { widthPt: 2592, heightPt: 1728, rotation: 0 };
    const ten = (dx: number) => Array.from({ length: 10 }, (_, i) => ({ typeKey: 'DEMO-FIXTURE', x: 200 + i * 100 + dx, y: 400 }));
    const r = buildDemolition([
      { key: 'E1', label: 'E1.0 "E"', demolition: false, geometry: g, marks: ten(0) },
      { key: 'A3', label: 'A3.0 "A"', demolition: true, geometry: g, marks: ten(900) },
    ], targets36);
    expect([r.lines[0].qty, r.lines[0].dedupedAcross]).toEqual([20, 0]);
    expect(r.questions.map(q => [q.classKey, q.sheets.map(s => s.count), q.keep, q.sum])).toEqual([['DEMO-FIXTURE', [10, 10], 10, 20]]);
  });
});

describe('A2 — unlisted tags: the guard, on real 36th Street tags', () => {
  const ctx = { panels: ['A', 'B', 'A', 'B'], targetKeys: new Set(targets36.map(t => t.key)) };
  it('H is a fixture tag; circuits, room names / numbers, keyed notes, door tags and listed types are not', () => {
    const cases: Array<[string, string]> = [
      ['H', "4' surface strip light"], ['F', 'circle with X'], ['A01', 'tag at fixture'], ['A05', ''], ['A08', ''], ['A-6', ''], ['A6', ''],
      ['BREAKROOM', 'room name'], ["PASTOR'S OFFICE", ''], ['101', ''], ['12', 'hexagon'], ['D101', 'door'], ['A', '2x4'], ['E2', 'exit'], ['W1', 'door tag'],
    ];
    expect(cases.map(([t, s]) => [t, unlistedTagRejection(normalizeUnlistedTag(t), s, ctx) === null])).toEqual([
      ['H', true], ['F', true], ['A01', false], ['A05', false], ['A08', false], ['A-6', false], ['A6', false],
      ['BREAKROOM', false], ["PASTOR'S OFFICE", false], ['101', false], ['12', false], ['D101', false], ['A', false], ['E2', false], ['W1', false],
    ]);
  });

  it('re-check S-new-2 — fixture-style tags are allowed; circuit shapes are rejected only on a known panel, as a comma list, or as a series', () => {
    const bare = { panels: [] as string[], targetKeys: new Set(['A', 'B']), equipmentTags: ['AC1', 'RTU-1', 'COMP #1'], circuits: ['12,14'] };
    for (const t of ['F-1', 'SL-1', 'HB-1', 'EX-1', 'L-2', 'F12', 'D10', 'H', 'F', 'S1', 'A10']) expect([t, unlistedTagRejection(t, 'fixture symbol', bare)]).toEqual([t, null]);
    for (const t of ['A26,28', 'RTU-1', 'AC1', 'COMP#1', 'EM', 'WP', 'GFI', 'GFCI', 'NL', 'X', 'TYP', '12,14']) expect([t, unlistedTagRejection(t, 'fixture symbol', bare)]).not.toEqual([t, null]);
    const panels = { ...bare, panels: ['LP1', 'L1', 'Panel A'] };
    expect(['LP1-5', 'L1-12', 'A10', 'A-5'].map(t => unlistedTagRejection(t, 'fixture symbol', panels))).toEqual(['a circuit on panel LP1', 'a circuit on panel L1', 'a circuit on panel A', 'a circuit on panel A']);
  });

  it('final check 1 — no "series" rule: F1/F2/F3, F5-F7 (F1-F4 listed), SL-1..3 are reported; with NO panel read A01/A05/A08 go to the non-blocking possible group, never dropped', () => {
    const items = (tags: string[]) => [{ sheetKey: 'E2', label: 'E2.0 "E"', items: tags.map(tag => ({ tag, symbol: 'fixture symbol', marks: [{ x: 1, y: 1 }] })) }];
    const ctx0 = { panels: [] as string[], targetKeys: new Set<string>() };
    expect(aggregateUnlisted(items(['F1', 'F2', 'F3']), ctx0).tags.map(t => t.tag)).toEqual(['F1', 'F2', 'F3']);
    expect(aggregateUnlisted(items(['F5', 'F6', 'F7']), { ...ctx0, targetKeys: new Set(['F1', 'F2', 'F3', 'F4']) }).tags.map(t => t.tag)).toEqual(['F5', 'F6', 'F7']);
    expect(aggregateUnlisted(items(['SL-1', 'SL-2', 'SL-3']), ctx0).tags.map(t => t.tag)).toEqual(['SL-1', 'SL-2', 'SL-3']);
    const noPanels = aggregateUnlisted(items(['A01', 'A05', 'A08', 'D10']), ctx0);
    expect([noPanels.tags.map(t => t.tag), noPanels.possible.map(t => t.tag), noPanels.rejected]).toEqual([['D10'], ['A01', 'A05', 'A08'], []]);
    // panels A / B known (36th): the real tokens are rejected outright
    const withPanels = aggregateUnlisted(items(['A01', 'A05', 'A08', 'A26,28', 'A26']), { ...ctx0, panels: ['A', 'B'] });
    expect([withPanels.tags, withPanels.possible, withPanels.rejected.map(x => x.tag)]).toEqual([[], [], ['A01', 'A05', 'A08', 'A26,28', 'A26']]);
  });

  it('one entry per tag across sheets', () => {
    const r = aggregateUnlisted([
      { sheetKey: 'E2', label: 'E2.0', items: [{ tag: 'Type H', symbol: 'strip', marks: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, { tag: 'A05', symbol: '', marks: [{ x: 3, y: 3 }] }] },
      { sheetKey: 'E1', label: 'E1.0', items: [{ tag: 'h', symbol: '', marks: [{ x: 5, y: 5 }] }] },
    ], ctx);
    expect(r.tags.map(t => [t.tag, t.total, t.sheets.map(s => s.count)])).toEqual([['H', 3, [2, 1]]]);
    expect(r.rejected).toEqual([{ tag: 'A05', reason: 'a circuit on panel A' }]);
  });
});

describe('A1 / A2 — the counter reply (mocked)', () => {
  const keys = new Set(['A', 'DUPLEX RECEPTACLE']);
  const tiles = new Set(['R1C1', 'R1C2']);
  it('a sixth element is the mark\'s status; "conventions" and "unlisted" ride along; an unlisted tile not sent is dropped', () => {
    const p = parseCounterResponse(JSON.stringify({
      marks: [['DUPLEX RECEPTACLE', 'R1C1', 0.1, 0.2, '', 'existing'], ['DUPLEX RECEPTACLE', 'R1C1', 0.3, 0.2, 'A-5', 'new'], ['A', 'R1C2', 0.5, 0.5]],
      unreadable: [],
      conventions: [{ status: 'new', rule: 'shaded = new', quote: 'SHADED SYMBOL DENOTES NEW RECEPTACLE' }],
      unlisted: [{ tag: 'H', symbol: "4' strip", marks: [['R1C2', 0.4, 0.4], ['R9C9', 0.1, 0.1]] }, { tag: 'X', marks: [] }],
      notes: [],
    }), keys, tiles)!;
    expect(p.marks.map(m => [m.typeKey, m.status ?? null, m.circuit ?? null])).toEqual([['DUPLEX RECEPTACLE', 'existing', null], ['DUPLEX RECEPTACLE', 'new', 'A5'], ['A', null, null]]);
    expect(p.conventions.length).toBe(1);
    expect(p.unlisted).toEqual([{ tag: 'H', symbol: "4' strip", marks: [{ tileId: 'R1C2', nx: 0.4, ny: 0.4 }] }]);
  });

  it('a reply without the new fields parses exactly as before', () => {
    const p = parseCounterResponse('{"marks":[["A","R1C1",0.5,0.5,"A-1"]],"unreadable":[],"notes":[]}', keys, tiles)!;
    expect(p.marks).toEqual([{ typeKey: 'A', tileId: 'R1C1', nx: 0.5, ny: 0.5, circuit: 'A1' }]);
    expect([p.conventions, p.unlisted]).toEqual([[], []]);
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

describe('A3 / fix B4 — the reviewer\'s repros: evidence anywhere keeps the item', () => {
  const tg = (type: string, description: string, category: CountTarget['category']): CountTarget => ({ type, key: type.toUpperCase(), description, symbolHint: '', wattage: null, category, source: 'legend', sourceSheet: 'E0.1', headsPerPole: null, emergency: false });
  const zero = (t: CountTarget) => ({ key: t.key, status: 'zero', reason: 'not found on any counted plan sheet', category: t.category });
  it('S "Single pole switch", DUPLEX "Duplex receptacle", C "EV charger receptacle" (panel circuit EVSE-1) all stay', () => {
    const agent1 = {
      quantities: [{ item: 'Single pole switch', qty: 16 }, { item: 'Duplex receptacle 20A', qty: 24 }],
      panelCircuits: [{ panel: 'A', circuit: '12,14', description: 'EVSE-1' }],
    };
    const ts = [tg('S', 'Single pole switch', 'lighting_control'), tg('DUPLEX', 'Duplex receptacle', 'device'), tg('C', 'EV charger receptacle', 'device')];
    const d = legendUnusedKeys(ts.map(zero), ts, evidenceCorpus(agent1));
    expect(d.map(x => [x.key, x.unused])).toEqual([['S', false], ['DUPLEX', false], ['C', false]]);
    // the charger alone, by the synonym map (EVSE = EV = charger)
    expect(legendUnusedKeys([zero(ts[2])], [ts[2]], evidenceCorpus({ panelCircuits: agent1.panelCircuits }))[0].unused).toBe(false);
    // a switch named "SW" in a note
    // fix Q1 — a generic noun alone ("SW") is not evidence for "Single pole switch"
    expect(mentionOf(ts[0], ['provide SW at each door'])).toBeNull();
    expect(mentionOf(ts[0], ['single pole SW at each door'])).toBe('single pole SW at each door');
  });
  it('re-check N2 — the reviewer\'s five repros stay review items (ratings, number words, EV / AFCI synonyms, generic station)', () => {
    const cases: Array<[CountTarget, Record<string, unknown>]> = [
      [tg('EV1', 'EV charging station', 'device'), { panelCircuits: [{ panel: 'A', circuit: '20', description: 'EV CHARGER' }] }],
      [tg('C', 'Electric vehicle charger', 'device'), { panelCircuits: [{ panel: 'A', circuit: '22', description: 'EV CHARGER' }] }],
      [tg('$3', 'Two/three way switch', 'lighting_control'), { quantities: [{ item: '3-way switch', qty: 4 }] }],
      [tg('AF', 'Duplex receptacle AFCI', 'device'), { quantities: [{ item: 'AFCI receptacles', qty: 12 }] }],
      [tg('D', 'Duplex receptacle, 20A, 125V', 'device'), { quantities: [{ item: 'Duplex receptacle 20A', qty: 24 }] }],
    ];
    for (const [t, agent1] of cases) expect([t.type, legendUnusedKeys([zero(t)], [t], evidenceCorpus(agent1))[0].unused]).toEqual([t.type, false]);
    // the tag decides a "Three/four way" legend: a 3-way row is not a 4-way
    expect(mentionOf(tg('$4', 'Three/four way switch', 'lighting_control'), ['3-way switch'])).toBeNull();
    expect(mentionOf(tg('$4', 'Three/four way switch', 'lighting_control'), ['4-way switch'])).toBe('4-way switch');
    // ratings never distinguish, except a voltage of 200 V or more
    expect(mentionOf(tg('220V', '220V receptacle', 'device'), ['Duplex receptacle 20A'])).toBeNull();
    // arc fault / ground fault fold into AFCI / GFCI
    expect(mentionOf(tg('AF', 'Duplex receptacle AFCI', 'device'), ['arc-fault receptacles in bedrooms'])).not.toBeNull();
  });

  it('final check 2 — voltages fold: 208 / 220 / 230 / 240 / 250 V and "N volt" -> one high-voltage word; the reviewer\'s five rows keep 220V; a service pair (120/208V) never does', () => {
    const t = tg('220V', '220V receptacle', 'device');
    for (const row of ['208V', '240V ice machine', 'Receptacle 208V 1PH', '220 volt', 'WELDER RECEPT 208V']) {
      expect([row, legendUnusedKeys([zero(t)], [t], evidenceCorpus({ quantities: [{ item: row, qty: 1 }] }))[0].unused]).toEqual([row, false]);
    }
    for (const row of ['Existing Panel A 200A MLO Siemens EQ 10kAIC 120/208V 1PH', 'Service 208Y/120V 3PH 4W', 'Duplex receptacle 20A 125V', 'GFCI receptacle 120V']) {
      expect([row, mentionOf(t, [row])]).toEqual([row, null]);
    }
  });

  it('83e4ef9 — a voltage pair is dropped only on a service / panel row; elsewhere its higher voltage counts (RECPT = receptacle)', () => {
    const cases: Array<[CountTarget, Record<string, unknown>]> = [
      [tg('240R', '240V receptacle', 'device'), { quantities: [{ item: 'Range receptacle 120/240V', qty: 1 }] }],
      [tg('220V', '220V receptacle', 'device'), { quantities: [{ item: 'Dryer receptacle 120/240V 30A', qty: 1 }] }],
      [tg('220V', '220V receptacle', 'device'), { panelCircuits: [{ panel: 'A', circuit: '31,33', description: 'OVEN RECPT 208/240' }] }],
    ];
    for (const [t, agent1] of cases) expect([t.type, legendUnusedKeys([zero(t)], [t], evidenceCorpus(agent1))[0].unused]).toEqual([t.type, false]);
    expect(mentionOf(tg('R', 'Receptacle', 'device'), ['OVEN RECPT'])).toBe('OVEN RECPT');
  });

  it('final check 3 — abbreviations: 1-pole / single pole / SP, 2-pole / DP, 3-pole, occ / occupancy, J-box / junction box', () => {
    const cases: Array<[CountTarget, string]> = [
      [tg('$', 'Single pole switch', 'lighting_control'), 'SP switch at each door'],
      [tg('$', 'Single pole switch', 'lighting_control'), '1-pole switches (16)'],
      [tg('$2', 'Double pole switch', 'lighting_control'), '2-pole switch for heater'],
      [tg('$3P', 'Three pole switch', 'lighting_control'), '3 pole switch'],
      [tg('OS', 'Ceiling occupancy sensor', 'lighting_control'), 'OCC SENSOR, ceiling, dual tech'],
      [tg('J', 'Junction box', 'equipment'), 'J-box at each RTU'],
      [tg('JB', 'J-box, 4" square', 'device'), '4 square junction box above ceiling'],
    ];
    for (const [t, row] of cases) expect([t.description, row, mentionOf(t, [row])]).toEqual([t.description, row, row]);
    // a breaker's "1P" is a rating, never a single-pole switch
    expect(mentionOf(tg('$D', 'Single pole dimmer switch', 'lighting_control'), ['20A/1P breaker dimmer'])).toBeNull();
  });

  it('a one-letter / $ tag is never matched on its own; nothing on the job naming it -> it collapses', () => {
    const t = tg('$K', 'Key switch', 'lighting_control');
    expect(mentionOf(t, ['$K', 'K'])).toBeNull();
    const t2 = tg('X', 'Pull station', 'device');
    expect(legendUnusedKeys([zero(t2)], [t2], evidenceCorpus({ quantities: [{ item: 'Duplex receptacle', qty: 3 }] }))[0].unused).toBe(true);
  });
  it('a type with existing marks never collapses', () => {
    const t = tg('PS', 'Pull station', 'device');
    expect(legendUnusedKeys([{ ...zero(t), existingMarks: 2 }], [t], [])).toEqual([]);
  });
});

describe('A3 — legend noise, on the real 36th Street analysis', () => {
  it('fix Q1: generic nouns never count on their own — fourplex, 220V, AF, $D, $4 collapse; OS / TC / S keep their real evidence', () => {
    const corpus = evidenceCorpus(agent1Input(run36));
    const zero = run36.countResult.types.filter(t => t.status === 'zero').map(t => ({ ...t, reason: 'not found on any counted plan sheet', category: t36(t.key)?.category ?? 'device' }));
    const d = legendUnusedKeys(zero, targets36, corpus);
    // final check 2 — 220V now STAYS: a real row names a high voltage
    // ("HVAC disconnect … Sized for 40A/2P 208V")
    expect(d.filter(x => x.unused).map(x => x.key).sort()).toEqual(['$4', '$D', 'AF', 'FOURPLEX']);
    expect(d.filter(x => !x.unused).map(x => x.key).sort()).toEqual(['220V', 'OS', 'S', 'TC']);
    expect(mentionOf(t36('220V') as CountTarget, corpus)).toContain('208V');
    // $D "Single pole dimmer switch" needs single + pole + dimmer — "timer switch" is not it
    expect(mentionOf(t36('$D') as CountTarget, corpus)).toBeNull();
    // TC "Time clock / VP24 timer switch": the VP24 alternative is named
    expect(mentionOf(t36('TC') as CountTarget, corpus)).toContain('VP24');
    expect(mentionOf(t36('OS') as CountTarget, corpus)).toMatch(/occupancy sensor/i);
    // no distinguishing word at all: any mention of the noun keeps it
    expect(mentionOf({ type: 'R', description: 'Receptacle' }, ['WP GFCI receptacle at condensers'])).not.toBeNull();
    // fixture-schedule zeros (C, D, E1, E3) and equipment (J, Exhaust fan) are never candidates
    expect(d.some(x => ['C', 'D', 'E1', 'E3', 'J', 'EXHAUST FAN'].includes(x.key))).toBe(false);
    expect(mentionOf(t36('TC') as CountTarget, corpus)).toContain('VP24');
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
