// Accuracy round C4/C5 — endpoints, frames and lengths on the real Kissimmee
// 0930 export (automatic), then with the SCRIPTED locate mock / pins.
import { describe, it, expect } from 'vitest';
import { estimateFeeders } from './feederEstimate';
import { resolveEndpoints, isEndpoint } from './feederEndpoints';
import { routeFeeder, DEFAULT_FEEDER_ESTIMATE } from './feederRoute';
import { feederInput0930, scriptedLocate, scriptedPins, textSheets0930 } from '../test/fixtures/realrun/feeders0930';

const byId = (r: ReturnType<typeof estimateFeeders>, id: string) => r.estimates.find(e => e.edge.id === id)!;

describe('C4 — endpoints (automatic, no pins, no locate)', () => {
  const r = estimateFeeders(feederInput0930());
  it('RTU-1/2: the two "HVAC disconnect with unit" marks, interchangeable (no circuit tag)', () => {
    const e = byId(r, 'PANEL B→RTU-1').to;
    expect(isEndpoint(e) && [e.source, e.confidence]).toEqual(['counted', 'interchangeable']);
    expect(isEndpoint(e) && e.note).toMatch(/HVAC DISCONNECT WITH UNIT .*interchangeable with RTU-2/);
  });
  it('XFMR: the C4.1 label "ELECTRICAL TRANSFORMER," (approximate); the legend "TRANSFORMER PAD" is not a candidate', () => {
    const x = byId(r, 'XFMR→METER').from;
    expect(isEndpoint(x) && [x.source, x.confidence, x.note]).toEqual(['label', 'approximate (label)', expect.stringContaining('"ELECTRICAL TRANSFORMER,"')]);
  });
  it('METER: the bare "METER" words on C4.1 are not used (water meter / legend) → pin hold', () => {
    const m = byId(r, 'XFMR→METER').to;
    expect(isEndpoint(m)).toBe(false);
  });
  it('every edge is a specific hold — panels / disconnects / meter are not count targets', () => {
    expect(r.estimates.map(e => [e.edge.id, e.route.status])).toEqual(r.estimates.map(e => [e.edge.id, 'hold']));
    expect(byId(r, 'PANEL B→RTU-1').route.math).toMatch(/needs: PANEL B location/);
  });
});

describe('C5 — lengths with the SCRIPTED locate mock (R\'s live-run expectation on E-1)', () => {
  const r = estimateFeeders(feederInput0930({ locate: scriptedLocate() }));
  it('SCRIPTED: PANEL B → RTU-1 on E-1, Manhattan at 1/8" = 1\'-0" with the area check, rise + roof + makeup + slack', () => {
    const e = byId(r, 'PANEL B→RTU-1');
    expect(e.route.status).toBe('estimated');
    expect(e.route.tier).toBe('suggested');
    expect(e.route.math).toMatch(/PANEL B \(E-1, located by the counter \(high\)\) → RTU-1 \(E-1, counted HVAC DISCONNECT WITH UNIT mark/);
    expect(e.route.math).toMatch(/Manhattan \d+ pt × 0\.1111 ft\/pt/);
    expect(e.route.math).toMatch(/PANEL B rise 7 ft \(deck 14 ft default − 7 ft exit\) \+ RTU-1 roof 3 ft \+ makeup 2 × 3 ft/);
    expect(e.route.lengthFt).toBeGreaterThan(40);
    expect(e.route.lengthFt).toBeLessThan(130);
    expect(e.route.quantities!.conductors.map(c => c.size)).toEqual(['6', '10']);
  });
  it('SCRIPTED: DISCON A → PANEL A is adjacent gear (no rise)', () => {
    const e = byId(r, 'DISCON A→PANEL A');
    expect(e.route.status).toBe('estimated');
    expect(e.route.math).toMatch(/adjacent gear/);
  });
  it('SCRIPTED: the service lateral stays held — XFMR is on C4.1, the meter on E-1 (different sheets)', () => {
    expect(byId(r, 'XFMR→METER').route.holds.join(' ')).toMatch(/different sheets/);
  });
});

describe('C5 — the SCRIPTED pin set (XFMR + METER on C4.1; panels + disconnects on E-1)', () => {
  const pins = scriptedPins(p => !(p.page === 49 && /meter|wireway/i.test(p.label)));
  const r = estimateFeeders(feederInput0930({ pins }));
  it('SCRIPTED: XFMR → METER is an underground run on C4.1 at the scale bar (0.2776 ft/pt)', () => {
    const e = byId(r, 'XFMR→METER');
    expect(e.route.status).toBe('estimated');
    expect(e.route.underground).toBe(true);
    expect(e.route.math).toMatch(/straight \d+ pt × 0\.2776 ft\/pt × 1\.15 route factor/);
    expect(e.route.math).toMatch(/underground 2 × \(2 ft burial \+ 3 ft stub-up\)/);
    expect(e.route.quantities!.conduitFt).toBe(e.route.lengthFt! * 2);
  });
});

describe('C4/C5 units', () => {
  it('a pin wins over a locate mark; a label needs exactly one candidate', () => {
    const t = textSheets0930();
    const m = resolveEndpoints(['PANEL A'], { pins: [{ sheetKey: 'S', label: 'panel a', x: 1, y: 2 }], locate: [{ node: 'PANEL A', sheetKey: 'S', x: 9, y: 9 }], textSheets: t });
    expect(m.get('PANEL A')).toMatchObject({ source: 'pin', x: 1 });
  });
  it('an unverified scale is a hold, never priced', () => {
    const edge = { id: 'A→B', from: 'PANEL A', to: 'RTU-1', kind: 'equipment' as const, spec: { key: 'k', conduit: '3/4"', conductors: [{ count: 3, size: '6', ground: false }], sets: 1 }, hold: null, quotes: [] };
    const end = (node: string) => ({ node, sheetKey: 'S', x: 0, y: 0, source: 'pin' as const, confidence: 'exact' as const, note: '' });
    const r = routeFeeder({ edge, from: end('PANEL A'), to: end('RTU-1'), scales: new Map([['S', { label: 'E-7', tier: 'unverified', ftPerPt: null, source: null, basis: 'Not to Scale', area: { status: 'not_checked' }, reasons: [] }]]), settings: DEFAULT_FEEDER_ESTIMATE, slackPct: 10, deckFt: null });
    expect([r.status, r.holds[0]]).toEqual(['hold', expect.stringMatching(/needs scale: confirm the scale on S/)]);
  });
});
