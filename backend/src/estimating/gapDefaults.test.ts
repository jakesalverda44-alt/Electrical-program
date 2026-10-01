// Gap-closing T10 — the OxBlue GE line (J13) and the optional Misc lump (J12).
import { describe, it, expect } from 'vitest';
import { defaultCostLine, parseCostLineDefaults, COST_LINE_DEFAULTS_V2, COST_LINE_DEFAULTS_V2_OXBLUE, oxblueSupportQuote, validateCostLineDefaultsJson, NO_COST_CONTEXT } from './costLineDefaults';
import { replayPricing } from '../eval/replayEval';
import { loadKissimmeeLive0930, load36th0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { textSheets0930 } from '../test/fixtures/realrun/feeders0930';

describe('J13 — OxBlue camera support', () => {
  it('the v2 rule adds $750 only with the setting AND a contractor-provides-the-support statement', () => {
    const k = loadKissimmeeLive0930();
    const q = oxblueSupportQuote(k.agent1);
    expect(q).toMatch(/providing the support structure for the camera/);
    const ctx = { ...NO_COST_CONTEXT, newBuild: true, oxblueSupport: q };
    expect(defaultCostLine('general_expense', COST_LINE_DEFAULTS_V2_OXBLUE, 600, ctx).amount).toBe(270 + 1800 + 950 + 750);
    expect(defaultCostLine('general_expense', COST_LINE_DEFAULTS_V2, 600, ctx).amount).toBe(270 + 1800 + 950);
    expect(defaultCostLine('general_expense', COST_LINE_DEFAULTS_V2_OXBLUE, 600, { ...ctx, oxblueSupport: null }).amount).toBe(270 + 1800 + 950);
    expect(oxblueSupportQuote(load36th0930().agent1)).toBeNull();
    expect(parseCostLineDefaults(JSON.stringify(COST_LINE_DEFAULTS_V2_OXBLUE)).items?.oxblueSupport).toBe(750);
    expect(validateCostLineDefaultsJson(JSON.stringify({ items: { oxblueSupport: -1 } }))).toEqual(['items.oxblueSupport must be at least 0']);
  });
  it('Kissimmee (due-fresh replay): GE $3,020 → $3,770', async () => {
    const r = await replayPricing(loadKissimmeeLive0930(), loadLiveLibrary0930(), { rows: 'live', stage: 'due', ignoreCostLineSeeds: true, feeders: { textSheets: textSheets0930() } });
    expect(r.generalExpenses).toBe(3770);
  });
});

describe('J12 — the Misc lump is offered, excluded', () => {
  it('Kissimmee (ground-up): one excluded ALW-MISC row, $0 in the totals; 36th (remodel): none', async () => {
    const lib = loadLiveLibrary0930();
    const k = await replayPricing(loadKissimmeeLive0930(), lib, { rows: 'live', stage: 'due', ignoreCostLineSeeds: true, detail: true, feeders: { textSheets: textSheets0930() } });
    const misc = k.lineDetail!.filter(l => /Misc materials & labor allowance/.test(l.description));
    expect(misc).toHaveLength(1);
    expect([misc[0].excluded, misc[0].qty]).toEqual([true, 1]);
    expect(k.hoursByGroup.misc ?? 0).toBeLessThan(2);
    const s = await replayPricing(load36th0930(), lib, { rows: 'live', stage: 'due', ignoreCostLineSeeds: true, detail: true, feeders: { textSheets: [] } });
    expect(s.lineDetail!.some(l => /Misc materials & labor allowance/.test(l.description))).toBe(false);
  });
});
