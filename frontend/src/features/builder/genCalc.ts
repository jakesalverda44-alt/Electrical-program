import { DEFAULT_PRICES, LC_MODELS, GEN_SPECS, GenForm } from './genData';

export function blankGenForm(): GenForm {
  return {
    customer: '', address: '', city: '', state: 'FL', zip: '', phone: '', email: '',
    brand: 'Kohler', coolingType: 'air-cooled', size: '14KW',
    ats: '200A', fuel: 'Natural Gas',
    pad: true, smm: true, surgePro: false, battery: false, extraWire: 0,
    liftType: 'none', removal: false, additionalATS: 0, lcATS: 'none',
    labor: DEFAULT_PRICES.labor,
    permit: DEFAULT_PRICES.permit,
    startup: DEFAULT_PRICES.startup,
    discount: 0, taxRate: 7,
    notes: '',
  };
}

export function getGenSizes(form: Pick<GenForm, 'brand' | 'coolingType'>): string[] {
  return Object.keys(DEFAULT_PRICES.generators[form.coolingType]?.[form.brand] ?? {});
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
  extraATS: number;
  lcATS: number;
  liftAmt: number;
  removalFee: number;
  laborAmt: number;
  permitAmt: number;
  startupAmt: number;
  batteryAmt: number;
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
  const smmTotal   = g.smm ? DEFAULT_PRICES.smm : 0;
  const surgeTotal = g.surgePro ? DEFAULT_PRICES.surgePro : 0;
  const batteryAmt = g.battery ? DEFAULT_PRICES.battery : 0;
  const extraWireAmt = Number(g.extraWire) * DEFAULT_PRICES.extraWire;
  const extraATS   = Number(g.additionalATS) * DEFAULT_PRICES.additionalATS;
  const lcATS      = g.lcATS === '150A' ? DEFAULT_PRICES.atsLC_150 : g.lcATS === '200A' ? DEFAULT_PRICES.atsLC_200 : 0;
  const liftAmt    = g.liftType === 'lull' ? DEFAULT_PRICES.lull : g.liftType === 'crane' ? DEFAULT_PRICES.crane : 0;
  const removalFee = g.removal ? 500 : 0;
  const laborAmt   = Number(g.labor);
  const permitAmt  = Number(g.permit);
  const startupAmt = g.coolingType === 'liquid-cooled' ? DEFAULT_PRICES.startupLC : Number(g.startup);

  const subtotal   = genP + padAmt + smmTotal + surgeTotal + batteryAmt + extraWireAmt + extraATS + lcATS + liftAmt + removalFee + laborAmt + permitAmt + startupAmt;
  const discountAmt = Number(g.discount) || 0;
  const taxable    = subtotal - discountAmt;
  const tax        = Math.round(taxable * (Number(g.taxRate) / 100));
  const total      = taxable + tax;
  const deposit    = Math.round(total * 0.5);

  return { genP, padAmt, smmTotal, surgeTotal, extraATS, lcATS, liftAmt, removalFee, laborAmt, permitAmt, startupAmt, batteryAmt, extraWireAmt, subtotal, discountAmt, taxable, tax, total, deposit };
}

export function genPriceRows(g: GenForm, t: GenTotals, fmt: (n: number) => string) {
  const rows: { label: string; amount: string }[] = [];
  rows.push({ label: `${g.brand} ${g.size} ${genModelNo(g)} (${g.coolingType})`, amount: fmt(t.genP) });
  if (t.padAmt)      rows.push({ label: 'Concrete Pad', amount: fmt(t.padAmt) });
  if (t.smmTotal)    rows.push({ label: 'SMM (Preventative Maintenance)', amount: fmt(t.smmTotal) });
  if (t.surgeTotal)  rows.push({ label: 'SurgeProtector Pro', amount: fmt(t.surgeTotal) });
  if (t.batteryAmt)  rows.push({ label: 'Battery Maintainer', amount: fmt(t.batteryAmt) });
  if (t.extraWireAmt) rows.push({ label: `Extra Wire (${g.extraWire} ft)`, amount: fmt(t.extraWireAmt) });
  if (t.extraATS)    rows.push({ label: `Additional ATS (${g.additionalATS})`, amount: fmt(t.extraATS) });
  if (t.lcATS)       rows.push({ label: `LC ATS (${g.lcATS})`, amount: fmt(t.lcATS) });
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
