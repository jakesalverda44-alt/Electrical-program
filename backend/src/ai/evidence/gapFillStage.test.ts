// Evidence round 4.3 / 4.4 — the gap-fill / crop-check I/O, on the real
// Kissimmee E-1 raster crop and its real baseline GFCI marks. Proves the
// whole flow the fixture test also exercises: a reconciled shortfall ->
// SUGGESTED marks -> the crop check's accept/reject/reclass -> only
// "accept" (or a reclass to a real target) ever becomes a candidate a
// caller may count; gap-fill itself never counts anything.
import { describe, it, expect, beforeAll } from 'vitest';
import { buildRasterSet, KISSIMMEE_E1 } from '../../test/fixtures/evidence/buildRasterSheet';
import { loadKissimmeeBaseline, KISSIMMEE_FILE } from '../../test/fixtures/evidence/kissimmeeBaseline';
import { fakeAnthropic, systemText, userText } from '../../test/fixtures/takeoff/fakeAnthropic';
import { isPdftoppmAvailable } from '../documentPrep';
import { buildCountTargets } from '../countTargets';
import { runGapFillStage, buildGapFillJobs, applyGapFillResults, type GapFillSheetAsset, type GapFillCandidateOut } from './gapFillStage';
import type { ReconcileFinding } from './reconcile';
import type { SheetGeom } from './viewports';
import type { TypeCountResult } from '../countMerge';

const MODEL = 'claude-sonnet-4-6';
const baseline = loadKissimmeeBaseline();
const { targets } = buildCountTargets(baseline.agent1);
const E1_KEY = `${KISSIMMEE_FILE}#49`;
const E1_GEOM: SheetGeom = baseline.sheets.find(s => s.page === 49)!.geometry;
// The real baseline's own GFCI/WP GFI marks on E-1 (kissimmee-eval-baseline.json) — 11 total, matching the 11-vs-16 gap the round's report documents.
const existingMarks = baseline.marks.filter(m => m.sheetKey === E1_KEY && /GFCI|GFI/.test(m.typeKey)).map(m => ({ typeKey: m.typeKey, x: m.x, y: m.y }));

let have = false;
let pdf: Buffer;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  pdf = await buildRasterSet([KISSIMMEE_E1]);
}, 60_000);

function asset(): GapFillSheetAsset {
  return { page: 1, pdf, geometry: E1_GEOM, existingMarks };
}

describe('buildGapFillJobs', () => {
  it('one job per type per eligible (used) sheet; a joined finding ("S1+S2") becomes two jobs', () => {
    const types = [
      { key: 'GFCI', sheets: [{ sheetKey: E1_KEY, label: 'E-1', count: 7, used: true }] },
      { key: 'S1', sheets: [{ sheetKey: 'set.pdf#55', label: 'PH0.1', count: 2, used: true }] },
      { key: 'S2', sheets: [{ sheetKey: 'set.pdf#55', label: 'PH0.1', count: 1, used: true }] },
      { key: 'ZERO', sheets: [{ sheetKey: 'set.pdf#49', label: 'E-1', count: 0, used: false }] },
    ];
    const findings: ReconcileFinding[] = [
      { typeKey: 'GFCI', kind: 'gfci_confirm', source: 'E-1', expected: null, actual: 7, shortfall: null, reason: 'r' },
      { typeKey: 'S1+S2', kind: 'schedule_qty', source: 'LUMINAIRE SCHEDULE', expected: 4, actual: 3, shortfall: 1, reason: 'r' },
    ];
    const jobs = buildGapFillJobs(findings, types);
    expect(jobs.map(j => [j.typeKey, j.sheetKey])).toEqual([
      ['GFCI', E1_KEY], ['S1', 'set.pdf#55'], ['S2', 'set.pdf#55'],
    ]);
  });
  it('a type with no eligible sheet gets no job', () => {
    const jobs = buildGapFillJobs([{ typeKey: 'ZERO', kind: 'gfci_confirm', source: '', expected: null, actual: 0, shortfall: null, reason: '' }],
      [{ key: 'ZERO', sheets: [{ sheetKey: 's', label: 'S', count: 0, used: false }] }]);
    expect(jobs).toEqual([]);
  });
});

describe('runGapFillStage — accept / reject / reclass, never auto-counted', () => {
  it('an accepted candidate is a real, positioned mark; a rejected one is discarded (kept as evidence, not silently dropped)', async (ctx) => {
    if (!have) return ctx.skip();
    let gapFillCalls = 0, cropCheckCalls = 0;
    const { client } = fakeAnthropic((req) => {
      const sys = systemText(req);
      if (sys.includes('MISSED instances')) {
        gapFillCalls++;
        return { text: JSON.stringify({ marks: [
          { x: 0.2, y: 0.2, confidence: 'medium', note: 'possible symbol near the note callout' },
          { x: 0.8, y: 0.8, confidence: 'low', note: 'faint mark, could be a dimension tick' },
        ] }) };
      }
      if (sys.includes('verify SUGGESTED symbol marks')) {
        cropCheckCalls++;
        expect(userText(req)).toMatch(/Candidate c1:[\s\S]*Candidate c2:/);
        return { text: JSON.stringify({ decisions: [
          { id: 'c1', decision: 'accept', note: 'matches the confirmed example' },
          { id: 'c2', decision: 'reject', note: 'a dimension tick, not the symbol' },
        ] }) };
      }
      throw new Error(`unexpected call: ${sys.slice(0, 60)}`);
    });
    const jobs = [{ typeKey: 'GFCI', sheetKey: E1_KEY, reason: 'GFCI-family device on a raster sheet — a known undercount risk', findingKind: 'gfci_confirm' as const }];
    const out = await runGapFillStage({ client, model: MODEL, maxTokens: 8000, jobs, targets, assets: new Map([[E1_KEY, asset()]]) });
    expect(out.errors).toEqual([]);
    expect(gapFillCalls).toBe(1);
    expect(cropCheckCalls).toBe(1);
    expect(out.candidates).toHaveLength(2);
    const accepted = out.candidates.find(c => c.decision === 'accept')!;
    const rejected = out.candidates.find(c => c.decision === 'reject')!;
    expect(accepted).toMatchObject({ typeKey: 'GFCI', sheetKey: E1_KEY, decision: 'accept' });
    expect(Number.isFinite(accepted.x)).toBe(true);
    expect(Number.isFinite(accepted.y)).toBe(true);
    expect(rejected.decisionNote).toMatch(/dimension tick/);
  }, 60_000);

  it('excludes candidates too close to an already-counted mark before the crop check ever runs', async (ctx) => {
    if (!have) return ctx.skip();
    let cropCheckCalls = 0;
    const near = existingMarks[0];
    const { screenPosition } = await import('../../estimating/pageGeometry');
    const p = screenPosition(near.x, near.y, E1_GEOM.originX, E1_GEOM.originY, E1_GEOM.widthPt, E1_GEOM.heightPt, E1_GEOM.rotation);
    const page = { width: E1_GEOM.heightPt / 72, height: E1_GEOM.widthPt / 72 };
    const { client } = fakeAnthropic((req) => {
      const sys = systemText(req);
      if (sys.includes('MISSED instances')) return { text: JSON.stringify({ marks: [{ x: (p.x / 72) / page.width, y: (p.y / 72) / page.height, confidence: 'high', note: 'right on the existing mark' }] }) };
      if (sys.includes('verify SUGGESTED symbol marks')) { cropCheckCalls++; return { text: '{"decisions":[]}' }; }
      throw new Error('unexpected call');
    });
    const jobs = [{ typeKey: 'GFCI', sheetKey: E1_KEY, reason: 'r', findingKind: 'gfci_confirm' as const }];
    const out = await runGapFillStage({ client, model: MODEL, maxTokens: 8000, jobs, targets, assets: new Map([[E1_KEY, asset()]]) });
    expect(out.candidates).toEqual([]);
    expect(cropCheckCalls).toBe(0);
  }, 60_000);

  it('no marks found is a real, evidenced answer — no crop-check call, no error', async (ctx) => {
    if (!have) return ctx.skip();
    const { client, calls } = fakeAnthropic(() => ({ text: '{"marks":[]}' }));
    const jobs = [{ typeKey: 'GFCI', sheetKey: E1_KEY, reason: 'r', findingKind: 'gfci_confirm' as const }];
    const out = await runGapFillStage({ client, model: MODEL, maxTokens: 8000, jobs, targets, assets: new Map([[E1_KEY, asset()]]) });
    expect(out.candidates).toEqual([]);
    expect(calls).toHaveLength(1);
  }, 60_000);

  it('a malformed gap-fill reply is recorded as an error, never silently zero', async (ctx) => {
    if (!have) return ctx.skip();
    const { client } = fakeAnthropic(() => ({ text: 'not JSON at all' }));
    const jobs = [{ typeKey: 'GFCI', sheetKey: E1_KEY, reason: 'r', findingKind: 'gfci_confirm' as const }];
    const out = await runGapFillStage({ client, model: MODEL, maxTokens: 8000, jobs, targets, assets: new Map([[E1_KEY, asset()]]) });
    expect(out.candidates).toEqual([]);
    expect(out.errors[0]).toMatch(/GFCI on .*gap-fill could not run/);
  }, 60_000);
});

describe('applyGapFillResults — only accept/reclass ever raises a count', () => {
  const gfci: TypeCountResult = {
    key: 'GFCI', type: 'GFCI', description: 'GFCI receptacle', category: 'device', count: 11, heads: null,
    status: 'counted', reason: '', sheets: [{ sheetKey: E1_KEY, label: 'E-1', count: 11, used: true }], flags: [], wattage: null,
  };
  const wpGfi: TypeCountResult = { ...gfci, key: 'WP GFI', type: 'WP GFI', description: 'Weatherproof GFCI', count: 4 };
  const quantities = [{ item: 'GFCI — GFCI receptacle', qty: 11, countType: 'GFCI' }, { item: 'WP GFI', qty: 4, countType: 'WP GFI' }];
  const cand = (over: Partial<GapFillCandidateOut>): GapFillCandidateOut => ({
    typeKey: 'GFCI', sheetKey: E1_KEY, x: 100, y: 100, confidence: 'high', note: 'n', reason: 'a known undercount risk',
    decision: 'accept', decisionNote: 'matches the example', ...over,
  });

  it('accept: +1 to that type, a new mark, the takeoff row bumped, status/reason cleared if it was zero', () => {
    const zero: TypeCountResult = { ...gfci, key: 'N', type: 'N', count: 0, status: 'zero', reason: 'not found', sheets: [] };
    const r = applyGapFillResults([gfci, wpGfi, zero], quantities, [], [cand({}), cand({ typeKey: 'N', decision: 'accept' })]);
    expect(r.types.find(t => t.key === 'GFCI')!.count).toBe(12);
    expect(r.types.find(t => t.key === 'GFCI')!.components).toMatchObject({ gapfill: 1 });
    expect(r.types.find(t => t.key === 'GFCI')!.gapFill).toHaveLength(1);
    expect(r.types.find(t => t.key === 'N')).toMatchObject({ count: 1, status: 'counted', reason: '' });
    expect(r.marks).toEqual([{ sheetKey: E1_KEY, typeKey: 'GFCI', x: 100, y: 100 }, { sheetKey: E1_KEY, typeKey: 'N', x: 100, y: 100 }]);
    expect(r.quantities.find(q => q.countType === 'GFCI')!.qty).toBe(12);
    expect(r.accepted).toBe(2);
    expect(r.notApplied).toEqual([]);
    // Never mutates the inputs.
    expect(gfci.count).toBe(11);
  });

  it('reject: never raises anything, kept in notApplied (never silently dropped)', () => {
    const r = applyGapFillResults([gfci], quantities, [], [cand({ decision: 'reject', decisionNote: 'a note callout' })]);
    expect(r.types[0].count).toBe(11);
    expect(r.accepted).toBe(0);
    expect(r.notApplied).toHaveLength(1);
  });

  it('reclass: raises the RECLASSIFIED type, not the one gap-fill originally proposed', () => {
    const r = applyGapFillResults([gfci, wpGfi], quantities, [], [cand({ decision: 'reclass', reclassKey: 'WP GFI' })]);
    expect(r.types.find(t => t.key === 'GFCI')!.count).toBe(11);
    expect(r.types.find(t => t.key === 'WP GFI')!.count).toBe(5);
    expect(r.marks[0].typeKey).toBe('WP GFI');
  });

  it('a reclass target (or the original type) that no longer exists is never counted, and is kept in notApplied', () => {
    const r = applyGapFillResults([gfci], quantities, [], [cand({ decision: 'reclass', reclassKey: 'NOT A TYPE ANY MORE' })]);
    expect(r.accepted).toBe(0);
    expect(r.notApplied).toHaveLength(1);
  });

  it('pending (the crop check never answered) is never counted either', () => {
    const r = applyGapFillResults([gfci], quantities, [], [cand({ decision: 'pending' as GapFillCandidateOut['decision'] })]);
    expect(r.accepted).toBe(0);
    expect(r.notApplied).toHaveLength(1);
  });
});
