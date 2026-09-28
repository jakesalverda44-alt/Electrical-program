// Typical fix (2026-09-28) — a legend typical for host type X uses only the
// hosts identified as type X. On the live run of 2026-09-28 the six power
// poles were ONE equipment row ("PP-1..6") and each of the #9 legend's five
// pole types was multiplied by all six. Packages and targets here are that
// run's own (fixtures/realrun/kissimmee-live-2026-09-28.json).
import { describe, it, expect } from 'vitest';
import {
  allocateFromText, expandTypicals, guardSharedHostCounts, hostTagRange, hostTypeId, identifyHostTypes, sharedHostTypes, suggestAllocation,
  type HostMark, type TypicalExpansion, type TypicalPackage,
} from './typicals';
import type { CountTarget } from '../countTargets';
import { loadKissimmeeLive0928 } from '../../test/fixtures/realrun/kissimmeeLive';

const live = loadKissimmeeLive0928();
const targets = live.countResult.targets as CountTarget[];
const packages = live.countResult.evidence.typicals as TypicalPackage[];
const poles = packages.filter(p => p.hostTargetKey === 'PP-1..6');
const D = 'DUPLEX / FLOOR RECEPTACLE';
const E2 = poles[0].sheetKey;
const mark = (i: number, tag?: string): HostMark => ({ sheetKey: E2, x: 10 + i * 5, y: 10, ...(tag ? { tag } : {}) });
const six = (tags?: string[]) => ({ count: 6, sheets: ['E-2'], marks: Array.from({ length: 6 }, (_, i) => mark(i, tags?.[i])) });
const hc = (h: ReturnType<typeof six>) => new Map([['PP-1..6', h], ['FLEX J', { count: 3, sheets: ['E-1'], marks: [] }]]);
const added = (es: TypicalExpansion[], key: string) => es.filter(e => e.deviceKey === key && e.status === 'expanded').reduce((n, e) => n + e.expanded, 0);

describe('which packages share one host count', () => {
  it('the five #9 pole types share PP-1..6; the display baseflex (an assembly) is left out', () => {
    expect(poles.map(p => p.hostTag)).toEqual(['1', '2', '3', '4', '6']);
    const s = sharedHostTypes(packages, targets);
    expect([...s.keys()]).toEqual(['PP-1..6']);
    expect(s.get('PP-1..6')!.length).toBe(5);
    expect(hostTypeId(poles[0])).toBe('tag:1');
  });
});

describe('untyped hosts: nothing is expanded, one group with a suggestion (never counted)', () => {
  const r = expandTypicals(packages, hc(six()), [], targets);

  it('every stated pole device is host_unassigned, 0 added (live: +42 duplex, +5 simplex)', () => {
    const pp = r.expansions.filter(e => e.hostKey === 'PP-1..6');
    expect(pp.filter(e => e.status === 'expanded')).toEqual([]);
    expect(pp.filter(e => e.status === 'host_unassigned').length).toBe(6);
    expect(added(r.expansions, D) + added(r.expansions, 'SIMPLEX')).toBe(0);
    // The office pole's unstated floor simplex keeps its own (information) path.
    expect(pp.find(e => e.deviceKey === 'SIMPLEX' && e.packageId.endsWith('#1'))!.status).toBe('qty_unstated');
  });

  it('ONE group: 6 power poles, 5 types, per-type outlet packages, suggestion from the PP-1..6 note (AI-read)', () => {
    expect(r.hostGroups.length).toBe(1);
    const g = r.hostGroups[0];
    expect([g.hostKey, g.hostNoun, g.hostCount, g.viewportLabel, g.types.length]).toEqual(['PP-1..6', 'power pole', 6, '#9 POWER POLE LEGEND', 5]);
    expect(g.types.map(t => [t.hostTag, t.devices.map(d => `${d.perHost}x${d.key}`).join('+'), t.unstated.map(d => d.key).join('+'), t.suggested])).toEqual([
      ['1', `2x${D}`, 'SIMPLEX', 1],
      ['2', `1x${D}`, '', 1],
      ['3', `1x${D}`, '', 2],
      ['4', `1xSIMPLEX+1x${D}`, '', 1],
      ['6', `2x${D}`, '', 1],
    ]);
    expect(g.suggestion).toMatchObject({ source: 'ai_note', unassigned: 0 });
  });
});

describe('identification sources, in order', () => {
  it('(a) a tag read at every host: office 1, checkout 1, parts pods 2, tester 1, counter 1 -> duplex 8, simplex 1', () => {
    const r = expandTypicals(packages, hc(six(['1', '2', '3', '3', '4', '6'])), [], targets);
    expect(r.hostGroups).toEqual([]);
    const pp = r.expansions.filter(e => e.hostKey === 'PP-1..6' && e.status === 'expanded');
    expect(pp.every(e => e.binding === 'tag')).toBe(true);
    expect(pp.map(e => [e.hostType, e.deviceKey, e.hostCount, e.expanded])).toEqual([
      ['tag:1', D, 1, 2], ['tag:2', D, 1, 1], ['tag:3', D, 2, 2], ['tag:4', 'SIMPLEX', 1, 1], ['tag:4', D, 1, 1], ['tag:6', D, 1, 2],
    ]);
    expect([added(r.expansions, D), added(r.expansions, 'SIMPLEX')]).toEqual([8, 1]);
  });

  it('(a) one host without a tag is not identification: asked', () => {
    const r = expandTypicals(packages, hc(six(['1', '2', '3', '3', '4'])), [], targets);
    expect(r.hostGroups.length).toBe(1);
    expect(added(r.expansions, D)).toBe(0);
  });

  it('(b) a schedule row mapping the poles to types (sum = the host count) expands per type', () => {
    const sched = [{ text: 'PP POWER POLES (OFFICE, CHECKOUT, 2 PARTS PODS, TESTER, COMMERCIAL COUNTER) G.C.', label: 'E-2 #5 SCHEDULE' }];
    const r = expandTypicals(packages, hc(six()), [], targets, { scheduleTexts: sched });
    expect(r.hostGroups).toEqual([]);
    const pp = r.expansions.filter(e => e.hostKey === 'PP-1..6' && e.status === 'expanded');
    expect(pp.every(e => e.binding === 'schedule' && e.reason.includes('E-2 #5 SCHEDULE'))).toBe(true);
    expect([added(r.expansions, D), added(r.expansions, 'SIMPLEX')]).toEqual([8, 1]);
  });

  it('(b) a mapping whose sum is not the host count is not used', () => {
    const sched = [{ text: 'POWER POLES (OFFICE, CHECKOUT, PARTS POD, TESTER, COMMERCIAL COUNTER)', label: 'x' }]; // 5, not 6
    const r = expandTypicals(packages, hc(six()), [], targets, { scheduleTexts: sched });
    expect(r.hostGroups.length).toBe(1);
    expect(added(r.expansions, D)).toBe(0);
  });

  it('(c) one-to-one: as many hosts as legend entries, one entry per host tag; Kissimmee (tags 1,2,3,4,6 of 1..6) is not', () => {
    const five = poles.map((p, i) => ({ ...p, hostTag: String(i + 1), hostTargetKey: 'PP-1..5' }));
    const t5: CountTarget[] = [...targets, { ...targets.find(t => t.key === 'PP-1..6')!, key: 'PP-1..5', type: 'PP-1..5', description: '(5) power poles #1-#5' }];
    const counts = new Map([['PP-1..5', { count: 5, sheets: ['E-2'], marks: Array.from({ length: 5 }, (_, i) => mark(i)) }]]);
    const b = identifyHostTypes('PP-1..5', five, counts.get('PP-1..5')!, t5);
    expect([...b!.values()].map(x => [x.count, x.source])).toEqual(Array.from({ length: 5 }, () => [1, 'one_to_one']));
    expect(identifyHostTypes('PP-1..6', poles, six(), targets)).toBeNull();
    expect(hostTagRange(targets.find(t => t.key === 'PP-1..6'))).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('no host count at all: each type asks for its own count (no_multiplier), no group', () => {
    const r = expandTypicals(packages, new Map([['PP-1..6', { count: null, sheets: [], marks: [], reason: 'not counted' }]]), [], targets);
    expect(r.hostGroups).toEqual([]);
    expect(r.expansions.filter(e => e.hostKey === 'PP-1..6' && e.perHost > 0).every(e => e.status === 'no_multiplier')).toBe(true);
  });
});

describe('allocation text and the suggestion', () => {
  const types = poles.map(p => ({ typeId: hostTypeId(p), host: p.host }));
  it('the live PP-1..6 note maps to office 1, checkout 1, parts pod 2, test station 1, commercial counter 1', () => {
    const a = allocateFromText(targets.find(t => t.key === 'PP-1..6')!.description, types)!;
    expect([...a.values()]).toEqual([1, 1, 2, 1, 1]);
  });
  it('an item matching two types equally ("counter") is never guessed', () => {
    expect(allocateFromText('(office, counter)', types)).toBeNull();
  });
  it('no usable note: one of each type, the extra asked; fewer hosts than types: no suggestion', () => {
    expect(suggestAllocation(types, 6, ['power poles, see plan'])).toMatchObject({ source: 'one_each', unassigned: 1 });
    expect([...suggestAllocation(types, 6, [])!.perType.values()]).toEqual([1, 1, 1, 1, 1]);
    expect(suggestAllocation(types, 3, [])).toBeNull();
  });
});

describe('guard: one host count never feeds several typical types', () => {
  const e = (host: string, hostType: string, binding?: 'tag'): TypicalExpansion => ({
    packageId: host, host, hostKey: 'PP', hostType, deviceKey: D, deviceText: 'duplex', perHost: 1, hostCount: 6, hostSheets: [],
    drawnAtHosts: 0, expanded: 6, status: 'expanded', reason: '6 × 1', quote: '', sheetKey: E2, viewportId: null, viewportLabel: '',
    ...(binding ? { binding } : {}),
  });
  it('two host types on one unbound count -> both host_unassigned, 0 added', () => {
    const out = guardSharedHostCounts([e('Checkout counter power pole', 'tag:2'), e('Parts pod power pole', 'tag:3')]);
    expect(out.map(x => [x.status, x.expanded])).toEqual([['host_unassigned', 0], ['host_unassigned', 0]]);
  });
  it('bound per type, or a single type: untouched', () => {
    const bound = [e('Checkout counter power pole', 'tag:2', 'tag'), e('Parts pod power pole', 'tag:3', 'tag')];
    expect(guardSharedHostCounts(bound)).toEqual(bound);
    const one = [e('Checkout counter power pole', 'tag:2'), { ...e('Checkout counter power pole', 'tag:2'), deviceKey: 'SIMPLEX' }];
    expect(guardSharedHostCounts(one)).toEqual(one);
  });
});
