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
