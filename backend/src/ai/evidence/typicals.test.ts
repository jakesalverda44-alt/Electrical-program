// Evidence round 2.1 / 2.2 — typical packages: the reader's reply validated,
// devices mapped to count targets, hosts as HOST targets, and the expansion
// (hosts x per-host qty, minus devices drawn at a host; no host count = no
// expansion). Targets are the REAL Kissimmee Agent 1's.
import { describe, it, expect } from 'vitest';
import { buildCountTargets } from '../countTargets';
import { parseTypicalsReply, matchDeviceToTarget, hostTargets, hostKeyOf, expandTypicals, HOST_RADIUS_PT, type TypicalPackage } from './typicals';
import { TYPICALS_REPLIES } from '../../test/fixtures/evidence/kissimmeeReplies';
import { loadKissimmeeBaseline } from '../../test/fixtures/evidence/kissimmeeBaseline';

const { targets } = buildCountTargets(loadKissimmeeBaseline().agent1);
const E2 = 'set.pdf#50';
const vps = [{ id: `${E2}@8`, label: '#8 GENERAL WIRING AND POWER NOTES' }, { id: `${E2}@9`, label: '#9 POWER POLE LEGEND' }, { id: `${E2}@10`, label: '#10 POWER POLE NOTES' }];

describe('2.1 — the E-2 #9 POWER POLE LEGEND packages', () => {
  const p = parseTypicalsReply(TYPICALS_REPLIES[50], { sheetKey: E2, source: 'vision', viewports: vps, targets })!;
  it('five pole types, each with its tag, its devices per pole and the verbatim quote', () => {
    expect(p.rejected).toEqual([]);
    expect(p.packages.map(x => [x.hostTag, x.devices.map(d => `${d.qty ?? '?'}x${d.targetKey}`).join('+')])).toEqual([
      ['1', '2xDUPLEX RECEPTACLE / FLOOR RECEPTACLE+?xSIMPLEX RECEPTACLE'],
      ['2', '1xDUPLEX RECEPTACLE / FLOOR RECEPTACLE'],
      ['3', '1xDUPLEX RECEPTACLE / FLOOR RECEPTACLE'],
      ['4', '1xSIMPLEX RECEPTACLE+1xDUPLEX RECEPTACLE / FLOOR RECEPTACLE'],
      ['6', '2xDUPLEX RECEPTACLE / FLOOR RECEPTACLE'],
    ]);
    expect(p.packages.every(x => x.viewportId === `${E2}@9` && /POWER POLE/.test(x.quote))).toBe(true);
  });
  it('a quantity that is not stated is never guessed ("simplex outlets in junction boxes on floor")', () => {
    expect(p.packages[0].devices[1]).toEqual({ targetKey: 'SIMPLEX RECEPTACLE', text: 'simplex outlets in junction boxes on floor', qty: null });
  });
  it('unmarked hosts become HOST targets (never lines); a host that is a target binds to it', () => {
    const hosts = hostTargets(p.packages, targets);
    expect(hosts.map(h => h.key)).toEqual([
      'HOST TAG 1 OFFICE AREA POWER POLE', 'HOST TAG 2 CHECKOUT COUNTER POWER POLE', 'HOST TAG 3 PARTS POD POWER POLE',
      'HOST TAG 4 TEST STATION POWER POLE', 'HOST TAG 6 COMMERCIAL COUNTER POWER POLE',
    ]);
    expect(hosts.every(h => h.role === 'host' && h.symbolHint.startsWith('hexagon tag'))).toBe(true);
    const e1 = parseTypicalsReply(TYPICALS_REPLIES[49], { sheetKey: 'set.pdf#49', source: 'vision', viewports: [{ id: 'set.pdf#49@5', label: '#5 POWER SCHEDULE' }], targets })!;
    expect(e1.packages[0].hostTargetKey).toBe('COIL + J');
    expect(hostTargets(e1.packages, targets)).toEqual([]);
  });
  it('rejects packages without a quote, devices, or any way to find the hosts; keys outside the target list are re-matched', () => {
    const bad = JSON.stringify({ packages: [
      { host: 'Pole', quote: '', devices: [{ text: 'duplex', qty: 1 }], host_tag: '1' },
      { host: 'Pole', quote: 'POLE WITH DUPLEX', devices: [], host_tag: '1' },
      { host: 'Island', quote: 'ISLAND WITH TWO VACUUMS', devices: [{ text: 'vacuum', qty: 2 }] },
      { host: 'Pole', quote: 'POLE WITH ONE QUAD OUTLET', devices: [{ text: 'quad outlet', target: 'NOT A TARGET', qty: 'one' }], host_tag: '7', viewport: '9' },
    ] });
    const r = parseTypicalsReply(bad, { sheetKey: E2, source: 'text', viewports: vps, targets })!;
    expect(r.rejected).toHaveLength(3);
    expect(r.packages[0].devices[0]).toEqual({ targetKey: 'QUADPLEX RECEPTACLE', text: 'quad outlet', qty: 1 });
    expect(parseTypicalsReply('{"items":[]}', { sheetKey: E2, source: 'text', viewports: vps, targets })).toBeNull();
  });
});

describe('matchDeviceToTarget — conservative', () => {
  it('maps plain / qualified receptacles to the right legend type, never across qualifiers', () => {
    const k = (t: string) => matchDeviceToTarget(t, targets)?.key ?? null;
    expect(k('Receptacle mounted to base plate')).toBe('DUPLEX RECEPTACLE / FLOOR RECEPTACLE');
    expect(k('duplex outlets')).toBe('DUPLEX RECEPTACLE / FLOOR RECEPTACLE');
    expect(k('simplex outlet')).toBe('SIMPLEX RECEPTACLE');
    expect(k('GFI receptacle')).toBe('GFCI');
    expect(k('weatherproof GFI receptacle')).toBe('WP GFI');
    expect(k('duplex receptacle on phone board in handy box')).toBe('DUPLEX RECEPTACLE, SHALLOW 2X4 HANDY BOX ON PHONE BOARD');
    expect(k('vacuum')).toBeNull();
    expect(k('USB receptacle')).toBeNull();
  });
});

describe('2.2 — expansion', () => {
  const pkg = (tag: string, devices: TypicalPackage['devices']): TypicalPackage => ({
    id: `${E2}@9#${tag}`, sheetKey: E2, viewportId: `${E2}@9`, viewportLabel: '#9 POWER POLE LEGEND',
    host: `Pole ${tag}`, hostTag: tag, hostMarker: `hexagon tag ${tag}`, hostTargetKey: null, devices, quote: `POLE ${tag} WITH OUTLETS`, source: 'vision',
  });
  const two = pkg('3', [{ targetKey: 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE', text: 'duplex outlet', qty: 1 }]);
  it('hosts x per host; a duplex drawn at a host is subtracted (never counted twice)', () => {
    const k = hostKeyOf(two);
    const hosts = new Map([[k, { count: 2, sheets: ['E-2'], marks: [{ sheetKey: E2, x: 100, y: 100 }, { sheetKey: E2, x: 500, y: 500 }] }]]);
    const none = expandTypicals([two], hosts, []);
    expect(none.expansions[0]).toMatchObject({ hostCount: 2, perHost: 1, drawnAtHosts: 0, expanded: 2, status: 'expanded' });
    const drawn = expandTypicals([two], hosts, [{ sheetKey: E2, typeKey: 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE', x: 100 + HOST_RADIUS_PT - 1, y: 100 }]);
    expect(drawn.expansions[0]).toMatchObject({ drawnAtHosts: 1, expanded: 1 });
    const far = expandTypicals([two], hosts, [{ sheetKey: E2, typeKey: 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE', x: 100 + HOST_RADIUS_PT + 5, y: 100 }]);
    expect(far.expansions[0].expanded).toBe(2);
  });
  it('no host count = no expansion and the reason (a blocking review item downstream)', () => {
    const r = expandTypicals([two], new Map([[hostKeyOf(two), { count: null, sheets: [], marks: [], reason: 'the parts pod power pole markers could not be read' }]]), []);
    expect(r.expansions[0]).toMatchObject({ status: 'no_multiplier', expanded: 0, hostCount: null, reason: 'the parts pod power pole markers could not be read' });
    expect(expandTypicals([two], new Map(), []).expansions[0].status).toBe('no_multiplier');
  });
  it('an unmapped device is reported, never dropped', () => {
    const u = pkg('9', [{ targetKey: null, text: 'vacuum', qty: 2 }]);
    const r = expandTypicals([u], new Map([[hostKeyOf(u), { count: 3, sheets: [], marks: [] }]]), []);
    expect(r.expansions).toEqual([]);
    expect(r.unmapped).toEqual([{ packageId: u.id, host: 'Pole 9', text: 'vacuum', qty: 2, quote: 'POLE 9 WITH OUTLETS' }]);
  });
});
