// Server-side generator proposal totals, used by build-from-notes / from-calendar-event (the
// builder computes its own totals client-side). calcFormTotals mirrors calcGenTotals in
// frontend/src/features/builder/genCalc.ts; the Install Only branch is held to it by the shared
// parity fixture frontend/src/features/builder/__fixtures__/ioParity.json (asserted in both suites).
// Moved here from routes/gens.ts so it can be unit-tested.

export const GEN_PRICES: Record<string, Record<string, Record<string, number>>> = {
  'air-cooled': {
    Kohler:  { '14KW': 5800, '20KW': 6700, '26KW': 8200 },
    Generac: { '14KW': 5600, '18KW': 6450, '22KW': 7150, '24KW': 7575, '26KW': 8000, '28KW': 9300 },
  },
  'liquid-cooled': {
    Kohler:  { '24KW': 17549, '30KW': 19999, '38KW': 22449, '48KW': 25209, '60KW': 27759, '80KW': 34089, '100KW': 41129 },
    Generac: { '32KW': 19203, '40KW': 21734, '48KW': 22914, '60KW': 25212 },
  },
};

export const ADDON_P = {
  smm: 250, surgePro: 395, pad: 485, battery: 185, emPanel: 495, gasLine: 500,
  ats: 1000, extraWire: 25,
  padLC_small: 800, padLC_large: 1200, startupLC: 1595,
  lull: 1100, crane: 1800, extendedWarranty: 1100, silverService: 395,
  labor: 3000, permit: 1250, startup: 695,
  genStandSmall: 2000, genStandBig: 2500,
  // Install Only (customer-furnished generator) built-in defaults — mirrors
  // DEFAULT_PRICES.installOnly in frontend/src/features/builder/genData.ts. Each is overridable
  // per company in Settings (gen_io_*) and per proposal (form_data.installOnly.prices).
  ioSetGenAC: 750, ioSetGenLC: 1500, ioAtsInstall: 750, ioConduitBase: 400, ioConduitPerFt: 30,
  ioWirePullBase: 250, ioWirePullPerFt: 12, ioConnect: 450, ioGas: 500, ioPermit: 475,
  // Bundled Tesla Wall Connector install, by distance tier — mirrors EV_PRICES in
  // frontend/src/features/builder/evData.ts.
  evLe5: 675, evF6to15: 993, evF16to25: 1275,
};

const EV_TIER_PRICE: Record<string, number> = {
  le5: ADDON_P.evLe5, f6to15: ADDON_P.evF6to15, f16to25: ADDON_P.evF16to25,
};

interface CustomItem { id?: string; desc?: string; amount?: unknown; taxable?: unknown }

/** Mirrors activeCustomItems/customItemAmount in frontend/src/features/builder/genCalc.ts:
 *  a row with no description contributes nothing, and a non-finite amount reads as 0. */
function customItemSums(raw: unknown): { taxable: number; nonTaxable: number } {
  const items: CustomItem[] = Array.isArray(raw) ? raw : [];
  let taxable = 0, nonTaxable = 0;
  for (const it of items) {
    if (!it || typeof it.desc !== 'string' || it.desc.trim() === '') continue;
    const n = Number(it.amount);
    if (!Number.isFinite(n)) continue;
    if (it.taxable) taxable += n; else nonTaxable += n;
  }
  return { taxable, nonTaxable };
}

/** Mirrors roundCents in frontend/src/features/builder/money.ts — proposal money rounds to
 *  the cent, not the dollar, so tax and deposit keep the cents the contract is written in. */
function roundCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const scaled = n * 100;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return rounded / 100;
}

export function calcFormTotals(g: Record<string, unknown>) {
  if (g.jobType === 'install-only') return calcInstallOnlyTotals(g);
  const coolingType = String(g.coolingType || 'air-cooled');
  const brand = String(g.brand || 'Kohler');
  const size = String(g.size || '14KW');
  const genP = GEN_PRICES[coolingType]?.[brand]?.[size] ?? 0;
  // A Gen Stand replaces the concrete pad, so it's charged instead of (never on top of) padAmt.
  const genStandAmt = g.genStand === 'small' ? ADDON_P.genStandSmall
    : g.genStand === 'big' ? ADDON_P.genStandBig : 0;
  const hasGenStand = g.genStand === 'small' || g.genStand === 'big';
  const padAmt = (g.pad && !hasGenStand) ? (coolingType === 'liquid-cooled'
    ? (parseInt(size) >= 60 ? ADDON_P.padLC_large : ADDON_P.padLC_small)
    : ADDON_P.pad) : 0;
  const smmTotal    = Number(g.smmQty || 0) * ADDON_P.smm;
  const surgeTotal  = Number(g.surgeProQty || 0) * ADDON_P.surgePro;
  const batteryAmt  = g.battery  ? ADDON_P.battery   : 0;
  const emPanelAmt  = g.emPanel  ? ADDON_P.emPanel   : 0;
  const gasLineAmt  = (g.jobType === 'swap-out' && g.gasLine) ? ADDON_P.gasLine : 0;
  const extraWireAmt = Number(g.extraWire || 0) * ADDON_P.extraWire;
  // Air-cooled includes 1 ATS standard; liquid-cooled includes none — only qty beyond that is billed.
  const atsIncluded = coolingType === 'air-cooled' ? 1 : 0;
  const atsBillableQty = Math.max(0, Number(g.atsQty || 0) - atsIncluded);
  const atsAmt      = atsBillableQty * ADDON_P.ats;
  const extWarrantyAmt = g.extWarranty === 'paid' ? ADDON_P.extendedWarranty : 0;
  const liftAmt     = g.liftType === 'lull' ? ADDON_P.lull : g.liftType === 'crane' ? ADDON_P.crane : 0;
  const removalFee  = g.jobType === 'swap-out' ? (Number(g.removalFee) || 0) : (g.removal ? 500 : 0);
  const laborAmt    = Number(g.labor)   || ADDON_P.labor;
  const permitAmt   = Number(g.permit)  || ADDON_P.permit;
  const startupAmt  = coolingType === 'liquid-cooled' ? ADDON_P.startupLC : (Number(g.startup) || ADDON_P.startup);
  // A custom item is goods or work depending on the salesperson's per-item flag, which is
  // what decides the base it joins below.
  // A bundled charger install joins the non-taxable base with the other labor: the customer
  // supplies the charger, and the generator's own equipment lines carry the job's sales tax.
  const evOverride = Number(g.evChargerPriceOverride);
  const evChargerAmt = g.evCharger
    ? (g.evChargerPriceOverride !== null && g.evChargerPriceOverride !== undefined && Number.isFinite(evOverride)
        ? evOverride
        : (EV_TIER_PRICE[String(g.evChargerTier)] ?? 0))
    : 0;
  const customSums = customItemSums(g.customItems);
  const customTaxableAmt    = customSums.taxable;
  const customNonTaxableAmt = customSums.nonTaxable;
  const customTotal         = customTaxableAmt + customNonTaxableAmt;
  // Keep in step with calcGenTotals in frontend/src/features/builder/genCalc.ts.
  // Sales tax applies to tangible goods only, matching the proposal's price breakdown:
  // labor, permit, startup, lift, removal and the gas line are services, and extra wire
  // is shown to the customer inside the non-taxable "Labor & Electrical" line.
  const taxableBase    = genP + padAmt + genStandAmt + batteryAmt + atsAmt + smmTotal + surgeTotal + extWarrantyAmt + emPanelAmt + customTaxableAmt;
  const nonTaxableBase = gasLineAmt + extraWireAmt + liftAmt + removalFee + laborAmt + permitAmt + startupAmt + evChargerAmt + customNonTaxableAmt;
  const subtotal    = taxableBase + nonTaxableBase;
  const discountAmt = g.discountType === '%'
    ? roundCents(subtotal * ((Number(g.discount) || 0) / 100))
    : (Number(g.discount) || 0);
  const taxedAmount = subtotal > 0
    ? Math.max(0, taxableBase - (discountAmt * taxableBase) / subtotal)
    : 0;
  const netSubtotal = roundCents(subtotal - discountAmt);
  const tax         = roundCents(taxedAmount * ((Number(g.taxRate) || 7) / 100));
  const total       = roundCents(netSubtotal + tax);
  const deposit     = roundCents(total * ((Number(g.depositPct) || 50) / 100));
  return { genP, padAmt, genStandAmt, smmTotal, surgeTotal, atsIncluded, atsBillableQty, atsAmt, extWarrantyAmt, liftAmt, removalFee, laborAmt, permitAmt, startupAmt, batteryAmt, emPanelAmt, gasLineAmt, extraWireAmt, ioSetGenAmt: 0, ioAtsInstallAmt: 0, ioConduitAmt: 0, ioConnectAmt: 0, ioGasAmt: 0, evChargerAmt, customTaxableAmt, customNonTaxableAmt, customTotal, subtotal, discountAmt, taxableBase, nonTaxableBase, taxedAmount, netSubtotal, tax, total, deposit };
}


// ── Install Only (customer-furnished generator) ────────────────────────────────────────

export type IoAts = 'customer-install' | 'apt-supply-install' | 'existing';
export type IoConduit = 'run' | 'wire-only' | 'existing';
export interface IoPrices {
  setGenAC: number; setGenLC: number; atsInstall: number; conduitBase: number; conduitPerFt: number;
  wirePullBase: number; wirePullPerFt: number; connect: number; gas: number;
}
export interface InstallOnlyScope {
  setGenerator: boolean; ats: IoAts; conduit: IoConduit; runFt: number; gas: boolean; permit: boolean;
  unitDesc: string; prices: IoPrices;
}

/** One entry per editable price: IoPrices key, its app_settings key, its built-in default. */
export const IO_PRICE_FIELDS: { key: keyof IoPrices; setting: string; fallback: number }[] = [
  { key: 'setGenAC',      setting: 'gen_io_set_gen_ac',       fallback: ADDON_P.ioSetGenAC },
  { key: 'setGenLC',      setting: 'gen_io_set_gen_lc',       fallback: ADDON_P.ioSetGenLC },
  { key: 'atsInstall',    setting: 'gen_io_ats_install',      fallback: ADDON_P.ioAtsInstall },
  { key: 'conduitBase',   setting: 'gen_io_conduit_base',     fallback: ADDON_P.ioConduitBase },
  { key: 'conduitPerFt',  setting: 'gen_io_conduit_per_ft',   fallback: ADDON_P.ioConduitPerFt },
  { key: 'wirePullBase',  setting: 'gen_io_wire_pull_base',   fallback: ADDON_P.ioWirePullBase },
  { key: 'wirePullPerFt', setting: 'gen_io_wire_pull_per_ft', fallback: ADDON_P.ioWirePullPerFt },
  { key: 'connect',       setting: 'gen_io_connect',          fallback: ADDON_P.ioConnect },
  { key: 'gas',           setting: 'gen_io_gas',              fallback: ADDON_P.ioGas },
];
export const IO_PERMIT_SETTING = 'gen_io_permit';
export const IO_SETTING_KEYS = [...IO_PRICE_FIELDS.map(f => f.setting), IO_PERMIT_SETTING];

function fallbackPrices(): IoPrices {
  return Object.fromEntries(IO_PRICE_FIELDS.map(f => [f.key, f.fallback])) as unknown as IoPrices;
}

/** A blank/invalid setting means "not set" (the built-in default applies), never $0. */
function settingAmount(v: unknown): number | undefined {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Company-default prices + permit from a map of app_settings values. */
export function ioDefaultsFromSettings(map: Record<string, string | undefined | null> = {}): { prices: IoPrices; permit: number } {
  const prices = fallbackPrices();
  for (const f of IO_PRICE_FIELDS) {
    const n = settingAmount(map[f.setting]);
    if (n !== undefined) prices[f.key] = n;
  }
  return { prices, permit: settingAmount(map[IO_PERMIT_SETTING]) ?? ADDON_P.ioPermit };
}

/** Per-key coercion of a stored/AI installOnly object — mirrors coerceInstallOnly in the
 *  frontend's genCalc.ts. Prices fall back per key; a deliberate 0 price stays 0. */
export function coerceInstallOnly(raw: unknown): InstallOnlyScope {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ft = Number(r.runFt);
  const rp = (r.prices && typeof r.prices === 'object' && !Array.isArray(r.prices) ? r.prices : {}) as Record<string, unknown>;
  const prices = fallbackPrices();
  for (const f of IO_PRICE_FIELDS) {
    const v = rp[f.key];
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    if (Number.isFinite(n) && n >= 0) prices[f.key] = n;
  }
  return {
    setGenerator: typeof r.setGenerator === 'boolean' ? r.setGenerator : true,
    ats: r.ats === 'customer-install' || r.ats === 'apt-supply-install' || r.ats === 'existing' ? r.ats : 'customer-install',
    conduit: r.conduit === 'run' || r.conduit === 'wire-only' || r.conduit === 'existing' ? r.conduit : 'run',
    runFt: Number.isFinite(ft) && ft > 0 ? ft : 0,
    gas: typeof r.gas === 'boolean' ? r.gas : false,
    permit: typeof r.permit === 'boolean' ? r.permit : true,
    unitDesc: typeof r.unitDesc === 'string' ? r.unitDesc : '',
    prices,
  };
}

/** Mirrors calcInstallOnlyTotals in the frontend's genCalc.ts. */
function calcInstallOnlyTotals(g: Record<string, unknown>) {
  const io = coerceInstallOnly(g.installOnly);
  const P = io.prices;
  const set = io.setGenerator;
  const coolingType = String(g.coolingType || 'air-cooled');
  const lc = coolingType === 'liquid-cooled';
  const size = String(g.size || '14KW');
  const genP = 0;
  const genStandAmt = set ? (g.genStand === 'small' ? ADDON_P.genStandSmall : g.genStand === 'big' ? ADDON_P.genStandBig : 0) : 0;
  const noStand = g.genStand !== 'small' && g.genStand !== 'big';
  const padAmt = (set && g.pad && noStand) ? (lc ? (parseInt(size) >= 60 ? ADDON_P.padLC_large : ADDON_P.padLC_small) : ADDON_P.pad) : 0;
  const smmTotal   = Number(g.smmQty || 0) * ADDON_P.smm;
  const surgeTotal = Number(g.surgeProQty || 0) * ADDON_P.surgePro;
  const batteryAmt = (set && g.battery) ? ADDON_P.battery : 0;
  const emPanelAmt = g.emPanel ? ADDON_P.emPanel : 0;
  const atsQty = Math.max(0, Number(g.atsQty || 0));
  const atsIncluded = 0;
  const atsBillableQty = io.ats === 'apt-supply-install' ? atsQty : 0;
  const atsAmt = atsBillableQty * ADDON_P.ats;
  const liftAmt = set ? (g.liftType === 'lull' ? ADDON_P.lull : g.liftType === 'crane' ? ADDON_P.crane : 0) : 0;
  const ioSetGenAmt = set ? (lc ? P.setGenLC : P.setGenAC) : 0;
  const ioAtsInstallAmt = io.ats === 'existing' ? 0 : atsQty * P.atsInstall;
  const ioConduitAmt = io.conduit === 'run' ? P.conduitBase + io.runFt * P.conduitPerFt
    : io.conduit === 'wire-only' ? P.wirePullBase + io.runFt * P.wirePullPerFt : 0;
  const ioConnectAmt = P.connect;
  const ioGasAmt = io.gas ? P.gas : 0;
  // A deliberate $0 additional labor / permit stays $0 (NOT the `|| default` of the other types).
  const laborAmt   = Number(g.labor) || 0;
  const permitAmt  = io.permit ? (Number(g.permit) || 0) : 0;
  // Startup is always included and cannot be zeroed out.
  const startupAmt = lc ? ADDON_P.startupLC : (Number(g.startup) > 0 ? Number(g.startup) : ADDON_P.startup);
  const evOverride = Number(g.evChargerPriceOverride);
  const evChargerAmt = g.evCharger
    ? (g.evChargerPriceOverride !== null && g.evChargerPriceOverride !== undefined && Number.isFinite(evOverride)
        ? evOverride
        : (EV_TIER_PRICE[String(g.evChargerTier)] ?? 0))
    : 0;
  const customSums = customItemSums(g.customItems);
  const customTaxableAmt    = customSums.taxable;
  const customNonTaxableAmt = customSums.nonTaxable;
  const customTotal         = customTaxableAmt + customNonTaxableAmt;
  const extWarrantyAmt = 0, removalFee = 0, gasLineAmt = 0, extraWireAmt = 0;

  const taxableBase    = padAmt + genStandAmt + batteryAmt + atsAmt + smmTotal + surgeTotal + emPanelAmt + customTaxableAmt;
  const nonTaxableBase = liftAmt + laborAmt + permitAmt + startupAmt + evChargerAmt + customNonTaxableAmt
    + ioSetGenAmt + ioAtsInstallAmt + ioConduitAmt + ioConnectAmt + ioGasAmt;
  const subtotal    = taxableBase + nonTaxableBase;
  const discountAmt = g.discountType === '%'
    ? roundCents(subtotal * ((Number(g.discount) || 0) / 100))
    : (Number(g.discount) || 0);
  const taxedAmount = subtotal > 0
    ? Math.max(0, taxableBase - (discountAmt * taxableBase) / subtotal)
    : 0;
  const netSubtotal = roundCents(subtotal - discountAmt);
  const tax         = roundCents(taxedAmount * ((Number(g.taxRate) || 7) / 100));
  const total       = roundCents(netSubtotal + tax);
  const deposit     = roundCents(total * ((Number(g.depositPct) || 50) / 100));
  return { genP, padAmt, genStandAmt, smmTotal, surgeTotal, atsIncluded, atsBillableQty, atsAmt, extWarrantyAmt, liftAmt, removalFee, laborAmt, permitAmt, startupAmt, batteryAmt, emPanelAmt, gasLineAmt, extraWireAmt, ioSetGenAmt, ioAtsInstallAmt, ioConduitAmt, ioConnectAmt, ioGasAmt, evChargerAmt, customTaxableAmt, customNonTaxableAmt, customTotal, subtotal, discountAmt, taxableBase, nonTaxableBase, taxedAmount, netSubtotal, tax, total, deposit };
}

/** Post-process an AI-extracted form whose jobType is "install-only": sanitize the scope,
 *  force the fields that don't apply, and take every price from the company defaults (the AI
 *  never sets prices). `parsed` is the raw AI object, so we can tell "AI said 0" from "AI
 *  said nothing". The generator-to-ATS connection and startup have no field, so nothing the
 *  AI returns can remove them; startup is re-defaulted if it comes back unusable. */
export function normalizeInstallOnly(
  form: Record<string, unknown>,
  parsed: Record<string, unknown>,
  defaults: { prices: IoPrices; permit: number } = { prices: fallbackPrices(), permit: ADDON_P.ioPermit },
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...form, jobType: 'install-only' };
  const scope = coerceInstallOnly(parsed.installOnly);
  scope.prices = { ...defaults.prices };
  out.installOnly = scope;
  out.genPriceOverride = null;
  out.extWarranty = 'none';
  out.extWarrantyPromoStart = ''; out.extWarrantyPromoEnd = '';
  out.removal = false;
  out.gasLine = false;
  out.extraWire = 0;
  out.removalFee = 0;
  // Additional labor defaults to 0 (not the $3,000 new-install labor); permit to the io default.
  const labor = Number(parsed.labor);
  out.labor = parsed.labor !== undefined && parsed.labor !== null && parsed.labor !== '' && Number.isFinite(labor) && labor >= 0 ? labor : 0;
  const permit = Number(parsed.permit);
  out.permit = parsed.permit !== undefined && parsed.permit !== null && parsed.permit !== '' && Number.isFinite(permit) && permit >= 0 ? permit : defaults.permit;
  if (!(Number(out.startup) > 0)) out.startup = ADDON_P.startup;
  // ATS count only matters when an ATS is being installed.
  if (scope.ats !== 'existing') out.atsQty = Math.max(1, Number(out.atsQty) || 0);
  // Anything that only applies when APT sets the unit is dropped when it doesn't.
  if (!scope.setGenerator) {
    out.pad = false; out.genStand = 'none'; out.liftType = 'none'; out.battery = false;
  } else {
    // Battery isn't forced (as it is on new installs): default on, but honor an explicit no.
    out.battery = parsed.battery === undefined ? true : !!parsed.battery;
    if (out.genStand === 'small' || out.genStand === 'big') out.pad = false;
  }
  return out;
}
