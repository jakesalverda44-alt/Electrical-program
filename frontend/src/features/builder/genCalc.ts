import { DEFAULT_PRICES, DEFAULT_IO_SCOPE, IO_PRICE_FIELDS, IO_PERMIT_SETTING, ioFallbackPrices, IoPrices, LC_MODELS, GEN_SPECS, NEW_INSTALL_ONLY, LOAD_CENTER_UNITS, GenForm, CustomItem, InstallOnlyScope, GEN_BATTERY_LABEL } from './genData';
import * as T from './installOnlyText';
import { evInstallPrice, evTierLabel } from './evData';
import { roundCents } from './money';

/** The Install Only company-default settings (app_settings keys). All optional strings. */
export interface IoSettings {
  gen_io_set_gen_ac?: string; gen_io_set_gen_lc?: string; gen_io_ats_install?: string;
  gen_io_conduit_base?: string; gen_io_conduit_per_ft?: string; gen_io_wire_pull_base?: string;
  gen_io_wire_pull_per_ft?: string; gen_io_connect?: string; gen_io_gas?: string; gen_io_permit?: string;
}

interface DefaultOverrides extends IoSettings {
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
    brand: 'Kohler', coolingType: 'air-cooled', size: '14KW', genPriceOverride: null,
    atsSize: '200A', atsQty: 1, fuel: 'Natural Gas',
    pad: true, smmQty: 1, surgeProQty: 0, battery: true, emPanel: false, gasLine: false, extraWire: 0,
    liftType: 'none', genStand: 'none', removal: false,
    extWarranty: 'none', extWarrantyPromoStart: '', extWarrantyPromoEnd: '',
    silverServicePromo: 'none',
    evCharger: false, evChargerTier: 'f6to15', evChargerPriceOverride: null,
    feedFt: 0, genSide: '', panelRel: '', panelFt: 0,
    labor:   Number(overrides?.gen_default_labor)    || DEFAULT_PRICES.labor,
    permit:  Number(overrides?.gen_default_permit)   || DEFAULT_PRICES.permit,
    startup: Number(overrides?.gen_default_startup)  || DEFAULT_PRICES.startup,
    discount: 0, discountType: '$',
    taxRate:  Number(overrides?.gen_default_tax_rate) || 7,
    customItems: [],
    notes: '',
    includeBreakdown: false,
    jobType: 'new-install',
    installOnly: { ...DEFAULT_IO_SCOPE, prices: ioPricesFromSettings(overrides) },
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
  // silverServicePromo was a boolean (true = 1 year) before the 2-year option existed.
  if (out.silverServicePromo === undefined || out.silverServicePromo === false) {
    out.silverServicePromo = 'none';
  } else if (out.silverServicePromo === true) {
    out.silverServicePromo = '1yr';
  }
  if (out.feedFt === undefined) out.feedFt = 0;
  if (out.genSide === undefined) out.genSide = '';
  if (out.panelRel === undefined) out.panelRel = '';
  if (out.panelFt === undefined) out.panelFt = 0;
  if (out.genPriceOverride === undefined) out.genPriceOverride = null;
  if (out.genStand === undefined) out.genStand = 'none';
  // Checked with isArray rather than for undefined so a proposal holding a malformed value
  // (null, an object, a string) also lands on an empty list instead of crashing the builder.
  if (!Array.isArray(out.customItems)) out.customItems = [];
  if (out.evCharger === undefined) out.evCharger = false;
  if (out.evChargerTier === undefined) out.evChargerTier = 'f6to15';
  if (out.evChargerPriceOverride === undefined) out.evChargerPriceOverride = null;
  out.installOnly = coerceInstallOnly(out.installOnly);
  return out;
}

/** A setting string that is a usable non-negative amount, else undefined. A blank setting
 *  means "not set" (the built-in default applies), never $0. */
function settingAmount(v: string | undefined): number | undefined {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Company-default Install Only prices from Settings, with the built-in default per key. */
export function ioPricesFromSettings(settings?: IoSettings): IoPrices {
  const out = ioFallbackPrices();
  if (!settings) return out;
  for (const f of IO_PRICE_FIELDS) {
    const n = settingAmount((settings as Record<string, string | undefined>)[f.setting]);
    if (n !== undefined) out[f.key] = n;
  }
  return out;
}

/** Company-default Install Only permit amount from Settings (fallback: the built-in default). */
export function ioPermitFromSettings(settings?: IoSettings): number {
  return settingAmount((settings as Record<string, string | undefined> | undefined)?.[IO_PERMIT_SETTING]) ?? DEFAULT_PRICES.installOnly.permit;
}

/** Per-key coercion of a stored/AI-supplied installOnly object onto a valid InstallOnlyScope:
 *  enums fall back to the default, booleans to the default, runFt to a finite number >= 0.
 *  The generator-to-ATS connection and startup have no field, so nothing here can remove them. */
export function coerceInstallOnly(raw: unknown): InstallOnlyScope {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_IO_SCOPE;
  const ft = Number(r.runFt);
  const rp = (r.prices && typeof r.prices === 'object' && !Array.isArray(r.prices) ? r.prices : {}) as Record<string, unknown>;
  const prices = ioFallbackPrices();
  for (const f of IO_PRICE_FIELDS) {
    const raw = rp[f.key];
    const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
    if (Number.isFinite(n) && n >= 0) prices[f.key] = n;   // a deliberate 0 stays 0
  }
  return {
    setGenerator: typeof r.setGenerator === 'boolean' ? r.setGenerator : d.setGenerator,
    ats: r.ats === 'customer-install' || r.ats === 'apt-supply-install' || r.ats === 'existing' ? r.ats : d.ats,
    conduit: r.conduit === 'run' || r.conduit === 'wire-only' || r.conduit === 'existing' ? r.conduit : d.conduit,
    runFt: Number.isFinite(ft) && ft > 0 ? ft : 0,
    gas: typeof r.gas === 'boolean' ? r.gas : d.gas,
    permit: typeof r.permit === 'boolean' ? r.permit : d.permit,
    unitDesc: typeof r.unitDesc === 'string' ? r.unitDesc : d.unitDesc,
    prices,
  };
}

interface JobTypeSettings extends IoSettings { gen_default_labor?: string; gen_default_permit?: string }

/** Install-only defaults and forced fields. Used when switching to install-only and when a
 *  lead-converted (partial) install-only form is opened. Leaves pad/battery/etc. alone. */
export function applyInstallOnlyDefaults(f: GenForm, settings?: IoSettings): GenForm {
  const next: GenForm = {
    ...f,
    jobType: 'install-only',
    labor: 0,
    permit: ioPermitFromSettings(settings),
    genPriceOverride: null,
    extWarranty: 'none',
    removal: false,
    gasLine: false,
    extraWire: 0,
    atsQty: Math.max(1, Number(f.atsQty) || 0),
    installOnly: { ...DEFAULT_IO_SCOPE, runFt: coerceInstallOnly(f.installOnly).runFt, unitDesc: coerceInstallOnly(f.installOnly).unitDesc, prices: ioPricesFromSettings(settings) },
  };
  return lockLoadCenter(next);
}

/** Load-center units carry their own integrated transfer switch: lock ATS size/qty, and APT
 *  can't supply an ATS for them. */
function lockLoadCenter(next: GenForm): GenForm {
  const lcAmps = loadCenterFor(next);
  if (lcAmps) {
    next.atsSize = lcAmps as GenForm['atsSize'];
    next.atsQty = 0;
    if (next.jobType === 'install-only' && next.installOnly?.ats === 'apt-supply-install') {
      next.installOnly = { ...next.installOnly, ats: 'customer-install' };
    }
  }
  return next;
}

/** Per-job-type defaults applied when the Job Type toggle changes (moved from BuilderPage). */
export function applyJobType(form: GenForm, jt: GenForm['jobType'], settings: JobTypeSettings = {}): GenForm {
  let next: GenForm;
  if (jt === 'swap-out') {
    next = { ...form, jobType: 'swap-out', pad: false, labor: 1500, permit: 475 };
  } else if (jt === 'install-only') {
    next = applyIoPreset(applyInstallOnlyDefaults(form, settings), 'full');
  } else {
    next = { ...form, jobType: 'new-install', gasLine: false, labor: settings.gen_default_labor ? Number(settings.gen_default_labor) : 3000, permit: settings.gen_default_permit ? Number(settings.gen_default_permit) : 1250 };
  }
  // New-install-only sizes (e.g. the 12KW load-center unit) drop off on swap-out.
  const sizes = getGenSizes(next);
  if (!sizes.includes(next.size)) next.size = sizes[0] ?? '';
  return lockLoadCenter(next);
}

export interface IoPreset {
  key: 'full' | 'set-connect' | 'wire-pull' | 'connect-only';
  label: string;
  scope: Pick<InstallOnlyScope, 'setGenerator' | 'ats' | 'conduit' | 'permit'>;
  pad: boolean;
  battery: boolean;
}

export const IO_PRESETS: IoPreset[] = [
  { key: 'full', label: 'Full install, customer-furnished generator & ATS',
    scope: { setGenerator: true, ats: 'customer-install', conduit: 'run', permit: true }, pad: true, battery: true },
  { key: 'set-connect', label: 'Set & connect, ATS already installed',
    scope: { setGenerator: true, ats: 'existing', conduit: 'run', permit: true }, pad: true, battery: true },
  { key: 'wire-pull', label: 'Wire pull only (conduit in place)',
    scope: { setGenerator: false, ats: 'existing', conduit: 'wire-only', permit: false }, pad: false, battery: false },
  { key: 'connect-only', label: 'Connect to existing ATS (conduit & wire in place)',
    scope: { setGenerator: false, ats: 'existing', conduit: 'existing', permit: false }, pad: false, battery: false },
];

/** Applies a preset's checkboxes; leaves runFt, unitDesc and gas alone. */
export function applyIoPreset(form: GenForm, key: IoPreset['key']): GenForm {
  const p = IO_PRESETS.find(x => x.key === key)!;
  const next: GenForm = {
    ...form,
    pad: p.pad,
    battery: p.battery,
    installOnly: { ...coerceInstallOnly(form.installOnly), ...p.scope },
  };
  if (!p.scope.setGenerator) { next.genStand = 'none'; next.liftType = 'none'; }
  else if (p.pad) next.genStand = 'none';
  if (p.scope.ats === 'existing') { /* atsQty irrelevant */ } else next.atsQty = Math.max(1, Number(next.atsQty) || 0);
  return lockLoadCenter(next);
}

/** Which preset the form currently matches, or 'custom'. Derived, never stored. */
export function matchIoPreset(form: GenForm): IoPreset['key'] | 'custom' {
  const io = coerceInstallOnly(form.installOnly);
  const padEff = !!form.pad && form.genStand === 'none';
  for (const p of IO_PRESETS) {
    if (io.setGenerator === p.scope.setGenerator && io.ats === p.scope.ats && io.conduit === p.scope.conduit
      && io.permit === p.scope.permit && padEff === p.pad && !!form.battery === p.battery
      && (!p.scope.setGenerator ? form.genStand === 'none' && form.liftType === 'none' : true)) return p.key;
  }
  return 'custom';
}

/** Blocking problems with an install-only form; empty for other job types. */
export function installOnlyIssues(form: GenForm): string[] {
  if (form.jobType !== 'install-only') return [];
  const io = coerceInstallOnly(form.installOnly);
  const issues: string[] = [];
  const ft = Number(form.installOnly?.runFt);
  if (io.conduit !== 'existing' && !(Number.isFinite(ft) && ft > 0)) issues.push(T.IO_ISSUE_RUNFT);
  if (!io.setGenerator && (form.pad || form.genStand !== 'none' || form.liftType !== 'none' || form.battery)) issues.push(T.IO_ISSUE_PAD_WITHOUT_SET);
  const lc = !!loadCenterFor(form);
  if (!lc && io.ats !== 'existing' && !(Number(form.atsQty) >= 1)) issues.push(T.IO_ISSUE_ATS_QTY);
  if (lc && io.ats === 'apt-supply-install') issues.push(T.IO_ISSUE_LC_ATS);
  return issues;
}

/** Custom items that count: a row the salesperson started but left undescribed contributes
 *  nothing to any total and renders nowhere, so a half-typed row can't move the price. */
export function activeCustomItems(g: Pick<GenForm, 'customItems'>): CustomItem[] {
  if (!Array.isArray(g.customItems)) return [];
  return g.customItems.filter(it => it && typeof it.desc === 'string' && it.desc.trim() !== '');
}

/** Coerces a hand-typed amount to a usable number. Non-finite (empty input, NaN) → 0.
 *  Negative amounts are kept: they read on the proposal as a named credit. */
export function customItemAmount(item: Pick<CustomItem, 'amount'>): number {
  const n = Number(item.amount);
  return Number.isFinite(n) ? n : 0;
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

export function getGenPrice(form: Pick<GenForm, 'brand' | 'coolingType' | 'size' | 'genPriceOverride'>): number {
  if (form.genPriceOverride !== null && form.genPriceOverride !== undefined && !isNaN(form.genPriceOverride)) {
    return form.genPriceOverride;
  }
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
  genStandAmt: number;
  removalFee: number;
  laborAmt: number;
  permitAmt: number;
  startupAmt: number;
  batteryAmt: number;
  emPanelAmt: number;
  gasLineAmt: number;
  extraWireAmt: number;
  /** Install Only labor lines (all non-taxable). Always 0 for the other job types. */
  ioSetGenAmt: number;
  ioAtsInstallAmt: number;
  ioConduitAmt: number;
  ioConnectAmt: number;
  ioGasAmt: number;
  /** Bundled Tesla Wall Connector install — non-taxable, like the other labor lines. */
  evChargerAmt: number;
  /** Hand-typed line items flagged as goods — folded into taxableBase. */
  customTaxableAmt: number;
  /** Hand-typed line items flagged as services — folded into nonTaxableBase. */
  customNonTaxableAmt: number;
  /** Both of the above; for display only. */
  customTotal: number;
  subtotal: number;
  discountAmt: number;
  /** Tangible goods, before discount — the only lines sales tax applies to. */
  taxableBase: number;
  /** Labor, permit, startup, lift, removal, gas line — never taxed. */
  nonTaxableBase: number;
  /** taxableBase after its pro-rata share of the discount; the figure tax is charged on. */
  taxedAmount: number;
  /** subtotal − discountAmt: the contract price before tax. */
  netSubtotal: number;
  tax: number;
  total: number;
  deposit: number;
}

/** Install Only totals. Kept separate so the new-install / swap-out path below is untouched.
 *  Must stay in step with calcFormTotals' io branch in backend/src/routes/gens.ts. */
function calcInstallOnlyTotals(g: GenForm): GenTotals {
  const io = coerceInstallOnly(g.installOnly);
  const P = io.prices;
  const set = io.setGenerator;
  const lc = g.coolingType === 'liquid-cooled';
  const genP = 0;
  const genStandAmt = set ? (g.genStand === 'small' ? DEFAULT_PRICES.genStandSmall
    : g.genStand === 'big' ? DEFAULT_PRICES.genStandBig : 0) : 0;
  const padAmt = (set && g.pad && g.genStand === 'none') ? (lc
    ? (parseInt(g.size) >= 60 ? DEFAULT_PRICES.padLC_large : DEFAULT_PRICES.padLC_small)
    : DEFAULT_PRICES.pad) : 0;
  const smmTotal   = Number(g.smmQty || 0) * DEFAULT_PRICES.smm;
  const surgeTotal = Number(g.surgeProQty || 0) * DEFAULT_PRICES.surgePro;
  const batteryAmt = (set && g.battery) ? DEFAULT_PRICES.battery : 0;
  const emPanelAmt = g.emPanel ? DEFAULT_PRICES.emPanel : 0;
  const atsQty = Math.max(0, Number(g.atsQty || 0));
  const atsIncluded = 0;
  const aptAts = io.ats === 'apt-supply-install';
  const atsBillableQty = aptAts ? atsQty : 0;
  const atsAmt = atsBillableQty * DEFAULT_PRICES.ats;
  const liftAmt = set ? (g.liftType === 'lull' ? DEFAULT_PRICES.lull : g.liftType === 'crane' ? DEFAULT_PRICES.crane : 0) : 0;
  const ioSetGenAmt = set ? (lc ? P.setGenLC : P.setGenAC) : 0;
  const ioAtsInstallAmt = io.ats === 'existing' ? 0 : atsQty * P.atsInstall;
  const ioConduitAmt = io.conduit === 'run' ? P.conduitBase + io.runFt * P.conduitPerFt
    : io.conduit === 'wire-only' ? P.wirePullBase + io.runFt * P.wirePullPerFt : 0;
  const ioConnectAmt = P.connect;
  const ioGasAmt = io.gas ? P.gas : 0;
  // A deliberate $0 additional labor / permit stays $0 (only a non-number falls to 0 too).
  const laborAmt   = Number(g.labor) || 0;
  const permitAmt  = io.permit ? (Number(g.permit) || 0) : 0;
  // Startup is always included and cannot be zeroed out.
  const startupAmt = lc ? DEFAULT_PRICES.startupLC
    : (Number(g.startup) > 0 ? Number(g.startup) : DEFAULT_PRICES.startup);
  const evChargerAmt = g.evCharger ? evInstallPrice(g.evChargerTier, g.evChargerPriceOverride) : 0;
  const custom = activeCustomItems(g);
  const customTaxableAmt    = custom.filter(it =>  it.taxable).reduce((sum, it) => sum + customItemAmount(it), 0);
  const customNonTaxableAmt = custom.filter(it => !it.taxable).reduce((sum, it) => sum + customItemAmount(it), 0);
  const customTotal         = customTaxableAmt + customNonTaxableAmt;
  const extWarrantyAmt = 0, removalFee = 0, gasLineAmt = 0, extraWireAmt = 0;

  const taxableBase    = padAmt + genStandAmt + batteryAmt + atsAmt + smmTotal + surgeTotal + emPanelAmt + customTaxableAmt;
  const nonTaxableBase = liftAmt + laborAmt + permitAmt + startupAmt + evChargerAmt + customNonTaxableAmt
    + ioSetGenAmt + ioAtsInstallAmt + ioConduitAmt + ioConnectAmt + ioGasAmt;
  const subtotal   = taxableBase + nonTaxableBase;
  const discountAmt = g.discountType === '%'
    ? roundCents(subtotal * ((Number(g.discount) || 0) / 100))
    : (Number(g.discount) || 0);
  const taxedAmount = subtotal > 0
    ? Math.max(0, taxableBase - (discountAmt * taxableBase) / subtotal)
    : 0;
  const netSubtotal = roundCents(subtotal - discountAmt);
  const tax        = roundCents(taxedAmount * (Number(g.taxRate) / 100));
  const total      = roundCents(netSubtotal + tax);
  const deposit    = roundCents(total * ((Number(g.depositPct) || 50) / 100));

  return { genP, padAmt, genStandAmt, smmTotal, surgeTotal, atsIncluded, atsBillableQty, atsAmt, extWarrantyAmt, liftAmt, removalFee, laborAmt, permitAmt, startupAmt, batteryAmt, emPanelAmt, gasLineAmt, extraWireAmt, ioSetGenAmt, ioAtsInstallAmt, ioConduitAmt, ioConnectAmt, ioGasAmt, evChargerAmt, customTaxableAmt, customNonTaxableAmt, customTotal, subtotal, discountAmt, taxableBase, nonTaxableBase, taxedAmount, netSubtotal, tax, total, deposit };
}

export function calcGenTotals(g: GenForm): GenTotals {
  if (g.jobType === 'install-only') return calcInstallOnlyTotals(g);
  const genP       = getGenPrice(g);
  // A Gen Stand replaces the concrete pad, so it's charged instead of (never on top of) padAmt.
  const genStandAmt = g.genStand === 'small' ? DEFAULT_PRICES.genStandSmall
    : g.genStand === 'big' ? DEFAULT_PRICES.genStandBig : 0;
  const padAmt     = (g.pad && g.genStand === 'none') ? (g.coolingType === 'liquid-cooled'
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
  // A custom item can be either goods or work, so the salesperson's per-item flag — not the
  // item's position in this list — decides which base it joins.
  // A bundled charger install is priced off the standalone tier list, and joins the
  // non-taxable base with the other labor: the customer supplies the charger itself, and
  // the generator's own equipment lines already carry the job's sales tax.
  const evChargerAmt = g.evCharger ? evInstallPrice(g.evChargerTier, g.evChargerPriceOverride) : 0;
  const custom = activeCustomItems(g);
  const customTaxableAmt    = custom.filter(it =>  it.taxable).reduce((sum, it) => sum + customItemAmount(it), 0);
  const customNonTaxableAmt = custom.filter(it => !it.taxable).reduce((sum, it) => sum + customItemAmount(it), 0);
  const customTotal         = customTaxableAmt + customNonTaxableAmt;

  // Sales tax applies to tangible goods only — matching what the proposal's price
  // breakdown tells the customer. Labor, permit fees, startup/commissioning, lift and
  // removal are services; the gas line is an install, and extra wire is presented to
  // the customer bundled into the non-taxable "Labor & Electrical" line.
  // A promo extended warranty is $0 here, so it contributes no tax by construction.
  const taxableBase    = genP + padAmt + genStandAmt + batteryAmt + atsAmt + smmTotal + surgeTotal + extWarrantyAmt + emPanelAmt + customTaxableAmt;
  const nonTaxableBase = gasLineAmt + extraWireAmt + liftAmt + removalFee + laborAmt + permitAmt + startupAmt + evChargerAmt + customNonTaxableAmt;
  const subtotal   = taxableBase + nonTaxableBase;
  const discountAmt = g.discountType === '%'
    ? roundCents(subtotal * ((Number(g.discount) || 0) / 100))
    : (Number(g.discount) || 0);
  // A discount is given against the whole job, so it reduces the taxable base only in
  // proportion to that base's share of the contract.
  const taxedAmount = subtotal > 0
    ? Math.max(0, taxableBase - (discountAmt * taxableBase) / subtotal)
    : 0;
  const netSubtotal = roundCents(subtotal - discountAmt);
  const tax        = roundCents(taxedAmount * (Number(g.taxRate) / 100));
  const total      = roundCents(netSubtotal + tax);
  const deposit    = roundCents(total * ((Number(g.depositPct) || 50) / 100));

  return { genP, padAmt, genStandAmt, smmTotal, surgeTotal, atsIncluded, atsBillableQty, atsAmt, extWarrantyAmt, liftAmt, removalFee, laborAmt, permitAmt, startupAmt, batteryAmt, emPanelAmt, gasLineAmt, extraWireAmt, ioSetGenAmt: 0, ioAtsInstallAmt: 0, ioConduitAmt: 0, ioConnectAmt: 0, ioGasAmt: 0, evChargerAmt, customTaxableAmt, customNonTaxableAmt, customTotal, subtotal, discountAmt, taxableBase, nonTaxableBase, taxedAmount, netSubtotal, tax, total, deposit };
}

function ioPriceRows(g: GenForm, t: GenTotals, fmt: (n: number) => string) {
  const io = coerceInstallOnly(g.installOnly);
  const rows: { label: string; amount: string }[] = [];
  if (t.ioSetGenAmt)  rows.push({ label: T.IO_ROW_SET, amount: fmt(t.ioSetGenAmt) });
  if (t.padAmt)       rows.push({ label: 'Concrete Pad', amount: fmt(t.padAmt) });
  if (t.genStandAmt)  rows.push({ label: g.genStand === 'small' ? 'Gen Stand — Adjustable 8–24"' : 'Gen Stand — Adjustable 32–72"', amount: fmt(t.genStandAmt) });
  if (t.atsAmt)       rows.push({ label: T.ioRowAtsEquip(t.atsBillableQty, g.atsSize), amount: fmt(t.atsAmt) });
  if (t.ioAtsInstallAmt) rows.push({ label: T.ioRowAtsInstall(Number(g.atsQty) || 0, g.atsSize), amount: fmt(t.ioAtsInstallAmt) });
  if (t.ioConduitAmt) rows.push({ label: io.conduit === 'run' ? T.ioRowConduitRun(io.runFt) : T.ioRowWirePull(io.runFt), amount: fmt(t.ioConduitAmt) });
  rows.push({ label: T.IO_ROW_CONNECT, amount: fmt(t.ioConnectAmt) });
  if (t.batteryAmt)   rows.push({ label: GEN_BATTERY_LABEL, amount: fmt(t.batteryAmt) });
  if (t.smmTotal)     rows.push({ label: `SMM (Preventative Maintenance) × ${g.smmQty}`, amount: fmt(t.smmTotal) });
  if (t.surgeTotal)   rows.push({ label: `SurgeProtector Pro × ${g.surgeProQty}`, amount: fmt(t.surgeTotal) });
  if (t.emPanelAmt)   rows.push({ label: 'EM Panel', amount: fmt(t.emPanelAmt) });
  if (t.ioGasAmt)     rows.push({ label: T.IO_ROW_GAS, amount: fmt(t.ioGasAmt) });
  if (g.silverServicePromo !== 'none') {
    const years = g.silverServicePromo === '2yr' ? 2 : 1;
    const value = DEFAULT_PRICES.silverService * years;
    rows.push({ label: `${years}-Year Silver Service — Promo: $${value.toLocaleString()} → FREE`, amount: fmt(0) });
  }
  if (t.evChargerAmt) {
    rows.push({ label: `Tesla Wall Connector Installation — ${evTierLabel(g.evChargerTier)}`, amount: fmt(t.evChargerAmt) });
  }
  for (const it of activeCustomItems(g)) {
    rows.push({ label: it.desc.trim(), amount: fmt(customItemAmount(it)) });
  }
  if (t.liftAmt)      rows.push({ label: g.liftType === 'lull' ? 'Lull' : 'Crane', amount: fmt(t.liftAmt) });
  if (t.laborAmt)     rows.push({ label: T.IO_ROW_LABOR, amount: fmt(t.laborAmt) });
  if (io.permit)      rows.push({ label: 'Permit', amount: fmt(t.permitAmt) });
  rows.push({ label: 'Startup & Commissioning', amount: fmt(t.startupAmt) });
  return rows;
}

export function genPriceRows(g: GenForm, t: GenTotals, fmt: (n: number) => string) {
  if (g.jobType === 'install-only') return ioPriceRows(g, t, fmt);
  const rows: { label: string; amount: string }[] = [];
  rows.push({ label: `${g.brand} ${g.size} ${genModelNo(g)} (${g.coolingType})`, amount: fmt(t.genP) });
  if (t.padAmt)      rows.push({ label: 'Concrete Pad', amount: fmt(t.padAmt) });
  if (t.genStandAmt) rows.push({ label: g.genStand === 'small' ? 'Gen Stand — Adjustable 8–24"' : 'Gen Stand — Adjustable 32–72"', amount: fmt(t.genStandAmt) });
  if (t.smmTotal)    rows.push({ label: `SMM (Preventative Maintenance) × ${g.smmQty}`, amount: fmt(t.smmTotal) });
  if (t.surgeTotal)  rows.push({ label: `SurgeProtector Pro × ${g.surgeProQty}`, amount: fmt(t.surgeTotal) });
  if (t.batteryAmt)  rows.push({ label: GEN_BATTERY_LABEL, amount: fmt(t.batteryAmt) });
  if (t.emPanelAmt)  rows.push({ label: 'EM Panel', amount: fmt(t.emPanelAmt) });
  if (t.gasLineAmt)  rows.push({ label: 'Gas Line Disconnect & Reconnect', amount: fmt(t.gasLineAmt) });
  if (t.extraWireAmt) rows.push({ label: `Extra Wire (${g.extraWire} ft)`, amount: fmt(t.extraWireAmt) });
  if (t.atsAmt)      rows.push({ label: `ATS — additional (${t.atsBillableQty} × ${g.atsSize})`, amount: fmt(t.atsAmt) });
  if (g.extWarranty === 'paid')  rows.push({ label: 'Extended Warranty (10-Year)', amount: fmt(t.extWarrantyAmt) });
  if (g.extWarranty === 'promo') {
    const promoLabel = g.brand === 'Kohler' ? 'Kohler Promo' : 'Included by APT';
    rows.push({ label: `Extended Warranty (10-Year) — ${promoLabel}: $${DEFAULT_PRICES.extendedWarranty.toLocaleString()} → FREE`, amount: fmt(0) });
  }
  if (g.silverServicePromo !== 'none') {
    const years = g.silverServicePromo === '2yr' ? 2 : 1;
    const value = DEFAULT_PRICES.silverService * years;
    rows.push({ label: `${years}-Year Silver Service — Promo: $${value.toLocaleString()} → FREE`, amount: fmt(0) });
  }
  if (t.evChargerAmt) {
    rows.push({ label: `Tesla Wall Connector Installation — ${evTierLabel(g.evChargerTier)}`, amount: fmt(t.evChargerAmt) });
  }
  for (const it of activeCustomItems(g)) {
    rows.push({ label: it.desc.trim(), amount: fmt(customItemAmount(it)) });
  }
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
