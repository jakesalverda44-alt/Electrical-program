// Typical fix (2026-09-28) — a legend typical for host type X uses only the
// hosts identified as type X. On the live run of 2026-09-28 the six power
// poles were ONE equipment row ("PP-1..6") and each of the #9 legend's five
// pole types was multiplied by all six. Packages and targets here are that
// run's own (fixtures/realrun/kissimmee-live-2026-09-28.json).
import { describe, it, expect } from 'vitest';
import {
  allocateFromText, expandTypicals, hostTypesOf, guardSharedHostCounts, hostTagRange, hostTypeId, identifyHostTypes, sharedHostTypes, suggestAllocation,
  type HostMark, type TypicalExpansion, type TypicalPackage,
} from './typicals';
import type { CountTarget } from '../countTargets';
import type { ScheduleTable } from './schedules';
import { hostScheduleSources } from '../countMerge';
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

  it('(b) a REAL host schedule (tag + type columns, rows add up to the host count) expands per type', () => {
    const sched = hostScheduleSources([{
      id: 't', sheetKey: E2, sheetLabel: 'E-2', viewportId: null, title: 'E-2 #5 POWER POLE SCHEDULE', kind: 'other', source: 'vision', warnings: [],
      columns: ['TAG', 'POLE TYPE', 'QTY'],
      rows: [['1', 'OFFICE', '1'], ['2', 'CHECKOUT', '1'], ['3', 'PARTS POD', '2'], ['4', 'TESTER', '1'], ['6', 'COMMERCIAL COUNTER', '1']].map((cells, rowIdx) => ({ cells, rowIdx })),
    } as ScheduleTable]);
    expect(sched.noteTexts).toEqual([]);
    const r = expandTypicals(packages, hc(six()), [], targets, sched);
    expect(r.hostGroups).toEqual([]);
    const pp = r.expansions.filter(e => e.hostKey === 'PP-1..6' && e.status === 'expanded');
    expect(pp.every(e => e.binding === 'schedule' && e.reason.includes('POWER POLE SCHEDULE'))).toBe(true);
    expect([added(r.expansions, D), added(r.expansions, 'SIMPLEX')]).toEqual([8, 1]);
  });

  it('(b) a schedule whose rows do not add up to the host count is not used', () => {
    const schedules = [{ label: 'x', rows: ['OFFICE', 'CHECKOUT', 'PARTS POD', 'TESTER', 'COMMERCIAL COUNTER'].map((type, i) => ({ tag: String(i + 1), type, qty: 1 })) }]; // 5, not 6
    const r = expandTypicals(packages, hc(six()), [], targets, { schedules });
    expect(r.hostGroups.length).toBe(1);
    expect(added(r.expansions, D)).toBe(0);
  });

  it('S3 (review repro): the same mapping in a KEYED NOTES table is only a suggestion — nothing expanded, the group asks', () => {
    const src = hostScheduleSources([{
      id: 'n', sheetKey: E2, sheetLabel: 'E-2', viewportId: null, title: 'KEYED NOTES', kind: 'other', source: 'vision', warnings: [], columns: ['NO', 'NOTE'],
      rows: [{ cells: ['7', '(6) power poles (office, checkout, 2 parts pods, tester, commercial counter)'], rowIdx: 0 }],
    } as ScheduleTable]);
    expect(src.schedules).toEqual([]);
    const r = expandTypicals(packages, hc(six()), [], targets, src);
    expect(added(r.expansions, D) + added(r.expansions, 'SIMPLEX')).toBe(0);
    expect(r.hostGroups.length).toBe(1);
    expect(r.hostGroups[0].suggestion).toMatchObject({ source: 'table_note', label: 'E-2 KEYED NOTES', unassigned: 0 });
    expect(r.hostGroups[0].types.map(t => t.suggested)).toEqual([1, 1, 2, 1, 1]);
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
    expect(suggestAllocation(types, 6, [{ text: 'power poles, see plan', label: 'x', source: 'ai_note' }])).toMatchObject({ source: 'one_each', unassigned: 1 });
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

// Fix round B1 — the review's three repros: two packages for ONE host type
// on one bound host (a legend row plus a note) are one type and add up,
// exactly as on main: 4 hosts x (1 + 1) = +8.
describe('B1 — one host type described twice still expands (review repros)', () => {
  const tgt = (key: string, description: string, category = 'equipment') => ({ type: key, key, description, symbolHint: '', wattage: null, category, source: 'legend', sourceSheet: 'E1', headsPerPole: null, emergency: false } as unknown as CountTarget);
  const pkg = (id: string, host: string, hostTag: string, dev: string): TypicalPackage =>
    ({ id, sheetKey: 'E1', viewportId: null, viewportLabel: 'LEGEND', host, hostTag, hostMarker: '', hostTargetKey: 'VAC', devices: [{ targetKey: dev, text: dev, qty: 1 }], quote: host } as unknown as TypicalPackage);
  const vac = new Map([['VAC', { count: 4, sheets: ['E-1'], marks: [] as HostMark[] }]]);
  const tg = [tgt('VAC', 'Vacuum island'), tgt('DUP', 'duplex', 'device'), tgt('GFI', 'gfci', 'device')];
  const run = (a: TypicalPackage, b: TypicalPackage) => {
    const r = expandTypicals([a, b], vac, [], tg);
    return { total: r.expansions.filter(e => e.status === 'expanded').reduce((n, e) => n + e.expanded, 0), groups: r.hostGroups.length, statuses: r.expansions.map(e => e.status) };
  };
  it('legend row tagged + note untagged on the same host: +8, no assignment item', () => {
    expect(run(pkg('a', 'Vacuum island', 'V', 'DUP'), pkg('b', 'Vacuum island', '', 'GFI'))).toEqual({ total: 8, groups: 0, statuses: ['expanded', 'expanded'] });
  });
  it('host words that differ only by "(typ.)": +8', () => {
    expect(run(pkg('a', 'Vacuum island', '', 'DUP'), pkg('b', 'Vacuum island (typ.)', '', 'GFI'))).toEqual({ total: 8, groups: 0, statuses: ['expanded', 'expanded'] });
  });
  it('"Storage unit" and "Storage unit interior": +8', () => {
    expect(run(pkg('a', 'Storage unit', '', 'DUP'), pkg('b', 'Storage unit interior', '', 'GFI'))).toEqual({ total: 8, groups: 0, statuses: ['expanded', 'expanded'] });
  });
  it('positive evidence still splits: two distinct tags, or disjoint words once the shared noun is dropped', () => {
    expect(new Set(hostTypesOf([pkg('a', 'Vacuum island', 'V1', 'DUP'), pkg('b', 'Vacuum island', 'V2', 'GFI')]).values()).size).toBe(2);
    expect(new Set(hostTypesOf([pkg('a', 'Checkout counter pole', '', 'DUP'), pkg('b', 'Commercial counter pole', '', 'GFI')]).values()).size).toBe(2);
    expect(new Set(hostTypesOf(poles).values()).size).toBe(5); // Kissimmee still splits
  });
  it('with 2+ tags, an untagged note joins the one tagged type its words match', () => {
    const ids = hostTypesOf([pkg('a', 'Office pole', '1', 'DUP'), pkg('b', 'Checkout pole', '2', 'DUP'), pkg('c', 'Office pole (typ.)', '', 'GFI')]);
    expect([ids.get('a'), ids.get('b'), ids.get('c')]).toEqual(['tag:1', 'tag:2', 'tag:1']);
  });
});

// Fix round 2 — the re-check's repros (review addendum, 3b683f6).
describe('fix round 2 — N1 / N2 / N4', () => {
  const tgt = (key: string, description: string, category = 'equipment') => ({ type: key, key, description, symbolHint: '', wattage: null, category, source: 'legend', sourceSheet: 'E1', headsPerPole: null, emergency: false } as unknown as CountTarget);
  const pkg = (id: string, host: string, hostTag: string, dev: string, qty = 1, hostTargetKey = 'VAC'): TypicalPackage =>
    ({ id, sheetKey: 'E1', viewportId: null, viewportLabel: 'LEGEND', host, hostTag, hostMarker: '', hostTargetKey, devices: [{ targetKey: dev, text: dev, qty }], quote: host } as unknown as TypicalPackage);
  const counts = (n: number) => new Map([['VAC', { count: n, sheets: ['E-1'], marks: [] as HostMark[] }]]);
  const tg = [tgt('VAC', 'host'), tgt('DUP', 'duplex', 'device'), tgt('GFI', 'gfci', 'device')];
  const total = (r: ReturnType<typeof expandTypicals>) => r.expansions.filter(e => e.status === 'expanded').reduce((n, e) => n + e.expanded, 0);

  it('N1 (blocker repro): the untagged Kissimmee-shaped legend is 5 types — "checkout counter" and "commercial counter" never merge', () => {
    const five = [pkg('a', 'Office area power pole', '', 'DUP', 2), pkg('b', 'Checkout counter power pole', '', 'DUP', 1), pkg('c', 'Parts pod power pole', '', 'DUP', 1),
      pkg('d', 'Test station power pole', '', 'DUP', 1), pkg('e', 'Commercial counter power pole', '', 'DUP', 2)];
    const r = expandTypicals(five, counts(6), [], tg);
    expect(total(r)).toBe(0);
    expect(r.hostGroups.length).toBe(1);
    expect(r.hostGroups[0].types.map(t => [t.typeId, t.devices.map(d => d.perHost).join('+')])).toEqual([
      ['host:OFFICE', '2'], ['host:CHECKOUT COUNTER', '1'], ['host:PART POD', '1'], ['host:TEST STATION', '1'], ['host:COMMERCIAL COUNTER', '2'],
    ]);
  });
  it('N1: two distinct types sharing a word (2 poles) do not both expand x2', () => {
    const r = expandTypicals([pkg('a', 'Checkout counter power pole', '', 'DUP', 1), pkg('b', 'Commercial counter power pole', '', 'DUP', 2)], counts(2), [], tg);
    expect(total(r)).toBe(0);
    expect(r.hostGroups[0].types.length).toBe(2);
  });
  it('N1: a subset merges ("Storage unit" + "Climate controlled storage unit" is one type); distinct supersets do not', () => {
    const ids = hostTypesOf([pkg('a', 'Storage unit', '', 'DUP'), pkg('b', 'Climate controlled storage unit', '', 'GFI'), pkg('c', 'Drive-up storage unit', '', 'GFI')]);
    // "Storage unit" names nothing beyond the shared noun: it applies to every unit (N4), never merged into one type.
    expect(new Set([ids.get('b'), ids.get('c')]).size).toBe(2);
    expect([ids.get('b'), ids.get('c')]).not.toContain(ids.get('a'));
    expect(ids.get('a')).toBe('all:VAC');
    // A real subset of TWO different types ("north unit" in both) is asked on its own.
    const amb = hostTypesOf([pkg('a', 'North office', '', 'DUP'), pkg('b', 'North office east', '', 'GFI'), pkg('c', 'North office west', '', 'GFI'), pkg('d', 'Checkout', '', 'DUP')]);
    expect(new Set([amb.get('a'), amb.get('b'), amb.get('c')]).size).toBe(3);
    const two = hostTypesOf([pkg('a', 'Office pole', '', 'DUP'), pkg('b', 'Office pole north', '', 'GFI'), pkg('c', 'Checkout pole', '', 'DUP')]);
    expect(two.get('a')).toBe(two.get('b'));
    expect(two.get('c')).not.toBe(two.get('a'));
    // Distinct storage types stay closed: nothing added.
    expect(total(expandTypicals([pkg('a', 'Climate controlled storage unit', '', 'DUP'), pkg('b', 'Drive-up storage unit', '', 'GFI')], counts(4), [], tg))).toBe(0);
  });
  it('N2: abbreviations — "Vac island" is "Vacuum island" (+8); "Stor unit" / "Storage unit" too; an unknown abbreviation stays closed', () => {
    expect(total(expandTypicals([pkg('a', 'Vacuum island', '', 'DUP'), pkg('b', 'Vac island', '', 'GFI')], counts(4), [], tg))).toBe(8);
    expect(total(expandTypicals([pkg('a', 'Storage unit north', '', 'DUP'), pkg('b', 'Stor unit north', '', 'GFI')], counts(4), [], tg))).toBe(8);
    expect(total(expandTypicals([pkg('a', 'Vacuum island north', '', 'DUP'), pkg('b', 'Vcm island south', '', 'GFI')], counts(4), [], tg))).toBe(0);
  });
  it('N4: "Power pole (typ.)" on the tagged Kissimmee legend applies to EVERY pole (x6, with evidence) and is not an extra type; the 5 types are unchanged', () => {
    const note = { ...poles[0], id: `${poles[0].id}-note`, host: 'Power pole (typ.)', hostTag: '', quote: 'POWER POLE (TYP.) — ONE DATA OUTLET', devices: [{ targetKey: D, text: 'data outlet', qty: 1 }] };
    const r = expandTypicals([...packages, note], hc(six()), [], targets);
    const n = r.expansions.find(e => e.packageId === note.id)!;
    expect([n.status, n.expanded, n.binding]).toEqual(['expanded', 6, 'every_host']);
    expect(n.reason).toContain('names no type, so it applies to every one of the 6');
    expect(r.hostGroups.length).toBe(1);
    expect(r.hostGroups[0].types.map(t => t.hostTag)).toEqual(['1', '2', '3', '4', '6']);
    expect(r.expansions.filter(e => e.hostKey === 'PP-1..6' && e.packageId !== note.id && e.status === 'expanded')).toEqual([]);
    // Kissimmee without the note: unchanged.
    const k = expandTypicals(packages, hc(six()), [], targets);
    expect(k.hostGroups[0].types.map(t => t.suggested)).toEqual([1, 1, 2, 1, 1]);
    expect(added(k.expansions, D) + added(k.expansions, 'SIMPLEX')).toBe(0);
  });
});
