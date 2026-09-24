// Next round Part B, coordinator follow-up — the 7-Eleven auto deduct
// alternate. Pure: given a bid's priced lines and the account rule's
// autoDeductAlternate config, computes $X = material cost of the matched
// lines + their material markup (+ tax if the rule marks it taxable).
// Installation labor is NEVER deducted (Jake's instruction — "installation
// remains in APT scope").
import type { TermKey } from '../bidstd/accountRules';

export interface DeductLineInput {
  category: string;
  description: string;
  materialExt: number;
  excluded: boolean;
}

export interface AutoDeductConfig {
  termKeys: TermKey[];
  materialMarkupPct: number;
  /** Material tax %, applied only when the rule marks the deduct taxable. */
  materialTaxPct?: number;
  taxable?: boolean;
}

export interface AutoDeductResult {
  amount: number;
  matchedLineCount: number;
  matchedMaterial: number;
}

// Review round 2 / S16 — matched by DESCRIPTION, term by term, never by
// sweeping in a whole takeoff category: "Service & Distribution" also holds
// APT's own feeder wire and conduit (which stay in APT's scope), and
// "lighting" categories hold site/area lighting that isn't necessarily a
// Graybar-package fixture either way — the description is what actually
// says "this line IS a fixture/panel/switchgear/SPD/disconnect/receptacle".
const TERM_DESCRIPTION_MATCH: Partial<Record<TermKey, RegExp>> = {
  lighting: /\b(luminaires?|light(ing)?\s+fixtures?|wall\s*packs?|troffers?|high[\s-]?bays?|down\s*lights?|exit\s+signs?|emergency\s+(light|fixture)s?|flood\s*lights?|canopy\s+fixtures?)\b/i,
  panels: /\b(panel\s*boards?|panels?|load\s*centers?)\b(?!\s*schedule)/i,
  disconnects: /\b(disconnects?|safety\s+switch(es)?)\b/i,
  // Switchgear/SPD/receptacles have no dedicated term key — the 7-Eleven
  // rule carries them on `other_equipment` (migration 129's own note).
  other_equipment: /\b(switchgear|surge\s*protect(ive|or|ion)?\s*devices?|\bspd\b|receptacles?)\b/i,
};

// Never part of the Graybar package regardless of which term matched: raw
// raceway/wire/feeder text (APT's own scope, even inside a Service &
// Distribution or Lighting Controls category), lighting CONTROLS (sensors,
// photocells, contactors, time clocks — never the fixtures themselves), and
// a panel SCHEDULE reference (paperwork, not a physical panel).
const NEVER_DEDUCT_RE = /\b(conduit|raceway|\bwire\b|wiring|cables?|feeders?|thhn|thwn|\bemt\b|\bpvc\b|\brmc\b|\brigid\b|\bmc\b|\bfmc\b|\blfmc\b|liquidtight|occupancy\s+sensors?|photo\s*cells?|contactors?|time\s*clocks?|lighting\s+relays?|panel\s*schedules?)\b/i;

function toCents(n: number): number { return Math.round((n + Number.EPSILON) * 100); }
function fromCents(c: number): number { return c / 100; }
function roundMoney(n: number): number { return fromCents(toCents(n)); }

/** True when a priced line is one of the EXACT Graybar-package item types
 *  named by the config's term keys — never a whole category. The
 *  "Lighting Controls" category and any raceway/wire/feeder/controls text
 *  are excluded no matter which term would otherwise have matched. */
export function lineMatchesAutoDeduct(line: Pick<DeductLineInput, 'category' | 'description'>, termKeys: TermKey[]): boolean {
  if (line.category === 'Lighting Controls') return false;
  if (NEVER_DEDUCT_RE.test(line.description)) return false;
  return termKeys.some(key => TERM_DESCRIPTION_MATCH[key]?.test(line.description) ?? false);
}

/** amount = Σ material $ of matched, non-excluded lines, plus that sum's
 *  material markup %, plus tax % if the rule is taxable — installation
 *  labor is never part of any line passed in here (callers pass MATERIAL
 *  extension only, never a line's labor/directShare). */
export function computeAutoDeductAmount(lines: DeductLineInput[], config: AutoDeductConfig): AutoDeductResult {
  const matched = lines.filter(l => !l.excluded && lineMatchesAutoDeduct(l, config.termKeys));
  const matchedMaterial = roundMoney(matched.reduce((s, l) => s + (Number.isFinite(l.materialExt) ? l.materialExt : 0), 0));
  const markup = roundMoney(matchedMaterial * (config.materialMarkupPct / 100));
  const withMarkup = roundMoney(matchedMaterial + markup);
  const tax = config.taxable ? roundMoney(withMarkup * ((config.materialTaxPct ?? 0) / 100)) : 0;
  const amount = roundMoney(withMarkup + tax);
  return { amount: Number.isFinite(amount) && amount > 0 ? amount : 0, matchedLineCount: matched.length, matchedMaterial };
}

/** Fills the %AMOUNT% token in a rule's label with a formatted dollar amount. */
export function formatAutoDeductLabel(label: string, amount: number): string {
  const formatted = amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return label.replace('%AMOUNT%', formatted);
}
