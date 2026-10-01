// Gap-closing T3 — "is this quote the fixture package?" (36th double count, S8).
import { describe, it, expect } from 'vitest';
import { fixturePackageQuestionFor, type QuoteRow } from './accubidBidData';
import { replayPricing } from '../eval/replayEval';
import { load36th0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';

const q = (over: Partial<QuoteRow> = {}): QuoteRow => ({ id: 'q1', description: 'materials. vendor', amount: 4470, taxPct: 0, markupPct: 18, status: 'budget_pending', vendor: null, sort: 0, fixturePackage: false, ...over });

describe('fixturePackageQuestionFor', () => {
  it('asks when an unflagged, unanswered quote sits beside fixture lines that still carry library material', () => {
    const r = fixturePackageQuestionFor([q()], 3005);
    expect(r?.quoteIds).toEqual(['q1']);
    expect(r?.message).toMatch(/^Quote 'materials\. vendor' \$4,470 and library fixture material \$3,005 are both priced — is this quote the fixture package\?/);
  });
  it('never asks after an answer (yes or no), with no fixture material, or with no quote', () => {
    expect(fixturePackageQuestionFor([q({ fixturePackage: true, fixturePackageDecided: true })], 3005)).toBeNull();
    expect(fixturePackageQuestionFor([q({ fixturePackageDecided: true })], 3005)).toBeNull();
    expect(fixturePackageQuestionFor([q()], 0)).toBeNull();
    expect(fixturePackageQuestionFor([], 3005)).toBeNull();
  });
  it('several quotes: one prompt, a lighting-worded quote first', () => {
    const r = fixturePackageQuestionFor([q({ id: 'gear', description: 'Switchgear' }), q({ id: 'lt', description: 'Lighting package' })], 100);
    expect(r?.quoteIds).toEqual(['lt', 'gear']);
  });
});

describe('36th replay (stage due)', () => {
  const live = load36th0930();
  const lib = loadLiveLibrary0930();
  const opts = { rows: 'live' as const, stage: 'due', ignoreCostLineSeeds: true, feeders: { textSheets: [] } };
  const quoteId = String((live.pricingContext.quotes[0] as { id?: string }).id);
  it('the prompt shows; Yes → the library fixture material leaves; No → the price stays and the prompt is gone', async () => {
    const asIs = await replayPricing(live, lib, opts);
    expect(asIs.fixturePackageQuestion?.quoteIds).toEqual([quoteId]);
    expect(asIs.sellingPrice).toBe(21357.35);
    const yes = await replayPricing(live, lib, { ...opts, quoteFixturePackage: { [quoteId]: true } });
    expect(yes.fixturePackageQuestion).toBeUndefined();
    expect(yes.sellingPrice).toBeLessThan(asIs.sellingPrice - 3000);
    const no = await replayPricing(live, lib, { ...opts, quoteFixturePackage: { [quoteId]: false } });
    expect(no.fixturePackageQuestion).toBeUndefined();
    expect(no.sellingPrice).toBe(21357.35);
    // eslint-disable-next-line no-console
    console.log(`[T3] 36th: as is $${asIs.sellingPrice} (fixture material $${asIs.fixturePackageQuestion?.fixtureMaterial}); Yes $${yes.sellingPrice}; No $${no.sellingPrice}`);
  });
});
