// Evidence round 4.3 / 4.4 — the gap-fill / crop-check I/O, on the real
// Kissimmee E-1 raster crop and its real baseline GFCI marks. Proves the
// whole flow: a reconciled UNDER shortfall -> SUGGESTED marks -> the crop
// check's accept/reject/reclass -> (fix round B2) a suggestion only, NEVER
// a count by itself.
import { describe, it, expect, beforeAll } from 'vitest';
import { buildRasterSet, KISSIMMEE_E1 } from '../../test/fixtures/evidence/buildRasterSheet';
import { loadKissimmeeBaseline, KISSIMMEE_FILE } from '../../test/fixtures/evidence/kissimmeeBaseline';
import { fakeAnthropic, systemText, userText } from '../../test/fixtures/takeoff/fakeAnthropic';
import { isPdftoppmAvailable } from '../documentPrep';
import { buildCountTargets } from '../countTargets';
import {
  runGapFillStage, buildGapFillJobs, resolveGapFillCandidates, planSearchRect, MAX_GAPFILL_JOBS,
  type GapFillSheetAsset, type GapFillCandidateOut, type GapFillJob,
} from './gapFillStage';
import type { ReconcileFinding } from './reconcile';
import type { SheetGeom, Viewport } from './viewports';

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

function asset(over: Partial<GapFillSheetAsset> = {}): GapFillSheetAsset {
  return { page: 1, pdf, geometry: E1_GEOM, existingMarks, ...over };
}
const job = (over: Partial<GapFillJob> = {}): GapFillJob => ({
  typeKey: 'GFCI', sheetKey: E1_KEY, reason: 'r', findingKind: 'schedule_qty', source: 's', expected: 5, actual: 4, diff: 1, ...over,
});

describe('buildGapFillJobs', () => {
  it('one job per type per USED sheet (every used sheet, not just the first — S4); a joined finding ("S1+S2") becomes one job per type', () => {
    const types = [
      { key: 'GFCI', sheets: [{ sheetKey: E1_KEY, label: 'E-1', count: 7, used: true }, { sheetKey: 'set.pdf#50', label: 'E-2', count: 1, used: true }] },
      { key: 'S1', sheets: [{ sheetKey: 'set.pdf#55', label: 'PH0.1', count: 2, used: true }] },
      { key: 'S2', sheets: [{ sheetKey: 'set.pdf#55', label: 'PH0.1', count: 1, used: true }] },
      { key: 'ZERO', sheets: [{ sheetKey: 'set.pdf#49', label: 'E-1', count: 0, used: false }] },
    ];
    const findings: ReconcileFinding[] = [
      { typeKey: 'GFCI', kind: 'schedule_qty', direction: 'under', source: 'x', expected: 5, actual: 4, diff: 1, reason: 'r' },
      { typeKey: 'S1+S2', kind: 'schedule_qty', direction: 'under', source: 'LUMINAIRE SCHEDULE', expected: 4, actual: 3, diff: 1, reason: 'r' },
    ];
    const { jobs, jobsSkipped } = buildGapFillJobs(findings, types);
    expect(jobsSkipped).toBe(0);
    expect(jobs.map(j => [j.typeKey, j.sheetKey])).toEqual(expect.arrayContaining([
      ['GFCI', E1_KEY], ['GFCI', 'set.pdf#50'], ['S1', 'set.pdf#55'], ['S2', 'set.pdf#55'],
    ]));
    expect(jobs).toHaveLength(4);
  });
  it('an OVER finding gets no job — gap-fill has nothing to search for (B2)', () => {
    const { jobs } = buildGapFillJobs([{ typeKey: 'GFCI', kind: 'schedule_qty', direction: 'over', source: 'x', expected: 3, actual: 5, diff: 2, reason: 'r' }],
      [{ key: 'GFCI', sheets: [{ sheetKey: E1_KEY, label: 'E-1', count: 5, used: true }] }]);
    expect(jobs).toEqual([]);
  });
  it('a type with no eligible sheet gets no job', () => {
    const { jobs } = buildGapFillJobs([{ typeKey: 'ZERO', kind: 'schedule_qty', direction: 'under', source: '', expected: 1, actual: 0, diff: 1, reason: '' }],
      [{ key: 'ZERO', sheets: [{ sheetKey: 's', label: 'S', count: 0, used: false }] }]);
    expect(jobs).toEqual([]);
  });
  it('S4 — jobs are capped, ranked by the size of the shortfall, and the overflow is disclosed', () => {
    const findings: ReconcileFinding[] = Array.from({ length: MAX_GAPFILL_JOBS + 3 }, (_, i) => ({
      typeKey: `T${i}`, kind: 'schedule_qty' as const, direction: 'under' as const, source: 'x', expected: i + 1, actual: 0, diff: i + 1, reason: 'r',
    }));
    const types = findings.map(f => ({ key: f.typeKey, sheets: [{ sheetKey: 'sheet', label: 'S', count: 0, used: true }] }));
    const { jobs, jobsSkipped } = buildGapFillJobs(findings, types);
    expect(jobs).toHaveLength(MAX_GAPFILL_JOBS);
    expect(jobsSkipped).toBe(3);
    // Ranked by diff descending: the biggest shortfalls survive the cap.
    expect(jobs[0].typeKey).toBe(`T${findings.length - 1}`);
  });
});

describe('planSearchRect — B1: restricted to countable (main/enlarged) viewports', () => {
  const vp = (kind: Viewport['kind'], rectIn: Viewport['rectIn']): Viewport => ({ id: 'v', number: '', title: '', scale: '', kind, rectIn, bboxPt: { x0: 0, y0: 0, x1: 0, y1: 0 }, source: 'text', inPerFt: null });
  it('the bounding box of main + enlarged viewports only, never a legend/schedule/notes/detail one', () => {
    const vps = [
      vp('main_plan', { left: 0, top: 0, width: 20, height: 10 }),
      vp('enlarged_plan', { left: 15, top: 8, width: 5, height: 5 }),
      vp('legend', { left: 30, top: 0, width: 10, height: 10 }),
    ];
    expect(planSearchRect(vps)).toEqual({ left: 0, top: 0, width: 20, height: 13 });
  });
  it('null (whole-sheet fallback) when no viewports are known', () => {
    expect(planSearchRect(null)).toBeNull();
    expect(planSearchRect([])).toBeNull();
    expect(planSearchRect([vp('legend', { left: 0, top: 0, width: 5, height: 5 })])).toBeNull();
  });
});

describe('runGapFillStage — accept / reject / reclass; B1 viewport rejection; B2 candidate cap', () => {
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
        expect(userText(req)).toMatch(/COUNT TARGETS \(tag \| description\)/); // N1
        return { text: JSON.stringify({ decisions: [
          { id: 'c1', decision: 'accept', note: 'matches the confirmed example' },
          { id: 'c2', decision: 'reject', note: 'a dimension tick, not the symbol' },
        ] }) };
      }
      throw new Error(`unexpected call: ${sys.slice(0, 60)}`);
    });
    const jobs = [job({ diff: 2 })];
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

  it('B1 — a candidate landing outside every countable viewport is rejected before any crop-check call', async (ctx) => {
    if (!have) return ctx.skip();
    let cropCheckCalls = 0;
    const { client } = fakeAnthropic((req) => {
      const sys = systemText(req);
      // 0.9/0.9 lands outside the main-plan viewport below (which covers only the top-left quarter).
      if (sys.includes('MISSED instances')) return { text: JSON.stringify({ marks: [{ x: 0.9, y: 0.9, confidence: 'high', note: 'looks real, but off in the legend area' }] }) };
      if (sys.includes('verify SUGGESTED symbol marks')) { cropCheckCalls++; return { text: '{"decisions":[]}' }; }
      throw new Error('unexpected call');
    });
    const page = { width: E1_GEOM.heightPt / 72, height: E1_GEOM.widthPt / 72 };
    const mainPlan: Viewport = {
      id: 'main', number: '1', title: 'POWER PLAN', scale: '', kind: 'main_plan',
      rectIn: { left: 0, top: 0, width: page.width * 0.5, height: page.height * 0.5 },
      bboxPt: { x0: 0, y0: 0, x1: 0, y1: 0 }, source: 'text', inPerFt: null,
    };
    const out = await runGapFillStage({
      client, model: MODEL, maxTokens: 8000, jobs: [job()], targets,
      assets: new Map([[E1_KEY, asset({ searchRect: { left: 0, top: 0, width: page.width, height: page.height }, viewports: [mainPlan] })]]),
    });
    expect(cropCheckCalls).toBe(0);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]).toMatchObject({ decision: 'reject', decisionNote: expect.stringContaining('outside a countable plan viewport') });
  }, 60_000);

  it('B2 — the gap-fill prompt states the shortfall cap, and the reply is capped at it', async (ctx) => {
    if (!have) return ctx.skip();
    const { client } = fakeAnthropic((req) => {
      const sys = systemText(req);
      if (sys.includes('MISSED instances')) {
        expect(userText(req)).toMatch(/Return at most 1 NEW instance/);
        return { text: JSON.stringify({ marks: [{ x: 0.1, y: 0.1, confidence: 'high', note: 'a' }, { x: 0.2, y: 0.2, confidence: 'high', note: 'b' }] }) };
      }
      if (sys.includes('verify SUGGESTED symbol marks')) return { text: JSON.stringify({ decisions: [{ id: 'c1', decision: 'accept' }] }) };
      throw new Error('unexpected call');
    });
    const out = await runGapFillStage({ client, model: MODEL, maxTokens: 8000, jobs: [job({ diff: 1 })], targets, assets: new Map([[E1_KEY, asset()]]) });
    expect(out.candidates).toHaveLength(1); // capped at diff=1, even though the model returned 2
  }, 60_000);

  it('B1 — the exclusion list includes EXCLUDED marks too, not just counted ones', async (ctx) => {
    if (!have) return ctx.skip();
    const excludedIn = { x: 5, y: 5 }; // displayed inches
    const { displayedToPdf } = await import('../../estimating/pageGeometry');
    const pt = displayedToPdf(excludedIn.x * 72, excludedIn.y * 72, E1_GEOM.originX, E1_GEOM.originY, E1_GEOM.widthPt, E1_GEOM.heightPt, E1_GEOM.rotation);
    const page = { width: E1_GEOM.heightPt / 72, height: E1_GEOM.widthPt / 72 };
    let sawInAlreadyCounted = false;
    const { client } = fakeAnthropic((req) => {
      const sys = systemText(req);
      if (sys.includes('MISSED instances')) {
        const text = userText(req);
        const fx = Math.round((excludedIn.x / page.width) * 1000) / 1000;
        sawInAlreadyCounted = text.includes(String(fx));
        return { text: '{"marks":[]}' };
      }
      throw new Error('unexpected call');
    });
    await runGapFillStage({
      client, model: MODEL, maxTokens: 8000, jobs: [job()], targets,
      assets: new Map([[E1_KEY, asset({ existingMarks: [], excludedMarks: [{ typeKey: 'GFCI', x: pt.x, y: pt.y }] })]]),
    });
    expect(sawInAlreadyCounted).toBe(true);
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
    const out = await runGapFillStage({ client, model: MODEL, maxTokens: 8000, jobs: [job()], targets, assets: new Map([[E1_KEY, asset()]]) });
    expect(out.candidates).toEqual([]);
    expect(cropCheckCalls).toBe(0);
  }, 60_000);

  it('no marks found is a real, evidenced answer — no crop-check call, no error', async (ctx) => {
    if (!have) return ctx.skip();
    const { client, calls } = fakeAnthropic(() => ({ text: '{"marks":[]}' }));
    const out = await runGapFillStage({ client, model: MODEL, maxTokens: 8000, jobs: [job()], targets, assets: new Map([[E1_KEY, asset()]]) });
    expect(out.candidates).toEqual([]);
    expect(calls).toHaveLength(1);
  }, 60_000);

  it('a malformed gap-fill reply is recorded as an error, never silently zero', async (ctx) => {
    if (!have) return ctx.skip();
    const { client } = fakeAnthropic(() => ({ text: 'not JSON at all' }));
    const out = await runGapFillStage({ client, model: MODEL, maxTokens: 8000, jobs: [job()], targets, assets: new Map([[E1_KEY, asset()]]) });
    expect(out.candidates).toEqual([]);
    expect(out.errors[0]).toMatch(/GFCI on .*gap-fill could not run/);
  }, 60_000);

  it('S4 — a cached job answers with no call at all', async (ctx) => {
    if (!have) return ctx.skip();
    const store = new Map<string, unknown>();
    const cache = {
      async get(sha: string, page: number, kind: string, key: string) { return store.get(`${sha}|${page}|${kind}|${key}`) ?? null; },
      async set(sha: string, page: number, kind: string, key: string, v: unknown) { store.set(`${sha}|${page}|${kind}|${key}`, v); },
    };
    const first = fakeAnthropic(() => ({ text: '{"marks":[]}' }));
    const out1 = await runGapFillStage({ client: first.client, model: MODEL, maxTokens: 8000, jobs: [job()], targets, assets: new Map([[E1_KEY, asset({ sha: 'deadbeef' })]]), cache });
    expect(out1.calls).toBe(1);
    expect(out1.cachedJobs).toBe(0);
    const second = fakeAnthropic(() => { throw new Error('should not be called — cached'); });
    const out2 = await runGapFillStage({ client: second.client, model: MODEL, maxTokens: 8000, jobs: [job()], targets, assets: new Map([[E1_KEY, asset({ sha: 'deadbeef' })]]), cache });
    expect(out2.calls).toBe(0);
    expect(out2.errors).toEqual([]);
    expect(out2.cachedJobs).toBe(1);
  }, 60_000);
});

describe('resolveGapFillCandidates — B2: never a count, only a suggestion', () => {
  const cand = (over: Partial<GapFillCandidateOut>): GapFillCandidateOut => ({
    typeKey: 'GFCI', sheetKey: E1_KEY, x: 100, y: 100, confidence: 'high', note: 'n', reason: 'a known undercount risk',
    decision: 'accept', decisionNote: 'matches the example', ...over,
  });

  it('accept -> a suggestion for that type/sheet/position, nothing else', () => {
    const r = resolveGapFillCandidates([cand({})], new Map());
    expect(r.suggested).toEqual([{ typeKey: 'GFCI', sheetKey: E1_KEY, x: 100, y: 100, confidence: 'high', note: 'matches the example' }]);
    expect(r.notApplied).toEqual([]);
  });
  it('reject -> never a suggestion, kept in notApplied (never silently dropped)', () => {
    const r = resolveGapFillCandidates([cand({ decision: 'reject', decisionNote: 'a note callout' })], new Map());
    expect(r.suggested).toEqual([]);
    expect(r.notApplied).toHaveLength(1);
  });
  it('reclass -> a suggestion for the RECLASSIFIED type, not the one gap-fill originally proposed', () => {
    const r = resolveGapFillCandidates([cand({ decision: 'reclass', reclassKey: 'WP GFI' })], new Map());
    expect(r.suggested).toEqual([{ typeKey: 'WP GFI', sheetKey: E1_KEY, x: 100, y: 100, confidence: 'high', note: 'matches the example' }]);
  });
  it('pending (the crop check never answered) is never a suggestion', () => {
    const r = resolveGapFillCandidates([cand({ decision: 'pending' as GapFillCandidateOut['decision'] })], new Map());
    expect(r.suggested).toEqual([]);
    expect(r.notApplied).toHaveLength(1);
  });
  it('N1 — a reclass deduped against the reclassified type\'s own existing marks (or another suggestion already made for it)', () => {
    const existing = new Map([[`WP GFI@${E1_KEY}`, [{ x: 100, y: 100 }]]]);
    const r = resolveGapFillCandidates([cand({ decision: 'reclass', reclassKey: 'WP GFI' })], existing);
    expect(r.suggested).toEqual([]);
    expect(r.notApplied).toHaveLength(1);
    expect(r.notApplied[0].decisionNote).toMatch(/already known\/suggested/);
  });
});
