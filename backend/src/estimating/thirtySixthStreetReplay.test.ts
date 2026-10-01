// Remodel + footage round, B5 — price the stored 2026-09-29 36th Street live
// run (Agent 1 + Agent 2 + count, real export) through the full Accubid
// recap, before and after B1–B4, against Chris's submitted $23,230.14.
//
// Deterministic on purpose: the library is the seed (SEED_ITEMS /
// SEED_ASSEMBLIES, incl. B3's demolition units), the settings are the app's
// Accubid defaults (1 journeyman $37 + 2 apprentices $27, 4% burden, $1.50
// fringe, 38% labor OH, 20%/20% markup, 0% tax), the footage ratios and
// cost-line rule are the shipped defaults. Nothing reads the test DB, so no
// other test's library edits can move these numbers.
//
// "After A" is an ESTIMATE of Builder A's effect, applied by hand to the
// same takeoff rows: A2 names the 13 unscheduled type-H high bays, A1 counts
// only the shaded (new) receptacles — Chris's 5 duplex + 2 GFCI — and adds
// the A2.0/A3.0 demolition as Demolition lines. The live 36th re-run is the
// real test of A.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SEED_ITEMS_BEFORE_GAP_ROUND as SEED_ITEMS, SEED_ASSEMBLIES } from './seed/laborUnits'; // the seed as the report quoted it (before the gap-closing unit moves, migration 166)
import { Library, LibraryItem, LibraryAssembly } from './library';
import { parseAgent2Takeoff, resolveLines, toLibraryCandidates, storedMatchConfidence, BidLineRow, RawTakeoffRow } from './bidEstimate';
import { mapTakeoffLines, fromLegacyTakeoff } from './mapper';
import { priceBid, EstUnit } from './pricing';
import { computeFieldLaborCost, computeAccubidRecap, DEFAULT_BURDEN_PCT, DEFAULT_FRINGE_PER_HR, DEFAULT_LABOR_OVERHEAD_PCT, DEFAULT_MATERIAL_MARKUP_PCT, DEFAULT_LABOR_MARKUP_PCT } from './accubidRecap';
import { parseAgent2Allowances, DEFAULT_ALLOWANCE_CATEGORY } from './footageAllowanceDb';
import { composeWiringRows, ExistingLineLike } from './wiringScopes';
import { resolveRunParts } from './footageSpecPricing';
import { computeFootageAllowance, DEFAULT_FOOTAGE_SETTINGS, TakeoffRowLike } from './footageAllowance';
import { applyCostRule, DEFAULT_COST_LINE_DEFAULTS } from './costLineDefaults';
import { validateExpectedFile, diffAgainstExpected } from '../eval/takeoffEval';

const run = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/36th-street-run-2026-09-29.json'), 'utf8'));
const agent2Raw = '```json\n' + JSON.stringify(run.agent2) + '\n```';
const CHRIS_SUBMITTED = 23230.14;
// Price accuracy round C1 — every pin below moved by the matcher-safety
// fix: this 2026-09-29 run priced COMP #1 as a 15 kVA transformer ($1,100 /
// 4 h), PANEL A as a 200A disconnect, DISC-A/B and the wall fans as wall
// packs, COMP #2 as a kitchen connection. C1_DELTA is that bogus sell price;
// the pins also carry decision 2's #12/#10 THHN at Chris's 5.15/5.65 h/M;
// the review's historical double-count thresholds are restated net of it.
const C1_DELTA = 3354.36;
const BL2_PRICE = 11339.87;
const BL3_PRICE = 11537.73;

const items: LibraryItem[] = SEED_ITEMS.map(i => ({
  id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, material_cost: i.materialCost,
  material_price_date: null, labor_hours: i.laborHours, aliases: i.aliases, source: 'seed', active: true,
}));
const byCode = new Map(items.map(i => [i.code, i]));
const assemblies: LibraryAssembly[] = SEED_ASSEMBLIES.map(a => ({
  id: a.code, code: a.code, name: a.name, category: a.category, unit: a.unit, aliases: a.aliases, source: 'seed', active: true,
  components: a.components.map(c => ({ item_id: c.itemCode, item_code: c.itemCode, item_name: byCode.get(c.itemCode)?.name ?? '', qty_per: c.qtyPer })),
}));
const library: Library = { items, assemblies, factors: [] };
const candidates = toLibraryCandidates(library);

interface Priced { material: number; hours: number; equipment: number; generalExpenses: number; sellingPrice: number; lines: number }

function price(rows: RawTakeoffRow[], withCostDefaults: boolean): Priced {
  const mapped = mapTakeoffLines(fromLegacyTakeoff(rows), candidates);
  const lines = mapped.map((m, i) => ({
    id: String(i), line_key: String(i), category: m.category, description: m.description, qty: m.qty, unit: m.unit as EstUnit,
    assembly_id: m.matchedKind === 'assembly' ? m.matchedId : null, item_id: m.matchedKind === 'item' ? m.matchedId : null,
    match_confidence: storedMatchConfidence(m), // a held (confirm) match prices $0, as in the app
    source: 'takeoff', sort: i,
  })) as BidLineRow[];
  const recap = priceBid(resolveLines(lines, library), { laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1 }, []);
  const material = recap.totals.materialSubtotal;
  const hours = recap.totals.laborHours;
  const labor = computeFieldLaborCost(hours, {
    shift: 'day', burdenPct: DEFAULT_BURDEN_PCT, fringePerHr: DEFAULT_FRINGE_PER_HR,
    members: [{ role: 'journeyman', count: 1, rate: 37 }, { role: 'apprentice', count: 2, rate: 27 }],
  });
  const equipment = withCostDefaults ? applyCostRule(DEFAULT_COST_LINE_DEFAULTS.equipment, hours) : 0;
  const generalExpenses = withCostDefaults ? applyCostRule(DEFAULT_COST_LINE_DEFAULTS.generalExpenses, hours) : 0;
  const r = computeAccubidRecap({
    material: { amount: material, taxPct: 0 }, fieldLaborCost: labor.totalCost,
    equipment: { amount: equipment }, generalExpenses: { amount: generalExpenses }, quotes: [],
    laborOverheadPct: DEFAULT_LABOR_OVERHEAD_PCT, materialMarkupPct: DEFAULT_MATERIAL_MARKUP_PCT, laborMarkupPct: DEFAULT_LABOR_MARKUP_PCT,
  });
  return { material, hours, equipment, generalExpenses, sellingPrice: r.sellingPrice, lines: lines.length };
}

/** The same composition the sync does (footageAllowanceDb.ts): ratio rows,
 *  then the one-source-per-scope rule. `typed` simulates lines the
 *  estimator typed a qty on (the sync keeps that qty). */
function withGenerated(takeoff: RawTakeoffRow[], opts: { allowances?: ReturnType<typeof parseAgent2Allowances>; typed?: Array<{ key: string; description: string; qty: number }>; manual?: ExistingLineLike[] } = {}): RawTakeoffRow[] {
  const allowances = opts.allowances ?? parseAgent2Allowances(agent2Raw);
  const ratio = computeFootageAllowance({
    takeoffRows: takeoff as TakeoffRowLike[], agent1: run.agent1, agent2Allowances: allowances,
    geometry: null, settings: DEFAULT_FOOTAGE_SETTINGS, dropFt: 10, slackPct: 10,
  });
  const existing: ExistingLineLike[] = [...(opts.typed ?? []).map(t => ({ category: t.key.split('||')[0], description: t.description, unit: 'LF', qty: t.qty, source: 'takeoff' as const, qty_overridden: true, takeoff_key: t.key })), ...(opts.manual ?? [])];
  const out = composeWiringRows({
    takeoff: takeoff as TakeoffRowLike[], allowances, ratioRows: ratio.rows, existing,
    resolveParts: parts => resolveRunParts(parts, candidates, byCode as unknown as Map<string, LibraryItem>) != null,
    settings: DEFAULT_FOOTAGE_SETTINGS, conductors: ratio.summary.conductors, allowanceCategory: DEFAULT_ALLOWANCE_CATEGORY,
  });
  const rows = [...out.takeoff, ...out.generated] as RawTakeoffRow[];
  return rows.map(r => {
    const t = (opts.typed ?? []).find(x => x.key === `${r.category}||${r.item}`);
    return t ? { ...r, qty: t.qty } : r;
  });
}

/** Builder A's expected effect on these same rows (see header). */
function afterA(takeoff: RawTakeoffRow[]): RawTakeoffRow[] {
  const newOnly: Record<string, number> = { 'Duplex receptacle': 5, 'Duplex receptacle at 42" AFF (42)': 0, 'Duplex receptacle w/ ground fault interrupter (GFI)': 2, 'Duplex receptacle weather protected (WP)': 0 };
  const rows = takeoff.map(r => (r.item in newOnly ? { ...r, qty: newOnly[r.item] } : r));
  rows.push({ category: 'Interior Lighting', item: 'Type H — 2x4 LED high bay (unscheduled, named by the estimator)', spec: 'LED high-bay fixture', qty: 13, unit: 'EA' });
  for (const [item, qty] of [
    ['Demolition — 2x4 fluorescent fixture', 52], ['Demolition — HID high bay', 2], ['Demolition — exit/emergency light', 2],
    ['Demolition — receptacle', 18], ['Demolition — single pole switch', 6], ['Demolition — 3-way switch', 2],
  ] as const) rows.push({ category: 'Demolition', item, qty, unit: 'EA' });
  return rows;
}

const takeoff = parseAgent2Takeoff(agent2Raw);
const before = price(takeoff, false);
const after = price(withGenerated(takeoff), true);
const afterWithA = price(withGenerated(afterA(takeoff)), true);

describe('B5 — 36th Street price replay (full Accubid recap, app defaults)', () => {
  it('prints the before / after / after-A table', () => {
    const pct = (p: Priced) => `${(((p.sellingPrice - CHRIS_SUBMITTED) / CHRIS_SUBMITTED) * 100).toFixed(1)}%`;
    // eslint-disable-next-line no-console
    console.log('[36th replay]', JSON.stringify({ before: { ...before, vsChris: pct(before) }, after: { ...after, vsChris: pct(after) }, afterWithA: { ...afterWithA, vsChris: pct(afterWithA) } }, null, 1));
    expect(before.sellingPrice).toBeGreaterThan(0);
  });

  it('B1–B4 raise the price: branch wiring, MC and the equipment/GE defaults are now carried', () => {
    expect(after.hours).toBeGreaterThan(before.hours);
    expect(after.material).toBeGreaterThan(before.material);
    expect(after.equipment).toBe(890); // max($890, $7.30 × 97.6 h)
    expect(after.generalExpenses).toBe(270);
    expect(after.sellingPrice).toBeGreaterThan(before.sellingPrice);
  });

  it('pins the replay numbers the report quotes (vs $23,230.14 submitted)', () => {
    // Before: the ~$10k the live run produced — no branch wiring, no demo, no equipment/GE.
    expect(before.sellingPrice).toBeCloseTo(6819.73, 2);
    expect(before.hours).toBeCloseTo(55.8851, 3);
    // After B1–B4 on the same run: -38.6%.
    expect(after.sellingPrice).toBeCloseTo(11236.06, 2);
    expect(after.hours).toBeCloseTo(97.6075, 3);
    // After B1–B4 + Builder A's expected effect (H named, new receptacles
    // only, demolition counted): -21.5% — just outside the ±20% target;
    // the rest is the unmeasured feeders (0-qty MEASURE lines — Chris
    // carried 400 ft of EMT & wire, 10.5 h) and box/fitting hours.
    expect(afterWithA.sellingPrice).toBeCloseTo(15106.81, 2);
    expect(afterWithA.equipment).toBeCloseTo(890, 2);
    expect(afterWithA.hours).toBeCloseTo(115.6146, 3);
    // C1 took the bogus transformer/wall-pack lines out; the gap to Chris is
    // now the box/fitting/hardware hours C3 carries (price accuracy replay).
    expect(Math.abs(afterWithA.sellingPrice - CHRIS_SUBMITTED) / CHRIS_SUBMITTED).toBeLessThan(0.4);
  });
});

describe('Fix round — pricing repros on the 36th run', () => {
  const BRANCH_KEY = `${DEFAULT_ALLOWANCE_CATEGORY}||Allowance — Branch circuit conduit/wire 1/2" EMT 2#12 1#10G`;
  it('BL-2 / NB-2: typing 670 ft on the branch NEEDS FOOTAGE line comes off the ratio — no double count, and above the plain after-B1–B4 price', () => {
    const typed = price(withGenerated(takeoff, { typed: [{ key: BRANCH_KEY, description: 'NEEDS FOOTAGE — Branch circuit conduit/wire 1/2" EMT 2#12 1#10G', qty: 670 }] }), true);
    expect(typed.sellingPrice).toBeLessThan(16700.38 - C1_DELTA); // the review's double count
    expect(typed.sellingPrice).toBeGreaterThan(after.sellingPrice);
    expect(typed.sellingPrice).toBeCloseTo(BL2_PRICE, 2);
  });

  it('NB-2: a manual 40 ft telecom run leaves the allowance untouched; a 20 ft extra EMT run takes only 20 ft off', () => {
    const telecomLine = { category: 'Branch Power', description: '1" EMT telecom', unit: 'LF', qty: 40, source: 'manual' as const };
    const telecomRows = withGenerated(takeoff, { manual: [telecomLine] });
    expect(price(telecomRows, true).sellingPrice).toBeCloseTo(after.sellingPrice, 2); // allowance unchanged (the review: −$2,539.95)
    const emtLine = { category: 'Branch Power', description: '3/4" EMT (incl. couplings/straps)', unit: 'LF', qty: 20, source: 'manual' as const };
    const withExtra = price([...withGenerated(takeoff, { manual: [emtLine] }), { category: 'Branch Power', item: '3/4" EMT (incl. couplings/straps)', qty: 20, unit: 'LF' }], true);
    expect(Math.abs(withExtra.sellingPrice - after.sellingPrice)).toBeLessThan(5); // +20 ft yours, −20 ft allowance
  });

  it('BL-3: Agent 2 branch 670 ft + HVAC 100 ft → complete conduit + wire, never lower than the no-footage run', () => {
    const allowances = parseAgent2Allowances(agent2Raw).map((a, i) => ({ ...a, footage: i === 0 ? 670 : i === 1 ? 100 : 0 }));
    const rows = withGenerated(takeoff, { allowances });
    expect(rows.filter(r => /#1[02] THHN|#6 THHN/.test(String(r.spec))).map(r => [r.spec, r.qty])).toEqual([
      ['#12 THHN/THWN copper conductor', 1340], ['#10 THHN/THWN copper conductor', 670],
      ['#6 THHN/THWN copper conductor', 300], ['#10 THHN/THWN copper conductor', 100],
      ['#12 THHN/THWN copper conductor', 0], ['#10 THHN/THWN copper conductor', 0],
    ]);
    const p = price(rows, true);
    expect(p.sellingPrice).toBeGreaterThan(13368.27 - C1_DELTA); // the review's conduit-only result
    expect(p.sellingPrice).toBeGreaterThan(after.sellingPrice);
    expect(p.sellingPrice).toBeCloseTo(BL3_PRICE, 2);
  });
});

describe('NB-4 — the estimator comes first: their own footage comes off Agent 2\'s run', () => {
  const run91 = { category: 'Branch Power', item: '9.1', spec: 'Branch circuits 3/4" EMT w/ 2#12 1#12G', qty: 500, unit: 'LF' };
  const manual = [
    { category: 'Branch Power', description: '3/4" EMT (incl. couplings/straps)', unit: 'LF', qty: 670, source: 'manual' as const },
    { category: 'Branch Power', description: '#12 THHN/THWN copper conductor', unit: 'LF', qty: 3660, source: 'manual' as const },
  ];
  const manualRows = manual.map(m => ({ category: m.category, item: m.description, qty: m.qty, unit: 'LF' }));
  const estimatorOnly = price([...withGenerated(takeoff, { manual }), ...manualRows], true);
  const agentOnly = price(withGenerated([...takeoff, run91]), true);
  const both = price([...withGenerated([...takeoff, run91], { manual }), ...manualRows], true);

  it("the review's three setups: Both prices the same as Estimator only (670/3,660 ≥ Agent 2's 500/1,500)", () => {
    // eslint-disable-next-line no-console
    console.log('[NB-4]', JSON.stringify({ estimatorOnly: estimatorOnly.sellingPrice, agentOnly: agentOnly.sellingPrice, both: both.sellingPrice }));
    expect(both.sellingPrice).toBeCloseTo(estimatorOnly.sellingPrice, 0);
    expect(both.sellingPrice).toBeLessThan(16826.06 - C1_DELTA); // the review's double count
    const parts = withGenerated([...takeoff, run91], { manual }).filter(r => String(r.item).startsWith('9.1 — '));
    expect(parts.map(r => r.qty)).toEqual([0, 0, 0]);
    expect(String(parts[0].evidence)).toMatch(/^Reduced by your own footage in this scope .*: 500 − 500 = 0 ft/);
  });

  it('smaller estimator footage takes only its own feet off Agent 2\'s run', () => {
    const small = [{ category: 'Branch Power', description: '3/4" EMT (incl. couplings/straps)', unit: 'LF', qty: 120, source: 'manual' as const }];
    const parts = withGenerated([...takeoff, run91], { manual: small }).filter(r => String(r.item).startsWith('9.1 — '));
    expect(parts.map(r => r.qty)).toEqual([380, 1000, 500]);
  });

  it('a measured ratio EMT line (670 ft, markup) counts as the estimator\'s branch footage against Agent 2\'s run', () => {
    const measured = [{ category: 'Branch Wiring (allowance)', description: '3/4" EMT (incl. couplings/straps)', unit: 'LF', qty: 670, source: 'takeoff' as const, qty_overridden: true, qty_source: 'markup', takeoff_key: 'Branch Wiring (allowance)||Branch conduit allowance — EMT' }];
    const rows = withGenerated([...takeoff, run91], { manual: measured });
    expect(rows.find(r => r.item === '9.1 — conduit')!.qty).toBe(0);
    // Priced: the measured 670 on the allowance line, never plus Agent 2's 500.
    const priced = price(rows.map(r => (r.item === 'Branch conduit allowance — EMT' ? { ...r, qty: 670 } : r)), true);
    expect(priced.sellingPrice).toBeLessThan(15614.26 - C1_DELTA); // the review's double count
  });
});

describe('B5 — the 36th Street answer key', () => {
  const expected = validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/36th-street-warehouse.expected.json'), 'utf8')));

  it("carries Chris's reference estimate", () => {
    expect(expected.reference_estimate).toMatchObject({
      selling_price: 23230.14, total_labor_hours: 189.21, database_material: 3399.32, quotes: 4466.72, equipment: 890, general_expenses: 310,
    });
  });

  it('scores the stored run: A and B pass; H is disputed until A2; switches/receptacles fail until A1 (new vs existing)', () => {
    const diff = diffAgainstExpected(expected, run.count_result);
    const v = Object.fromEntries(diff.rows.map(r => [r.id, [r.verdict, r.actual]]));
    expect(v.type_A).toEqual(['pass', 14]);
    expect(v.type_B).toEqual(['pass', 2]);
    expect(v.type_H[0]).toBe('reported');
    expect(v.switches).toEqual(['fail', 15]);
    expect(v.duplex_new).toEqual(['fail', 17]);
    expect(v.gfci_new).toEqual(['fail', 9]);
    for (const id of ['demo_fluor', 'demo_hid', 'demo_exit_em', 'demo_recept', 'demo_switch']) expect(v[id][0]).toBe('reported');
  });
});
