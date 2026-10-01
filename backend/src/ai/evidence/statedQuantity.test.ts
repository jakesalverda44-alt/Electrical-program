// Fewer-questions round Task 2 — the stated-quantity parser: strict rules,
// and a pinned sweep over EVERY equipment / legend / panel description of
// both 2026-09-30 live exports (a new match or a lost one fails here).
import { describe, it, expect } from 'vitest';
import { statedQuantity, namedUnitTag } from './statedQuantity';
import { loadKissimmeeLive0930, load36th0930 } from '../../test/fixtures/realrun/live0930';

describe('statedQuantity — rules', () => {
  it.each([
    ['(3) Ceiling fans Hunter #28692', 3],
    ['(5) Battery chargers, Panel B ckt 15,17,19', 5],
    ['Thermostats #1 and #2 above electric panels (2)', 2],
    ['Exhaust fans #1, #2 and #3', 3],
    ['Unit heaters #1-#6', 6],
    ['three exhaust fans in the warehouse', 3],
    ['Hand dryers (2)', 2],
  ])('%s → %i', (text, qty) => {
    expect(statedQuantity(text)).toMatchObject({ qty });
  });
  it.each([
    'Meter base NEMA 3R, parallel (2)4#3/0 2"C',
    'Lithonia quick connect/relock, factory wired w/ 11 ft cable, 1 and 2 circuit models (AutoZone furnished, contractor installed)',
    'NEMA 3R 12x12 wireway, contractor provided',
    'Pylon sign connection, circuit A-18',
    'Leviton VP24 7-day astronomic timer switch (VPOSR for 3-way)',
    'Venstar lighting contactor enclosure 19.5"W x 23.5"H x 8"D, semi-recessed, (6) contactors: WORK, SALES',
    'Feeder (2) 3" C with (4) 500 kcmil',
    '(2) circuits to the sign',
    'two-gang box',
    'Exterior emergency light with two heads',
    'Rooftop unit, 60/3 breaker, Panel B ckt 1,3,5',
  ])('never: %s', text => {
    expect(statedQuantity(text)).toBeNull();
  });
  it('two different quantities → a conflict, no number', () => {
    expect(statedQuantity('(2) Exhaust fans … exhaust fans #1, #2 and #3')).toHaveProperty('conflict');
  });
  it('named one unit', () => {
    expect(['AHU #2', 'RTU-1', 'EF 3', 'CF1-CF3', 'PP-1..6', 'MB', 'TSTAT'].map(namedUnitTag)).toEqual([true, true, false, false, false, false, false]);
  });
});

describe('statedQuantity — sweep of every real row (2026-09-30 exports)', () => {
  it('matches exactly the pinned rows', () => {
    const hits: string[] = [];
    for (const [job, live] of [['kissimmee', loadKissimmeeLive0930()], ['36th', load36th0930()]] as const) {
      const a = live.agent1 as { equipment: Array<{ tag: string; description: string }>; symbolLegend: Array<{ symbol: string; description: string }>; panels: Array<{ name: string; fedFrom: string; location: string }>; fixtureSchedule: Array<{ type: string; description: string }> };
      const rows = [
        ...a.equipment.map(e => [e.tag, e.description]), ...a.symbolLegend.map(e => [e.symbol, e.description]),
        ...a.panels.map(p => [p.name, `${p.fedFrom} ${p.location}`]), ...(a.fixtureSchedule ?? []).map(f => [f.type, f.description]),
      ];
      for (const [tag, d] of rows) { const q = statedQuantity(d); if (q) hits.push(`${job} ${tag}: ${'qty' in q ? q.qty : 'conflict'}`); }
    }
    expect(hits).toEqual([
      'kissimmee BATT CHGR: 5',
      'kissimmee TSTAT: 2',
      'kissimmee EF: 2',
      'kissimmee CF1-CF3: 3',
    ]);
    // the traps, by name
    const k = loadKissimmeeLive0930().agent1 as { equipment: Array<{ tag: string; description: string }> };
    const d = (tag: string) => k.equipment.find(e => e.tag === tag)!.description;
    expect(statedQuantity(d('MB'))).toBeNull();
    expect(statedQuantity(d('QC/RELOCK'))).toBeNull();
    expect(statedQuantity(d('TSTAT'))).toMatchObject({ qty: 2 });
    expect(statedQuantity(d('CF1-CF3'))).toMatchObject({ qty: 3 });
  });
});
