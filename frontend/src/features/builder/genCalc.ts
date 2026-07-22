import { DEFAULT_PRICES, LC_MODELS, GEN_SPECS, NEW_INSTALL_ONLY, LOAD_CENTER_UNITS, GenForm } from './genData';

interface DefaultOverrides {
  gen_default_labor?: string;
  gen_default_permit?: string;
  gen_default_startup?: string;
  gen_default_tax_rate?: string;
  gen_default_deposit_pct?: string;
  gen_default_valid_days?: string;
}

export function blankGenForm(overrides?: DefaultOverrides): GenForm {
  return {
    customer: '', attn: '', address: '', city: '', state: 'FL', zip: '', phone: '', email: '',
    brand: 'Kohler', coolingType: 'air-cooled', size: '14KW',
    atsSize: '200A', atsQty: 1, fuel: 'Natural Gas',
    pad: true, smmQty: 1, surgeProQty: 0, battery: true, emPanel: false, gasLine: false, extraWire: 0,
    liftType: 'none', removal: false,
    extWarranty: 'none', extWarrantyPromoStart: '', extWarrantyPromoEnd: '',
    labor:   Number(overrides?.gen_default_labor)    || DEFAULT_PRICES.labor,
    permit:  Number(overrides?.gen_default_permit)   || DEFAULT_PRICES.permit,
    startup: Number(overrides?.gen_default_startup)  || DEFAULT_PRICES.startup,
    discount: 0, discountType: '$',
    taxRate:  Number(overrides?.gen_default_tax_rate) || 7,
    notes: '',
    includeBreakdown: false,
    jobType: 'new-install',
    removalFee: 500,
    validDays:  Number(overrides?.gen_default_valid_days)  || 30,
    depositPct: Number(overrides?.gen_default_deposit_pct) || 50,
  };
}

// Older saved/sent proposals used ats/smm/surgePro/lcATS/additionalATS (pre-ATS-unification,
// pre-qty add-ons). Reopening one of those in the builder, or a customer revisiting an old
// signed link, would otherwise silently drop those selections since the new fields wouldn't
// exist on the stored form_data. Translates old field names/shapes onto the current GenForm shape
// — a no-op for anything already saved in the current shape.
export function migrateGenForm(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  if (out.smmQty === undefined && out.smm !== undefined) {
    out.smmQty = out.smm ? 1 : 0;
  }
  if (out.surgeProQty === undefined && out.surgePro !== undefined) {
    out.surgeProQty = out.surgePro ? 1 : 0;
  }
  if (out.atsSize === undefined && typeof out.ats === 'string') {
    out.atsSize = out.ats;
  }
  if (out.atsQty === undefined && (out.lcATS !== undefined || out.additionalATS !== undefined)) {
    const includedQty = out.coolingType === 'liquid-cooled' ? 0 : 1;
    const oldExtra = (out.lcATS && out.lcATS !== 'none' ? 1 : 0) + Number(out.additionalATS || 0);
    out.atsQty = includedQty + oldExtra;
  }
  if (out.extWarranty === undefined) {
    out.extWarranty = 'none';
  }
  return out;
}

export function getGenSizes(form: Pick<GenForm, 'brand' | 'coolingType' | 'jobType'>): string[] {
  const all = Object.keys(DEFAULT_PRICES.generators[form.coolingType]?.[form.brand] ?? {});
  // Some sizes (e.g. the 12KW load-center unit) are new-install only — hide on swap-outs.
  if (form.jobType === 'swap-out') {
    return all.filter(size => !NEW_INSTALL_ONLY.has(`${form.brand}|${form.coolingType}|${size}`));
  }
  return all;
}

// For units with an integrated load center, returns its amperage label (e.g. '100A');
// otherwise null. These include the transfer switch, so no separate ATS is selected.
export function loadCenterFor(form: Pick<GenForm, 'brand' | 'coolingType' | 'size'>): string | null {
  return LOAD_CENTER_UNITS[`${form.brand}|${form.coolingType}|${form.size}`] ?? null;
}

// Air-cooled generators ship with 1 ATS standard; liquid-cooled do not include one.
// Load-center units (e.g. Kohler 12KW) bundle their own integrated transfer switch instead
// of a standalone ATS, so they never carry a separate included/billable ATS count.
export function atsIncludedQty(form: Pick<GenForm, 'brand' | 'coolingType' | 'size'>): number {
  if (loadCenterFor(form)) return 0;
  return form.coolingType === 'air-cooled' ? 1 : 0;
}

export function getGenPrice(form: Pick<GenForm, 'brand' | 'coolingType' | 'size'>): number {
  return DEFAULT_PRICES.generators[form.coolingType]?.[form.brand]?.[form.size] ?? 0;
}

export function genModelNo(form: Pick<GenForm, 'brand' | 'coolingType' | 'size'>): string {
  if (form.coolingType === 'liquid-cooled') {
    return LC_MODELS[form.brand]?.[form.size] ?? form.size;
  }
  const spec = GEN_SPECS[form.brand]?.[form.size];
  const amps = spec?.amps ?? '';
  const kw = parseInt(form.size);
  return `${form.brand.slice(0, 4).toUpperCase()}-${kw}KW-${amps}A`;
}

export function genSpec(form: Pick<GenForm, 'brand' | 'size'>) {
  return GEN_SPECS[form.brand]?.[form.size] ?? {};
}

export interface GenTotals {
  genP: number;
  padAmt: number;
  smmTotal: number;
  surgeTotal: number;
  atsIncluded: number;
  atsBillableQty: number;
  atsAmt: number;
  extWarrantyAmt: number;
  liftAmt: number;
  removalFee: number;
  laborAmt: number;
  permitAmt: number;
  startupAmt: number;
  batteryAmt: number;
  emPanelAmt: number;
  gasLineAmt: number;
  extraWireAmt: number;
  subtotal: number;
  discountAmt: number;
  taxable: number;
  tax: number;
  total: number;
  deposit: number;
}

export function calcGenTotals(g: GenForm): GenTotals {
  const genP       = getGenPrice(g);
  const padAmt     = g.pad ? (g.coolingType === 'liquid-cooled'
    ? (parseInt(g.size) >= 60 ? DEFAULT_PRICES.padLC_large : DEFAULT_PRICES.padLC_small)
    : DEFAULT_PRICES.pad) : 0;
  const smmTotal   = Number(g.smmQty || 0) * DEFAULT_PRICES.smm;
  const surgeTotal = Number(g.surgeProQty || 0) * DEFAULT_PRICES.surgePro;
  const batteryAmt = g.battery ? DEFAULT_PRICES.battery : 0;
  const emPanelAmt = g.emPanel ? DEFAULT_PRICES.emPanel : 0;
  const gasLineAmt = (g.jobType === 'swap-out' && g.gasLine) ? DEFAULT_PRICES.gasLine : 0;
  const extraWireAmt = Number(g.extraWire) * DEFAULT_PRICES.extraWire;
  const atsIncluded = atsIncludedQty(g);
  const atsBillableQty = Math.max(0, Number(g.atsQty || 0) - atsIncluded);
  const atsAmt     = atsBillableQty * DEFAULT_PRICES.ats;
  // Promo waives the fee (still shown on the proposal as $1,100 → FREE); 'none' charges nothing.
  const extWarrantyAmt = g.extWarranty === 'paid' ? DEFAULT_PRICES.extendedWarranty : 0;
  const liftAmt    = g.liftType === 'lull' ? DEFAULT_PRICES.lull : g.liftType === 'crane' ? DEFAULT_PRICES.crane : 0;
  const removalFee = g.jobType === 'swap-out' ? (Number(g.removalFee) || 0) : (g.removal ? 500 : 0);
  const laborAmt   = Number(g.labor);
  const permitAmt  = Number(g.permit);
  const startupAmt = g.coolingType === 'liquid-cooled' ? DEFAULT_PRICES.startupLC : Number(g.startup);

  const subtotal   = genP + padAmt + smmTotal + surgeTotal + batteryAmt + emPanelAmt + gasLineAmt + extraWireAmt + atsAmt + extWarrantyAmt + liftAmt + removalFee + laborAmt + permitAmt + startupAmt;
  const discountAmt = g.discountType === '%'
    ? Math.round(subtotal * ((Number(g.discount) || 0) / 100))
    : (Number(g.discount) || 0);
  const taxable    = subtotal - discountAmt;
  const tax        = Math.round(taxable * (Number(g.taxRate) / 100));
  const total      = taxable + tax;
  const deposit    = Math.round(total * ((Number(g.depositPct) || 50) / 100));

  return { genP, padAmt, smmTotal, surgeTotal, atsIncluded, atsBillableQty, atsAmt, extWarrantyAmt, liftAmt, removalFee, laborAmt, permitAmt, startupAmt, batteryAmt, emPanelAmt, gasLineAmt, extraWireAmt, subtotal, discountAmt, taxable, tax, total, deposit };
}

export function genPriceRows(g: GenForm, t: GenTotals, fmt: (n: number) => string) {
  const rows: { label: string; amount: string }[] = [];
  rows.push({ label: `${g.brand} ${g.size} ${genModelNo(g)} (${g.coolingType})`, amount: fmt(t.genP) });
  if (t.padAmt)      rows.push({ label: 'Concrete Pad', amount: fmt(t.padAmt) });
  if (t.smmTotal)    rows.push({ label: `SMM (Preventative Maintenance) × ${g.smmQty}`, amount: fmt(t.smmTotal) });
  if (t.surgeTotal)  rows.push({ label: `SurgeProtector Pro × ${g.surgeProQty}`, amount: fmt(t.surgeTotal) });
  if (t.batteryAmt)  rows.push({ label: 'Battery Maintainer', amount: fmt(t.batteryAmt) });
  if (t.emPanelAmt)  rows.push({ label: 'EM Panel', amount: fmt(t.emPanelAmt) });
  if (t.gasLineAmt)  rows.push({ label: 'Gas Line Disconnect & Reconnect', amount: fmt(t.gasLineAmt) });
  if (t.extraWireAmt) rows.push({ label: `Extra Wire (${g.extraWire} ft)`, amount: fmt(t.extraWireAmt) });
  if (t.atsAmt)      rows.push({ label: `ATS — additional (${t.atsBillableQty} × ${g.atsSize})`, amount: fmt(t.atsAmt) });
  if (g.extWarranty === 'paid')  rows.push({ label: 'Extended Warranty (10-Year)', amount: fmt(t.extWarrantyAmt) });
  if (g.extWarranty === 'promo') rows.push({ label: `Extended Warranty (10-Year) — Kohler Promo: $${DEFAULT_PRICES.extendedWarranty.toLocaleString()} → FREE`, amount: fmt(0) });
  if (t.liftAmt)     rows.push({ label: g.liftType === 'lull' ? 'Lull' : 'Crane', amount: fmt(t.liftAmt) });
  if (t.removalFee)  rows.push({ label: 'Removal / Haul-Off', amount: fmt(t.removalFee) });
  rows.push({ label: 'Labor & Installation', amount: fmt(t.laborAmt) });
  rows.push({ label: 'Permit', amount: fmt(t.permitAmt) });
  rows.push({ label: 'Startup & Commissioning', amount: fmt(t.startupAmt) });
  return rows;
}

export function genProposalNo(brand: string, coolingType: string): string {
  const now   = new Date();
  const mm    = String(now.getMonth() + 1).padStart(2, '0');
  const dd    = String(now.getDate()).padStart(2, '0');
  const yyyy  = now.getFullYear();
  const rand  = String(Math.floor(Math.random() * 900) + 100);
  const prefix = brand === 'Kohler'
    ? (coolingType === 'liquid-cooled' ? 'JSKOHL-LC' : 'JSKOHL')
    : (coolingType === 'liquid-cooled' ? 'JSGNRC-LC' : 'JSGNRC');
  return `${prefix}-${mm}${dd}${yyyy}-${rand}`;
}
