import { describe, expect, it } from 'vitest';
import { buildCountTargets, fixtureCategory, normalizeTypeKey, parseWatts } from './countTargets';
import { kissimmeeAgent1, carWashAgent1 } from '../test/fixtures/takeoff/agent1Fixtures';
import { mergeAgent1Batches } from './mergeAgent1';

describe('buildCountTargets — Kissimmee-shaped Agent 1 output (two batches, real merge)', () => {
  const { targets, notes } = buildCountTargets(kissimmeeAgent1());
  const byKey = Object.fromEntries(targets.map(t => [t.key, t]));

  it('lists every fixture-schedule type first, in schedule order, then the legend and equipment', () => {
    expect(targets.map(t => t.key)).toEqual([
      'A', 'B', 'C', 'M', 'G', 'E', 'F', 'K', 'J', 'D', 'L', 'S1', 'S2',
      'GFI', 'DUPLEX RECEPTACLE', 'S', 'OS',
      'RTU-1',
    ]);
    expect(notes).toEqual([]);
  });

  it('categorizes interior / building-mounted exterior / site (poles)', () => {
    expect(byKey.A.category).toBe('interior_lighting');
    expect(byKey.D.category).toBe('exterior_building');
    expect(byKey.L.category).toBe('exterior_building');
    expect(byKey.S1.category).toBe('site_lighting');
    expect(byKey.S2.headsPerPole).toBe(2);
    expect(byKey.A.headsPerPole).toBeNull();
  });

  it('parses wattage from numbers and "64W" strings; flags emergency types', () => {
    expect(byKey.A.wattage).toBe(32);
    expect(byKey.B.wattage).toBe(64);
    expect(byKey.E.emergency).toBe(true);
    expect(byKey.A.emergency).toBe(false);
  });

  it('legend: a short printed label is the identity; otherwise the description is', () => {
    expect(byKey.GFI.description).toBe('GFCI duplex receptacle');
    expect(byKey['DUPLEX RECEPTACLE'].type).toBe('Duplex receptacle');
    expect(byKey.OS.category).toBe('lighting_control');
  });

  it('a schedule concatenated twice by a batch merge yields one target and no false conflict', () => {
    const a1 = kissimmeeAgent1();
    const doubled = mergeAgent1Batches([a1, { fixtureSchedule: a1.fixtureSchedule }]);
    const r = buildCountTargets(doubled);
    expect(r.targets.filter(t => t.key === 'A')).toHaveLength(1);
    expect(r.notes).toEqual([]);
  });
});

describe('buildCountTargets — car-wash equipment schedule', () => {
  const { targets } = buildCountTargets(carWashAgent1());
  it('counts equipment tags and skips an untagged equipment row', () => {
    expect(targets.map(t => `${t.key}:${t.category}`)).toEqual([
      'W1:interior_lighting', 'WP:exterior_building', 'EQ-1:equipment', 'EQ-2:equipment', 'VAC-1:equipment',
    ]);
  });
});

describe('buildCountTargets — panel-circuit fallback', () => {
  it('is used only when there is no schedule/legend/equipment, with a warning note', () => {
    const r = buildCountTargets({ panelCircuits: [{ panel: 'LP', circuit: '1', description: 'LIGHTING - SALES', loadVA: 1200 }] });
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].category).toBe('panel_circuit');
    expect(r.notes[0]).toMatch(/falls back to panel-circuit descriptions/);
  });
  it('is not used when a fixture schedule exists', () => {
    const r = buildCountTargets({ fixtureSchedule: [{ type: 'A', description: 'Troffer' }], panelCircuits: [{ description: 'LIGHTING' }] });
    expect(r.targets.map(t => t.key)).toEqual(['A']);
  });
  it('reports an empty list honestly', () => {
    expect(buildCountTargets({}).notes[0]).toMatch(/nothing to count/);
    expect(buildCountTargets(null).targets).toEqual([]);
  });
});

describe('helpers', () => {
  it('normalizeTypeKey', () => {
    expect(normalizeTypeKey(' Type  a ')).toBe('A');
    expect(normalizeTypeKey('"S1"')).toBe('S1');
    expect(normalizeTypeKey('type b1')).toBe('B1');
  });
  it('parseWatts', () => {
    expect(parseWatts('32 W')).toBe(32);
    expect(parseWatts(0)).toBeNull();
    expect(parseWatts('n/a')).toBeNull();
  });
  it('fixtureCategory falls back to text when location is blank', () => {
    expect(fixtureCategory({ description: 'LED wall pack', location: '' })).toBe('exterior_building');
    expect(fixtureCategory({ description: 'Area light', mounting: '25 ft pole' })).toBe('site_lighting');
    expect(fixtureCategory({ description: '2x4 troffer' })).toBe('interior_lighting');
  });
  it('a duplicate type fills a missing wattage and records a conflicting definition', () => {
    const r = buildCountTargets({
      fixtureSchedule: [{ type: 'A', description: 'Troffer' }, { type: 'A', description: 'Downlight', wattage: 20 }],
    });
    expect(r.targets[0].wattage).toBe(20);
    expect(r.notes[0]).toMatch(/Type A is defined twice/);
  });
});
