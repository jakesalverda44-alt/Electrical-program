// Accuracy round F3 — the shared hours classifier, on Chris's real BOMs.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAccubidBom } from './accubidBom';
import { classifyBomRow, classifyCrmLine, groupOfText, racewaySizeIn, wireGaugeRank, sumHours, HOURS_GROUPS } from './hoursGroups';

const bom = (f: string) => parseAccubidBom(fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/accubid', f), 'utf8'));
/** Kissimmee's type G "Soffit" downlights (CRM line "Soffit" × 11 = BOM 5" recessed downlight × 11). */
const KISSIMMEE_EXTERIOR = [/5" Luminaire Recessed Downlight/];

describe('hoursGroups — sizes', () => {
  it('reads raceway trade sizes and wire gauges', () => {
    expect([racewaySizeIn('3/4" Conduit - EMT'), racewaySizeIn('1-1/4" EMT'), racewaySizeIn('2" Conduit - PVC 40'), racewaySizeIn('no size')]).toEqual([0.75, 1.25, 2, null]);
    expect([wireGaugeRank('#12 Black Wire'), wireGaugeRank('#6 Green'), wireGaugeRank('#3/0 Black'), wireGaugeRank('nothing')]).toEqual([-12, -6, 3, null]);
  });
});

describe('hoursGroups — Chris\'s BOMs (every hour lands in exactly one group)', () => {
  for (const f of ['kissimmee-bom.txt', '36th-street-bom.txt', 'north-port-bom.txt', 'orlando-clubhouse-bom.txt', 'rockledge-bom.txt']) {
    it(`${f}: groups and buckets sum to the BOM footer`, () => {
      const b = bom(f);
      const h = sumHours(b.rows, r => r.totalFieldLaborHours ?? 0, r => classifyBomRow(r));
      const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
      expect(h.total).toBeCloseTo(b.footerLaborHours ?? b.computedLaborHours, 1);
      expect(sum(h.byGroup)).toBeCloseTo(h.total, 1);
      expect(sum(h.byBucket)).toBeCloseTo(h.total, 1);
      for (const g of Object.keys(h.byGroup)) expect(HOURS_GROUPS).toContain(g);
    });
  }

  it('Kissimmee: the buckets the plan estimated (Branch Wiring ~405, Feeders ~79, Site ~44, Service ~42)', () => {
    const b = bom('kissimmee-bom.txt');
    const h = sumHours(b.rows, r => r.totalFieldLaborHours ?? 0, r => classifyBomRow(r, KISSIMMEE_EXTERIOR));
    expect(h.byBucket).toEqual({
      'Branch Wiring': 406.55, 'Interior Lighting': 111.85, 'Exterior / Site Lighting': 49.54, 'Branch Power': 50.23,
      'Service & Distribution': 42, Feeders: 79.62, 'Site / Underground': 44.56, 'Lighting Controls': 14.6,
    });
  });

  it('row rules: feeder-size raceway, small PVC is site, splices before wire, supports are hardware', () => {
    const g = (d: string) => classifyBomRow({ description: d }).group;
    expect(g('2" Conduit - PVC 40 10\' Lengths')).toBe('feeders');
    expect(g('1" Conduit - PVC 40 10\' Lengths')).toBe('site / underground');
    expect(g('2" Male Adapter - PVC Socket to Box')).toBe('feeders');
    expect(g('#12 to #6 Wire Connector Live Spring Twist-On - 600V')).toBe('splices');
    expect(g('#3/0 Black Wire THHN / T90 - Copper')).toBe('feeders');
    expect(g('#10 Black Wire THHN / T90 - Copper')).toBe('wire & MC');
    expect(g('3/4" Conduit Clip Screw-On to Metal Stud for 2-1/8" Deep Box')).toBe('hardware');
    expect(g('3/4" Coupling - EMT Set Screw Steel')).toBe('fittings');
    expect(g('C-Purlin Strap w/ #8 Wire or 1/4" Plain Rod Hanger')).toBe('hardware');
    expect(g('200A Safety Switch Heavy Duty Fusible 600V 3 Pole - NEMA 1')).toBe('service gear');
    expect(g('60A Safety Switch Heavy Duty Non-Fusible 600V 3 Pole - NEMA 3R')).toBe('equipment connections');
    expect(g('15A 120-277V Ivory Toggle Switch Single Pole - Commercial Grade')).toBe('devices');
    expect(g('20\' H x 4-1/2" Pole Round Straight - Steel')).toBe('fixtures');
  });

  it('CRM lines: the category decides the bucket, the text the group', () => {
    expect(classifyCrmLine({ category: 'Feeders (allowance)', description: '#3/0 THHN/THWN copper conductor' })).toEqual({ group: 'feeders', bucket: 'Feeders' });
    expect(classifyCrmLine({ category: 'Branch Wiring (allowance)', description: '3/4" EMT (incl. couplings/straps)' })).toEqual({ group: 'branch conduit', bucket: 'Branch Wiring' });
    expect(classifyCrmLine({ category: 'Boxes, Fittings & Hardware (allowance)', description: 'Wire connector allowance — twist-on splices (per point)' })).toEqual({ group: 'splices', bucket: 'Branch Wiring' });
    expect(classifyCrmLine({ category: 'Lighting Controls', description: 'Single pole switch' })).toEqual({ group: 'devices', bucket: 'Lighting Controls' });
    expect(classifyCrmLine({ category: 'Branch Power', description: 'HVAC disconnect with unit' }).group).toBe('equipment connections');
    expect(classifyCrmLine({ category: 'Exterior Site Lighting', description: 'site pole' })).toEqual({ group: 'fixtures', bucket: 'Exterior / Site Lighting' });
    expect(groupOfText('Existing to be removed — counted A3.0 56')).toBe('demolition');
  });
});
