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

// Term -> which takeoff categories / description patterns it covers, for
// matching a PRICED LINE to the term (est_bid_lines.category is always one
// of boilerplate.ts's TAKEOFF_CATEGORIES — see accubidImport.ts's
// classifyBomCategory for the same category set used elsewhere in Part B).
const TERM_CATEGORY_MATCH: Partial<Record<TermKey, (category: string, description: string) => boolean>> = {
  lighting: (category) => /lighting/i.test(category),
  panels: (category) => category === 'Service & Distribution',
  disconnects: (category) => category === 'Service & Distribution',
  // Switchgear/SPD have no dedicated category — they live in Service &
  // Distribution alongside panels/disconnects, so `other_equipment` on the
  // 7-Eleven rule already covers them via the same category match. A
  // Branch-Power receptacle line ALSO counts (7-Eleven's Graybar package
  // includes receptacles) but only the receptacle rows, never the whole
  // branch-power circuit — matched by description, not category, so
  // wiring/conduit in Branch Power is never swept in by mistake.
  other_equipment: (category, description) => category === 'Service & Distribution' || (category === 'Branch Power' && /receptacle/i.test(description)),
};

function toCents(n: number): number { return Math.round((n + Number.EPSILON) * 100); }
function fromCents(c: number): number { return c / 100; }
function roundMoney(n: number): number { return fromCents(toCents(n)); }

/** True when a priced line falls under one of the config's term keys. */
export function lineMatchesAutoDeduct(line: Pick<DeductLineInput, 'category' | 'description'>, termKeys: TermKey[]): boolean {
  return termKeys.some(key => TERM_CATEGORY_MATCH[key]?.(line.category, line.description) ?? false);
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
