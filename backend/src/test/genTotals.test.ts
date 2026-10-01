// Backend generator totals (build-from-notes path) — Install Only branch parity with the
// frontend, legacy-type stability, and the AI normalizer. Pure: no DB, no AI.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calcFormTotals, normalizeInstallOnly, coerceInstallOnly, ioDefaultsFromSettings, ADDON_P } from '../utils/genTotals';

// The shared parity fixture lives with the frontend suite, which asserts the same expectations
// against calcGenTotals — so a drift in either calc breaks one of the two suites.
const parity = JSON.parse(readFileSync(
  join(__dirname, '../../../frontend/src/features/builder/__fixtures__/ioParity.json'), 'utf8',
)) as { name: string; form: Record<string, unknown>; expected: Record<string, number> }[];

describe('calcFormTotals — Install Only parity with the frontend', () => {
  it('has the fixture cases', () => {
    expect(parity.length).toBeGreaterThanOrEqual(8);
    expect(parity.some(c => c.name === 'deliberate-zero-labor-permit')).toBe(true);
    expect(parity.some(c => c.name.startsWith('overridden'))).toBe(true);
  });
  it.each(parity.map(c => [c.name, c] as const))('%s', (_n, c) => {
    const t = calcFormTotals(c.form) as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(c.expected)) expect(t[k], k).toBe(v);
  });

  it('a deliberate 0 labor/permit stays 0 (not 3000 / 1250)', () => {
    const c = parity.find(x => x.name === 'deliberate-zero-labor-permit')!;
    const t = calcFormTotals(c.form);
    expect(t.laborAmt).toBe(0);
    expect(t.permitAmt).toBe(0);
  });
  it('startup cannot be zeroed and the connection is always billed', () => {
    const c = parity.find(x => x.name === 'preset-full')!;
    const t = calcFormTotals({ ...c.form, startup: 0 });
    expect(t.startupAmt).toBe(ADDON_P.startup);
    expect(t.ioConnectAmt).toBe(ADDON_P.ioConnect);
  });
});

// Totals captured from the pre-Install-Only calcFormTotals (git 862ce66) for fixed forms.
const legacy = JSON.parse(readFileSync(join(__dirname, 'fixtures/genTotals.legacy.json'), 'utf8')) as
  { name: string; form: Record<string, unknown>; totals: Record<string, number> }[];

describe('calcFormTotals — new-install / swap-out unchanged', () => {
  it.each(legacy.map(c => [c.name, c] as const))('%s', (_n, c) => {
    const t = calcFormTotals(c.form) as unknown as Record<string, number>;
    const legacyTotals = c.totals;
    for (const [k, v] of Object.entries(legacyTotals)) expect(t[k], k).toBe(v);
    for (const k of Object.keys(t)) if (k.startsWith('io')) expect(t[k]).toBe(0);
  });
});

describe('normalizeInstallOnly', () => {
  const aiForm = (over: Record<string, unknown> = {}) => ({
    jobType: 'install-only', brand: 'Kohler', coolingType: 'air-cooled', size: '14KW', atsQty: 1,
    labor: 3000, permit: 1250, startup: 695, pad: true, battery: true, genPriceOverride: 9999,
    extWarranty: 'paid', removal: true, gasLine: true, extraWire: 50, removalFee: 500, genStand: 'none', liftType: 'none',
    ...over,
  });
  const run = (parsed: Record<string, unknown>, defaults?: Parameters<typeof normalizeInstallOnly>[2]) =>
    normalizeInstallOnly({ ...aiForm(), ...parsed }, parsed, defaults);

  it('sanitizes the scope and forces the fields that do not apply', () => {
    const f = run({ installOnly: { ats: 'bogus', conduit: 'wire-only', runFt: '35', gas: 'yes', setGenerator: 'maybe', prices: { connect: 0 } } });
    expect(f.installOnly).toMatchObject({ ats: 'customer-install', conduit: 'wire-only', runFt: 35, gas: false, setGenerator: true });
    expect(f).toMatchObject({ genPriceOverride: null, extWarranty: 'none', removal: false, gasLine: false, extraWire: 0, jobType: 'install-only' });
  });
  it('ignores any prices the AI returns and uses the company defaults', () => {
    const f = run({ installOnly: { prices: { connect: 1, setGenAC: 1 } } }, ioDefaultsFromSettings({ gen_io_connect: '500' }));
    const prices = (f.installOnly as { prices: Record<string, number> }).prices;
    expect(prices.connect).toBe(500);
    expect(prices.setGenAC).toBe(ADDON_P.ioSetGenAC);
  });
  it('labor defaults to 0 and permit to the io default when the AI says nothing', () => {
    const parsed = { installOnly: {} };
    const f = normalizeInstallOnly({ ...aiForm(), labor: 3000, permit: 1250 }, parsed);
    expect(f.labor).toBe(0);
    expect(f.permit).toBe(ADDON_P.ioPermit);
    expect(normalizeInstallOnly({ ...aiForm() }, parsed, ioDefaultsFromSettings({ gen_io_permit: '525' })).permit).toBe(525);
  });
  it('keeps an AI-stated labor / permit, including an explicit 0', () => {
    const f = run({ labor: 250, permit: 0, installOnly: {} });
    expect(f.labor).toBe(250);
    expect(f.permit).toBe(0);
  });
  it('battery is not forced on: defaults on when setGenerator, honors an explicit false, and is off without setGenerator', () => {
    expect(run({ installOnly: {} }).battery).toBe(true);
    expect(run({ battery: false, installOnly: {} }).battery).toBe(false);
    expect(run({ installOnly: { setGenerator: false } })).toMatchObject({ battery: false, pad: false, genStand: 'none', liftType: 'none' });
  });
  it('a gen stand replaces the pad', () => {
    expect(run({ genStand: 'big', installOnly: {} })).toMatchObject({ pad: false, genStand: 'big' });
  });
  it('re-defaults an unusable startup and keeps at least one ATS to install', () => {
    const f = run({ startup: 0, atsQty: 0, installOnly: { ats: 'apt-supply-install' } });
    expect(f.startup).toBe(ADDON_P.startup);
    expect(f.atsQty).toBe(1);
  });
  it('produces totals that pass through calcFormTotals', () => {
    const f = run({ installOnly: { conduit: 'run', runFt: 20 } });
    const t = calcFormTotals(f);
    expect(t.genP).toBe(0);
    expect(t.ioConduitAmt).toBe(ADDON_P.ioConduitBase + 20 * ADDON_P.ioConduitPerFt);
    expect(t.laborAmt).toBe(0);
  });
});

describe('coerceInstallOnly / settings defaults', () => {
  it('defaults a missing or malformed scope', () => {
    for (const bad of [undefined, null, 'x', [1]]) {
      expect(coerceInstallOnly(bad)).toMatchObject({ setGenerator: true, ats: 'customer-install', conduit: 'run', runFt: 0, gas: false, permit: true });
    }
  });
  it('blank / invalid settings fall back to the built-in defaults; a typed 0 is kept', () => {
    const d = ioDefaultsFromSettings({ gen_io_set_gen_ac: '800', gen_io_gas: '0', gen_io_connect: 'x', gen_io_conduit_base: '' });
    expect(d.prices.setGenAC).toBe(800);
    expect(d.prices.gas).toBe(0);
    expect(d.prices.connect).toBe(ADDON_P.ioConnect);
    expect(d.prices.conduitBase).toBe(ADDON_P.ioConduitBase);
  });
});
