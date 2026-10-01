// One-off generator for ioParity.json (run: npx vite-node src/features/builder/__fixtures__/gen-io-parity.ts).
// The JSON is the shared frontend/backend parity fixture for the Install Only totals; after
// changing a placeholder price, re-run this and review the diff.
import { writeFileSync } from 'node:fs';
import { ioFallbackPrices } from '../genData';
import { installOnlyIssues, blankGenForm, applyJobType, applyIoPreset, calcGenTotals } from '../genCalc';
import type { GenForm } from '../genData';

const base = (over: Partial<GenForm>, preset: Parameters<typeof applyIoPreset>[1], io: Partial<GenForm['installOnly']>, after: Partial<GenForm> = {}): GenForm => {
  let f = applyJobType({ ...blankGenForm(), customer: 'Parity', ...over }, 'install-only', {});
  f = applyIoPreset(f, preset);
  return { ...f, ...after, installOnly: { ...f.installOnly, ...io } };
};

const cases: Record<string, GenForm> = {
  'preset-full': base({ size: '20KW' }, 'full', { runFt: 40 }),
  'preset-set-connect': base({ brand: 'Generac', size: '24KW', taxRate: 6.5 }, 'set-connect', { runFt: 25 }),
  'preset-wire-pull': base({}, 'wire-pull', { runFt: 60 }),
  'preset-connect-only': base({}, 'connect-only', { runFt: 0 }),
  'apt-ats-lc-discount-gas': base({ coolingType: 'liquid-cooled', size: '60KW', brand: 'Kohler', atsQty: 2, atsSize: '400A' }, 'full', { runFt: 80, ats: 'apt-supply-install', gas: true }, { liftType: 'crane', discount: 10, discountType: '%', smmQty: 2 }),
  'overridden-prices': base({ size: '24KW', brand: 'Generac', atsQty: 2 }, 'full', { runFt: 35, gas: true,
    prices: { ...ioFallbackPrices(), setGenAC: 900, conduitPerFt: 22, atsInstall: 600, connect: 0, gas: 650 } }),
  'overridden-wire-pull-prices': base({}, 'wire-pull', { runFt: 50, prices: { ...ioFallbackPrices(), wirePullBase: 300, wirePullPerFt: 15 } }),
  'deliberate-zero-labor-permit': base({ size: '14KW' }, 'full', { runFt: 10 }, { labor: 0, permit: 0 }),
};
const out = Object.entries(cases).map(([name, form]) => {
  const t = calcGenTotals(form);
  const { subtotal, taxableBase, nonTaxableBase, tax, total, deposit, laborAmt, permitAmt, startupAmt, ioSetGenAmt, ioAtsInstallAmt, ioConduitAmt, ioConnectAmt, ioGasAmt, atsAmt, padAmt, batteryAmt } = t;
  return { name, form, expected: { subtotal, taxableBase, nonTaxableBase, tax, total, deposit, laborAmt, permitAmt, startupAmt, ioSetGenAmt, ioAtsInstallAmt, ioConduitAmt, ioConnectAmt, ioGasAmt, atsAmt, padAmt, batteryAmt } };
});
const issueCases: Record<string, GenForm> = {
  'ok-full': base({}, 'full', { runFt: 40 }),
  'no-runft': base({}, 'full', { runFt: 0 }),
  'existing-conduit-no-runft-ok': base({}, 'connect-only', { runFt: 0 }),
  'pad-without-set': { ...base({}, 'wire-pull', { runFt: 10 }), pad: true },
  'battery-without-set': { ...base({}, 'wire-pull', { runFt: 10 }), battery: true },
  'stand-without-set': { ...base({}, 'wire-pull', { runFt: 10 }), genStand: 'big' },
  'lift-without-set': { ...base({}, 'wire-pull', { runFt: 10 }), liftType: 'lull' },
  'ats-qty-zero': base({}, 'full', { runFt: 10 }, { atsQty: 0 }),
  'ats-qty-zero-existing-ok': base({}, 'set-connect', { runFt: 10 }, { atsQty: 0 }),
  '12kw-loadcenter-apt-ats': base({ size: '12KW' }, 'full', { runFt: 10, ats: 'apt-supply-install' }),
  '12kw-loadcenter-ok': base({ size: '12KW' }, 'full', { runFt: 10 }),
  'zero-startup': base({}, 'full', { runFt: 10 }, { startup: 0 }),
  'lc-startup-zero-ok': base({ coolingType: 'liquid-cooled', size: '48KW' }, 'full', { runFt: 10 }, { startup: 0 }),
  'multiple': { ...base({}, 'wire-pull', { runFt: 0 }), pad: true, startup: 0 },
};
writeFileSync(new URL('./ioIssuesParity.json', import.meta.url), JSON.stringify(Object.entries(issueCases).map(([name, form]) => ({ name, form, issues: installOnlyIssues(form) })), null, 1) + '\n');
writeFileSync(new URL('./ioParity.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
