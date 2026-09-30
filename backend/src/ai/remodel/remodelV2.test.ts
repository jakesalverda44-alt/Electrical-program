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
  it('a non-fill rule: only a type read confidently for fewer than 80% of its marks', () => {
    const r = [rule('(E) = EXISTING', 'existing')];
    const ok = [...mk('DUPLEX RECEPTACLE', 8, 'new'), ...mk('DUPLEX RECEPTACLE', 2, 'unknown')]; // 80% confident
    expect(planStatusCrops([{ key: 'E1', label: 'E1.0', rules: r, placed: ok }], REC).jobs).toEqual([]);
    const bad = [...mk('DUPLEX RECEPTACLE', 7, 'new'), ...mk('DUPLEX RECEPTACLE', 3, 'unknown')];
    const p = planStatusCrops([{ key: 'E1', label: 'E1.0', rules: r, placed: bad }], REC);
    expect(p.jobs.flatMap(j => j.marks).length).toBe(10);
    expect(p.jobs[0].mode).toBe('rule');
    // no rule on the sheet: nothing is checked
    expect(planStatusCrops([{ key: 'E1', label: 'E1.0', rules: [], placed: bad }], REC).jobs).toEqual([]);
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
import { buildDemolition, demolitionRows, registerDemolitionSheet, reuseQuoteFor } from './demolition';

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
    const d = buildDemolition([demoSheet()], REC_T, [plan(7)]);
    const l = d.lines.find(x => x.classKey === 'DEMO-RECEPTACLE')!;
    expect(l.qty).toBe(5);
    expect(d.comparisons!.map(c => [c.classKey, c.shown, c.remain, c.demo])).toEqual([['DEMO-RECEPTACLE', 12, 7, 5]]);
    expect(String(demolitionRows(d).find(r => r.countType === 'DEMO-RECEPTACLE')!.spec)).toContain('7 more on A2.0 still shown as existing on E1.0 — not removed');
    // switches: drawn on the new plan WITHOUT a status — kept (4) and asked
    expect(d.lines.find(x => x.classKey === 'DEMO-SWITCH')!.qty).toBe(4);
    expect(d.suggestions!.map(q => [q.classKey, q.unstated, q.suggested])).toEqual([['DEMO-SWITCH', true, 0]]);
  });
  it('rule (a): an item MARKED for removal on the demolition plan is always removed', () => {
    const d = buildDemolition([demoSheet(3)], REC_T, [plan(7)]);
    expect(d.lines.find(x => x.classKey === 'DEMO-RECEPTACLE')!.qty).toBe(8);
    expect(d.comparisons![0]).toMatchObject({ marked: 3, remain: 4, demo: 8 });
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
    const unst = { ...plan(0), marks: [...demoRec.slice(0, 7).map(m => ({ ...m, ...shift(m) })), ...sw.map(m => ({ ...m, ...shift(m) }))] };
    const d = buildDemolition([demoSheet()], REC_T, [unst]);
    expect(d.lines.find(x => x.classKey === 'DEMO-RECEPTACLE')!.qty).toBe(12);
    const q = d.suggestions!.find(x => x.classKey === 'DEMO-RECEPTACLE')!;
    expect([q.unstated, q.demoCount, q.suggested]).toEqual([true, 12, 5]);
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
    expect(d.suggestions!.find(q => q.classKey === 'DEMO-EQUIPMENT')).toMatchObject({ demoCount: 1, suggested: 0, unstated: true });
    // no reuse note: all three asked, nothing lowered
    const none = buildDemolition([ds], T, [p], []);
    expect(none.lines.find(x => x.classKey === 'DEMO-EQUIPMENT')!.qty).toBe(3);
  });
});
