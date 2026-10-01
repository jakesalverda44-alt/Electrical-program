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
  it('review S1: a contactor ENCLOSURE row is never LC-CONTACTOR (the Kissimmee "Semi-recessed, circuit B-25" line)', () => {
    const encl = row('Lighting Controls', 'Lighting contactor enclosure (6 contactors)', 'Semi-recessed, circuit B-25', 1);
    const counted = row('Lighting Controls', 'Lighting contactors (Work, Sales, Sign x2, Site x2)', '', 6);
    const d = decideServiceGear([encl, counted]);
    expect([d[0].note, (d[0] as { libraryCode?: string }).libraryCode ?? null]).toEqual(['duplicate', null]);
    expect(d[1].note ?? null).toBeNull();
    const alone = decideServiceGear([encl])[0] as { holdReason?: string; libraryCode?: string };
    expect([alone.holdReason, alone.libraryCode ?? null]).toEqual(['confirm_match', null]);
  });
  it('review S2: a non-service wireway is never a duplicate of the service gutter (dimensions alone do not make it service)', () => {
    const d = decideServiceGear([
      row('Lighting Controls', 'Lighting control wireway 4x4', '', 1),
      row('Service & Distribution', 'Wireway NEMA 3R 12x12', "Contractor provided, length as req'd"),
    ]);
    expect(d[0].note ?? null).toBeNull();
    expect((d[0] as { libraryCode?: string }).libraryCode ?? null).toBeNull();
    expect((d[1] as { libraryCode?: string }).libraryCode).toBe('SVC-GUTTER');
    // a bare "Wireway 12x12" is left to the mapper too
    expect(decideServiceGear([row('Branch Power', 'Wireway 12x12', '', 1), row('Service & Distribution', 'Wireway NEMA 3R 12x12', '', 3)])[0].note ?? null).toBeNull();
  });
  it('review S3: transformer / separately-derived grounding is never the service grounding lump', () => {
    for (const item of ['Ground transformer T1 to building steel and cold water pipe', 'Transformer grounding \u2014 building steel & water pipe bond']) {
      const d = decideServiceGear([row('Grounding', item, '', 1)])[0] as { libraryCode?: string };
      expect(d.libraryCode ?? null, item).toBeNull();
    }
    // the service's own electrode system still is the lump, even when a transformer is mentioned with "service"
    expect((decideServiceGear([row('Grounding', 'Service grounding electrode system', 'Ground rod, building steel, water pipe', 1, 'LS')])[0] as { libraryCode?: string }).libraryCode).toBe('GND-SVC');
  });
  it('review N2: "surface (not flush)" and an existing panel are not the flush panel', () => {
    for (const item of ['Panelboard 225A MLO surface (not flush)', 'Panel B 225A MLO flush, existing to remain']) {
      expect((decideServiceGear([row('Service & Distribution', item, '', 1)])[0] as { libraryCode?: string }).libraryCode ?? null, item).toBeNull();
    }
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

describe('T9 — controls', () => {
  it('36th: the TIMER row (SCRIPTED count 1) maps to the 24-hour time switch (LC-TIMESW, 1.65 h, migration 157)', async () => {
    const { load36th0930 } = await import('../test/fixtures/realrun/live0930');
    const live = load36th0930();
    const r = await replayPricing(live, loadLiveLibrary0930(), { ...scriptedAnswersOptions('36th', live, live.countResult), rows: 'live' });
    const t = r.lineDetail!.find(l => /Leviton VP24|TIMER/i.test(l.description))!;
    expect([t.qty, t.matched, t.hours]).toEqual([1, 'Time switch, 24-hour', 1.65]);
  });
  it('Kissimmee: the Venstar data cable line quotes E-6 and stays at 0 until a length is typed', async () => {
    const live = loadKissimmeeLive0930();
    const r = await replayPricing(live, loadLiveLibrary0930(), { rows: 'live', stage: 'due', ignoreCostLineSeeds: true, detail: true, feeders: { textSheets: [] } });
    const cmp = r.lineDetail!.find(l => /CMP #24/.test(l.description))!;
    expect([cmp.qty, cmp.hours, cmp.matched]).toEqual([0, 0, 'Communication & control cable, CMP #24 4-pair (Chris BOM)']);
  });
});

describe('contactor rows (Kissimmee live 2026-09-30) -> LC-CONTACTOR by code, never the relay panel', () => {
  it('the real "Lighting contactors" x6 row maps to LC-CONTACTOR once decided; the enclosure row stays a duplicate note', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { toLibraryCandidates, parseAgent2Takeoff, mapRawTakeoffRows } = await import('./bidEstimate');
    const R = path.join(__dirname, '../test/fixtures/realrun');
    const live = JSON.parse(fs.readFileSync(path.join(R, 'live-library-2026-09-30.json'), 'utf8'));
    const run = JSON.parse(fs.readFileSync(path.join(R, 'kissimmee-live-2026-09-30.json'), 'utf8'));
    const rows = parseAgent2Takeoff('```json\n' + JSON.stringify(run.agent2) + '\n```');
    const decided = decideServiceGear(rows as never[]) as typeof rows;
    // the post-gap library (migrations 165-167 applied): LC-CONTACTOR is Chris's $133.33 / 1.0 h per contactor
    const { applyGapMigrations } = await import('../eval/gapMigrations');
    const post = applyGapMigrations({ items: live.library.items ?? live.library, assemblies: live.library.assemblies ?? [], factors: [] } as never).library;
    const cands = toLibraryCandidates(post);
    const idx = decided.findIndex(r => /^Lighting contactors \(/i.test(r.item));
    expect(decided[idx].qty).toBe(6);
    expect(decided[idx].libraryCode).toBe('LC-CONTACTOR');
    const mapped = mapRawTakeoffRows(decided, cands);
    expect(mapped[idx].matchedCode).toBe('LC-CONTACTOR');
    expect(mapped[idx].confirmReason).toBeNull();
    const unit = post.items.find(i => i.code === 'LC-CONTACTOR')!;
    expect(6 * unit.material_cost).toBeCloseTo(800, 1); // $133.33 x 6 = $799.98 (Chris's $800 lump)
    expect(6 * unit.labor_hours).toBeCloseTo(6, 6);
    const enc = decided.find(r => /contactor enclosure/i.test(r.item))!;
    expect(enc.note).toBe('duplicate');
    // a bid that is not being estimated never runs decideServiceGear (priced:false) — unchanged by design.
  });
});

describe('contactor rule is narrow: rows that merely mention contactors are not LC-CONTACTOR', () => {
  const row = (item: string, category = 'Lighting Controls') => ({ category, item, spec: '', qty: 2, unit: 'EA' });
  it.each([
    'Time clock controlling lighting contactors',
    'Photocell for exterior lighting contactor',
    'HOA switch for lighting contactor',
    'Contactor control wiring',
    'Motor starter / contactor for EF-1',
  ])('%s', item => {
    const [out] = decideServiceGear([row(item, /EF-1/.test(item) ? 'Mechanical controls' : 'Lighting Controls')] as never[]) as Array<{ libraryCode?: string }>;
    expect(out.libraryCode).toBeUndefined();
  });
  it('a plain contactors row is still coded', () => {
    expect((decideServiceGear([row('Lighting contactors (Work, Sales)')] as never[]) as Array<{ libraryCode?: string }>)[0].libraryCode).toBe('LC-CONTACTOR');
  });
});
