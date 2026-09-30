// Price accuracy round, C7 — the replay. The 36th Street live re-run
// (ab7e1dc6, 2026-09-29b, remodel mode on) plus Jake's H answer, priced
// through the full Accubid recap the way the app now prices it:
//   review answers → Agent 2 rows (C2) → footage allowance + one-source rule
//   → box / fitting / hardware allowance (C3) → mapper (C1: no cross-family
//   fuzzy, gear / expensive fuzzy held at $0) → priceBid → Accubid recap
//   with the app defaults and the default equipment / GE lines (C4 preview).
// Deterministic: the seed library, the shipped settings, no DB.
//
// "Before" is the same export through main a5ac9cd's pipeline (measured on
// a checkout of a5ac9cd with the same harness — see the C report): the
// matcher priced the Panel A circuit list as 17 × a 15 kVA transformer and
// COMP #1 as another, the answer never reached the estimate, no boxes /
// fittings / hardware.
//
// "After + D (expected)" hand-applies Builder D's expected effect to the
// same rows, as the B5 replay did for Builder A: the new receptacles only
// (Chris: 5 duplex + 2 GFCI), and the A2.0/A3.0 demolition read by
// comparison (Chris's counts: 52 fluorescent, 2 HID, 2 exit, 18 receptacles,
// 6 single-pole + 2 3-way switches).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SEED_ITEMS, SEED_ASSEMBLIES } from './seed/laborUnits';
import { Library, LibraryItem, LibraryAssembly } from './library';
import { parseAgent2Takeoff, resolveLines, toLibraryCandidates, storedMatchConfidence, pointHasBoxResolver, BidLineRow, RawTakeoffRow } from './bidEstimate';
import { mapTakeoffLines, fromLegacyTakeoff } from './mapper';
import { priceBid, EstUnit } from './pricing';
import { computeFieldLaborCost, computeAccubidRecap, DEFAULT_BURDEN_PCT, DEFAULT_FRINGE_PER_HR, DEFAULT_LABOR_OVERHEAD_PCT, DEFAULT_MATERIAL_MARKUP_PCT, DEFAULT_LABOR_MARKUP_PCT } from './accubidRecap';
import { parseAgent2Allowances, DEFAULT_ALLOWANCE_CATEGORY } from './footageAllowanceDb';
import { composeWiringRows } from './wiringScopes';
import { resolveRunParts } from './footageSpecPricing';
import { computeFootageAllowance, DEFAULT_FOOTAGE_SETTINGS, TakeoffRowLike } from './footageAllowance';
import { applyCostRule, DEFAULT_COST_LINE_DEFAULTS } from './costLineDefaults';
import { applyReviewAnswers } from './reviewAnswers';
import { computeBoxFittingRows, DEFAULT_BOX_FITTING_SETTINGS, BOX_FITTING_CATEGORY, BfRowLike } from './boxFittingAllowance';
import { bfGroupOf } from './boxFittingCalibration';

const run = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/price-accuracy/36th-street-run-2026-09-29b.json'), 'utf8'));
const agent2Raw = '```json\n' + JSON.stringify(run.agent2) + '\n```';
const CHRIS = { sellingPrice: 23230.14, hours: 189.21, databaseMaterial: 3399.32, quotes: 4466.72 };

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
const pointHasBox = pointHasBoxResolver(library, candidates);

export interface Replay {
  material: number; hours: number; equipment: number; generalExpenses: number; sellingPrice: number;
  groups: Record<string, number>; held: number; lines: number;
}

/** Hours by Chris's BOM groups, for the report. */
function groupOf(category: string, description: string, code: string | null): string {
  if (category === 'Demolition') return 'demolition';
  if (category === BOX_FITTING_CATEGORY && code === 'ALW-SPLICE') return 'wire & MC';
  if (category === BOX_FITTING_CATEGORY) return code === 'ALW-BOX' ? 'boxes & rings' : code?.startsWith('ALW-FIT') ? 'fittings' : 'hardware';
  if (/conductor|thhn|mc cable|\bwire\b/i.test(description) && !/conduit|emt/i.test(description)) return 'wire & MC';
  if (/\bemt\b|\bpvc\b|conduit/i.test(description)) return 'conduit';
  const g = bfGroupOf(description);
  if (g === 'box') return 'boxes & rings';
  if (/interior lighting|exterior/i.test(category)) return 'fixtures';
  return 'devices & other';
}

function price(takeoffRows: RawTakeoffRow[], opts: { box: boolean }): Replay {
  const allowances = parseAgent2Allowances(agent2Raw);
  const ratio = computeFootageAllowance({
    takeoffRows: takeoffRows as TakeoffRowLike[], agent1: run.agent1, agent2Allowances: allowances,
    geometry: null, settings: DEFAULT_FOOTAGE_SETTINGS, dropFt: 10, slackPct: 10,
  });
  const composed = composeWiringRows({
    takeoff: takeoffRows as TakeoffRowLike[], allowances, ratioRows: ratio.rows, existing: [],
    resolveParts: parts => resolveRunParts(parts, candidates, byCode as unknown as Map<string, LibraryItem>) != null,
    settings: DEFAULT_FOOTAGE_SETTINGS, conductors: ratio.summary.conductors, allowanceCategory: DEFAULT_ALLOWANCE_CATEGORY,
  });
  let rows = [...composed.takeoff, ...composed.generated] as RawTakeoffRow[];
  if (opts.box) {
    rows = [...rows, ...(computeBoxFittingRows({ rows: rows as BfRowLike[], existing: [], settings: DEFAULT_BOX_FITTING_SETTINGS, pointHasBox }).rows as RawTakeoffRow[])];
  }
  const mapped = mapTakeoffLines(fromLegacyTakeoff(rows), candidates);
  const lines = mapped.map((m, i) => ({
    id: String(i), line_key: String(i), category: m.category, description: m.description, qty: m.qty, unit: m.unit as EstUnit,
    assembly_id: m.matchedKind === 'assembly' ? m.matchedId : null, item_id: m.matchedKind === 'item' ? m.matchedId : null,
    match_confidence: storedMatchConfidence(m), match_source: m.matchedKind ? 'auto' : null,
    source: 'takeoff', sort: i,
  })) as BidLineRow[];
  const recap = priceBid(resolveLines(lines, library), { laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1 }, []);
  const groups: Record<string, number> = {};
  recap.lines.forEach((l, i) => {
    if (l.excluded) return;
    const g = groupOf(rows[i].category, `${rows[i].item} ${rows[i].spec ?? ''}`, mapped[i].matchedCode);
    groups[g] = (groups[g] ?? 0) + l.hoursExt;
  });
  const material = recap.totals.materialSubtotal;
  const hours = recap.totals.laborHours;
  const labor = computeFieldLaborCost(hours, {
    shift: 'day', burdenPct: DEFAULT_BURDEN_PCT, fringePerHr: DEFAULT_FRINGE_PER_HR,
    members: [{ role: 'journeyman', count: 1, rate: 37 }, { role: 'apprentice', count: 2, rate: 27 }],
  });
  const equipment = applyCostRule(DEFAULT_COST_LINE_DEFAULTS.equipment, hours);
  const generalExpenses = applyCostRule(DEFAULT_COST_LINE_DEFAULTS.generalExpenses, hours);
  const r = computeAccubidRecap({
    material: { amount: material, taxPct: 0 }, fieldLaborCost: labor.totalCost,
    equipment: { amount: equipment }, generalExpenses: { amount: generalExpenses }, quotes: [],
    laborOverheadPct: DEFAULT_LABOR_OVERHEAD_PCT, materialMarkupPct: DEFAULT_MATERIAL_MARKUP_PCT, laborMarkupPct: DEFAULT_LABOR_MARKUP_PCT,
  });
  for (const k of Object.keys(groups)) groups[k] = Math.round(groups[k] * 10) / 10;
  return { material, hours, equipment, generalExpenses, sellingPrice: r.sellingPrice, groups, held: recap.warnings.confirmMatchCount, lines: lines.length };
}

/** Builder D's expected effect (see header). */
function withD(rows: RawTakeoffRow[]): RawTakeoffRow[] {
  const out = rows.map(r => {
    if (r.item === 'Duplex receptacle') return { ...r, qty: 5 };
    if (r.item === 'WP GFCI receptacle exterior at condensers') return { ...r, qty: 2 };
    if (r.countType === 'DEMO-FIXTURE') return { ...r, qty: 52 };
    if (r.countType === 'DEMO-EXIT') return { ...r, qty: 2 };
    if (r.countType === 'DEMO-RECEPTACLE') return { ...r, qty: 18 };
    if (r.countType === 'DEMO-SWITCH') return { ...r, qty: 6 };
    return r;
  });
  out.push({ category: 'Demolition', item: 'Demolition — HID high bay fixture', qty: 2, unit: 'EA' });
  out.push({ category: 'Demolition', item: 'Demolition — 3-way switch', qty: 2, unit: 'EA' });
  return out;
}

const agent2Rows = parseAgent2Takeoff(agent2Raw);
const answered = applyReviewAnswers(agent2Rows, run.count_result, run.review_items).rows;
const after = price(answered, { box: true });
const afterNoH = price(agent2Rows, { box: true });
const afterWithD = price(withD(answered), { box: true });
const pct = (a: number, b: number) => `${(((a - b) / b) * 100).toFixed(1)}%`;

describe('C7 — the 36th Street replay (2026-09-29b export + Jake\'s H answer)', () => {
  it('prints the table the report quotes', () => {
    const show = (p: Replay) => ({
      material: Math.round(p.material), hours: +p.hours.toFixed(1), equipment: p.equipment, ge: p.generalExpenses, sellingPrice: p.sellingPrice,
      vsChrisPrice: pct(p.sellingPrice, CHRIS.sellingPrice), vsChrisHours: pct(p.hours, CHRIS.hours),
      vsChrisMaterialPlusQuotes: pct(p.material, CHRIS.databaseMaterial + CHRIS.quotes), held: p.held, groups: p.groups,
    });
    // eslint-disable-next-line no-console
    console.log('[C7 replay]', JSON.stringify({ afterNoH: show(afterNoH), after: show(after), afterWithD: show(afterWithD) }, null, 1));
    expect(after.sellingPrice).toBeGreaterThan(0);
  });

  it("the answer reaches the estimate: 13 × 1.0 h high bays", () => {
    expect(after.hours - afterNoH.hours).toBeGreaterThan(13);
  });

  it('no transformer, no circuit list, no wall-pack disconnect priced; the held meter is $0', () => {
    expect(after.groups['devices & other']).toBeLessThan(20);
  });

  it('pins the replay numbers the report quotes', () => {
    expect(after.sellingPrice).toBeCloseTo(PIN.after.sellingPrice, 2);
    expect(after.hours).toBeCloseTo(PIN.after.hours, 1);
    expect(after.material).toBeCloseTo(PIN.after.material, 2);
    expect(afterWithD.sellingPrice).toBeCloseTo(PIN.afterWithD.sellingPrice, 2);
    expect(afterWithD.hours).toBeCloseTo(PIN.afterWithD.hours, 1);
  });

  it('hours land within ±15% of Chris with D\'s expected effect (160.0 h alone is −15.4%)', () => {
    expect(Math.abs(afterWithD.hours - CHRIS.hours) / CHRIS.hours).toBeLessThan(0.15);
    expect(Math.abs(after.hours - CHRIS.hours) / CHRIS.hours).toBeLessThan(0.16);
  });
});

const PIN = {
  after: { sellingPrice: 17471.9, hours: 160.0, material: 6063.38 },
  afterWithD: { sellingPrice: 17803.22, hours: 163.8 },
};

// Measured with this same harness on a checkout of main a5ac9cd (no review
// answers, the old matcher, no box / fitting / hardware / splice lines):
//   before:      $37,829.30 · 152.8 h · material $23,401 — of it $18,700 +
//                68 h the circuit list as 17 transformers and $1,100 + 4 h
//                COMP #1 as another; "devices & other" 83.4 h
//   before + D:  $37,958.83 · 153.8 h
// (the sidebar showed $39,026: the Phase A engine on the same lines.)
export const BEFORE = { sellingPrice: 37829.3, hours: 152.8037, material: 23401.32 };
