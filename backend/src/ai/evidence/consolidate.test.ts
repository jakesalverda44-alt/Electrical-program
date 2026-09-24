// Real-run fix 2 — type synonym / duplicate consolidation, on the REAL type
// list of the live Kissimmee run (2026-09-24) and its real schedule tables.
import { describe, it, expect } from 'vitest';
import { consolidateTargets, resolveUncertainSynonyms, tagInfoOf } from './consolidate';
import { scheduleCounts, circuitRefs } from './schedules';
import { buildCountTargets, type CountTarget } from '../countTargets';
import { tradeAssignmentOf } from '../../bidstd/tradeAssignment';
import { buildReviewItems, enforcedCounts, reviewItemIsOpen } from '../reviewItems';
import type { CountResult } from '../countingStage';
import { loadKissimmeeLive, liveBlocking } from '../../test/fixtures/realrun/kissimmeeLive';

const live = loadKissimmeeLive();
const realTargets = () => buildCountTargets(live.agent1).targets;

describe('real-run fix 2 — the real Kissimmee type list', () => {
  const cons = consolidateTargets(realTargets(), { panels: ['A', 'B'] });
  const into = (k: string) => cons.merges.find(m => m.key === k);

  it('synonyms fold into one canonical entity, each with its evidence', () => {
    expect(Object.fromEntries(cons.merges.map(m => [m.key, [m.kind, m.into.join(' + ')]]))).toEqual({
      'RTU-1/RTU-2': ['combined', 'RTU-1 + RTU-2'],
      RTU: ['class', 'RTU-1 + RTU-2'],
      ALC: ['synonym', 'ALC PANEL'],
      LCP: ['synonym', 'ALC PANEL'],
      'LIGHTING CONTACTOR ENCLOSURE': ['synonym', 'ALC PANEL'],
      PYLON: ['synonym', 'PYLON SIGN'],
      'SIGN-JB': ['combined', 'FRONT WALL SIGN + SIDE WALL SIGN'],
      PP: ['class', 'PP#1 + PP#2 + PP#3 + PP#4 + PP#5 + PP#6'],
      'POWER POLE TAG 1-6': ['tag_legend', 'PP#1 + PP#2 + PP#3 + PP#4 + PP#5 + PP#6'],
      DUPLEX: ['synonym', 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE'],
      EWH: ['synonym', 'WH'],
      EF: ['synonym', 'EXHAUST FAN RECESSED (AUTOZONE FURN, HVAC INSTALL, EC WIRE)'],
    });
    expect(into('PYLON')!.basis).toContain('the same circuit A18');
    expect(into('SIGN-JB')!.basis).toContain('FRONT WALL SIGN (A6) + SIDE WALL SIGN (A14, A16)');
    expect(into('EWH')!.basis).toContain('water heater');
    expect(into('LCP')!.basis).toBe('another name for ALC PANEL — LCP abbreviates "lighting control panel" on the same circuit B25');
    // Every alias is still on the list (never dropped), pointing at its entity.
    for (const m of cons.merges) expect(cons.targets.find(t => t.key === m.key)!.mergedInto).toEqual(m.into);
    // The pole-tag legend is a host marker (its marks are the poles).
    expect(cons.targets.find(t => t.key === 'POWER POLE TAG 1-6')!.role).toBe('host');
    // The canonical entity names its aliases for the counter.
    expect(cons.targets.find(t => t.key === 'ALC PANEL')!.symbolHint).toContain('also listed as LCP');
  });

  it('never merges what is distinct: numbered siblings, different circuits, receptacle qualifiers', () => {
    const merged = new Set(cons.merges.map(m => m.key));
    for (const k of ['DISCON A', 'DISCON B', 'PP#1', 'PP#4', 'M1', 'M2', 'FRONT WALL SIGN', 'SIDE WALL SIGN', 'GFCI', 'WP GFI',
      'DUPLEX RECEPTACLE, SHALLOW 2X4 HANDY BOX', 'SIMPLEX', 'QUADPLEX', 'METER BASE', 'WIREWAY', 'CT/SERVICE CABINET', 'MINI-TUNE', 'BATTERY CHARGER']) {
      expect(merged.has(k), k).toBe(false);
    }
    // Drawn legend symbols that are a general name — "Motion sensor" (M1 or
    // M2?), T "Thermostat" (T-1/T-2), P "Power poles" (PP#1-#6) — are
    // uncertain: counted, then folded when none is drawn, asked about when
    // drawn on a member's marks, kept when drawn elsewhere.
    // Review fix B2 / N4 — generic names are never folded blind: SIGN (a
    // word of three sign tags) and POWER POLES (it only abbreviates to PP)
    // are counted and decided by their marks too.
    expect(cons.uncertain.map(u => [u.key, u.candidates.join(' + ')])).toEqual([
      ['T', 'T-1/T-2'], ['POWER POLES', 'PP#1 + PP#2 + PP#3 + PP#4 + PP#5 + PP#6'], ['MOTION SENSOR', 'M1 + M2'],
      ['P', 'PP#1 + PP#2 + PP#3 + PP#4 + PP#5 + PP#6'], ['SIGN', 'FRONT WALL SIGN + SIDE WALL SIGN + PYLON SIGN'],
    ]);
  });

  it('quantities never double: RTU = 2 from the real Panel B rows, not 4; ALC / WH / signs owned once', () => {
    const sc = scheduleCounts(cons.targets, live.countResult.evidence.tables);
    expect([sc.get('RTU-1')?.qty, sc.get('RTU-2')?.qty, sc.has('RTU-1/RTU-2'), sc.has('RTU')]).toEqual([1, 1, false, false]);
    // A synonym made these rows ambiguous live (two targets named them), so
    // nobody owned them and each raised a zero item.
    expect(sc.get('ALC PANEL')?.qty).toBe(1);
    expect(sc.get('WH')?.qty).toBe(1);
    expect([sc.get('FRONT WALL SIGN')?.qty, sc.get('SIDE WALL SIGN')?.qty, sc.get('PYLON SIGN')?.qty]).toEqual([1, 2, 1]);
    const live0 = scheduleCounts(realTargets(), live.countResult.evidence.tables);
    expect([live0.has('ALC PANEL'), live0.has('WH'), live0.has('PYLON SIGN'), live0.has('FRONT WALL SIGN')]).toEqual([false, false, false, false]);
  });

  it('the live run\'s 24 blocking zero-count items: 9 were another name (7 folded now, T and POWER POLES after the count), 5 had rows a synonym made ambiguous (now owned)', () => {
    const zeroKeys = liveBlocking(live).filter(i => i.id.startsWith('count:') && i.group === 'zero').map(i => i.typeKey!);
    expect(zeroKeys.length).toBe(24);
    const folded = zeroKeys.filter(k => cons.merges.some(m => m.key === k)).sort();
    expect(folded).toEqual(['ALC', 'EF', 'LCP', 'PP', 'PYLON', 'RTU', 'SIGN-JB']);
    // T and POWER POLES are uncertain: none drawn -> folded after the count
    // (resolveUncertainSynonyms), never their own zero item.
    expect(cons.uncertain.filter(u => ['T', 'POWER POLES'].includes(u.key)).length).toBe(2);
    const sc = scheduleCounts(cons.targets, live.countResult.evidence.tables);
    const owned = zeroKeys.filter(k => sc.has(k)).sort();
    expect(owned).toEqual(['ALC PANEL', 'FRONT WALL SIGN', 'PYLON SIGN', 'SIDE WALL SIGN', 'WH']);
  });

  it('"ckt A-6, 1,220VA" cites circuit A-6 only (was A-6, A-1, A-220)', () => {
    expect(circuitRefs('Front wall sign, ckt A-6, 1,220VA')).toEqual([{ panel: 'A', circuit: 6 }]);
    expect(circuitRefs('Side wall sign (2), ckts A-14,16, 1,220VA each')).toEqual([{ panel: 'A', circuit: 14 }, { panel: 'A', circuit: 16 }]);
    expect(circuitRefs('Rooftop unit, 60/3, ckts B-1,3,5, 3#6,#10G')).toEqual([{ panel: 'B', circuit: 1 }, { panel: 'B', circuit: 3 }, { panel: 'B', circuit: 5 }]);
  });

  it('the legend shorthand "(AutoZone furn, HVAC install, EC wire)" is another trade\'s install, APT connects', () => {
    expect(tradeAssignmentOf('Exhaust fan recessed (AutoZone furn, HVAC install, EC wire)')).toMatchObject({ install: 'OtherTrade', aptConnects: true, aptScope: 'connection' });
  });
});

describe('real-run fix 2 — tags and the uncertain generic symbol', () => {
  it('tag tokens', () => {
    expect(tagInfoOf('RTU-1/RTU-2')).toMatchObject({ base: 'RTU', members: ['RTU-1', 'RTU-2'] });
    expect(tagInfoOf('T-1/T-2')).toMatchObject({ base: 'T', members: ['T-1', 'T-2'] });
    expect(tagInfoOf('PANEL A/B')).toMatchObject({ base: 'PANEL', members: ['PANEL A', 'PANEL B'] });
    expect(tagInfoOf('PP#4')).toMatchObject({ base: 'PP', num: '4' });
    expect(tagInfoOf('DISCON B')).toMatchObject({ base: 'DISCON', num: 'B' });
    expect(tagInfoOf('Power pole tag 1-6')).toMatchObject({ base: 'POWER POLE TAG', range: [1, 6] });
  });

  it('"Motion sensor": its real mark on E-3 is nowhere near M1\'s -> a different device, kept, no question', () => {
    const types = [
      { key: 'MOTION SENSOR', type: 'Motion sensor', status: 'counted', count: 1, flags: [] as string[], reason: '' },
      { key: 'M1', type: 'M1', status: 'counted', count: 2, flags: [] as string[], reason: '' },
      { key: 'M2', type: 'M2', status: 'zero', count: 0, flags: [] as string[], reason: '' },
    ];
    resolveUncertainSynonyms(types, [{ key: 'MOTION SENSOR', type: 'Motion sensor', candidates: ['M1', 'M2'], basis: 'x' }], live.countResult.marks);
    expect(types[0]).toMatchObject({ status: 'counted', count: 1 });
    expect((types[0] as { synonymQuestion?: unknown }).synonymQuestion).toBeUndefined();
    expect(types[0].flags[0]).toContain('a different device');
  });

  it('a generic symbol drawn ON a candidate\'s marks -> ONE question; answered "same" it leaves no line (never doubled)', () => {
    const mk = (type: string, description: string, category: CountTarget['category'] = 'lighting_control', source: CountTarget['source'] = 'legend'): CountTarget =>
      ({ type, key: type.toUpperCase(), description, symbolHint: '', wattage: null, category, source, sourceSheet: 'E-1', headsPerPole: null, emergency: false });
    const cons = consolidateTargets([mk('Occupancy sensor', 'Occupancy sensor'), mk('OS1', 'Occupancy sensor ceiling'), mk('OS2', 'Occupancy sensor wall')]);
    expect(cons.uncertain.map(u => u.key)).toEqual(['OCCUPANCY SENSOR']);
    const types = [
      { key: 'OCCUPANCY SENSOR', type: 'Occupancy sensor', description: '', category: 'lighting_control' as const, status: 'counted', count: 2, heads: null, sheets: [], flags: [] as string[], reason: '', wattage: null },
      { key: 'OS1', type: 'OS1', description: '', category: 'lighting_control' as const, status: 'counted', count: 2, heads: null, sheets: [], flags: [] as string[], reason: '', wattage: null },
    ];
    resolveUncertainSynonyms(types, cons.uncertain, [
      { sheetKey: 's', typeKey: 'OCCUPANCY SENSOR', x: 100, y: 100 }, { sheetKey: 's', typeKey: 'OCCUPANCY SENSOR', x: 500, y: 500 },
      { sheetKey: 's', typeKey: 'OS1', x: 105, y: 102 }, { sheetKey: 's', typeKey: 'OS1', x: 900, y: 900 },
    ]);
    const cr = { version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], types, loadCheck: null, removedRows: [], flags: [], marks: [], evidence: { tables: [], expansions: [], families: [], typicals: [] } } as unknown as CountResult;
    const items = buildReviewItems(cr);
    const q = items.find(i => i.id === 'synonym:OCCUPANCY SENSOR')!;
    // Review fix S7 — "the same device" drops only the ONE coinciding mark.
    expect(q).toMatchObject({ kind: 'area', options: ['Different devices — keep 2', 'The same device — keep 1'] });
    expect(reviewItemIsOpen(q)).toBe(true);
    const same = enforcedCounts(cr, [{ ...q, resolution: { action: 'answer', answer: q.options![1], qty: q.sumQty, by: 'x', at: 'y' } }]);
    expect(same.byType.get('OCCUPANCY SENSOR')).toBe(1);
    expect(same.byType.get('OS1')).toBe(2);
  });
});
