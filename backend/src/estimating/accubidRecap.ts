// Next round Part B, Task 2 — the Accubid-style recap. Pure: no I/O, no DB.
// Reproduces the arithmetic in Chris's real Accubid "Breakdown" exports
// (Final Price / Key Indicators pages) exactly, reverse-engineered against
// five real jobs (see accubidRecap.test.ts): Autozone Kissimmee, Gulf
// Simulator, James Co Seminole State, Bubble Down Remodel, 36th Street
// Warehouse, plus Orlando Clubhouse as a bonus check.
//
// The model, read straight off the breakdowns' own section order:
//
//   MaterialTax   = MaterialCost * materialTaxPct / 100
//   MaterialTotal = MaterialCost + MaterialTax
//   (same net+tax shape for Equipment, General Expenses, Subcontracts, and
//    each Quote line — a "Total" column always adds tax before markup, per
//    the 36th Street / Orlando quote lines: Total = net + tax + markup,
//    where markup = (net + tax) * markupPct / 100 — see QUOTE MARKUP below)
//
//   FieldLabor    = given directly, OR from computeFieldLaborCost() (crew)
//
//   PrimeCost     = MaterialTotal + FieldLabor + (Equipment net+tax)
//                 + (GeneralExpenses net+tax) + Σ(Subcontract net+tax)
//                 + Σ(Quote net+tax)
//
//   <Category>Overhead = <cat>OverheadPct/100 * (<cat> net+tax)     [only
//     Labor Overhead is ever nonzero in Chris's real jobs — Decision 5's
//     "38% on labor only" — but the report format carries a column for
//     every category, so this module does too, for a future job that uses
//     one]
//   TotalOverhead = Σ every category's overhead + adjustmentOverheadAmt
//   NetCost       = PrimeCost + TotalOverhead
//
//   MaterialMarkup   = materialMarkupPct/100 * (MaterialTotal + MaterialOH)
//   LaborMarkup      = laborMarkupPct/100    * (FieldLabor + LaborOH)
//   EquipmentMarkup  = equipmentMarkupPct/100 * (Equipment net+tax + EquipOH)
//   GeneralExpMarkup = geMarkupPct/100        * (GE net+tax + GeOH)
//   SubcontractMarkup= Σ subcontractMarkupPct/100 * (net+tax)
//   QuoteMarkup      = Σ (net+tax) * quote's own markupPct/100   [PER QUOTE —
//     Seminole/36th Street/Orlando all split Distribution vs Lighting quotes
//     at different %]
//   AdjustmentMarkup = adjustmentMarkupPct/100 * NetCost
//   TotalMarkup      = sum of all of the above
//
//   Subtotal      = NetCost + TotalMarkup
//   SalesMarkup   = salesMarkupPct/100 * Subtotal    ["*** CE Sales Mark Up"
//     on 36th Street / Orlando Clubhouse — 1% of NetCost+TotalMarkup, added
//     last, after every other markup]
//   SellingPrice  = Subtotal + SalesMarkup
//
// Money rounding: same convention as pricing.ts (this module's sibling) —
// every dollar figure is rounded to the nearest cent via integer-cent
// arithmetic the moment it's computed, and every subtotal is a SUM of
// already-rounded cents, never a round of a sum of unrounded fractions —
// this is what makes the reproduction match Chris's printed breakdowns to
// the cent (his report is built the same way).

// Fix-round-1-style EPSILON nudge (same as pricing.ts) — an exact half-cent
// binary-float artifact must round up, not down.
function toCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100);
}
function fromCents(c: number): number {
  return c / 100;
}
function roundMoney(n: number): number {
  return fromCents(toCents(n));
}
function pct(base: number, p: number): number {
  return roundMoney((base * p) / 100);
}

// ── Field labor from crew + hours (Decision B2) ─────────────────────────────

export type CrewRole = 'journeyman' | 'apprentice' | 'foreman';
export type Shift = 'day' | 'night';

export interface CrewMember {
  role: CrewRole;
  /** Head count for this role (can be fractional in principle; Chris's
   *  jobs use whole numbers — 1 journeyman + 2 apprentices, etc). */
  count: number;
  /** Base hourly rate BEFORE burden/fringe. */
  rate: number;
}

export interface CrewConfig {
  members: CrewMember[];
  /** Percent, e.g. 4 for Chris's standard 4%. */
  burdenPct: number;
  /** $/hr, e.g. 1.50. */
  fringePerHr: number;
  shift: Shift;
}

/** rate*(1+burden%) + fringe$/hr — Accubid's "Full Cost" column. */
export function fullCostPerHour(rate: number, burdenPct: number, fringePerHr: number): number {
  return roundMoney(rate * (1 + burdenPct / 100) + fringePerHr);
}

export interface FieldLaborResult {
  /** Total extended field labor cost — sum of each role's (hours * fullCost), each rounded to the cent before summing. */
  totalCost: number;
  byRole: Array<{ role: CrewRole; count: number; hours: number; fullCost: number; extended: number }>;
}

/** Splits totalHours across the crew by head-count share (Accubid's own
 *  "Crew" column ratio), rounds each role's hours to 3 decimals (matching
 *  the breakdown's own displayed precision), then extends at that role's
 *  full cost per hour.
 *
 *  KNOWN QUIRK (documented, not silently hidden) — Review round 2 / N11
 *  corrected this comment's earlier explanation: this function is off by
 *  1 (occasionally 2) cent(s) from Chris's real Extended Cost on several
 *  jobs — Kissimmee, Golf, 36th Street AND Orlando (the review found 36th
 *  Street at −$0.02 and Orlando at −$0.01) — including 36th Street's own
 *  EVEN 1:1 crew split. The earlier comment blamed "the crew ratio doesn't
 *  divide evenly," which can't be the real cause: an even split shouldn't
 *  lose any precision at all, yet still misses by a cent. The real
 *  explanation is that Accubid computes each role's TRUE hours by summing
 *  that role's share of every LINE ITEM's own hours (each carrying its own
 *  Field Labor Adj %), then extends cost from that unrounded, per-line-built
 *  figure — only ROUNDING to 3 decimals for the printed "Hours" column,
 *  after the cost extension already happened. This function only ever
 *  receives the job's single TOTAL hours figure (accubidBidData.ts sums it
 *  from every saved line, once), so it can only approximate a role's true
 *  hours by splitting that one total by the crew ratio — a real, inherent
 *  precision gap from not having each line's own role-split hours to work
 *  from, not a bug in the split/round/extend arithmetic itself. Seminole and
 *  Bubble Down happen to reproduce exactly (simpler jobs, apparently no
 *  per-line adjustment % that would create this gap); every other real job
 *  checked so far is off by a cent or two. The reproduction tests below
 *  allow a documented tolerance of <= $0.05 on jobs known to show this gap. */
export function computeFieldLaborCost(totalHours: number, crew: CrewConfig): FieldLaborResult {
  const totalCount = crew.members.reduce((s, m) => s + m.count, 0);
  const byRole: FieldLaborResult['byRole'] = [];
  let totalCents = 0;
  for (const m of crew.members) {
    const hoursRaw = totalCount > 0 ? (totalHours * m.count) / totalCount : 0;
    const hours = Math.round(hoursRaw * 1000) / 1000;
    const fullCost = fullCostPerHour(m.rate, crew.burdenPct, crew.fringePerHr);
    const extended = roundMoney(hours * fullCost);
    totalCents += toCents(extended);
    byRole.push({ role: m.role, count: m.count, hours, fullCost, extended });
  }
  return { totalCost: fromCents(totalCents), byRole };
}

// ── The recap ────────────────────────────────────────────────────────────────

export interface TaxedAmount {
  /** Net cost before tax. */
  amount: number;
  /** Percent, default 0. Ignored when taxAmount is given. */
  taxPct?: number;
  /** Review round 2 / N14 — an exact tax DOLLAR figure, for a net amount
   *  that's itself a SUM of several lines which may each carry a different
   *  tax rate (equipment/general-expense cost lines) — passing the true sum
   *  of each line's own tax here reproduces it to the cent. The alternative
   *  (accubidBidData.ts's old approach) blended every line's rate into one
   *  weighted-average %, rounded to 2 decimals, and re-derived tax from
   *  that — lossy whenever the lines don't all share one tax rate. Takes
   *  priority over taxPct when both are present. */
  taxAmount?: number;
}

export interface QuoteLine {
  description: string;
  amount: number;
  taxPct?: number;
  /** This quote's OWN markup % — Chris routinely splits Distribution vs
   *  Lighting quotes at different rates (18%/20%, 15%/10%, etc). */
  markupPct: number;
  status: 'firm' | 'budget_pending';
}

export interface AccubidRecapInput {
  material: TaxedAmount;
  /** Pre-computed field labor $ (from Chris's breakdown, or from
   *  computeFieldLaborCost for a bid this engine is pricing itself). */
  fieldLaborCost: number;
  equipment?: TaxedAmount;
  generalExpenses?: TaxedAmount;
  subcontracts?: Array<TaxedAmount & { markupPct?: number }>;
  quotes?: QuoteLine[];

  materialOverheadPct?: number;
  laborOverheadPct: number; // Decision 5 — the one that's always nonzero, 38% default
  equipmentOverheadPct?: number;
  generalExpensesOverheadPct?: number;
  subcontractOverheadPct?: number;
  quotesOverheadPct?: number;
  /** Flat $ — Accubid's "Adjustment Overhead" is a manual override, never a %-of-something in any real breakdown seen. */
  adjustmentOverheadAmt?: number;

  materialMarkupPct: number;
  laborMarkupPct: number;
  equipmentMarkupPct?: number;
  generalExpensesMarkupPct?: number;
  /** Percent of Net Cost — Chris's "Adjustment Markup". */
  adjustmentMarkupPct?: number;
  /** "*** CE Sales Mark Up" — percent of (Net Cost + Total Markup), applied last. */
  salesMarkupPct?: number;
}

export interface AccubidRecapResult {
  materialTotal: number;
  materialTax: number;
  fieldLaborCost: number;
  equipmentTotal: number;
  equipmentTax: number;
  generalExpensesTotal: number;
  generalExpensesTax: number;
  subcontractsTotal: number;
  subcontractsTax: number;
  quotesNetTotal: number;
  quotesTaxTotal: number;
  quotesMarkupTotal: number;
  /** Quote lines that block send — any status='budget_pending' (Chris's
   *  "hold until CES gets back"). */
  budgetPendingQuotes: QuoteLine[];
  primeCost: number;
  materialOverhead: number;
  laborOverhead: number;
  equipmentOverhead: number;
  generalExpensesOverhead: number;
  subcontractOverhead: number;
  quotesOverhead: number;
  totalOverhead: number;
  netCost: number;
  materialMarkup: number;
  laborMarkup: number;
  equipmentMarkup: number;
  generalExpensesMarkup: number;
  subcontractMarkup: number;
  adjustmentMarkup: number;
  totalMarkup: number;
  salesMarkup: number;
  sellingPrice: number;
  /** True when the proposal must not be sent — a budget-pending quote is outstanding. */
  blocksSend: boolean;
}

function taxedAmount(t: TaxedAmount | undefined): { net: number; tax: number; withTax: number } {
  const net = t?.amount ?? 0;
  const tax = t?.taxAmount != null ? roundMoney(t.taxAmount) : pct(net, t?.taxPct ?? 0);
  return { net, tax, withTax: roundMoney(net + tax) };
}

export function computeAccubidRecap(input: AccubidRecapInput): AccubidRecapResult {
  const material = taxedAmount(input.material);
  const equipment = taxedAmount(input.equipment);
  const generalExpenses = taxedAmount(input.generalExpenses);

  const subcontracts = (input.subcontracts ?? []).map(s => ({ ...taxedAmount(s), markupPct: s.markupPct ?? 0 }));
  const subcontractsNet = roundMoney(subcontracts.reduce((s, x) => s + x.net, 0));
  const subcontractsTax = roundMoney(subcontracts.reduce((s, x) => s + x.tax, 0));
  const subcontractsWithTax = roundMoney(subcontracts.reduce((s, x) => s + x.withTax, 0));
  const subcontractMarkup = roundMoney(subcontracts.reduce((s, x) => s + pct(x.withTax, x.markupPct), 0));

  const quotes = input.quotes ?? [];
  const quoteRows = quotes.map(q => {
    const t = taxedAmount(q);
    const markup = pct(t.withTax, q.markupPct);
    return { ...q, ...t, markup, total: roundMoney(t.withTax + markup) };
  });
  const quotesNetTotal = roundMoney(quoteRows.reduce((s, q) => s + q.net, 0));
  const quotesTaxTotal = roundMoney(quoteRows.reduce((s, q) => s + q.tax, 0));
  const quotesWithTaxTotal = roundMoney(quoteRows.reduce((s, q) => s + q.withTax, 0));
  const quotesMarkupTotal = roundMoney(quoteRows.reduce((s, q) => s + q.markup, 0));
  const budgetPendingQuotes = quotes.filter(q => q.status === 'budget_pending');

  const fieldLaborCost = roundMoney(input.fieldLaborCost);

  const primeCost = roundMoney(
    material.withTax + fieldLaborCost + equipment.withTax + generalExpenses.withTax + subcontractsWithTax + quotesWithTaxTotal
  );

  const materialOverhead = pct(material.withTax, input.materialOverheadPct ?? 0);
  const laborOverhead = pct(fieldLaborCost, input.laborOverheadPct);
  const equipmentOverhead = pct(equipment.withTax, input.equipmentOverheadPct ?? 0);
  const generalExpensesOverhead = pct(generalExpenses.withTax, input.generalExpensesOverheadPct ?? 0);
  const subcontractOverhead = pct(subcontractsWithTax, input.subcontractOverheadPct ?? 0);
  const quotesOverhead = pct(quotesWithTaxTotal, input.quotesOverheadPct ?? 0);
  const adjustmentOverheadAmt = roundMoney(input.adjustmentOverheadAmt ?? 0);
  const totalOverhead = roundMoney(
    materialOverhead + laborOverhead + equipmentOverhead + generalExpensesOverhead + subcontractOverhead + quotesOverhead + adjustmentOverheadAmt
  );

  const netCost = roundMoney(primeCost + totalOverhead);

  const materialMarkup = pct(material.withTax + materialOverhead, input.materialMarkupPct);
  const laborMarkup = pct(fieldLaborCost + laborOverhead, input.laborMarkupPct);
  const equipmentMarkup = pct(equipment.withTax + equipmentOverhead, input.equipmentMarkupPct ?? 0);
  const generalExpensesMarkup = pct(generalExpenses.withTax + generalExpensesOverhead, input.generalExpensesMarkupPct ?? 0);
  const adjustmentMarkup = pct(netCost, input.adjustmentMarkupPct ?? 0);
  const totalMarkup = roundMoney(
    materialMarkup + laborMarkup + equipmentMarkup + generalExpensesMarkup + subcontractMarkup + quotesMarkupTotal + adjustmentMarkup
  );

  const subtotal = roundMoney(netCost + totalMarkup);
  const salesMarkup = pct(subtotal, input.salesMarkupPct ?? 0);
  const sellingPrice = roundMoney(subtotal + salesMarkup);

  return {
    materialTotal: material.withTax, materialTax: material.tax,
    fieldLaborCost,
    equipmentTotal: equipment.withTax, equipmentTax: equipment.tax,
    generalExpensesTotal: generalExpenses.withTax, generalExpensesTax: generalExpenses.tax,
    subcontractsTotal: subcontractsWithTax, subcontractsTax,
    quotesNetTotal, quotesTaxTotal, quotesMarkupTotal, budgetPendingQuotes,
    primeCost,
    materialOverhead, laborOverhead, equipmentOverhead, generalExpensesOverhead, subcontractOverhead, quotesOverhead, totalOverhead,
    netCost,
    materialMarkup, laborMarkup, equipmentMarkup, generalExpensesMarkup, subcontractMarkup, adjustmentMarkup, totalMarkup,
    salesMarkup, sellingPrice,
    blocksSend: budgetPendingQuotes.length > 0,
  };
}

// ── Per-GC overhead default table (Decision 5 / B3 — "a per-GC OH default
// table at 38%") ─────────────────────────────────────────────────────────────

export const DEFAULT_LABOR_OVERHEAD_PCT = 38;
export const DEFAULT_MATERIAL_MARKUP_PCT = 20;
export const DEFAULT_LABOR_MARKUP_PCT = 20;
export const DEFAULT_QUOTE_MARKUP_PCT = 18;
export const DEFAULT_ADJUSTMENT_PCT = 0;
export const DEFAULT_BURDEN_PCT = 4;
export const DEFAULT_FRINGE_PER_HR = 1.5;
