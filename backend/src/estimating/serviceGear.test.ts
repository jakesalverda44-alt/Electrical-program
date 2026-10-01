// Gap-closing T5 / T9 / J6 / J7 — service gear held at $0 → Chris's units, by code.
import { describe, it, expect } from 'vitest';
import { decideServiceGear, feederLugRow, noteGroundingAllowances } from './serviceGear';
import { replayPricing } from '../eval/replayEval';
import { loadKissimmeeLive0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { replayKissimmee0930 } from '../test/fixtures/realrun/replay0930';
import { scriptedAnswersOptions } from '../test/fixtures/realrun/gapScripted';
import { isPdftoppmAvailable } from '../ai/documentPrep';

type R = { category: string; item: string; spec?: string; qty: number; unit: string; note?: string | null; evidence?: string | null; libraryCode?: string | null };
const row = (category: string, item: string, spec = '', qty = 1, unit = 'EA'): R => ({ category, item, spec, qty, unit });

describe('decideServiceGear (pure)', () => {
  it('Kissimmee rows: gutter, grounding lump, FRT plywood, 200A fused switches, meter socket, flush panels, DSXW1 wall packs', () => {
    const d = decideServiceGear([
      row('Service & Distribution', 'Wireway NEMA 3R 12x12', "Contractor provided, length as req'd"),
      row('Branch Power', 'WIREWAY — NEMA 3R 12x12 wireway (connection)', 'COUNT PENDING ESTIMATOR REVIEW', 0),
      row('Grounding', 'Grounding electrode system #2 CU', "Ground rod, building steel, water pipe, 20' Ufer", 1, 'LS'),
      row('Grounding', '#6 AWG telecom bonding jumper', 'Phone ground bus to MGB'),
      row('Low Voltage', '3/4" FRT plywood backboard', 'Entire wall, alarm/phone'),
      row('Service & Distribution', '200A fused switch NEMA 3R', '', 2),
      row('Service & Distribution', 'MB — Meter base NEMA 3R, parallel (2)4#3/0 2"C (connection)', '', 1),
      row('Service & Distribution', 'Panelboard 225A MLO 42ckt 208Y/120V flush', 'Panels A & B, 10kAIC', 2),
      row('Exterior Site Lighting', 'Type D — DSXW1 LED 10C 1000 40K T3M MVOLT wall pack', '', 5),
      row('Exterior Site Lighting', 'Type X — LED wall pack 150W', '', 3),
      row('Low Voltage', 'EAS dual surface wireway at storefront', '120V + LV', 1),
    ]);
    expect(d.map(r => (r as { libraryCode?: string }).libraryCode ?? r.note ?? null)).toEqual([
      'SVC-GUTTER', 'duplicate', 'GND-SVC', null, 'BKBD-FRT', 'ASM-SW200F', 'METER-SKT', 'PNL-225F', 'LTG-WM250', 'LTG-WM175', null,
    ]);
    expect([d[2].qty, d[2].unit]).toEqual([1, 'EA']);
    expect(d[5].qty).toBe(2); // the count is never changed here
  });
  it('a single ground rod (EA, any count) is never the grounding lump, and its count never changes', () => {
    const d = decideServiceGear([row('Grounding', '5/8" x 10\' copper-clad ground rod w/ exothermic connection', '', 2)]);
    expect([d[0].libraryCode ?? null, d[0].qty]).toEqual([null, 2]);
  });
  it('a surface-mount 225A panel stays the library PNL-225 (no code); a 0-qty row keeps 0', () => {
    const d = decideServiceGear([row('Service & Distribution', 'Panelboard 225A MLO surface', '', 2), row('Service & Distribution', '200A fused switch NEMA 3R', 'COUNT PENDING', 0)]);
    expect((d[0] as { libraryCode?: string }).libraryCode).toBeUndefined();
    expect(d[1].qty).toBe(0);
  });
  it('T9 (J14): the EC-installed Venstar data cable is a 0-length line quoting E-6, never a guessed length', () => {
    const st = [{ item: 'Lighting control panel, accessories, data concentrator, data cable', installBy: 'EC', sourceSheet: 'E-6', quote: 'THE ELECTRICAL CONTRACTOR WILL INSTALL LIGHTING CONTROL PANEL, ALL ACCESSORIES, DATA CONCENTRATOR AND DATA CABLE.' }];
    const d = decideServiceGear([row('Branch Power', 'LCP — Automatic lighting control panel (connection)', '', 0)], { furnishStatements: st });
    const cmp = d.find(r => /CMP #24/.test(r.item))!;
    expect([cmp.qty, cmp.unit, (cmp as { libraryCode?: string }).libraryCode]).toEqual([0, 'LF', 'LV-CMP244']);
    expect(cmp.evidence).toMatch(/^NEEDS FOOTAGE — E-6: "THE ELECTRICAL CONTRACTOR WILL INSTALL .*Chris carried 1,000 ft/);
    expect(decideServiceGear([row('Branch Power', 'LCP', '', 0)], { furnishStatements: [{ ...st[0], quote: 'CAT 5 DATA CABLE FOR CAMERAS BY EC' }] }).some(r => /CMP/.test(r.item))).toBe(false);
  });
  it('#6 lugs: 3 per priced feeder with a #6 ground; the Ufer allowance becomes a note once the grounding lump is priced', () => {
    const e = (id: string, g: boolean) => ({ id, kind: 'feeder', spec: { conductors: [{ size: '3/0', ground: false, count: 4 }, ...(g ? [{ size: '6', ground: true, count: 1 }] : [])] } });
    expect(feederLugRow([e('A', true), e('B', true), e('C', false)])?.qty).toBe(6);
    expect(feederLugRow([e('C', false)])).toBeNull();
    const ufer: R[] = [{ category: 'Site / Underground / Allowances', item: 'Concrete-encased electrode #2 CU', qty: 20, unit: 'LF' }];
    expect(noteGroundingAllowances(ufer, true)[0].note).toBe('duplicate');
    expect(noteGroundingAllowances(ufer, false)[0].note).toBeUndefined();
  });
});

describe('Kissimmee SCRIPTED answers (replay)', () => {
  it('service gear lands within ±20% of Chris (42.0 h); the 200A switches carry 3 fuses each; the meter is the 1.5 h socket', async (ctx) => {
    if (!(await isPdftoppmAvailable())) return ctx.skip();
    const live = loadKissimmeeLive0930();
    const r = await replayPricing(live, loadLiveLibrary0930(), scriptedAnswersOptions('kissimmee', live, (await replayKissimmee0930()).cr));
    expect(Math.abs(r.hoursByGroup['service gear'] - 42) / 42).toBeLessThanOrEqual(0.2);
    const sw = r.lineDetail!.find(l => /200A fused switch/.test(l.description))!;
    expect([sw.qty, sw.matched, Math.round(sw.hours * 100) / 100]).toEqual([2, '200A fusible safety switch w/ 3 fuses, installed (Chris BOM)', 6.8]);
    expect(sw.furnish).toBe('disputed:disconnects');
    expect(r.lineDetail!.find(l => /Meter base/.test(l.description))!.hours).toBe(1.5);
  });
});
