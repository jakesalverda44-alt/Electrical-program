import { describe, it, expect } from 'vitest';
import { calcGenTotals, genPriceRows } from './genCalc';
import { LEGACY_FORMS } from './__fixtures__/legacyGenForms';

// Install Only adds io* total fields; strip them so the legacy snapshot compares only the
// pre-existing keys (and asserts the new ones are 0 for the other types).
describe('new-install / swap-out totals are unchanged by Install Only', () => {
  for (const [name, form] of Object.entries(LEGACY_FORMS)) {
    it(name, async () => {
      const t = calcGenTotals(form) as unknown as Record<string, number>;
      const legacy: Record<string, number> = {};
      for (const [k, v] of Object.entries(t)) {
        if (k.startsWith('io')) expect(v).toBe(0);
        else legacy[k] = v;
      }
      await expect(JSON.stringify({ totals: legacy, rows: genPriceRows(form, t as never, n => `$${n}`) }, null, 1))
        .toMatchFileSnapshot(`./__fixtures__/legacy-totals/${name}.json`);
    });
  }
});
