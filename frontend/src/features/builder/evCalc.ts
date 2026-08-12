import { EV_PRICES, EvForm, EvDistanceTier, evInstallPrice, evTierLabel } from './evData';
import { activeCustomItems, customItemAmount } from './genCalc';

interface EvDefaultOverrides {
  ev_default_tax?: string;
  ev_default_valid_days?: string;
  ev_default_deposit_pct?: string;
}

export function blankEvForm(overrides?: EvDefaultOverrides): EvForm {
  return {
    customer: '', attn: '', address: '', city: '', state: 'FL', zip: '', phone: '', email: '',
    distanceTier: 'f6to15',
    tierPriceOverride: null,
    panelUpgrade: false,
    customItems: [],
    discount: 0, discountType: '$',
    taxAmount: Number(overrides?.ev_default_tax) || EV_PRICES.tax,
    notes: '',
    includeBreakdown: false,
    validDays: Number(overrides?.ev_default_valid_days) || 30,
    // Number() on '0' is 0, which || would replace with 0 anyway — but written explicitly
    // so a deliberate 0% deposit default reads as intended rather than as a fallback.
    depositPct: Number(overrides?.ev_default_deposit_pct) || 0,
  };
}

/** Fills in anything a proposal saved by an older build of the form is missing, the way
 *  migrateGenForm does for generators. EV quotes are new, so this exists to keep the
 *  reopen path safe as the form grows rather than to fix shapes already in the wild. */
export function migrateEvForm(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  if (!Array.isArray(out.customItems)) out.customItems = [];
  if (out.distanceTier === undefined) out.distanceTier = 'f6to15';
  if (out.tierPriceOverride === undefined) out.tierPriceOverride = null;
  if (out.panelUpgrade === undefined) out.panelUpgrade = false;
  if (out.taxAmount === undefined) out.taxAmount = EV_PRICES.tax;
  if (out.depositPct === undefined) out.depositPct = 0;
  if (out.validDays === undefined) out.validDays = 30;
  return out;
}

export interface EvTotals {
  tierAmt: number;
  panelUpgradeAmt: number;
  customTotal: number;
  subtotal: number;
  discountAmt: number;
  netSubtotal: number;
  tax: number;
  total: number;
  deposit: number;
}

export function calcEvTotals(e: EvForm): EvTotals {
  const tierAmt = evInstallPrice(e.distanceTier as EvDistanceTier, e.tierPriceOverride);
  const panelUpgradeAmt = e.panelUpgrade ? EV_PRICES.panelUpgrade : 0;
  // Custom items share the generator helpers: a row with no description contributes
  // nothing, and a non-finite amount reads as 0.
  const customTotal = activeCustomItems(e).reduce((sum, it) => sum + customItemAmount(it), 0);

  const subtotal = tierAmt + panelUpgradeAmt + customTotal;
  const discountAmt = e.discountType === '%'
    ? Math.round(subtotal * ((Number(e.discount) || 0) / 100))
    : (Number(e.discount) || 0);
  const netSubtotal = subtotal - discountAmt;

  // Flat, never derived. There is no taxable/non-taxable split here as there is on a
  // generator quote: the customer already bought the only piece of equipment, so what's
  // left is a passthrough of the tax APT paid on materials.
  const taxRaw = Number(e.taxAmount);
  const tax = Number.isFinite(taxRaw) ? taxRaw : 0;

  const total = netSubtotal + tax;
  const deposit = Math.round(total * ((Number(e.depositPct) || 0) / 100));

  return { tierAmt, panelUpgradeAmt, customTotal, subtotal, discountAmt, netSubtotal, tax, total, deposit };
}

export function evPriceRows(e: EvForm, t: EvTotals, fmt: (n: number) => string) {
  const rows: { label: string; amount: string }[] = [];
  rows.push({ label: `Wall Connector Installation — ${evTierLabel(e.distanceTier)}`, amount: fmt(t.tierAmt) });
  if (t.panelUpgradeAmt) rows.push({ label: 'Service Upgrade to 200A', amount: fmt(t.panelUpgradeAmt) });
  for (const it of activeCustomItems(e)) {
    rows.push({ label: it.desc.trim(), amount: fmt(customItemAmount(it)) });
  }
  return rows;
}

export function evProposalNo(): string {
  const now  = new Date();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const yyyy = now.getFullYear();
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `JSEV-${mm}${dd}${yyyy}-${rand}`;
}
