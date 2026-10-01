// Gap-closing T2 — owner-furnished material → labor only; disputed furnish stays priced and flagged.
import { describe, it, expect } from 'vitest';
import { decideOwnerFurnished, furnishTermOfLine, furnishDecisionForLine } from './ownerFurnished';
import { resolveAccountTerms, type AccountRule } from '../bidstd/accountRules';
import { resolveLines, type BidLineRow } from './bidEstimate';
import { priceBid } from './pricing';
import { replayPricing } from '../eval/replayEval';
import { loadKissimmeeLive0930, load36th0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { scriptedAccountTerms, SCRIPTED_ACCOUNT_RULES } from '../test/fixtures/realrun/gapScripted';
import { textSheets0930 } from '../test/fixtures/realrun/feeders0930';
import type { Library } from './library';

const AZ = SCRIPTED_ACCOUNT_RULES.find(r => r.name === 'AutoZone')!;
const st = (item: string, furnishBy: string, quote: string, installBy = '') => ({ item, furnishBy, installBy, sourceSheet: 'E-1', quote });

describe('decideOwnerFurnished', () => {
  it('Kissimmee: lighting and panels labor only (every furnish source says AutoZone); disconnects and power poles disputed (fused only)', () => {
    const d = decideOwnerFurnished(scriptedAccountTerms('kissimmee', loadKissimmeeLive0930()));
    expect([d.lighting?.mode, d.panels?.mode, d.disconnects?.mode, d.power_poles?.mode]).toEqual(['labor_only', 'labor_only', 'disputed', 'disputed']);
    expect(d.disconnects?.fusedOnly).toBe(true);
    expect(d.panels?.evidence).toMatch(/^Owner-furnished — labor only: E-4 "PANEL A AUTOZONE PROVIDED"/);
    expect(d.power_poles?.evidence).toMatch(/GENERAL CONTRACTOR TO FURNISH ALL POWER POLES/);
  });
  it('review N3: when every source says Owner and the only statement names FUSED switches, labor-only applies to the fused switches only', () => {
    const rule = { ...AZ, terms: { disconnects: { mode: 'ask' } } } as AccountRule;
    const snap = resolveAccountTerms(rule, 'test', [st('Fused disconnect switches', 'Owner', '200A FUSED DISCONNECT SWITCHES FURNISHED BY OWNER')], false);
    const d = decideOwnerFurnished(snap).disconnects!;
    expect([d.mode, d.fusedOnly]).toEqual(['labor_only', true]);
    expect(furnishDecisionForLine({ [d.term]: d } as never, { category: 'Service & Distribution', description: '60A non-fused RTU disconnect' }, false)).toBeNull();
    expect(furnishDecisionForLine({ [d.term]: d } as never, { category: 'Service & Distribution', description: '200A fused switch NEMA 3R' }, false)).not.toBeNull();
  });
  it('the Default rule (36th): no effect', () => {
    expect(decideOwnerFurnished(scriptedAccountTerms('36th', load36th0930()))).toEqual({});
  });
  it('"by G.C." is APT scope: a GC-furnished statement never zeroes, and disputes an owner one', () => {
    const rule = { ...AZ, terms: { lighting: { mode: 'ask' } } } as AccountRule;
    const gcOnly = resolveAccountTerms(rule, 'test', [st('Light fixtures', '', 'LIGHT FIXTURES FURNISHED BY G.C.')], false);
    expect(decideOwnerFurnished(gcOnly)).toEqual({});
    const both = resolveAccountTerms(rule, 'test', [st('Light fixtures', '', 'LIGHT FIXTURES FURNISHED BY G.C.'), st('Light fixtures', 'Owner', 'LIGHT FIXTURES FURNISHED BY OWNER')], false);
    expect(decideOwnerFurnished(both).lighting?.mode).toBe('disputed');
  });
  it('the estimator\'s scope answer wins outright; an auto-deduct alternate covering the term is never zeroed', () => {
    const snap = scriptedAccountTerms('kissimmee', loadKissimmeeLive0930());
    expect(decideOwnerFurnished(snap, { estimatorTerms: [{ term: 'disconnects', furnishBy: 'APT', installBy: 'APT', source: 'estimator' }] }).disconnects).toBeUndefined();
    expect(decideOwnerFurnished(snap, { estimatorTerms: [{ term: 'power_poles', furnishBy: 'Owner', installBy: 'APT', source: 'estimator' }] }).power_poles?.mode).toBe('labor_only');
    expect(decideOwnerFurnished(snap, { autoDeductAlternate: { enabled: true, termKeys: ['lighting'], label: 'x' } }).lighting).toBeUndefined();
  });
  it('line matching: raceway / wire / feeder text never; a "panel" word alone is not a panelboard', () => {
    expect(furnishTermOfLine({ category: 'Service & Distribution', description: 'Feeder 4#3/0,#6G,2"C disconnect to panel' }, false)).toBeNull();
    expect(furnishTermOfLine({ category: 'Low Voltage', description: 'Thermostats #1 and #2 above panels', matchedName: 'Thermostat rough-in' }, false)).toBeNull();
    expect(furnishTermOfLine({ category: 'Service & Distribution', description: 'Panels A & B, 10kAIC', matchedName: 'Panelboard, 225A MLO, up to 42 circuits' }, false)).toBe('panels');
    expect(furnishTermOfLine({ category: 'Service & Distribution', description: '200A fused switch NEMA 3R', matchedName: '200A fusible safety switch w/ 3 fuses, installed (Chris BOM)' }, false)).toBe('disconnects');
  });
});

describe('resolveLines + priceBid with owner-furnished decisions', () => {
  const lib: Library = { factors: [], assemblies: [], items: [
    { id: 'pnl', code: 'PNL-225', name: 'Panelboard, 225A MLO, up to 42 circuits', category: 'Service & Distribution', unit: 'EA', material_cost: 1450, material_price_date: null, labor_hours: 8, aliases: [], source: 'seed', active: true },
  ] };
  const line = (over: Partial<BidLineRow> = {}) => ({ id: 'l1', line_key: 'l1', category: 'Service & Distribution', description: 'Panels A & B', qty: 2, unit: 'EA', item_id: 'pnl', assembly_id: null, material_unit_override: null, labor_hours_override: null, excluded: false, source: 'takeoff', sort: 0, ...over }) as BidLineRow;
  const NEUTRAL = { laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1 };
  const decisions = decideOwnerFurnished(scriptedAccountTerms('kissimmee', loadKissimmeeLive0930()));
  it('labor only: material $0, hours kept, the quote on the line, the warning counts the removed material', () => {
    const r = priceBid(resolveLines([line()], lib, { ownerFurnished: decisions }), NEUTRAL, []);
    expect([r.lines[0].materialExt, r.lines[0].hoursExt]).toEqual([0, 16]);
    expect(r.lines[0].furnishedBy?.evidence).toMatch(/PANEL A AUTOZONE PROVIDED/);
    expect(r.warnings.ownerFurnished).toEqual({ lineCount: 1, materialRemoved: 2900 });
  });
  it('an estimator\'s material override still wins', () => {
    const r = priceBid(resolveLines([line({ material_unit_override: 1000 })], lib, { ownerFurnished: decisions }), NEUTRAL, []);
    expect(r.lines[0].materialExt).toBe(2000);
    expect(r.warnings.ownerFurnished).toEqual({ lineCount: 1, materialRemoved: 0 });
  });
  it('without decisions (a submitted bid, or no account terms) nothing changes', () => {
    expect(priceBid(resolveLines([line()], lib, {}), NEUTRAL, []).lines[0].materialExt).toBe(2900);
  });
});

describe('Kissimmee replay', () => {
  it('SCRIPTED account terms remove the owner-furnished fixture / panel material; the submitted bid is untouched', async () => {
    const live = loadKissimmeeLive0930();
    const lib = loadLiveLibrary0930();
    const base = { rows: 'live' as const, stage: 'due', ignoreCostLineSeeds: true, feeders: { textSheets: textSheets0930() }, detail: true };
    const without = await replayPricing(live, lib, base);
    const withTerms = await replayPricing(live, lib, { ...base, accountTerms: scriptedAccountTerms('kissimmee', live) });
    expect(withTerms.hours).toBeCloseTo(without.hours, 6);
    expect(withTerms.ownerFurnished!.materialRemoved).toBeCloseTo(without.material - withTerms.material, 2);
    expect(withTerms.ownerFurnished!.materialRemoved).toBeGreaterThan(10000);
    const submitted = await replayPricing(live, lib, { rows: 'live', feeders: { textSheets: textSheets0930() }, accountTerms: scriptedAccountTerms('kissimmee', live) });
    expect(submitted.sellingPrice).toBe(42916.83);
  });
});
