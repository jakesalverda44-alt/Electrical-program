// Backend generator totals (build-from-notes path) — Install Only branch parity with the
// frontend, legacy-type stability, and the AI normalizer. Pure: no DB, no AI.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installOnlyIssues, installOnlySendIssues, IO_ISSUE_INCOMPLETE, IO_ISSUE_RUNFT, IO_ISSUE_PAD_WITHOUT_SET, IO_ISSUE_ATS_QTY, IO_ISSUE_STARTUP, calcFormTotals, normalizeInstallOnly, coerceInstallOnly, ioDefaultsFromSettings, ADDON_P } from '../utils/genTotals';

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
  it('startup uses the form value exactly and the connection is always billed', () => {
    const c = parity.find(x => x.name === 'preset-full')!;
    expect(calcFormTotals({ ...c.form, startup: 800 }).startupAmt).toBe(800);
    const t = calcFormTotals({ ...c.form, startup: 0 });
    expect(t.startupAmt).toBe(0);
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
  it('labor is always 0 and permit the company default, whatever the AI returns', () => {
    const parsed = { installOnly: {}, labor: 3000, permit: 1250 };
    const f = normalizeInstallOnly({ ...aiForm(), labor: 3000, permit: 1250 }, parsed);
    expect(f.labor).toBe(0);
    expect(f.permit).toBe(ADDON_P.ioPermit);
    const g = normalizeInstallOnly({ ...aiForm(), labor: 250, permit: 0 }, { ...parsed, labor: 250, permit: 0 }, ioDefaultsFromSettings({ gen_io_permit: '525' }));
    expect(g.labor).toBe(0);
    expect(g.permit).toBe(525);
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
  it('SMM defaults to 0 unless the AI named a quantity', () => {
    expect(run({ smmQty: undefined, installOnly: {} }).smmQty).toBe(0);
    const f = normalizeInstallOnly({ ...aiForm(), smmQty: 1 }, { installOnly: {}, smmQty: 2 });
    expect(f.smmQty).toBe(1);   // the form carries the merged AI value; the normalizer leaves a named quantity alone
  });
  it('12KW load-center unit: no ATS qty, no APT ATS, ONE load-center charge', () => {
    const f = run({ size: '12KW', installOnly: { ats: 'apt-supply-install', runFt: 10 } });
    expect(f.atsQty).toBe(0);
    expect((f.installOnly as { ats: string }).ats).toBe('customer-install');
    const t = calcFormTotals(f);
    expect(t.ioAtsInstallAmt).toBe(ADDON_P.ioAtsInstall);
    expect(t.atsAmt).toBe(0);
    expect(installOnlyIssues(f)).toEqual([]);
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

const issuesParity = JSON.parse(readFileSync(
  join(__dirname, '../../../frontend/src/features/builder/__fixtures__/ioIssuesParity.json'), 'utf8',
)) as { name: string; form: Record<string, unknown>; issues: string[] }[];

describe('installOnlyIssues — parity with the frontend validator', () => {
  it.each(issuesParity.map(c => [c.name, c] as const))('%s', (_n, c) => {
    expect(installOnlyIssues(c.form)).toEqual(c.issues);
  });
  it('is empty for other job types', () => {
    expect(installOnlyIssues({ jobType: 'new-install' })).toEqual([]);
    expect(installOnlySendIssues({ jobType: 'swap-out' })).toEqual([]);
  });
  it('a never-set-up (lead-converted) install-only form is blocked from sending', () => {
    expect(installOnlySendIssues({ jobType: 'install-only', brand: 'Kohler', size: '14KW' })).toEqual([IO_ISSUE_INCOMPLETE]);
    const ok = issuesParity.find(c => c.name === 'ok-full')!.form;
    expect(installOnlySendIssues(ok)).toEqual([]);
  });
});

describe('12KW load-center parity and validator shape', () => {
  it('fixture covers the load-center and $0-startup cases', () => {
    for (const n of ['12kw-loadcenter-install', '12kw-loadcenter-existing', '12kw-loadcenter-overridden-price', 'zero-startup']) {
      expect(parity.some(c => c.name === n), n).toBe(true);
    }
    const lc = parity.find(c => c.name === '12kw-loadcenter-install')!;
    expect(calcFormTotals(lc.form).ioAtsInstallAmt).toBe(ADDON_P.ioAtsInstall);
    expect(parity.find(c => c.name === 'zero-startup')!.expected.startupAmt).toBe(0);
  });
  it('validates a sparse stored form on the same blank defaults the frontend merges', () => {
    const sparse = { jobType: 'install-only', labor: 0, permit: 475,
      installOnly: { setGenerator: true, ats: 'customer-install', conduit: 'run', runFt: 10, gas: false, permit: true, unitDesc: '' } };
    expect(installOnlyIssues(sparse)).toEqual([]);
    // no setGenerator + missing pad key: blank default pad:true applies, as in the drawer
    expect(installOnlyIssues({ ...sparse, installOnly: { ...sparse.installOnly, setGenerator: false } })).toEqual([IO_ISSUE_PAD_WITHOUT_SET]);
  });
  it('issue strings match the shared message fixture', () => {
    const m = JSON.parse(readFileSync(join(__dirname, '../../../frontend/src/features/builder/__fixtures__/ioMessages.json'), 'utf8'));
    expect(m).toEqual({ runFt: IO_ISSUE_RUNFT, padWithoutSet: IO_ISSUE_PAD_WITHOUT_SET, atsQty: IO_ISSUE_ATS_QTY, startup: IO_ISSUE_STARTUP, incomplete: IO_ISSUE_INCOMPLETE });
  });
});
