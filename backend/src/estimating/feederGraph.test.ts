// Accuracy round C1 — the feeder graph on the real Kissimmee (0928, 0930)
// and 36th Street (0930) exports.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { feederGraph, normalizeNode, endpointPairs } from './feederGraph';
import { loadKissimmeeLive0930, load36th0930 } from '../test/fixtures/realrun/live0930';

const k28 = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/price-accuracy/kissimmee-run-2026-09-28.json'), 'utf8'));
const KISSIMMEE_EDGES = ['DISCON A→PANEL A', 'DISCON B→PANEL B', 'METER→WIREWAY', 'PANEL B→RTU-1', 'PANEL B→RTU-2', 'XFMR→METER'];

describe('C1 — normalizeNode / endpointPairs', () => {
  it('normalizes the names the drawings use', () => {
    expect(['DISCON A (200A fused switch)', 'Disc B', 'Meter base NEMA 3R', 'Xfmr', 'ELECTRICAL TRANSFORMER', 'NEMA 3R 12x12 wireway', 'Panel B', 'RTU #1', 'MDP'].map(n => normalizeNode(n)))
      .toEqual(['DISCON A', 'DISCON B', 'METER', 'XFMR', 'XFMR', 'WIREWAY', 'PANEL B', 'RTU-1', 'MDP']);
    expect(normalizeNode('A', { asPanel: true })).toBe('PANEL A');
    expect(normalizeNode('A')).toBeNull();
  });
  it('reads endpoint pairs', () => {
    expect(endpointPairs('Xfmr-meter and meter-wireway')).toEqual([['XFMR', 'METER'], ['METER', 'WIREWAY']]);
    expect(endpointPairs('Discon A->Panel A, Discon B->Panel B')).toEqual([['DISCON A', 'PANEL A'], ['DISCON B', 'PANEL B']]);
    expect(endpointPairs('DISCON A to Panel A')).toEqual([['DISCON A', 'PANEL A']]);
  });
});

describe('C1 — Kissimmee', () => {
  for (const [name, run] of [['0928', k28], ['0930', loadKissimmeeLive0930()]] as const) {
    it(`${name}: exactly the six edges, each with its stated spec`, () => {
      const g = feederGraph({ agent1: run.agent1, takeoffRows: run.agent2.takeoff as never });
      expect(g.edges.map(e => e.id).sort()).toEqual(KISSIMMEE_EDGES);
      const by = (id: string) => g.edges.find(e => e.id === id)!;
      expect(by('XFMR→METER')).toMatchObject({ kind: 'service_lateral', hold: null, spec: { conduit: '2"', sets: 2, conductors: [{ count: 8, size: '3/0', ground: false }] } });
      expect(by('METER→WIREWAY').kind).toBe('service');
      expect(by('DISCON A→PANEL A')).toMatchObject({ kind: 'feeder', spec: { conduit: '2"', sets: 1, conductors: [{ count: 4, size: '3/0', ground: false }, { count: 1, size: '6', ground: true }] } });
      expect(by('PANEL B→RTU-1')).toMatchObject({ kind: 'equipment', spec: { conduit: '3/4"', conductors: [{ count: 3, size: '6' }, { count: 1, size: '10', ground: true }] } });
      expect(g.edges.every(e => e.hold === null)).toBe(true);
    });
  }
  it('0930: the wireway → disconnect connections are taps (no length edge)', () => {
    const run = loadKissimmeeLive0930();
    const g = feederGraph({ agent1: run.agent1, takeoffRows: run.agent2.takeoff as never });
    expect(g.taps.map(t => `${t.from}→${t.to}`)).toEqual(['WIREWAY→DISCON A', 'WIREWAY→DISCON B']);
  });
});

describe('C1 — 36th Street 0930', () => {
  it('the riser is skipped as existing (the export says "existing to remain"); the four HVAC circuits are equipment edges from Panel A', () => {
    const run = load36th0930();
    const g = feederGraph({ agent1: run.agent1, takeoffRows: run.agent2.takeoff as never });
    expect(g.edges.map(e => `${e.id} ${e.kind} ${e.spec?.key}`)).toEqual([
      'PANEL A→COMP-1 equipment 3/4"|3#6+1#10G',
      'PANEL A→AHU-1 equipment 3/4"|3#6+1#10G',
      'PANEL A→COMP-2 equipment 3/4"|3#6+1#10G',
      'PANEL A→AHU-2 equipment 3/4"|3#6+1#10G',
    ]);
    expect(g.skipped.map(s => s.quote)).toContain('Existing main disconnect/meter via 2"C (4)3/0 CU #6 G');
  });
  it('an unreadable spec is a needs-size hold, never guessed', () => {
    const g = feederGraph({ agent1: { panels: [{ name: 'A', fedFrom: 'MDP' }] } });
    expect(g.edges).toEqual([expect.objectContaining({ id: 'MDP→PANEL A', spec: null, hold: 'needs_size' })]);
  });
});
