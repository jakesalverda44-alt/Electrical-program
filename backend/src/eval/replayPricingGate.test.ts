// Fix round (Opus review of Builder P) — the pricing policy, tested without any
// rendering (no pdftoppm): a submitted, non-calibration bid keeps its price; an
// estimating or calibration bid gets the new rows / units.
import { describe, it, expect } from 'vitest';
import { replayPricing } from './replayEval';
import { loadKissimmeeLive0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { textSheets0930 } from '../test/fixtures/realrun/feeders0930';

describe('B1 — the stage gate covers the equipment-unit decisions', () => {
  const live = loadKissimmeeLive0930();
  const lib = loadLiveLibrary0930();
  const feeders = { textSheets: textSheets0930() };

  it('Kissimmee live@submitted, calibration=false: the stored proposal price does not move ($42,916.83 / 364.5375 h)', async () => {
    const r = await replayPricing(live, lib, { rows: 'live', feeders });
    expect(r.sellingPrice).toBe(42916.83);
    expect(r.hours).toBeCloseTo(364.5375, 4);
  });

  it('with calibration=true the same bid gets the new rows (units by code, site poles, heads)', async () => {
    const off = await replayPricing(live, lib, { rows: 'live', feeders });
    const on = await replayPricing(live, lib, { rows: 'live', feeders, calibration: true });
    expect(on.sellingPrice).toBeGreaterThan(off.sellingPrice + 5000);
    expect(on.hours).toBeGreaterThan(off.hours + 20);
  });
});
