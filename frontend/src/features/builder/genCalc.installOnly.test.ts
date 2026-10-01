import { describe, it, expect } from 'vitest';
import {
  blankGenForm, calcGenTotals, migrateGenForm, genPriceRows, applyJobType, applyIoPreset,
  matchIoPreset, installOnlyIssues, getGenSizes, ioPricesFromSettings, ioPermitFromSettings, applyInstallOnlyDefaults, IO_PRESETS, coerceInstallOnly,
} from './genCalc';
import { DEFAULT_PRICES, DEFAULT_IO_SCOPE, type GenForm, type InstallOnlyScope } from './genData';
import parity from './__fixtures__/ioParity.json';

const P = DEFAULT_PRICES.installOnly;
const fmt = (n: number) => `$${n}`;

function io(over: Partial<GenForm> = {}, scope: Partial<InstallOnlyScope> = {}, preset: Parameters<typeof applyIoPreset>[1] = 'full'): GenForm {
  const f = applyIoPreset(applyJobType({ ...blankGenForm(), ...over }, 'install-only'), preset);
  return { ...f, ...over, installOnly: { ...f.installOnly, runFt: 40, ...scope } };
}

describe('applyJobType', () => {
  it('install-only sets the forced defaults', () => {
    const f = applyJobType({ ...blankGenForm(), extWarranty: 'paid', removal: true, gasLine: true, extraWire: 9, genPriceOverride: 1 }, 'install-only');
    expect(f).toMatchObject({ jobType: 'install-only', labor: 0, permit: P.permit, genPriceOverride: null, extWarranty: 'none', removal: false, gasLine: false, extraWire: 0 });
    expect(f.installOnly).toEqual(DEFAULT_IO_SCOPE);
  });
  it('new-install / swap-out keep their previous defaults', () => {
    expect(applyJobType(blankGenForm(), 'swap-out')).toMatchObject({ jobType: 'swap-out', pad: false, labor: 1500, permit: 475 });
    expect(applyJobType(blankGenForm(), 'new-install', { gen_default_labor: '2800', gen_default_permit: '900' })).toMatchObject({ labor: 2800, permit: 900, gasLine: false });
    expect(applyJobType(blankGenForm(), 'new-install')).toMatchObject({ labor: 3000, permit: 1250 });
  });
  it('locks the 12KW load-center unit and swap-out drops its size', () => {
    const lc = applyJobType({ ...blankGenForm(), size: '12KW' }, 'install-only');
    expect(lc.atsQty).toBe(0);
    expect(lc.atsSize).toBe('100A');
    expect(applyJobType({ ...blankGenForm(), size: '12KW' }, 'swap-out').size).not.toBe('12KW');
  });
  it('install-only offers every size', () => {
    expect(getGenSizes({ brand: 'Kohler', coolingType: 'air-cooled', jobType: 'install-only' })).toContain('12KW');
  });
  it('atsQty is at least 1', () => {
    expect(applyJobType({ ...blankGenForm(), atsQty: 0 }, 'install-only').atsQty).toBe(1);
  });
});

describe('install-only totals', () => {
  it('has no generator price and zeros the forced fields', () => {
    const t = calcGenTotals(io({ genPriceOverride: 9999, extWarranty: 'paid', removal: true, gasLine: true, extraWire: 50 }));
    expect(t.genP).toBe(0);
    expect(t.extWarrantyAmt + t.removalFee + t.gasLineAmt + t.extraWireAmt).toBe(0);
  });

  it.each([
    ['full', { setGenerator: true, ats: 'customer-install', conduit: 'run', permit: true }],
    ['set-connect', { setGenerator: true, ats: 'existing', conduit: 'run', permit: true }],
    ['wire-pull', { setGenerator: false, ats: 'existing', conduit: 'wire-only', permit: false }],
    ['connect-only', { setGenerator: false, ats: 'existing', conduit: 'existing', permit: false }],
  ] as const)('preset %s total', (key, scope) => {
    const f = io({ smmQty: 0, taxRate: 0 }, {}, key);
    expect(matchIoPreset(f)).toBe(key);
    expect(f.installOnly).toMatchObject(scope);
    const t = calcGenTotals(f);
    const run = key === 'wire-pull' ? P.wirePullBase + 40 * P.wirePullPerFt : key === 'connect-only' ? 0 : P.conduitBase + 40 * P.conduitPerFt;
    const expected =
      (scope.setGenerator ? P.setGenAC + DEFAULT_PRICES.pad + DEFAULT_PRICES.battery : 0)
      + (key === 'full' ? P.atsInstall : 0) + run + P.connect + (scope.permit ? P.permit : 0) + DEFAULT_PRICES.startup;
    expect(t.total).toBe(expected);
  });

  it('each ATS mode x each conduit mode', () => {
    for (const ats of ['customer-install', 'apt-supply-install', 'existing'] as const) {
      for (const conduit of ['run', 'wire-only', 'existing'] as const) {
        const f = io({ smmQty: 0, taxRate: 0, atsQty: 2, pad: false, battery: false }, { ats, conduit, runFt: 10, permit: false });
        const t = calcGenTotals(f);
        expect(t.ioAtsInstallAmt).toBe(ats === 'existing' ? 0 : 2 * P.atsInstall);
        expect(t.atsAmt).toBe(ats === 'apt-supply-install' ? 2 * DEFAULT_PRICES.ats : 0);
        expect(t.ioConduitAmt).toBe(conduit === 'run' ? P.conduitBase + 10 * P.conduitPerFt : conduit === 'wire-only' ? P.wirePullBase + 10 * P.wirePullPerFt : 0);
        expect(t.ioConnectAmt).toBe(P.connect);
      }
    }
  });

  it('scales with runFt', () => {
    const a = calcGenTotals(io({}, { runFt: 10 })).ioConduitAmt;
    const b = calcGenTotals(io({}, { runFt: 20 })).ioConduitAmt;
    expect(b - a).toBe(10 * P.conduitPerFt);
  });

  it('liquid-cooled uses LC startup, LC set price and pad tiers', () => {
    const small = calcGenTotals(io({ coolingType: 'liquid-cooled', size: '48KW' }));
    const big = calcGenTotals(io({ coolingType: 'liquid-cooled', size: '60KW' }));
    expect(small.startupAmt).toBe(DEFAULT_PRICES.startupLC);
    expect(small.ioSetGenAmt).toBe(P.setGenLC);
    expect(small.padAmt).toBe(DEFAULT_PRICES.padLC_small);
    expect(big.padAmt).toBe(DEFAULT_PRICES.padLC_large);
  });

  it('permit on/off, and a deliberate $0 stays $0', () => {
    expect(calcGenTotals(io({}, { permit: true })).permitAmt).toBe(P.permit);
    expect(calcGenTotals(io({}, { permit: false })).permitAmt).toBe(0);
    const z = calcGenTotals(io({ labor: 0, permit: 0 }));
    expect(z.laborAmt).toBe(0);
    expect(z.permitAmt).toBe(0);
  });

  it('startup cannot be zeroed', () => {
    expect(calcGenTotals(io({ startup: 0 })).startupAmt).toBe(DEFAULT_PRICES.startup);
  });

  it('tax base holds pad, battery and APT ATS but none of the io labor', () => {
    const f = io({ smmQty: 0, atsQty: 1 }, { ats: 'apt-supply-install', gas: true });
    const t = calcGenTotals(f);
    expect(t.taxableBase).toBe(DEFAULT_PRICES.pad + DEFAULT_PRICES.battery + DEFAULT_PRICES.ats);
    expect(t.nonTaxableBase).toBe(t.ioSetGenAmt + t.ioAtsInstallAmt + t.ioConduitAmt + t.ioConnectAmt + t.ioGasAmt + t.permitAmt + t.startupAmt + t.laborAmt);
  });

  it('pad, battery, stand and lift only count with setGenerator', () => {
    const t = calcGenTotals(io({ pad: true, battery: true, genStand: 'small', liftType: 'crane' }, { setGenerator: false }));
    expect(t.padAmt + t.batteryAmt + t.genStandAmt + t.liftAmt + t.ioSetGenAmt).toBe(0);
  });

  it('discount is pro-rata across the bases', () => {
    const f = io({ smmQty: 0, discount: 10, discountType: '%', taxRate: 10 });
    const t = calcGenTotals(f);
    expect(t.discountAmt).toBeCloseTo(t.subtotal * 0.1, 2);
    expect(t.taxedAmount).toBeCloseTo(t.taxableBase * 0.9, 5);
  });

  it('price rows: no generator row, startup and connect always present', () => {
    const f = io();
    const rows = genPriceRows(f, calcGenTotals(f), fmt).map(r => r.label);
    expect(rows.some(l => /Kohler|KW/.test(l))).toBe(false);
    expect(rows).toContain('Startup & Commissioning');
    expect(rows).toContain('Generator-to-ATS Connection');
  });

  it.each(parity as unknown as { name: string; form: GenForm; expected: Record<string, number> }[])('parity fixture $name', ({ form, expected }) => {
    const t = calcGenTotals(form) as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(expected)) expect(t[k]).toBe(v);
  });
});

describe('migrate / coerce', () => {
  it('fills the default scope when installOnly is missing or malformed', () => {
    expect(migrateGenForm({}).installOnly).toEqual(DEFAULT_IO_SCOPE);
    expect(migrateGenForm({ installOnly: 'x' }).installOnly).toEqual(DEFAULT_IO_SCOPE);
    expect(migrateGenForm({ installOnly: [1] }).installOnly).toEqual(DEFAULT_IO_SCOPE);
  });
  it('coerces keys one by one', () => {
    expect(coerceInstallOnly({ ats: 'bogus', conduit: 'wire-only', runFt: '25', gas: 'yes', permit: false, setGenerator: false, unitDesc: 5 }))
      .toEqual({ ...DEFAULT_IO_SCOPE, conduit: 'wire-only', runFt: 25, permit: false, setGenerator: false });
    expect(coerceInstallOnly({ runFt: -3 }).runFt).toBe(0);
  });
  it('a partial lead-converted form gets the install-only defaults', () => {
    const f = applyInstallOnlyDefaults({ ...blankGenForm(), jobType: 'install-only' });
    expect(f.labor).toBe(0);
    expect(f.permit).toBe(P.permit);
  });
});

describe('installOnlyIssues / presets', () => {
  it('is empty for other job types', () => {
    expect(installOnlyIssues(blankGenForm())).toEqual([]);
  });
  it('blocks a missing runFt unless conduit already exists', () => {
    const f = io({}, { runFt: 0 });
    expect(installOnlyIssues(f).length).toBe(1);
    expect(installOnlyIssues({ ...f, installOnly: { ...f.installOnly, conduit: 'existing' } })).toEqual([]);
    expect(installOnlyIssues({ ...f, installOnly: { ...f.installOnly, runFt: NaN } }).length).toBe(1);
  });
  it('flags pad/stand/lift/battery without setGenerator', () => {
    expect(installOnlyIssues(io({ pad: true }, { setGenerator: false })).length).toBe(1);
    expect(installOnlyIssues(io({ genStand: 'big', pad: false, battery: false }, { setGenerator: false })).length).toBe(1);
    expect(installOnlyIssues(io({ liftType: 'lull', pad: false, battery: false }, { setGenerator: false })).length).toBe(1);
  });
  it('requires an ATS qty unless existing; load-center cannot take an APT ATS', () => {
    expect(installOnlyIssues(io({ atsQty: 0 })).length).toBe(1);
    expect(installOnlyIssues(io({ atsQty: 0 }, { ats: 'existing' }))).toEqual([]);
    expect(installOnlyIssues({ ...io({ size: '12KW' }), installOnly: { ...DEFAULT_IO_SCOPE, ats: 'apt-supply-install', runFt: 5 } }).length).toBe(1);
    expect(installOnlyIssues(io({ size: '12KW' }))).toEqual([]);
  });
  it('presets match, anything else is custom, and applying leaves runFt/unitDesc alone', () => {
    for (const p of IO_PRESETS) {
      const f = applyIoPreset(io({}, { runFt: 33, unitDesc: 'Generac 7043' }, 'full'), p.key);
      expect(matchIoPreset(f)).toBe(p.key);
      expect(f.installOnly.runFt).toBe(33);
      expect(f.installOnly.unitDesc).toBe('Generac 7043');
    }
    expect(matchIoPreset({ ...io(), battery: false })).toBe('custom');
  });
  it('unchecking setGenerator via a preset clears pad, stand and lift', () => {
    const f = applyIoPreset(io({ genStand: 'big', liftType: 'crane' }), 'wire-pull');
    expect(f).toMatchObject({ pad: false, genStand: 'none', liftType: 'none', battery: false });
  });
});

describe('editable prices', () => {
  it('settings defaults feed new proposals; blank/invalid settings fall back to the placeholders', () => {
    const p = ioPricesFromSettings({ gen_io_set_gen_ac: '800', gen_io_conduit_per_ft: '', gen_io_connect: 'abc', gen_io_gas: '0' });
    expect(p.setGenAC).toBe(800);
    expect(p.conduitPerFt).toBe(P.conduitPerFt);
    expect(p.connect).toBe(P.connect);
    expect(p.gas).toBe(0);                       // a typed 0 is a real price
    expect(ioPermitFromSettings({ gen_io_permit: '525' })).toBe(525);
    expect(ioPermitFromSettings({})).toBe(P.permit);
  });
  it('blankGenForm and applyJobType copy settings into installOnly.prices and permit', () => {
    const settings = { gen_io_set_gen_ac: '800', gen_io_permit: '525' };
    expect(blankGenForm(settings).installOnly.prices.setGenAC).toBe(800);
    const f = applyJobType(blankGenForm(), 'install-only', settings);
    expect(f.installOnly.prices.setGenAC).toBe(800);
    expect(f.permit).toBe(525);
  });
  it('a per-proposal price override drives the total; a deliberate 0 stays 0', () => {
    const base = io({ smmQty: 0, taxRate: 0 });
    const t0 = calcGenTotals(base);
    const edited = { ...base, installOnly: { ...base.installOnly, prices: { ...base.installOnly.prices, connect: 0, setGenAC: 1000 } } };
    const t1 = calcGenTotals(edited);
    expect(t1.ioConnectAmt).toBe(0);
    expect(t1.total).toBe(t0.total - P.connect + (1000 - P.setGenAC));
  });
  it('missing or invalid stored prices coerce to the fallbacks', () => {
    expect(coerceInstallOnly({ prices: { connect: -5, gas: 'x', setGenAC: '900' } }).prices)
      .toMatchObject({ connect: P.connect, gas: P.gas, setGenAC: 900 });
  });
});
