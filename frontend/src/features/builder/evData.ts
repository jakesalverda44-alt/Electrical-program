import { CustomItem } from './genData';

// Tesla Wall Connector installs. The customer buys the charger from Tesla themselves, so
// APT sells the installation alone and the price turns on one variable: the distance from
// the breaker panel feeding the circuit to the charger location.
//
// Prices match APT's public estimator at accuratepowerandtechnology.com/TeslaCharger.asp —
// change them here and the builder, the proposal and the breakdown all follow.

export const EV_PRICES = {
  le5: 675,
  f6to15: 993,
  f16to25: 1275,
  panelUpgrade: 2200,
  /** Flat sales tax, in dollars — see the note on EvForm.taxAmount. */
  tax: 50,
} as const;

export type EvDistanceTier = 'le5' | 'f6to15' | 'f16to25';

export const EV_TIERS: { key: EvDistanceTier; label: string; short: string }[] = [
  { key: 'le5',     label: '5 feet or less', short: '≤ 5 ft' },
  { key: 'f6to15',  label: '6 to 15 feet',   short: '6–15 ft' },
  { key: 'f16to25', label: '16 to 25 feet',  short: '16–25 ft' },
];

export function evTierPrice(tier: EvDistanceTier): number {
  return EV_PRICES[tier] ?? 0;
}

/** The install price actually charged: a hand-typed override when the rep set one,
 *  otherwise the tier's standard price. Mirrors getGenPrice/genPriceOverride on the
 *  generator side. A non-finite override (empty field, NaN) falls back to the tier. */
export function evInstallPrice(tier: EvDistanceTier, override?: number | null): number {
  if (override !== null && override !== undefined && Number.isFinite(Number(override))) {
    return Number(override);
  }
  return evTierPrice(tier);
}

export function evTierLabel(tier: EvDistanceTier): string {
  return EV_TIERS.find(t => t.key === tier)?.label ?? '';
}

export interface EvForm {
  // Customer block — same field names as GenForm so the shared proposal chrome and the
  // customer autofill work unchanged. There is deliberately no taxRate: EV tax is a flat
  // amount, so the address→FL-rate derivation the generator form runs doesn't apply.
  customer: string;
  attn: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;

  /** Exactly one tier is charged — the run from the feeding panel to the charger. */
  distanceTier: EvDistanceTier;
  /** Hand-typed install price. Null uses the tier's standard price. Cleared whenever the
   *  tier changes, so switching tiers can't silently keep the old tier's number. */
  tierPriceOverride: number | null;
  /** Service upgrade to 200A. Rare, and charged flat when it comes up. */
  panelUpgrade: boolean;

  /** Runs past 25 ft and the occasional second charger are quoted here: the estimator
   *  publishes no price beyond 25 ft, and inventing one would put a number on a customer's
   *  proposal that APT never set. */
  customItems: CustomItem[];

  discount: number;
  discountType: '%' | '$';
  /** Flat dollar sales tax, NOT a rate. An EV quote's tax is a passthrough of tax paid on
   *  materials — roughly $50 — rather than a percentage of the contract, so deriving it
   *  from a rate would drift from what APT actually charges. */
  taxAmount: number;
  notes: string;
  includeBreakdown: boolean;
  validDays: number;
  /** Defaults to 0: a job around $1,000 doesn't usually take a deposit. */
  depositPct: number;
}
