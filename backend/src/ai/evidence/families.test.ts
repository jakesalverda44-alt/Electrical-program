// Evidence round 3.3 — catalog-number equivalence across sheets, on the REAL
// Kissimmee type list (S1/S2 on PH0.1, E-7's untagged site light, E-3's SITE
// LIGHT; W1/W2 vs D/L), and legend symbol definitions.
import { describe, it, expect } from 'vitest';
import { buildCountTargets } from '../countTargets';
import type { TypeCountResult } from '../countMerge';
import { catalogOf, isTaggedType, applyFamilies, applySymbolDefinitions, applyScheduleLegendEquivalence, scheduleIdOf } from './families';
import { loadKissimmeeBaseline } from '../../test/fixtures/evidence/kissimmeeBaseline';

const { targets } = buildCountTargets(loadKissimmeeBaseline().agent1);
const T = (k: string) => targets.find(t => t.key === k)!;

function ty(key: string, count: number, opts: Partial<TypeCountResult> = {}): TypeCountResult {
  const t = T(key);
  return {
    key, type: t.type, description: t.description, category: t.category, wattage: t.wattage,
    count, heads: t.category === 'site_lighting' ? (t.headsPerPole != null ? count * t.headsPerPole : null) : null,
    status: count > 0 ? 'counted' : 'zero', reason: count > 0 ? '' : 'not found on any counted plan sheet',
    sheets: [{ sheetKey: 's', label: `${t.sourceSheet} x`, count, used: count > 0 }], flags: [], ...opts,
  };
}

describe('catalog numbers', () => {
  it('series + the ordering tokens that change the fixture; a repeated token ends it', () => {
    expect(catalogOf('Lithonia DSX1 LED P8 40K T4M MVOLT HS area light, IES full cutoff')).toEqual({ series: 'DSX1', full: 'DSX1 LED P8 40K T4M' });
    expect(catalogOf('D-Series Size 1 DSX1 LED 60C 1000 40K T3M MVOLT')).toEqual({ series: 'DSX1', full: 'DSX1 LED 60C 1000 40K T3M' });
    expect(catalogOf('D-Series Size 1 DSXW1 LED 10C 1000 40K T3M MVOLT wall pack')!.full).toBe('DSXW1 LED 10C 1000 40K T3M');
    expect(catalogOf('Site light LED area luminaire head, Lithonia DSX1 LED P8 40K T4M MVOLT HS LED 207W')!.full).toBe('DSX1 LED P8 40K T4M');
    expect(catalogOf('8\' LED strip 42W')).toBeNull();
  });
  it('tagged vs untagged types', () => {
    expect(isTaggedType(T('S1'))).toBe(true);
    expect(isTaggedType(T('(UNTAGGED) SITE LIGHT'))).toBe(false);
    expect(isTaggedType(T('SITE LIGHT'))).toBe(false);
  });
});

describe('Kissimmee site lights — one DSX1 family, never stacked (was 6 poles / 7 heads)', () => {
  const input = [
    ty('S1', 2, { photometricOnly: true }), ty('S2', 1, { photometricOnly: true }),
    ty('SITE LIGHT', 0), ty('(UNTAGGED) SITE LIGHT', 3),
  ];
  const { types, decisions } = applyFamilies(input, targets);
  const get = (k: string) => types.find(t => t.key === k)!;
  it('S1 + S2 stay (primary, tagged): 3 poles, 4 heads; E-7\'s untagged (same catalog, 3) and E-3\'s SITE LIGHT (0) fold in', () => {
    expect(get('S1').count + get('S2').count).toBe(3);
    expect(get('S1').heads! + get('S2').heads!).toBe(4);
    expect(get('(UNTAGGED) SITE LIGHT')).toMatchObject({ status: 'merged', count: 0, mergedInto: 'S1/S2', mergedCount: 3 });
    expect(get('SITE LIGHT')).toMatchObject({ status: 'merged', count: 0, mergedInto: 'S1/S2' });
    expect(decisions[0].question).toBeUndefined();
    expect(input[3].status).toBe('counted'); // the input is not modified
  });
  it('a member that counted MORE than its primary group is a question, never silently dropped', () => {
    const r = applyFamilies([ty('S1', 1, { photometricOnly: true }), ty('S2', 1, { photometricOnly: true }), ty('(UNTAGGED) SITE LIGHT', 4)], targets);
    expect(r.decisions[0].question).toEqual({ key: '(UNTAGGED) SITE LIGHT', memberCount: 4, primaryCount: 2, into: 'S1/S2', intoKeys: ['S1', 'S2'] });
  });
});

describe('Kissimmee wall packs — W1/W2 (photometric) are D/L (E-3)', () => {
  const { types } = applyFamilies([ty('W1', 3, { photometricOnly: true }), ty('W2', 1, { photometricOnly: true }), ty('D', 5), ty('L', 0)], targets);
  const get = (k: string) => types.find(t => t.key === k)!;
  it('D keeps E-3\'s 5 (W1\'s 3 not stacked); L takes W2\'s photometric-only 1', () => {
    expect(get('D').count).toBe(5);
    expect(get('W1').status).toBe('merged');
    expect(get('L')).toMatchObject({ count: 1, status: 'counted', photometricOnly: true });
    expect(get('W2')).toMatchObject({ status: 'merged', mergedInto: 'L' });
  });
});

describe('symbol definitions and schedule rows for legend symbols', () => {
  it('a zero legend entry naming a scheduled tag folds into it (PYLON SIGN; the pole-light symbol -> SITE LIGHT -> S1/S2)', () => {
    const fam = applyFamilies([ty('S1', 2, { photometricOnly: true }), ty('S2', 1, { photometricOnly: true }), ty('SITE LIGHT', 0)], targets).types;
    const r = applySymbolDefinitions([...fam, ty('PYLON SIGN', 1), ty('PYLON SIGN RECTANGLE WITH CIRCUIT TAG A-18', 0), ty('POLE-MOUNTED SITE LIGHT WITH AIMING ARROW AND CIRCUIT TAG', 0), ty('M2', 0), ty('MOTION SENSOR', 1)], targets);
    const get = (k: string) => r.types.find(t => t.key === k)!;
    expect(get('PYLON SIGN RECTANGLE WITH CIRCUIT TAG A-18')).toMatchObject({ status: 'merged', mergedInto: 'PYLON SIGN' });
    expect(get('POLE-MOUNTED SITE LIGHT WITH AIMING ARROW AND CIRCUIT TAG')).toMatchObject({ status: 'merged', mergedInto: 'S1/S2' });
    // Another legend entry is never "the tag" ("Motion sensor LSXR-50-HL" is not the generic motion sensor).
    expect(get('M2').status).toBe('zero');
  });
  it('a DEVICE that names a tag is never folded (a receptacle at the pylon sign is a receptacle to count)', () => {
    const extra = { ...T('SIMPLEX RECEPTACLE'), type: 'X1', key: 'X1', description: 'Duplex receptacle at PYLON SIGN base', category: 'device' as const };
    const r = applySymbolDefinitions([ty('PYLON SIGN', 1), { ...ty('SIMPLEX RECEPTACLE', 0), key: 'X1', type: 'X1', description: extra.description, category: 'device' }], [...targets, extra]);
    expect(r.types.find(t => t.key === 'X1')!.status).toBe('zero');
  });
  it('EF (schedule, 0) is the legend\'s "Exhaust fan recessed" (2); a phone-board duplex is never folded into a plain duplex', () => {
    const r = applyScheduleLegendEquivalence([ty('EF', 0), ty('EXHAUST FAN RECESSED', 2), ty('DUPLEX RECEPTACLE, SHALLOW 2X4 HANDY BOX ON PHONE BOARD', 0), ty('DUPLEX RECEPTACLE / FLOOR RECEPTACLE', 4)], targets);
    expect(r.types.find(t => t.key === 'EF')).toMatchObject({ status: 'merged', mergedInto: 'Exhaust fan recessed' });
    expect(r.types.find(t => t.key === 'DUPLEX RECEPTACLE, SHALLOW 2X4 HANDY BOX ON PHONE BOARD')!.status).toBe('zero');
  });
});

describe('fix round S11 — family edge cases', () => {
  const fx = (key: string, description: string, sourceSheet: string, category: 'site_lighting' | 'exterior_building' = 'site_lighting', headsPerPole: number | null = 1) =>
    ({ type: key, key, description, symbolHint: '', wattage: null, category, source: 'fixture_schedule' as const, sourceSheet, headsPerPole, emergency: false });
  const r = (t: ReturnType<typeof fx>, count: number, status: TypeCountResult['status'] = count > 0 ? 'counted' : 'zero'): TypeCountResult => ({
    key: t.key, type: t.type, description: t.description, category: t.category, wattage: null, count, heads: count, status, reason: '',
    sheets: [{ sheetKey: 's', label: `${t.sourceSheet} x`, count, used: count > 0 }], flags: [],
  });
  it('catalog numbers normalize: hyphens, voltage and option suffixes', () => {
    expect(catalogOf('DSX1-LED-P8-40K-T4M-MVOLT-SPA-DDBXD')!.full).toBe('DSX1 LED P8 40K T4M');
    expect(catalogOf('Lithonia DSX1 LED P8 40K T4M 277 HS')!.full).toBe('DSX1 LED P8 40K T4M');
    expect(catalogOf('DSX1 LED P8 40K T4M MVOLT HS')!.full).toBe('DSX1 LED P8 40K T4M');
  });
  it('a 277 V / hyphenated copy of S1 on another sheet still folds (Kissimmee-style stacking stays gone)', () => {
    const s1 = fx('S1', 'Lithonia DSX1 LED P8 40K T4M MVOLT HS', 'PH0.1');
    const u = fx('(UNTAGGED) SITE LIGHT', 'DSX1-LED-P8-40K-T4M-277-HS', 'E-7');
    const out = applyFamilies([r(s1, 2), r(u, 2)], [s1, u]);
    expect(out.types.find(t => t.key === u.key)!.status).toBe('merged');
  });
  it('an UNREADABLE member is never folded away; its item stays', () => {
    const s1 = fx('S1', 'Lithonia DSX1 LED P8 40K T4M MVOLT HS', 'PH0.1');
    const u = fx('SITE LIGHT', 'D-Series Size 1 DSX1 LED 60C 1000 40K T3M MVOLT', 'E-3');
    const out = applyFamilies([r(s1, 2), r(u, 0, 'unreadable')], [s1, u]);
    expect(out.types.find(t => t.key === u.key)!.status).toBe('unreadable');
  });
  it('"E-7" and "E-7 SITE PLAN" are ONE schedule: two tagged types there are never merged', () => {
    const a = fx('S1', 'DSX1 LED P8 40K T4M', 'E-7');
    const b = fx('S3', 'DSX1 LED P8 40K T4M', 'E-7 SITE PLAN');
    const out = applyFamilies([r(a, 2), r(b, 1)], [a, b]);
    expect(out.types.every(t => t.status === 'counted')).toBe(true);
    expect(scheduleIdOf('E-7 SITE PLAN')).toBe('E7');
  });
  it('FDS-1 (fused disconnect 200A, counted 0) is never folded into the legend\'s generic "Disconnect switch"', () => {
    const fds = { ...fx('FDS-1', 'Fused disconnect switch 200A NEMA 3R', 'E-4'), category: 'equipment' as const, source: 'equipment_schedule' as const };
    const leg = { ...fx('DISCONNECT SWITCH', 'Disconnect switch', 'E-0'), category: 'equipment' as const, source: 'legend' as const };
    const out = applyScheduleLegendEquivalence([{ ...r(fds as never, 0), category: 'equipment' }, { ...r(leg as never, 2), category: 'equipment' }], [fds as never, leg as never]);
    expect(out.types.find(t => t.key === 'FDS-1')!.status).toBe('zero');
  });
  it('the symbol-definition fold never takes an unreadable entry', () => {
    const r2 = applySymbolDefinitions([ty('PYLON SIGN', 1), { ...ty('PYLON SIGN RECTANGLE WITH CIRCUIT TAG A-18', 0), status: 'unreadable' }], targets);
    expect(r2.types.find(t => t.key === 'PYLON SIGN RECTANGLE WITH CIRCUIT TAG A-18')!.status).toBe('unreadable');
  });
});
