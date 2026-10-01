// Accuracy round D6 — MEASURE AND REPORT ONLY (Jake's decision 2: no
// change). The "…receptacle circuit, complete" assemblies (ASM-DUPLEX /
// ASM-GFCI / ASM-WPGFCI: 0.25 C EMT + 0.075 M #12 each) carry branch raceway
// and wire the footage allowance also carries (the box is already skipped).
// This prints the hours of that raceway + wire on both jobs.
import { describe, it, expect } from 'vitest';
import { replayPricing, libraryAfterMigrations } from '../eval/replayEval';
import { loadKissimmeeLive0930, load36th0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { textSheets0930 } from '../test/fixtures/realrun/feeders0930';

describe('D6 — receptacle-circuit assemblies vs the footage allowance (report only)', () => {
  it('prints the double-counted raceway + wire hours', async () => {
    const lib = loadLiveLibrary0930();
    const library = libraryAfterMigrations(lib.library);
    const byCode = new Map(library.items.map(i => [i.id, i]));
    const asm = library.assemblies.filter(a => /^ASM-(DUPLEX|GFCI|WPGFCI)$/.test(a.code));
    const perUnit = new Map(asm.map(a => [a.name, a.components.filter(c => /^(EMT|THHN)-/.test(c.item_code)).reduce((h, c) => h + (byCode.get(c.item_id)?.labor_hours ?? 0) * c.qty_per, 0)]));
    const out: string[] = [];
    let total = 0;
    for (const live of [loadKissimmeeLive0930(), load36th0930()]) {
      const r = await replayPricing(live, lib, { rows: 'live', stage: 'due', ignoreCostLineSeeds: true, detail: true, feeders: { textSheets: live.bid.name === 'AutoZone' ? textSheets0930() : [] } });
      let h = 0; let n = 0;
      for (const l of r.lineDetail!) if (l.matched && perUnit.has(l.matched)) { h += perUnit.get(l.matched)! * l.qty; n += l.qty; }
      total += h;
      out.push(`${live.bid.name}: ${n} receptacles on complete-circuit assemblies → ${h.toFixed(2)} h of raceway + wire also carried by the footage allowance (${(n ? h / n : 0).toFixed(2)} h each)`);
    }
    // eslint-disable-next-line no-console
    console.log(`[D6]\n${out.join('\n')}\nper unit: ${[...perUnit].map(([k, v]) => `${k} ${v.toFixed(3)} h`).join('; ')}`);
    // Gap-closing T7 (J9, est_receptacle_device_only = true, migration 168): the receptacles map to the bare device
    // while the footage allowance carries the branch wiring — the measured double count is gone (was 22.70 h K).
    expect(total).toBeCloseTo(0, 6);
  });

  it('gap-closing T7: device only swaps the K receptacles (devices ≈ 16 h, the box allowance takes the points back); 36th unchanged; off → as before', async () => {
    const lib = loadLiveLibrary0930();
    const k = loadKissimmeeLive0930();
    const opts = { rows: 'live' as const, stage: 'due', ignoreCostLineSeeds: true, detail: true, feeders: { textSheets: textSheets0930() } };
    const on = await replayPricing(k, lib, opts);
    const off = await replayPricing(k, { ...lib, appSettings: [...lib.appSettings, { key: 'est_receptacle_device_only', value: 'false' }] }, opts);
    expect(off.hoursByGroup.devices - on.hoursByGroup.devices).toBeGreaterThan(20);
    expect(on.hoursByGroup.devices).toBeGreaterThan(13);
    expect(on.hoursByGroup.devices).toBeLessThan(19);
    expect(on.hoursByGroup['boxes & rings']).toBeGreaterThan(off.hoursByGroup['boxes & rings']);
    const swapped = on.lineDetail!.filter(l => /duplex receptacle, spec grade|GFCI receptacle, weatherproof/.test(l.matched ?? ''));
    expect(swapped.length).toBeGreaterThanOrEqual(4);
    const s36 = load36th0930();
    const o36 = { rows: 'live' as const, stage: 'due', ignoreCostLineSeeds: true, feeders: { textSheets: [] } };
    const on36 = await replayPricing(s36, lib, o36);
    const off36 = await replayPricing(s36, { ...lib, appSettings: [...lib.appSettings, { key: 'est_receptacle_device_only', value: 'false' }] }, o36);
    expect(on36.hoursByGroup.devices).toBeCloseTo(off36.hoursByGroup.devices, 6);
  });
});
