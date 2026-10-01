// Level 2 learning, Task 9 — meanings (never the tag letter), the device
// class of every target in both 0930 exports (pinned), the visual hash and
// conflict clusters.
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { deviceClassOf, meaningOf, meaningMatches } from './meaning';
import { dhash64, hamming, clusterOf } from './visualHash';
import { buildCountTargets } from '../countTargets';
import { loadKissimmeeLive0930, load36th0930 } from '../../test/fixtures/realrun/live0930';

describe('deviceClassOf — every target of both 0930 exports (pinned)', () => {
  it('Kissimmee', () => {
    const t = buildCountTargets(loadKissimmeeLive0930().agent1 as Record<string, unknown>).targets;
    const got = Object.fromEntries(t.map(x => [x.key, deviceClassOf(x.description, x.category)]));
    expect(got).toMatchObject({
      A: 'fixture.strip', B: 'fixture.strip', C: 'fixture.strip', E: 'fixture.emergency', F: 'fixture.exit', K: 'fixture.exit', EXIT: 'fixture.exit',
      G: 'fixture.downlight', S1: 'fixture.pole', S2: 'fixture.pole', W1: 'fixture.wallpack', D: 'fixture.wallpack',
      GFCI: 'receptacle.gfci', 'WP GFI': 'receptacle.gfci', 'SIMPLEX RECEPTACLE': 'receptacle.simplex', 'QUADPLEX RECEPTACLE': 'receptacle.quad',
      'DUPLEX / FLOOR RECEPTACLE': 'receptacle.floor', 'DUPLEX RECEPTACLE IN SHALLOW 2X4 HANDY BOX': 'receptacle.duplex',
      'J-BOX': 'equipment.jbox', '200A FUSED SWITCH NEMA 3R': 'equipment.disconnect', 'HVAC DISCONNECT WITH UNIT': 'equipment.disconnect',
      T: 'equipment.thermostat', CF: 'equipment.fan', 'EXHAUST FAN RECESSED': 'equipment.fan', P: 'tag.powerpole', 'PP-1..6': 'tag.powerpole',
      M1: 'switch.occupancy', 'MOTION SENSOR': 'switch.occupancy',
    });
    // a pinned table of the full map
    expect(Object.values(got).filter(v => v === null).length).toBeGreaterThan(0);
  });
  it('36th Street', () => {
    const t = buildCountTargets(load36th0930().agent1 as Record<string, unknown>).targets;
    const got = Object.fromEntries(t.map(x => [x.key, deviceClassOf(x.description, x.category)]));
    expect(got).toMatchObject({
      A: 'fixture.troffer', B: 'fixture.troffer', D: 'fixture.downlight', G: 'fixture.downlight', E1: 'fixture.emergency', E3: 'fixture.exit',
      'DUPLEX RECEPTACLE': 'receptacle.duplex', GFI: 'receptacle.gfci', WP: 'receptacle.weatherproof', FOURPLEX: 'receptacle.quad',
      'FLOOR RECESSED RECEPTACLE W/ COVER': 'receptacle.floor', $: 'switch.single', $D: 'switch.dimmer', $3: 'switch.3way', $4: 'switch.4way', OS: 'switch.occupancy',
      J: 'equipment.jbox', DISCONNECT: 'equipment.disconnect', 'ELECTRICAL PANEL': 'equipment.panel', MOTOR: 'equipment.motor',
    });
  });
});

describe('meaningMatches', () => {
  const k = (description: string, category = 'interior_lighting') => meaningOf({ type: 'A', description, category });
  it('a tag letter alone never matches ("A" troffer vs "A" downlight)', () => {
    expect(meaningMatches(k('2x4 LED recessed troffer'), meaningOf({ type: 'A', description: '6" LED downlight', category: 'interior_lighting' }))).toBe(false);
  });
  it('a 2x4 troffer target (SCRIPTED Kissimmee-style; Kissimmee has none) vs 36th A "2x4 LED recessed troffer, Lithonia 2GTL4LP840" → match', () => {
    expect(meaningMatches(k('2x4 LED recessed troffer'), k('2x4 LED recessed troffer, Lithonia 2GTL4LP840'))).toBe(true);
  });
  it('a shared series token matches even with different wording; strict needs Jaccard 0.8 or the series', () => {
    expect(meaningMatches(k('Lithonia 2GTL4 troffer 2x4'), k('2x2 recessed troffer, Lithonia 2GTL4A12120LP840'), { strict: true })).toBe(true);
    expect(meaningMatches(k('2x4 recessed troffer, Lithonia'), k('2x4 LED recessed troffer, Lithonia'), { strict: true })).toBe(true);
    expect(meaningMatches(k('2x4 LED recessed troffer volumetric'), k('2x4 LED recessed troffer, Lithonia 2GTL4LP840'), { strict: true })).toBe(false);
    expect(meaningMatches(k('2x4 recessed troffer, center basket'), k('2x4 LED recessed troffer acrylic lens'), { strict: true })).toBe(false);
  });
  it('different category or device class never matches', () => {
    expect(meaningMatches(k('surface strip light 4ft'), meaningOf({ description: 'surface strip light 4ft', category: 'device' }))).toBe(false);
    expect(meaningMatches(meaningOf({ description: 'GFCI receptacle', category: 'device' }), meaningOf({ description: 'Duplex receptacle', category: 'device' }))).toBe(false);
  });
});

const glyph = async (svgBody: string): Promise<Buffer> => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><rect width="360" height="360" fill="white"/>${svgBody}</svg>`)).grayscale().png().toBuffer();
const DUPLEX = '<circle cx="180" cy="180" r="40" stroke="black" stroke-width="5" fill="none"/><line x1="160" y1="140" x2="160" y2="220" stroke="black" stroke-width="5"/><line x1="200" y1="140" x2="200" y2="220" stroke="black" stroke-width="5"/>';
const GFCI = '<path d="M140 220 L180 130 L220 220 Z" fill="black"/><rect x="120" y="225" width="120" height="12" fill="black"/>';

describe('visual hash', () => {
  it('stable under JPEG re-encode (Hamming ≤ 4); a duplex and a GFCI glyph differ', async () => {
    const d = await glyph(DUPLEX);
    const dj = await sharp(await sharp(d).jpeg({ quality: 60 }).toBuffer()).png().toBuffer();
    const g = await glyph(GFCI);
    expect(hamming(await dhash64(d), await dhash64(dj))).toBeLessThanOrEqual(4);
    expect(hamming(await dhash64(d), await dhash64(g))).toBeGreaterThan(10);
  });
  it('a cluster holding two meanings is conflicted; one meaning is not', () => {
    const c = clusterOf([
      { id: 'a', dhash: 0b1010n, deviceClass: 'tag.powerpole', meaningFp: 'power pole' },
      { id: 'b', dhash: 0b1011n, deviceClass: 'equipment.jbox', meaningFp: 'junction box' },
      { id: 'c', dhash: -1n, deviceClass: 'fixture.strip', meaningFp: 'strip' },
    ]);
    expect(c.get('a')!.conflicted).toBe(true);
    expect(c.get('a')!.ids.sort()).toEqual(['a', 'b']);
    expect(c.get('c')!.conflicted).toBe(false);
  });
});
