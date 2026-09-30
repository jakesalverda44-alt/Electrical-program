// Price accuracy round D1-D4 — pure rules (no I/O).
import { describe, it, expect } from 'vitest';
import { conventionScope, inScope, typeScopeClass, unionScope } from './statusScope';
import type { CountTarget } from '../countTargets';

const t = (key: string, category: CountTarget['category'], description: string): CountTarget => ({
  type: key, key, description, symbolHint: '', wattage: null, category, source: 'legend', sourceSheet: 'E1.0', headsPerPole: null, emergency: false,
});
const q = (quote: string) => ({ quote, source: 'counter' as const });

describe('D1 — a printed rule covers only what it names', () => {
  it('the real 36th rule (misspelt "RECEPTICLE") covers receptacles only', () => {
    const s = conventionScope(q('SHADED SYMBOL DENOTES NEW RECEPTICLE'));
    expect(s).toEqual(new Set(['receptacle']));
    // the real 36th types
    const types = [
      t('DUPLEX RECEPTACLE', 'device', 'Duplex receptacle'), t('GFI', 'device', 'Duplex receptacle w/ ground fault interrupter'),
      t('42', 'device', 'Duplex receptacle at 42" AFF'), t('WP', 'device', 'Duplex receptacle weather protected'),
    ];
    for (const x of types) expect([x.key, inScope(s, x)]).toEqual([x.key, true]);
    const others = [
      t('DISCONNECT', 'equipment', 'Disconnect'), t('ELECTRICAL PANEL', 'equipment', 'Electrical panel'), t('$', 'lighting_control', 'Single pole switch'),
      t('AHU #1', 'equipment', 'Air Handler Unit #1'), t('COMP #1', 'equipment', 'A/C Comp Unit #1'), t('DISC-A', 'equipment', 'Disconnect, warehouse north wall'),
      t('TRIANGLE', 'device', 'Telephone'), t('A', 'interior_lighting', '2X4 LED recessed troffer'),
    ];
    for (const x of others) expect([x.key, inScope(s, x)]).toEqual([x.key, false]);
  });
  it('fixtures / devices / switches / equipment / unqualified', () => {
    expect(conventionScope(q('SHADED FIXTURES ARE NEW'))).toEqual(new Set(['fixture']));
    expect(conventionScope(q('DASHED DEVICES TO BE REMOVED'))).toEqual(new Set(['receptacle', 'switch', 'control', 'device']));
    expect(conventionScope(q('BOLD SWITCHES ARE NEW'))).toEqual(new Set(['switch']));
    expect(conventionScope(q('(E) EXISTING EQUIPMENT TO REMAIN'))).toEqual(new Set(['equipment']));
    expect(conventionScope(q('(E) = EXISTING'))).toBe('all');
    expect(conventionScope(q('BOLD LINES INDICATE NEW WORK'))).toBe('all');
    expect(conventionScope({ quote: 'Estimator: shaded / filled symbols are new; open symbols are existing', source: 'estimator' })).toBe('all');
    expect(unionScope([q('SHADED RECEPTACLES ARE NEW'), q('(E) = EXISTING')])).toBe('all');
    expect(inScope(null, t('X', 'device', 'Duplex receptacle'))).toBe(false);
  });
  it('type classes', () => {
    expect(typeScopeClass(t('S3', 'lighting_control', 'Three way switch'))).toBe('switch');
    expect(typeScopeClass(t('OS', 'lighting_control', 'Occupancy sensor'))).toBe('control');
    expect(typeScopeClass(t('EXIT', 'interior_lighting', 'Exit sign'))).toBe('fixture');
    expect(typeScopeClass(t('J', 'equipment', 'Junction box'))).toBe('equipment');
  });
});

// ── D2 ─────────────────────────────────────────────────────────────────────
import { fillRuleOf, MAX_STATUS_CROPS, parseStatusCropReply, planStatusCrops, statusFromAnswer, CROPS_PER_CALL } from './statusCrops';
import type { StatusConvention } from './status';
import type { PlacedMark } from '../counter';

const rule = (quote: string, status: StatusConvention['status'] = 'new'): StatusConvention => ({ status, rule: quote.toLowerCase(), quote, sheetKey: 'E1', sheetLabel: 'E1.0', source: 'counter' });
const mk = (typeKey: string, n: number, status?: PlacedMark['status']): PlacedMark[] => Array.from({ length: n }, (_, i) => ({ typeKey, tileIds: [], x: 100 + i * 50, y: 100, ...(status ? { status } : {}) }));
const REC = [t('DUPLEX RECEPTACLE', 'device', 'Duplex receptacle'), t('GFI', 'device', 'Duplex receptacle w/ ground fault interrupter'), t('DISCONNECT', 'equipment', 'Disconnect'), t('$', 'lighting_control', 'Single pole switch')];

describe('D2 — the close-up status check', () => {
  it('fill rules: shaded = new (the real 36th quote), open = existing, and the other way round', () => {
    expect(fillRuleOf([rule('SHADED SYMBOL DENOTES NEW RECEPTICLE')])).toEqual({ filled: 'new', open: 'existing', quote: 'SHADED SYMBOL DENOTES NEW RECEPTICLE' });
    expect(fillRuleOf([rule('OPEN SYMBOLS ARE EXISTING TO REMAIN', 'existing')])).toMatchObject({ open: 'existing', filled: 'new' });
    expect(fillRuleOf([rule('SOLID DEVICES ARE EXISTING', 'existing')])).toMatchObject({ filled: 'existing', open: 'new' });
    expect(fillRuleOf([rule('(E) = EXISTING', 'existing')])).toBeNull();
    expect(fillRuleOf([rule('DASHED = TO BE REMOVED', 'demo')])).toBeNull();
  });
  it('a fill rule checks every covered mark (never the uncovered ones), in batches', () => {
    const placed = [...mk('DUPLEX RECEPTACLE', 14, 'existing'), ...mk('GFI', 7, 'existing'), ...mk('DISCONNECT', 4, 'unknown'), ...mk('$', 3)];
    const p = planStatusCrops([{ key: 'E1', label: 'E1.0', rules: [rule('SHADED SYMBOL DENOTES NEW RECEPTICLE')], placed }], REC);
    const idx = p.jobs.flatMap(j => j.marks);
    expect(idx.length).toBe(21);
    expect(new Set(idx.map(i => placed[i].typeKey))).toEqual(new Set(['DUPLEX RECEPTACLE', 'GFI']));
    expect(p.jobs.map(j => j.marks.length)).toEqual([CROPS_PER_CALL, CROPS_PER_CALL, 1]);
    expect(p.jobs.every(j => j.mode === 'fill')).toBe(true);
  });
  it('review B1 — a non-fill rule is never crop-checked, however unconfident the tile pass was', () => {
    const bad = [...mk('DUPLEX RECEPTACLE', 2, 'new'), ...mk('DUPLEX RECEPTACLE', 8, 'unknown')];
    for (const q of ['(E) = EXISTING', 'SOLID LINES INDICATE NEW WORK', 'NEW WORK SHOWN DARK, EXISTING WORK SHOWN LIGHT']) {
      expect([q, planStatusCrops([{ key: 'E1', label: 'E1.0', rules: [rule(q)], placed: bad }], REC).jobs]).toEqual([q, []]);
    }
    expect(planStatusCrops([{ key: 'E1', label: 'E1.0', rules: [], placed: bad }], REC).jobs).toEqual([]);
  });
  it('review B1 — line-weight / line-style / area rules are not fill rules; symbol-fill rules are', () => {
    for (const q of ['SOLID LINES INDICATE NEW WORK', 'DARK SYMBOLS ARE NEW', 'NEW WORK SHOWN DARK, EXISTING WORK SHOWN LIGHT', 'HATCHED AREA DENOTES DEMOLITION',
      'BOLD = NEW WORK', 'HEAVY LINES ARE NEW', 'SCREENED ITEMS ARE EXISTING', 'LIGHT LINES INDICATE EXISTING', 'CLEAR = EXISTING']) {
      expect([q, fillRuleOf([rule(q)])]).toEqual([q, null]);
    }
    for (const q of ['SHADED SYMBOL DENOTES NEW RECEPTICLE', 'SOLID SYMBOLS ARE NEW', 'FILLED DEVICES ARE NEW', 'RECEPTACLES SHOWN FILLED ARE NEW', 'HATCHED SYMBOL = NEW', 'DARKENED SYMBOLS DENOTE NEW WORK']) {
      expect([q, fillRuleOf([rule(q)])?.filled]).toEqual([q, 'new']);
    }
  });
  it('the cap: 60 crops per run, the rest go to review', () => {
    const placed = mk('DUPLEX RECEPTACLE', 75, 'existing');
    const p = planStatusCrops([{ key: 'E1', label: 'E1.0', rules: [rule('SHADED SYMBOL DENOTES NEW RECEPTACLE')], placed }], REC);
    expect(p.jobs.flatMap(j => j.marks).length).toBe(MAX_STATUS_CROPS);
    expect(p.capped.length).toBe(15);
  });
  it('replies: missing / malformed = unclear; only a HIGH-confidence clear answer sets a status', () => {
    const a = parseStatusCropReply(JSON.stringify({ answers: [{ id: 'c1', answer: 'Filled', confidence: 'high' }, { id: 'c2', answer: 'open', confidence: 'low' }, { id: 'zz', answer: 'open' }] }), ['c1', 'c2', 'c3'])!;
    expect(a).toEqual([{ id: 'c1', answer: 'filled', confidence: 'high' }, { id: 'c2', answer: 'open', confidence: 'low' }, { id: 'c3', answer: 'unclear', confidence: 'low' }]);
    expect(parseStatusCropReply('not json', ['c1'])).toBeNull();
    const job = { mode: 'fill' as const, fill: { filled: 'new' as const, open: 'existing' as const, quote: 'q' } };
    expect(a.map(x => statusFromAnswer(job, x))).toEqual(['new', null, null]);
    expect(statusFromAnswer({ mode: 'rule', fill: null }, { id: 'c1', answer: 'existing', confidence: 'high' })).toBe('existing');
    expect(statusFromAnswer({ mode: 'rule', fill: null }, { id: 'c1', answer: 'unclear', confidence: 'high' })).toBeNull();
  });
});

// ── D3 ─────────────────────────────────────────────────────────────────────
import { buildDemolition, demolitionRows, hedgedReuseNotesFor, registerDemolitionSheet, reuseEvidenceFor, reuseQuoteFor } from './demolition';

const G = { widthPt: 2592, heightPt: 1728, rotation: 0, originX: 0, originY: 0 };
const REC_T = [t('DUPLEX RECEPTACLE', 'device', 'Duplex receptacle'), t('A', 'interior_lighting', '2X4 LED troffer'), t('$', 'lighting_control', 'Single pole switch')];
// 12 receptacles on a demolition plan; the new-work plan is drawn 16 pt / 24 pt
// away (the real A2.0 → E1.0 offset) and shows the first 7 as existing,
// 2 as new at other places, and 4 switches for the registration.
const demoRec = Array.from({ length: 12 }, (_, i) => ({ typeKey: 'DUPLEX RECEPTACLE', x: 300 + (i % 6) * 250, y: 400 + Math.floor(i / 6) * 400 }));
const sw = Array.from({ length: 4 }, (_, i) => ({ typeKey: '$', x: 500 + i * 300, y: 1200 }));
const shift = (m: { x: number; y: number }) => ({ x: m.x - 16, y: m.y - 24 });
const plan = (existing: number, dx = 0) => ({
  key: 'E1', label: 'E1.0 "Electrical Plan"', geometry: G,
  marks: [
    ...demoRec.slice(0, existing).map(m => ({ ...m, ...shift(m), x: shift(m).x + dx, status: 'existing' as const })),
    { typeKey: 'DUPLEX RECEPTACLE', x: 2100, y: 300, status: 'new' as const }, { typeKey: 'DUPLEX RECEPTACLE', x: 2200, y: 300, status: 'new' as const },
    ...sw.map(m => ({ ...m, ...shift(m), x: shift(m).x + dx })),
  ],
});
const demoSheet = (marked = 0) => ({ key: 'A2', label: 'A2.0 "EXISTING FLOOR PLAN - DEMOLITIONS"', demolition: true, geometry: G,
  marks: [...demoRec.map((m, i) => ({ ...m, ...(i < marked ? { marked: true } : {}) })), ...sw] });

describe('D3 — demolition by comparison with the new-work plan', () => {
  it('registration: by the shared marks (offset vote), never by the bare sheet frame', () => {
    const cls = (ms: Array<{ typeKey: string; x: number; y: number }>) => ms.map(m => ({ ...m, classKey: m.typeKey === '$' ? 'DEMO-SWITCH' : 'DEMO-RECEPTACLE' }));
    const r = registerDemolitionSheet({ ...demoSheet(), marks: cls(demoSheet().marks) }, [{ ...plan(7), marks: cls(plan(7).marks) }]);
    expect(r?.plan).toBe('E1');
    expect(r?.al.kind).toBe('marks');
    // everything 400 pt away (5.6"): past the vote's reach — not registered
    expect(registerDemolitionSheet({ ...demoSheet(), marks: cls(demoSheet().marks) }, [{ ...plan(7, 400), marks: cls(plan(7, 400).marks) }])).toBeNull();
  });
  it('registered: an item still shown as existing at the same place stays (12 shown, 7 remain → 5), said in the line', () => {
    // (review B3: 8 of 12 = 67% pair with the plan's receptacles — compared)
    const d = buildDemolition([demoSheet()], REC_T, [plan(8)]);
    const l = d.lines.find(x => x.classKey === 'DEMO-RECEPTACLE')!;
    expect(l.qty).toBe(4);
    expect(d.comparisons!.map(c => [c.classKey, c.shown, c.remain, c.demo])).toEqual([['DEMO-RECEPTACLE', 12, 8, 4]]);
    expect(String(demolitionRows(d).find(r => r.countType === 'DEMO-RECEPTACLE')!.spec)).toContain('8 more on A2.0 still shown as existing on E1.0 — not removed');
    // 7 of 12 (58%) is under the 60% bar: not compared, asked
    expect(buildDemolition([demoSheet()], REC_T, [plan(7)]).lines.find(x => x.classKey === 'DEMO-RECEPTACLE')!.qty).toBe(12);
    // switches: drawn on the new plan WITHOUT a status — kept (4) and asked
    expect(d.lines.find(x => x.classKey === 'DEMO-SWITCH')!.qty).toBe(4);
    expect(d.suggestions!.map(q => [q.classKey, q.unstated, q.suggested])).toEqual([['DEMO-SWITCH', true, 0]]);
  });
  it('rule (a): an item MARKED for removal on the demolition plan is always removed', () => {
    const d = buildDemolition([demoSheet(3)], REC_T, [plan(8)]);
    expect(d.lines.find(x => x.classKey === 'DEMO-RECEPTACLE')!.qty).toBe(7);
    expect(d.comparisons![0]).toMatchObject({ marked: 3, remain: 5, demo: 7 });
  });
  it('a new-work plan showing nothing existing (a new lighting plan replacing every fixture): today\'s behaviour', () => {
    const fx = { key: 'A3', label: 'A3.0', demolition: true, geometry: G, marks: Array.from({ length: 6 }, (_, i) => ({ typeKey: 'A', x: 300 + i * 200, y: 800 })) };
    const e2 = { key: 'E2', label: 'E2.0', geometry: G, marks: fx.marks.map(m => ({ ...m, ...shift(m), status: undefined })) };
    const d = buildDemolition([fx], REC_T, [e2]);
    expect(d.lines[0].qty).toBe(6);
    expect(d.comparisons ?? []).toEqual([]);
  });
  it('registration fails: the count stays, and the arithmetic is a SUGGESTION (12 − 7 = 5)', () => {
    const d = buildDemolition([demoSheet()], REC_T, [plan(7, 400)]);
    expect(d.lines.find(x => x.classKey === 'DEMO-RECEPTACLE')!.qty).toBe(12);
    expect(d.suggestions!.map(q => [q.classKey, q.demoCount, q.suggested, q.existing])).toEqual([['DEMO-RECEPTACLE', 12, 5, [{ label: 'E1.0 "Electrical Plan"', count: 7 }]]]);
  });
  it('no new-work plan at all: unchanged', () => {
    expect(buildDemolition([demoSheet()], REC_T).lines.find(x => x.classKey === 'DEMO-RECEPTACLE')!.qty).toBe(12);
  });
});

describe('D3 — the new-work plan draws the class with no status', () => {
  it('a device class drawn at the same places without a status: the line keeps its count, a suggestion asks', () => {
    const unst = { ...plan(0), marks: [...demoRec.slice(0, 8).map(m => ({ ...m, ...shift(m) })), ...sw.map(m => ({ ...m, ...shift(m) }))] };
    const d = buildDemolition([demoSheet()], REC_T, [unst]);
    expect(d.lines.find(x => x.classKey === 'DEMO-RECEPTACLE')!.qty).toBe(12);
    const q = d.suggestions!.find(x => x.classKey === 'DEMO-RECEPTACLE')!;
    expect([q.unstated, q.demoCount, q.suggested]).toEqual([true, 12, 4]);
  });
});

describe('Decision 4 — replacement in place', () => {
  it('a NEW device drawn where an old one was: still removed, and the line says "includes N devices replaced in place"', () => {
    const p = plan(7);
    p.marks.push(...demoRec.slice(7, 9).map(m => ({ ...m, ...shift(m), status: 'new' as const })));
    const d = buildDemolition([demoSheet()], REC_T, [p]);
    expect(d.lines.find(x => x.classKey === 'DEMO-RECEPTACLE')).toMatchObject({ qty: 5, replaced: 2 });
    expect(d.comparisons![0]).toMatchObject({ remain: 7, demo: 5, replaced: 2 });
    expect(String(demolitionRows(d).find(r => r.countType === 'DEMO-RECEPTACLE')!.spec)).toContain('; includes 2 devices replaced in place');
  });
});

describe('Decision 5 — equipment noted for reuse', () => {
  const panel = t('ELECTRICAL PANEL', 'equipment', 'Electrical panel');
  const disc = t('DISCONNECT', 'equipment', 'Disconnect');
  // the real 36th analysis lines
  const notes = ['Existing Panel A 200A MLO 120/208V 1PH - reuse', 'Existing pendant fixture; reuse scope unclear', 'Existing unit meter/disconnect off existing service wireway'];
  it('the note must say reuse / to remain AND name the same kind of equipment', () => {
    expect(reuseQuoteFor(panel, panel.key, notes)).toBe('Existing Panel A 200A MLO 120/208V 1PH - reuse');
    expect(reuseQuoteFor(disc, disc.key, notes)).toBeNull();
    expect(reuseQuoteFor(disc, disc.key, ['Existing disconnects to remain'])).toBe('Existing disconnects to remain');
    expect(reuseQuoteFor(t('A', 'interior_lighting', 'troffer'), 'A', notes)).toBeNull();
  });
  it('panels drawn at the same place + a reuse note: 0 demolition for them; disconnects without one are still asked', () => {
    const T = [...REC_T, panel, disc];
    const eq = [{ typeKey: 'ELECTRICAL PANEL', x: 400, y: 1500 }, { typeKey: 'ELECTRICAL PANEL', x: 700, y: 1500 }, { typeKey: 'DISCONNECT', x: 1000, y: 1500 }];
    const ds = { ...demoSheet(), marks: [...demoSheet().marks, ...eq] };
    const p = plan(7);
    p.marks.push(...eq.map(m => ({ ...m, ...shift(m) })));
    const d = buildDemolition([ds], T, [p], notes);
    expect(d.lines.find(x => x.classKey === 'DEMO-EQUIPMENT')).toMatchObject({ qty: 1, reused: 2 });
    expect(d.reused!.map(r => [r.count, r.quotes])).toEqual([[2, ['Existing Panel A 200A MLO 120/208V 1PH - reuse']]]);
    // coordinator follow-up — the panels are their own row, never dropped (1 + 2 = 3)
    expect(demolitionRows(d).filter(r => String(r.countType).startsWith('DEMO-EQUIPMENT')).map(r => [r.countType, r.qty])).toEqual([['DEMO-EQUIPMENT', 1], ['DEMO-EQUIPMENT/ELECTRICAL PANEL', 2]]);
    expect(d.suggestions!.find(q => q.classKey === 'DEMO-EQUIPMENT')).toMatchObject({ demoCount: 1, suggested: 0, unstated: true });
    // no reuse note: all three asked, nothing lowered
    const none = buildDemolition([ds], T, [p], []);
    expect(none.lines.find(x => x.classKey === 'DEMO-EQUIPMENT')!.qty).toBe(3);
  });
});

describe('Decision 5 follow-up — a hedged reuse note never answers', () => {
  const panel = t('ELECTRICAL PANEL', 'equipment', 'Electrical panel');
  it('unclear / verify / confirm / if / may / TBD / field verify / possibly / "or …?" cancel it; it is kept as context', () => {
    const hedged = [
      'Existing panel reuse scope unclear', 'Verify existing Panel A can be reused', 'Confirm panel B to remain', 'Reuse panel A if in good condition',
      'Panel B may be reused', 'Panel A reuse TBD', 'Existing panels to remain - field verify', 'Possibly reuse panel B', 'Reuse panel A or replace?',
    ];
    for (const n of hedged) expect([n, reuseQuoteFor(panel, panel.key, [n]), hedgedReuseNotesFor(panel, panel.key, [n]).length > 0]).toEqual([n, null, true]);
    expect(reuseQuoteFor(panel, panel.key, ['Existing Panel A 200A MLO 120/208V 1PH - reuse'])).toBe('Existing Panel A 200A MLO 120/208V 1PH - reuse');
  });
  it('panels at the same place with only a hedged note: nothing lowered, the question stays with the note as context', () => {
    const T = [...REC_T, panel];
    const eq = [{ typeKey: 'ELECTRICAL PANEL', x: 400, y: 1500 }, { typeKey: 'ELECTRICAL PANEL', x: 700, y: 1500 }];
    const ds = { ...demoSheet(), marks: [...demoSheet().marks, ...eq] };
    const p = plan(7);
    p.marks.push(...eq.map(m => ({ ...m, ...shift(m) })));
    const d = buildDemolition([ds], T, [p], ['Existing panels to remain - field verify']);
    expect(d.lines.find(x => x.classKey === 'DEMO-EQUIPMENT')!.qty).toBe(2);
    expect(d.reused).toBeUndefined();
    expect(d.suggestions!.find(q => q.classKey === 'DEMO-EQUIPMENT')).toMatchObject({ suggested: 0, context: ['Existing panels to remain - field verify'] });
  });
});

describe('Review B2 — reuse notes are read clause by clause; negations and removals cancel; tags must match', () => {
  const panel = t('ELECTRICAL PANEL', 'equipment', 'Electrical panel');
  const disc = t('DISC-A', 'equipment', '60A disconnect switch');
  it('the reviewer\'s phrasings never zero the panel (the question stays, the note is context)', () => {
    for (const n of [
      'Do not reuse existing panel', 'Existing panel shall not be reused', 'Reuse of existing panel B is not permitted',
      'Remove existing panel. Reuse existing conduit where possible', 'Replace existing panel; existing feeders to remain',
      'Existing panel to be removed and replaced with new panel; existing branch circuits to remain',
      'Existing Panel A 200A MLO 120/208V 1PH - do not reuse, remove and replace',
    ]) {
      const e = reuseEvidenceFor(panel, panel.key, [n]);
      expect([n, e.quote, e.context.length > 0]).toEqual([n, null, true]);
    }
  });
  it('the mixed sentence: panel B and the disconnects demolished, panel A reused → only panel A zeroed', () => {
    const note = ['Demolish existing panel B and disconnects; reuse existing panel A'];
    const A = t('PANEL A', 'equipment', 'Panel A 200A MLO'), B = t('PANEL B', 'equipment', 'Panel B 100A MLO');
    expect(reuseQuoteFor(A, A.key, note)).toBe('reuse existing panel A');
    expect(reuseQuoteFor(B, B.key, note)).toBeNull();
    expect(reuseQuoteFor(disc, disc.key, note)).toBeNull();
    // an untagged "Electrical panel" can't tell A from B: the question stays
    expect(reuseQuoteFor(panel, panel.key, note)).toBeNull();
  });
  it('the real 36th notes still count (no negation, no removal)', () => {
    const real = ['Existing Panel A 200A MLO 120/208V 1PH - reuse', 'Existing Panel B 100A MLO sub panel - reuse', 'Panels A & B existing - reuse', 'Reuse existing Panels A & B and service', 'Existing unit meter/disconnect off existing service wireway'];
    expect(reuseQuoteFor(panel, panel.key, real)).toBe('Existing Panel A 200A MLO 120/208V 1PH - reuse');
    expect(reuseQuoteFor(t('PANEL B', 'equipment', 'Panel B'), 'PANEL B', real)).toBe('Existing Panel B 100A MLO sub panel - reuse');
    expect(reuseQuoteFor(disc, disc.key, real)).toBeNull();
    // one removal clause anywhere about the same kind cancels
    expect(reuseQuoteFor(panel, panel.key, [...real, 'Remove existing Panels A & B; reuse existing service conductors'])).toBeNull();
  });
});

describe('Review B3 — registration: same level, no mirror / aliasing, 60% of the class', () => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const T2 = [t('DUPLEX RECEPTACLE', 'device', 'Duplex receptacle'), t('$', 'lighting_control', 'Single pole switch')];
  const rec = Array.from({ length: 20 }, () => ({ typeKey: 'DUPLEX RECEPTACLE', x: Math.round(250 + rnd() * 1900), y: Math.round(250 + rnd() * 1200) }));
  const sws = Array.from({ length: 4 }, () => ({ typeKey: '$', x: Math.round(250 + rnd() * 1900), y: Math.round(250 + rnd() * 1200) }));
  const line = (d: ReturnType<typeof buildDemolition>) => d.lines.find(l => l.classKey === 'DEMO-RECEPTACLE')!.qty;
  it('typical floors: a LEVEL 2 demolition sheet never compares with the LEVEL 1 plan; the level-2 plan pairs too little → ONE question, 20 − 2 = 18', () => {
    const A21 = { key: 'A21', label: 'A2.1 "LEVEL 2 - EXISTING FLOOR PLAN - DEMOLITIONS"', level: '2', demolition: true, geometry: G, marks: [...rec, ...sws] };
    const E10 = { key: 'E10', label: 'E1.0 "LEVEL 1 POWER PLAN"', level: '1', geometry: G, marks: [...rec.slice(0, 18).map(m => ({ ...m, status: 'existing' as const })), ...sws] };
    const E11 = { key: 'E11', label: 'E1.1 "LEVEL 2 POWER PLAN"', level: '2', geometry: G, marks: [...rec.slice(0, 2).map(m => ({ ...m, status: 'existing' as const })), ...Array.from({ length: 10 }, (_, i) => ({ typeKey: 'DUPLEX RECEPTACLE', x: 2300, y: 200 + i * 120, status: 'new' as const })), { typeKey: '$', x: 2400, y: 1500 }] };
    const d = buildDemolition([A21], T2, [E10, E11]);
    expect(line(d)).toBe(20);
    expect(d.comparisons ?? []).toEqual([]);
    expect(d.suggestions!.map(q => [q.demoCount, q.suggested, q.existing])).toEqual([[20, 18, [{ label: 'E1.1 "LEVEL 2 POWER PLAN"', count: 2 }]]]);
  });
  it('re-check N1 — a missing level is compatible when the job names at most one level; otherwise not compared, and ALWAYS asked', () => {
    const A2 = { key: 'A2', label: 'A2', demolition: true, geometry: G, marks: [...rec, ...sws] };
    const E1 = { key: 'E1', label: 'E1', geometry: G, marks: [...rec.map(m => ({ ...m, status: 'existing' as const })), ...sws] };
    const l3 = { key: 'E3', label: 'E3 "LEVEL 3"', level: '3', geometry: G, marks: [] };
    const l4 = { key: 'E4', label: 'E4 "LEVEL 4"', level: '4', geometry: G, marks: [] };
    expect(line(buildDemolition([A2], T2, [E1]))).toBe(0);
    expect(line(buildDemolition([A2], T2, [E1, l3]))).toBe(0); // one level named: compatible
    const two = buildDemolition([A2], T2, [E1, l3, l4]);          // two levels named: not compared …
    expect(line(two)).toBe(20);
    expect(two.suggestions!.map(q => [q.demoCount, q.suggested, q.why.slice(0, 40)])).toEqual([[20, 0, 'no new-work plan is on the same level / ']]); // … but asked
  });
  it('a mirrored plan with a regular layout never auto-reduces (the reviewer grid repro): ONE question instead', () => {
    const gridR = Array.from({ length: 20 }, (_, i) => ({ typeKey: 'DUPLEX RECEPTACLE', x: 300 + 200 * (i % 10), y: i < 10 ? 400 : 900 }));
    const gridS = Array.from({ length: 4 }, (_, i) => ({ typeKey: '$', x: 500 + 300 * i, y: 1300 }));
    const A20 = { key: 'A20', label: 'A2.0', demolition: true, geometry: G, marks: [...gridR, ...gridS] };
    const mir = (m: { typeKey: string; x: number; y: number }) => ({ ...m, x: 2592 - m.x });
    const E10 = { key: 'E10', label: 'E1.0', geometry: G, marks: [...gridR.map(m => ({ ...mir(m), status: 'existing' as const })), ...gridS.map(mir)] };
    const d = buildDemolition([A20], T2, [E10]);
    expect(line(d)).toBe(20);
    expect(d.comparisons ?? []).toEqual([]);
    expect(d.suggestions!.map(q => [q.demoCount, q.suggested])).toEqual([[20, 0]]);
  });
  it('review S3 — two unregistered demolition sheets subtract the plan list ONCE: 70 − 25 = 45', () => {
    const rec40 = Array.from({ length: 40 }, () => ({ typeKey: 'DUPLEX RECEPTACLE', x: Math.round(250 + rnd() * 2000), y: Math.round(250 + rnd() * 1200) }));
    const A20 = { key: 'A20', label: 'A2.0 demo', demolition: true, geometry: G, marks: rec40 };
    const A21 = { key: 'A21', label: 'A2.1 demo', demolition: true, geometry: { ...G, widthPt: 3024 }, marks: rec40.slice(0, 30).map(m => ({ ...m, y: m.y + 7 })) };
    const E10 = { key: 'E10', label: 'E1.0', geometry: G, marks: rec40.slice(0, 25).map(m => ({ ...m, x: m.x + 400, status: 'existing' as const })) };
    const d = buildDemolition([A20, A21], T2, [E10]);
    expect(line(d)).toBe(70);
    expect(d.suggestions!.map(q => [q.demoCount, q.suggested, q.sheets.length])).toEqual([[70, 45, 2]]);
  });
});

describe('Review S1 — only the rule’s own device nouns narrow it; plan references never do', () => {
  it('the reviewer’s phrasings', () => {
    expect(conventionScope(q('BOLD INDICATES NEW WORK ON LIGHTING AND POWER PLANS'))).toBe('all');
    expect(conventionScope(q('NEW WORK SHOWN BOLD. REFER TO PANEL SCHEDULES FOR CIRCUITING'))).toBe('all');
    expect(conventionScope(q('SCREENED ITEMS ARE EXISTING; SEE LIGHTING FIXTURE SCHEDULE'))).toBe('all');
    expect(conventionScope(q('(E) INDICATES EXISTING DEVICE TO REMAIN'))).toEqual(new Set(['receptacle', 'switch', 'control', 'device']));
    // the real ones are unchanged
    expect(conventionScope(q('SHADED SYMBOL DENOTES NEW RECEPTICLE'))).toEqual(new Set(['receptacle']));
    expect(conventionScope(q('SHADED FIXTURES ARE NEW'))).toEqual(new Set(['fixture']));
    expect(conventionScope(q('BOLD = NEW WORK'))).toBe('all');
  });
});

describe('Re-check N2 — quoted / parenthesized tags are read', () => {
  const LP1 = t('PANEL LP-1', 'equipment', 'Panel LP-1'), A = t('PANEL A', 'equipment', 'Panel A');
  it('"EXISTING PANEL "A" TO REMAIN" (and (A), \'A\', “A”) never matches LP-1, and does match panel A', () => {
    for (const n of ['EXISTING PANEL "A" TO REMAIN', 'EXISTING PANEL (A) TO REMAIN', "EXISTING PANEL 'A' TO REMAIN", 'EXISTING PANEL “A” TO REMAIN']) {
      expect([n, reuseQuoteFor(LP1, LP1.key, [n])]).toEqual([n, null]);
      expect([n, reuseQuoteFor(A, A.key, [n])]).toEqual([n, n]);
    }
    expect(reuseQuoteFor(LP1, LP1.key, ['EXISTING PANEL LP-1 TO REMAIN'])).toBe('EXISTING PANEL LP-1 TO REMAIN');
    // a plain word after the noun is not a tag
    expect(reuseQuoteFor(LP1, LP1.key, ['EXISTING PANELS TO REMAIN'])).toBe('EXISTING PANELS TO REMAIN');
    expect(reuseQuoteFor(A, A.key, ['DEMOLISH EXISTING PANEL B AND DISCONNECTS; REUSE EXISTING PANEL A'])).toBe('REUSE EXISTING PANEL A');
  });
});

describe('Final check R2 — an unlabelled demolition sheet pairs with a labelled plan only on a ground-level, one-level job', () => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const T2 = [t('DUPLEX RECEPTACLE', 'device', 'Duplex receptacle'), t('$', 'lighting_control', 'Single pole switch')];
  const grid = Array.from({ length: 20 }, () => ({ typeKey: 'DUPLEX RECEPTACLE', x: Math.round(250 + rnd() * 1900), y: Math.round(250 + rnd() * 1200) }));
  const sw = Array.from({ length: 4 }, () => ({ typeKey: '$', x: Math.round(250 + rnd() * 1900), y: Math.round(250 + rnd() * 1200) }));
  const recLine = (d: ReturnType<typeof buildDemolition>) => d.lines.find(l => l.classKey === 'DEMO-RECEPTACLE')!.qty;
  const A20 = { key: 'A20', label: 'A2.0 "EXISTING FLOOR PLAN - DEMOLITIONS"', demolition: true, geometry: G, marks: [...grid, ...sw] };
  const E10 = { key: 'E10', label: 'E1.0 "ELECTRICAL FLOOR PLAN"', geometry: G, marks: [...grid.slice(0, 2).map(m => ({ ...m, status: 'existing' as const })), ...Array.from({ length: 10 }, (_, i) => ({ typeKey: 'DUPLEX RECEPTACLE', x: 2300, y: 200 + i * 120, status: 'new' as const })), { typeKey: '$', x: 2400, y: 1500 }] };
  const upper = (label: string, level: string) => ({ key: 'E11', label, level, geometry: G, marks: [...grid.slice(0, 18).map(m => ({ ...m, status: 'existing' as const })), ...sw] });
  it('the reviewer’s p4 D stacked floors ("FLOOR PLAN" vs "SECOND FLOOR"): never 2 — ONE blocking question (20 − 2 = 18)', () => {
    const d = buildDemolition([A20], T2, [E10, upper('E1.1 "SECOND FLOOR ELECTRICAL PLAN"', '2')]);
    expect(recLine(d)).toBe(20);
    expect(d.comparisons ?? []).toEqual([]);
    expect(d.suggestions!.map(q => [q.demoCount, q.suggested])).toEqual([[20, 18]]);
  });
  it('"FLOOR PLAN" + "MEZZANINE": a question, never an automatic cut', () => {
    const d = buildDemolition([A20], T2, [E10, upper('E1.1 "MEZZANINE ELECTRICAL PLAN"', 'MEZZANINE')]);
    expect(recLine(d)).toBe(20);
    expect(d.comparisons ?? []).toEqual([]);
    expect(d.suggestions!.length).toBe(1);
  });
  it('ground / first level, no other level on the job: pairs automatically (p9 shape)', () => {
    expect(recLine(buildDemolition([A20], T2, [upper('E1.0 "FIRST FLOOR ELECTRICAL PLAN"', '1')]))).toBe(2);
    // …but not once another level's plan exists
    expect(recLine(buildDemolition([A20], T2, [upper('E1.0 "FIRST FLOOR ELECTRICAL PLAN"', '1'), { ...upper('E2.0 "SECOND FLOOR"', '2'), key: 'E20', marks: [] }]))).toBe(20);
  });
});
