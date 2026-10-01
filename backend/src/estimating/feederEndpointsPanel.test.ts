// Gap-closing T13 (J16) — 36th Street's "ELECTRICAL PANEL" is Panel A: the only unlabeled panel mark for the only
// panel nothing located, offered as `suggested` (quoted, never confirmed). The riser stays skipped (Q13).
import { describe, it, expect } from 'vitest';
import { estimateFeeders } from './feederEstimate';
import { endpointCandidates } from './feederEndpoints';
import { feederInput0930 } from '../test/fixtures/realrun/feeders0930';
import { load36th0930 } from '../test/fixtures/realrun/live0930';

describe('T13 — 36th HVAC circuits', () => {
  const live = load36th0930();
  const r = estimateFeeders({ ...feederInput0930({ live }), textSheets: [] });
  it('PANEL A takes the "ELECTRICAL PANEL" mark as a suggestion; the HVAC edges resolve at the suggested tier', () => {
    const a = r.endpointOf['PANEL A'];
    expect([a.source, a.confidence]).toEqual(['counted', 'suggested']);
    expect(a.note).toMatch(/the only unlabeled panel mark "ELECTRICAL PANEL" for the only panel not located \(".*Panels A\/B reused/);
    const hvac = r.estimates.filter(e => e.edge.from === 'PANEL A' && e.edge.kind === 'equipment');
    const done = hvac.filter(e => e.route.status === 'estimated');
    expect(done.map(e => e.edge.to).sort()).toEqual(['AHU-1', 'COMP-1', 'COMP-2']);
    for (const e of done) expect(e.route.tier, e.edge.id).toBe('suggested');
    // AHU-2 has no mark in the 0930 count (a counting gap, not this task's): a visible hold, never guessed.
    expect(hvac.find(e => e.edge.to === 'AHU-2')!.route.holds.join(' ')).toMatch(/Pin AHU-2 on the Plans view/);
    const emt = done.reduce((t, e) => t + (e.route.quantities?.conduitFt ?? 0), 0);
    // eslint-disable-next-line no-console
    console.log(`[T13] 36th HVAC edges (0930): ${hvac.map(e => `${e.edge.id} ${e.route.lengthFt ?? 'hold'} ft${e.route.tier ? ` (${e.route.tier})` : ''}`).join('; ')} — ${emt} ft of 3/4" EMT located (0929 export, all four: 392 ft)`);
    expect(emt).toBeGreaterThan(200);
  });
  it('the PANEL B mark is never reused; the riser stays skipped as existing', () => {
    expect(r.endpointOf['PANEL B'].note).toMatch(/counted PANEL B mark/);
    expect(r.graph.skipped.some(s => /existing/i.test(s.reason))).toBe(true);
  });
  it('two unlabeled panel types → a hold that says so, never a guess', () => {
    const marks = [{ typeKey: 'ELECTRICAL PANEL', sheetKey: 's', x: 1, y: 1 }, { typeKey: 'PANEL BOARD', sheetKey: 's', x: 5, y: 5 }];
    const types = [{ key: 'ELECTRICAL PANEL', status: 'counted' }, { key: 'PANEL BOARD', status: 'counted' }];
    const c = endpointCandidates(['PANEL A'], { types, marks });
    expect(c.get('PANEL A')).toEqual({ node: 'PANEL A', hold: 'Pin PANEL A on the Plans view (2 unlabeled panel marks could be it: ELECTRICAL PANEL, PANEL BOARD)' });
  });
});
