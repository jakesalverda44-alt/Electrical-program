// Accuracy round E1–E3 on the real Kissimmee 0930 export (PH0.1's real text
// runs give its scale; SCRIPTED locate mock where named).
import { describe, it, expect } from 'vitest';
import { siteGeometryRows, siteCircuits } from './siteGeometry';
import { estimateFeeders } from './feederEstimate';
import { DEFAULT_FEEDER_ESTIMATE } from './feederRoute';
import { feederInput0930, scriptedLocate } from '../test/fixtures/realrun/feeders0930';
import { loadKissimmeeLive0930 } from '../test/fixtures/realrun/live0930';

const live = loadKissimmeeLive0930();
const poles = [{ item: 'Type S1 — pole', qty: 2, libraryCode: 'LTG-POLE' }, { item: 'Type S2 — pole', qty: 1, libraryCode: 'LTG-POLE' }];
const run = (o: { locate?: boolean; texts?: string[]; resolve?: boolean }) => siteGeometryRows({
  feeders: estimateFeeders(feederInput0930({ locate: o.locate ? scriptedLocate() : undefined })),
  countResult: live.countResult as never, agent1: live.agent1 as never, texts: o.texts ?? [], takeoffRows: poles,
  settings: DEFAULT_FEEDER_ESTIMATE, resolveName: () => o.resolve ?? true,
});

describe('E1 — site circuits by geometry', () => {
  it('the site circuits off the panel schedule (A-12 soffit / A-13 wall packs are not site)', () => {
    expect(siteCircuits((live.agent1 as { panelCircuits: never }).panelCircuits)).toEqual({ panel: 'A', circuits: ['A-15', 'A-17', 'A-19'] });
  });
  it('PH0.1: building (wall-pack marks) → 3 poles nearest-first at the scale bar; replaces the ratio PVC', () => {
    const r = run({});
    const pvc = r.rows.find(x => x.item === 'Site lighting circuits — 1" PVC underground')!;
    expect(r.replacesRatioPvc).toBe(true);
    expect(pvc.evidence).toMatch(/Site lighting from PH0\.1 \(graphic scale bar 20\/0\/20\/40 ft \(text layer\)\): building entry → 3 poles nearest-first, \d+ pt × 0\.2776 ft\/pt × 1\.15 = \d+ ft \+ stub-ups 4 × \(2 \+ 3\) = 20 ft \+ interior run \(panel → building wall\) not included/);
    expect(r.rows.find(x => /#10 wire \(5 per run\)/.test(x.item))!.qty).toBe(pvc.qty * 5);
  });
  it('SCRIPTED locate: the interior part off Panel A on E-1 (approximate)', () => {
    expect(run({ locate: true }).math).toMatch(/interior PANEL A → nearest wall on E-1 ≈ \d+ ft \(approximate/);
  });
  it('no library items → a hold, never a partial price', () => {
    const r = run({ resolve: false });
    expect(r.replacesRatioPvc).toBe(false);
    expect(r.holds).toContain('needs: library items for 1" PVC and #10 wire');
  });
});

describe('E2 — pole bases / E3 — trenching', () => {
  it('anchor bolts installed by EC → an anchor-bolt set per pole (with the "verify" note)', () => {
    const r = run({ texts: ['Site poles, anchor bolts, templates AZ furnished; EC installs', 'Pole bases 3\' above grade; verify who pours bases'] });
    const a = r.rows.find(x => x.libraryCode === 'POLE-ANCHOR')!;
    expect(a.qty).toBe(3);
    expect(a.evidence).toMatch(/verify who pours/);
  });
  it('nothing said → a visible question; trenching is excluded by default', () => {
    const r = run({});
    expect(r.rows.find(x => x.item === 'Pole bases — who pours them?')!.evidence).toMatch(/^Who pours the pole bases\?/);
    const t = r.rows.find(x => x.item === 'Trenching — site route')!;
    expect([t.excluded, t.qty]).toEqual([true, r.routeFt]);
    expect(t.evidence).toMatch(/Chris carries no trenching on 5 of 5 BOMs/);
  });
});
