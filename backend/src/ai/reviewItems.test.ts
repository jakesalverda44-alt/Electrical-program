import { describe, expect, it } from 'vitest';
import { carryOverResolutions, validateResolution, reviewResolutionsForAgent4, buildReviewItems, enforcedCounts, riskRank as riskRankOf, applyGroupMemberResolution, applyReconcileMemberResolution, spotCheckSamples, SPOTCHECK_MIN_COUNT, reviewItemIsOpen, type ReviewItem } from './reviewItems';
import { runCountingStage, type CountResult } from './countingStage';
import { mergeCountsIntoTakeoff } from './countMerge';
import { buildCountTargets } from './countTargets';
import { selectCountSheets } from './countSheets';
import { kissimmeeAgent1 } from '../test/fixtures/takeoff/agent1Fixtures';
import type Anthropic from '@anthropic-ai/sdk';
import { buildAgent4UserMessage } from './agent4Message';

const countItem = (id: string, over: Partial<ReviewItem> = {}): ReviewItem => ({ id, kind: 'count', title: `Type ${id}`, detail: '', ...over });
const scopeItem: ReviewItem = {
  id: 'scope:power_poles', kind: 'scope_question', title: 'Power poles', detail: 'Who furnishes and installs the power poles?',
  term: 'power_poles', question: 'Who furnishes and installs the power poles?', options: ['APT', 'GC', 'Owner'], notes: [],
};

describe('carryOverResolutions — a re-run never discards the estimator\'s resolutions', () => {
  it('keeps a resolution for the same item id, marks it carried over; drops resolutions for items that are gone', () => {
    const prev = [
      countItem('count:G', { resolution: { action: 'not_on_job', reason: 'generic legend', by: 'Jake', at: 't' } }),
      countItem('count:Z', { resolution: { action: 'count', qty: 3, by: 'Jake', at: 't' } }),
    ];
    const out = carryOverResolutions([countItem('count:G'), countItem('count:K')], prev);
    expect(out[0].resolution).toMatchObject({ action: 'not_on_job', carriedOver: true });
    expect(out[1].resolution).toBeUndefined();
    expect(out).toHaveLength(2);
  });
  it('a scope answer that is no longer a valid option is not carried', () => {
    const prev = [{ ...scopeItem, resolution: { action: 'answer' as const, answer: 'Vendor', by: 'J', at: 't' } }];
    expect(carryOverResolutions([scopeItem], prev)[0].resolution).toBeUndefined();
  });
});

describe('validateResolution', () => {
  it('scope questions accept only a listed option', () => {
    expect(validateResolution(scopeItem, { action: 'answer', answer: 'GC' }, null)).toEqual({ ok: true, resolution: { action: 'answer', answer: 'GC' } });
    expect(validateResolution(scopeItem, { action: 'answer', answer: 'gc lol' }, null)).toEqual({ ok: false, error: 'Choose one of: APT, GC, Owner.' });
    expect(validateResolution(scopeItem, { action: 'count', qty: 3 }, null).ok).toBe(false);
  });
  it('counts', () => {
    expect(validateResolution(countItem('count:A'), { action: 'count', qty: '12' }, null)).toEqual({ ok: true, resolution: { action: 'count', qty: 12 } });
    expect(validateResolution(countItem('count:A'), { action: 'count', qty: -1 }, null).ok).toBe(false);
  });
});

describe('Agent 4 receives the resolutions as authoritative', () => {
  it('renders each resolution and lands in the user message', () => {
    const items: ReviewItem[] = [
      countItem('count:G', { title: 'Type G — Downlight', resolution: { action: 'count', qty: 11, by: 'J', at: 't' } }),
      countItem('count:OS', { title: 'Type OS — Occupancy sensor', resolution: { action: 'not_on_job', reason: 'x', by: 'J', at: 't' } }),
      countItem('count:S1:heads', { title: 'Type S1 — fixture heads', resolution: { action: 'markers', qty: 2, by: 'J', at: 't' } }),
      { ...scopeItem, resolution: { action: 'answer', answer: 'GC', by: 'J', at: 't' } },
      countItem('count:Q'),
    ];
    const block = reviewResolutionsForAgent4(items)!;
    expect(block.split('\n').slice(2)).toEqual([
      '- Type G — Downlight: 11 EA (counted by the estimator).',
      '- Type OS — Occupancy sensor: NOT ON THIS JOB — omit it from the takeoff and scope.',
      '- Type S1 — fixture heads: 2 EA (confirmed on the plans).',
      '- Power poles: GC',
    ]);
    const msg = buildAgent4UserMessage({ price: '1000', agent1Output: '{}', agent2Output: '{}', reviewResolutions: block });
    expect(msg).toContain('--- ESTIMATOR-RESOLVED TAKEOFF REVIEW (AUTHORITATIVE) ---');
    expect(msg.indexOf('ESTIMATOR-RESOLVED')).toBeLessThan(msg.indexOf('--- DRAWING ANALYSIS (Agent 1) ---'));
    expect(reviewResolutionsForAgent4([countItem('count:Q')])).toBeNull();
  });
});

describe('buildReviewItems — scope questions', () => {
  it('adds one item per question', () => {
    const items = buildReviewItems(null, [{ term: 'power_poles', label: 'Power poles', question: 'Who furnishes and installs the power poles? (APT / GC / Owner)', options: ['APT', 'GC', 'Owner'], notes: ['AI count: 8 poles'] }]);
    expect(items).toMatchObject([{
      id: 'scope:power_poles', kind: 'scope_question', title: 'Power poles', detail: 'Who furnishes and installs the power poles? (APT / GC / Owner)',
      term: 'power_poles', question: 'Who furnishes and installs the power poles? (APT / GC / Owner)', options: ['APT', 'GC', 'Owner'], notes: ['AI count: 8 poles'],
    }]);
  });
});

// ── Fix round 1 ─────────────────────────────────────────────────────────────

function countResultFrom(a1: Record<string, unknown>, sheets: Parameters<typeof mergeCountsIntoTakeoff>[2], extra: Partial<CountResult> = {}): CountResult {
  const { targets } = buildCountTargets(a1);
  const m = mergeCountsIntoTakeoff(a1, targets, sheets, { countingRan: true });
  return { version: 2, ran: true, model: 'm', targets, targetNotes: [], sheets: [], skippedSheets: [], types: m.types, loadCheck: m.loadCheck,
    removedRows: m.removedRows, flags: m.flags, marks: [], noScheduleOrLegend: !targets.some(t => t.source === 'fixture_schedule' || t.source === 'legend'), ...extra };
}
/** Evidence round 4.5/4.6 — grouping, $ risk ordering and facility
 *  checklists are switched by `countResult.evidence`, the same as Parts
 *  1-3's own rule; this minimal stub turns it on for tests that are about
 *  Part 4 (not about what the evidence readers themselves found). */
const EMPTY_EVIDENCE: CountResult['evidence'] = {
  model: 'm', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  calls: 0, cached: 0, errors: [], pages: [], typicals: [], expansions: [], unmappedTypical: [], tables: [], families: [],
  symbolDefinitions: [], circuitRows: 0, scheduleOwned: [], panelsExpected: 0, panelsUnread: [],
};
const pick = (inv: Array<[string, string]>) => selectCountSheets(inv.map(([no, title], i) => ({ file: 'set.pdf', page: i + 1, sheetNo: no, title, discipline: 'electrical', cls: 'plan', included: true }))).counted;
const marks = (counts: Record<string, number>) => Object.entries(counts).flatMap(([k, n]) => Array.from({ length: n }, () => ({ typeKey: k })));

describe('B2 — counting that could not verify the counts is never "clear"', () => {
  it('review repro C: no fixture schedule and no legend -> one BLOCKING item, never a clear review', async () => {
    const a1 = { quantities: [{ category: 'Interior Lighting', item: '2x4 LED troffer', qty: 40 }] };
    const stage = await runCountingStage({ client: {} as Anthropic, model: 'm', maxTokens: 1000, agent1: a1, inventory: [], pdfs: new Map() });
    expect(stage.countResult.targets).toEqual([]);
    const items = buildReviewItems(stage.countResult);
    expect(items.map(i => [i.id, i.kind, i.title])).toEqual([
      ['counting:not_run', 'confirm', 'No fixture schedule/legend found — counts not verified'],
    ]);
    expect(items[0].detail).toMatch(/^Counting did not run: no fixture schedule, legend/);
  });
  it('counting ran on equipment only (no schedule/legend) -> the same blocking item', () => {
    const cr = countResultFrom({ equipment: [{ tag: 'EQ-1', description: 'Dryer 15 HP' }] }, [
      { sheet: pick([['E-2', 'POWER PLAN']])[0], status: 'counted', placed: marks({ 'EQ-1': 1 }), unreadable: [] },
    ]);
    expect(buildReviewItems(cr).map(i => i.id)).toContain('counting:no_schedule');
  });
  it('resolved only by a confirmation with a real reason', () => {
    const [item] = buildReviewItems({ ...countResultFrom({}, []), ran: false, notRunReason: 'x' });
    expect(validateResolution(item, { action: 'count', qty: 3 }, null).ok).toBe(false);
    expect(validateResolution(item, { action: 'confirm', reason: 'ok' }, null)).toEqual({ ok: false, error: 'Give the reason you are confirming this (at least 10 characters).' });
    expect(validateResolution(item, { action: 'confirm', reason: 'Checked E-3 by hand, 40 troffers' }, null).ok).toBe(true);
  });
});

describe('B3 — an unscheduled Agent 1 fixture row becomes a blocking item', () => {
  it('review repro C: "Type M ... qty 6" with M missing from the schedule', () => {
    const a1 = kissimmeeAgent1();
    a1.fixtureSchedule = (a1.fixtureSchedule as Array<{ type: string }>).filter(f => f.type !== 'M');
    (a1.quantities as Array<Record<string, unknown>>).push({ category: 'Interior Lighting', item: 'Type M — 2x2 LED flat panel', qty: 6, unit: 'EA', sourceSheet: 'E-3' });
    const [e3] = pick([['E-3', 'LIGHTING PLAN']]);
    const cr = countResultFrom(a1, [{ sheet: e3, status: 'counted', placed: marks({ A: 73 }), unreadable: [] }]);
    const items = buildReviewItems(cr);
    const m = items.find(i => i.title === 'Unscheduled fixture: Type M — 2x2 LED flat panel')!;
    expect(m).toMatchObject({ kind: 'count', aiCount: 6, rowItem: 'Type M — 2x2 LED flat panel', category: 'Interior Lighting', actions: ['count', 'not_on_job'] });
    // Kissimmee's "Site lights 4 (E-7)" is one "not on this job" click, not a silent deletion.
    const site = items.find(i => /Unscheduled fixture: Site lights/i.test(i.title));
    expect(site?.detail).toMatch(/found 4 × Site lights/);
    // A count resolution puts the line back (B1 enforcement).
    m.resolution = { action: 'count', qty: 6, by: 'J', at: 't' };
    expect(enforcedCounts(cr, items).extraLines).toEqual([{ category: 'Interior Lighting', item: 'Type M — 2x2 LED flat panel', qty: 6 }]);
  });
});

describe('B4 — an unclassifiable same-level pair is a blocking choice showing both numbers', () => {
  const A = { fixtureSchedule: [{ type: 'A', description: '2x4 LED troffer', location: 'interior', wattage: 32 }] };
  const [a, b] = pick([['E-2.1', 'LIGHTING PLAN'], ['E-2.2', 'LIGHTING PLAN']]);
  const cr = countResultFrom(A, [
    { sheet: a, status: 'counted', placed: marks({ A: 40 }), unreadable: [] },
    { sheet: b, status: 'counted', placed: marks({ A: 35 }), unreadable: [] },
  ]);
  const item = buildReviewItems(cr).find(i => i.id === 'area:A')!;
  it('asks keep 40 vs sum 75', () => {
    expect(item.detail).toBe('E-2.1 "LIGHTING PLAN" 40 / E-2.2 "LIGHTING PLAN" 35 — same area (keep 40) or different areas (sum 75)?');
    expect(item.options).toEqual(['Same area — keep 40', 'Different areas — sum 75']);
  });
  it('the answer carries the quantity the GC documents must show', () => {
    const r = validateResolution(item, { action: 'answer', answer: 'Different areas — sum 75' }, null);
    expect(r).toEqual({ ok: true, resolution: { action: 'answer', answer: 'Different areas — sum 75', qty: 75 } });
    const resolved = [{ ...item, resolution: { ...(r as unknown as { resolution: NonNullable<ReviewItem["resolution"]> }).resolution, by: 'J', at: 't' } }];
    expect(enforcedCounts(cr, resolved).byType.get('A')).toBe(75);
    expect(enforcedCounts(cr, []).byType.get('A')).toBe(40);
  });
  it('AREA A + AREA B raises no question and enforces 75', () => {
    const [x, y] = pick([['E-2.1', 'PARTIAL LIGHTING PLAN - AREA A'], ['E-2.2', 'PARTIAL LIGHTING PLAN - AREA B']]);
    const cr2 = countResultFrom(A, [
      { sheet: x, status: 'counted', placed: marks({ A: 40 }), unreadable: [] },
      { sheet: y, status: 'counted', placed: marks({ A: 35 }), unreadable: [] },
    ]);
    expect(buildReviewItems(cr2).filter(i => i.typeKey === 'A')).toEqual([]);
    expect(enforcedCounts(cr2, []).byType.get('A')).toBe(75);
  });
});

describe('S3 — partial coverage and uncounted plan pages block', () => {
  it('lighting counted only from the power plan -> blocking coverage item; confirm keeps the AI count', () => {
    const A = { fixtureSchedule: [{ type: 'A', description: '2x4 LED troffer', location: 'interior', wattage: 32 }] };
    const cr = countResultFrom(A, [{ sheet: pick([['E-2', 'POWER PLAN']])[0], status: 'counted', placed: marks({ A: 12 }), unreadable: [] }]);
    const item = buildReviewItems(cr).find(i => i.id === 'coverage:A')!;
    expect(item.detail).toMatch(/counted only on the power plan/);
    const r = validateResolution(item, { action: 'confirm', reason: 'Lighting plan is E-2 too on this job' }, null);
    expect(r).toMatchObject({ ok: true, resolution: { action: 'confirm', qty: 12 } });
  });
  it('a lighting plan classified as "schedule", and a PDF the classifier returned nothing for, are blocking items', () => {
    const sel = selectCountSheets([
      { file: 'set.pdf', page: 1, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'schedule', included: true },
      { file: 'set.pdf', page: 2, sheetNo: 'E-0.1', title: 'FIXTURE SCHEDULE', discipline: 'electrical', cls: 'schedule', included: true },
      { file: 'set.pdf', page: 3, sheetNo: 'E-3.1', title: 'ENLARGED RESTROOM PLAN', discipline: 'electrical', cls: 'detail', included: true },
    ]);
    const cr = { ...countResultFrom({}, []), skippedSheets: sel.skipped, unclassifiedFiles: ['addendum.pdf'] };
    expect(buildReviewItems(cr).filter(i => i.kind === 'confirm' && !i.id.startsWith('counting:')).map(i => i.title)).toEqual([
      'Not counted: E-3 "LIGHTING PLAN"', 'Not counted: E-3.1 "ENLARGED RESTROOM PLAN"', 'Not counted: addendum.pdf',
    ]);
  });
});

describe('N4 / N6 — re-confirmation after a new drawing set; real reasons', () => {
  it('a resolution carries over only when the item was built from the same evidence', () => {
    const prev = [countItem('count:G', { fingerprint: 'zero|0|', resolution: { action: 'count', qty: 11, by: 'J', at: 't' } })];
    expect(carryOverResolutions([countItem('count:G', { fingerprint: 'zero|0|' })], prev)[0].resolution).toMatchObject({ qty: 11, carriedOver: true });
    const changed = carryOverResolutions([countItem('count:G', { fingerprint: 'unreadable|0|E-3: 4' })], prev)[0];
    expect(changed.resolution).toBeUndefined();
    expect(changed.previousResolution).toMatchObject({ qty: 11 });
  });
  it('"Not on this job" needs a real reason', () => {
    expect(validateResolution(countItem('count:A'), { action: 'not_on_job', reason: '...' }, null).ok).toBe(false);
    expect(validateResolution(countItem('count:A'), { action: 'not_on_job', reason: '1234567890' }, null).ok).toBe(false);
    expect(validateResolution(countItem('count:A'), { action: 'not_on_job', reason: 'Alternate only, not bid' }, null).ok).toBe(true);
  });
});

describe('next round A4 — referencedSheetItems (post-Agent-1 safety net)', () => {
  it('one blocking confirm item per sheet the check did not know; loaded and already-checked sheets are not raised', async () => {
    const { referencedSheetItems, reviewStatus } = await import('./reviewItems');
    const { normalizeSheetId } = await import('./sheetRefs');
    const items = referencedSheetItems(
      ['E-9 (see note 5 on E-3)', 'M-1', 'E-3', 'E9', { sheet: 'C-2.0' }, 'not a sheet'],
      { loadedSheetKeys: new Set(['E3']), checkRefKeys: new Set(['M1']) },
      normalizeSheetId,
    );
    expect(items.map(i => i.id)).toEqual(['refsheet:E9', 'refsheet:C2.0']);
    expect(items[0]).toMatchObject({ kind: 'confirm', title: 'Referenced sheet E-9 not in analysis', actions: ['confirm'] });
    expect(reviewStatus(items)).toBe('needs_review');
  });
});

describe('Fix round B2 — gapfill: / reconcile: review items; gap-fill never counts by itself', () => {
  const a1 = { fixtureSchedule: [{ type: 'A', description: '2x4 LED troffer', location: 'interior', wattage: 32 }] };
  const [e2] = pick([['E-2', 'POWER PLAN']]);
  const finding = (over: Partial<{ typeKey: string; kind: 'schedule_qty' | 'circuit_desc'; direction: 'under' | 'over'; source: string; expected: number; actual: number; diff: number; reason: string }> = {}) =>
    ({ typeKey: 'A', kind: 'schedule_qty' as const, direction: 'under' as const, source: 'FIXTURE SCHEDULE', expected: 5, actual: 3, diff: 2, reason: 'FIXTURE SCHEDULE lists QTY 5; the plans account for 3.', ...over });

  it('an UNDER finding with suggested candidates -> gapfill:<type>, "confirm on plans", never a count by itself', () => {
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: marks({ A: 3 }), unreadable: [] }], {
      evidence: { ...EMPTY_EVIDENCE, gapFill: { findings: [finding()], jobs: 1, jobsSkipped: 0, cachedJobs: 0, candidates: 2, suggested: [{ typeKey: 'A', sheetKey: e2.key, x: 1, y: 1, confidence: 'high', note: 'n' }], calls: 2, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, errors: [] } },
    });
    const items = buildReviewItems(cr);
    const item = items.find(i => i.id === 'gapfill:A')!;
    expect(item).toBeTruthy();
    expect(item.title).toBe('Gap-fill found 1 possible A — confirm on plans');
    // Fix round 3 / B10 — never offers "not on this job"; exactly markers
    // (confirm the found marks), confirm (reject — keep the current count)
    // and count (enter the correct one).
    expect(item.actions).toEqual(['markers', 'confirm', 'count']);
    expect(item.reconcileMembers).toEqual([{ key: 'A', type: 'A', description: '2x4 LED troffer', unit: 'count', currentQty: 3, headsPerPole: null }]);
    expect(items.find(i => i.id === 'reconcile:A')).toBeUndefined();
    // The type's OWN count is untouched — gap-fill never counts by itself.
    expect(cr.types.find(t => t.key === 'A')!.count).toBe(3);
    expect(enforcedCounts(cr, items).byType.get('A')).toBe(3);
  });

  it('resolving gapfill: with "markers" (confirmed count) raises the count; B10 — "confirm" (reject) keeps the CURRENT count, never null', () => {
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: marks({ A: 3 }), unreadable: [] }], {
      evidence: { ...EMPTY_EVIDENCE, gapFill: { findings: [finding()], jobs: 1, jobsSkipped: 0, cachedJobs: 0, candidates: 1, suggested: [{ typeKey: 'A', sheetKey: e2.key, x: 1, y: 1, confidence: 'high', note: 'n' }], calls: 2, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, errors: [] } },
    });
    const items = buildReviewItems(cr);
    const gfItem = items.find(i => i.id === 'gapfill:A')!;
    const resolved = applyReconcileMemberResolution(gfItem, 'A', { action: 'markers', qty: 5 }, 'J');
    expect(enforcedCounts(cr, [resolved]).byType.get('A')).toBe(5);
    // B10 — the reviewer's exact repro: 7 real GFCIs, gap-fill's 2 suggested
    // marks turn out to be dimension ticks. Rejecting them must NEVER null
    // the type: it keeps exactly the current count (never the reviewer's
    // dreaded 7 -> 0).
    // The route layer (takeoffReview.ts) fills qty from the member's own
    // currentQty before calling this — mirrored here for the assertion.
    const rejected = applyReconcileMemberResolution(gfItem, 'A', { action: 'confirm', reason: 'Suggested marks are dimension ticks, not fixtures', qty: 3 }, 'J');
    expect(enforcedCounts(cr, [rejected]).byType.get('A')).toBe(3); // kept at the current count, not null
    expect(rejected.reconcileMembers![0].resolution).toMatchObject({ action: 'confirm', qty: 3 });
  });

  it('B10 — the reviewer\'s GFCI 7 -> 0 repro: rejecting a gap-fill suggestion keeps the count at 7, never zeroes it', () => {
    const gfciA1 = { fixtureSchedule: [{ type: 'GFCI', description: 'GFCI duplex receptacle', location: 'interior', wattage: 20 }] };
    const cr = countResultFrom(gfciA1, [{ sheet: e2, status: 'counted', placed: marks({ GFCI: 7 }), unreadable: [] }], {
      evidence: {
        ...EMPTY_EVIDENCE,
        gapFill: {
          findings: [{ typeKey: 'GFCI', kind: 'schedule_qty', direction: 'under', source: 'FIXTURE SCHEDULE', expected: 9, actual: 7, diff: 2, reason: 'FIXTURE SCHEDULE lists QTY 9; the plans account for 7.' }],
          jobs: 1, jobsSkipped: 0, cachedJobs: 0, candidates: 2,
          suggested: [{ typeKey: 'GFCI', sheetKey: e2.key, x: 1, y: 1, confidence: 'high', note: 'n' }, { typeKey: 'GFCI', sheetKey: e2.key, x: 2, y: 1, confidence: 'high', note: 'n' }],
          calls: 2, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, errors: [],
        },
      },
    });
    const items = buildReviewItems(cr);
    const gfItem = items.find(i => i.id === 'gapfill:GFCI')!;
    expect(gfItem.actions).not.toContain('not_on_job');
    // The estimator determines the 2 suggested marks are dimension ticks —
    // rejects them with "No more on this job — keep current count 7".
    const rejected = applyReconcileMemberResolution(gfItem, 'GFCI', { action: 'confirm', reason: 'Suggested marks are dimension ticks, not GFCI receptacles' }, 'Jake');
    expect(enforcedCounts(cr, [rejected]).byType.get('GFCI')).toBe(7); // stays 7, never null / never 0
  });

  it('an UNDER finding with NO candidates found -> reconcile:<type>, blocking, shown with both sides', () => {
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: marks({ A: 3 }), unreadable: [] }], {
      evidence: { ...EMPTY_EVIDENCE, gapFill: { findings: [finding()], jobs: 1, jobsSkipped: 0, cachedJobs: 0, candidates: 0, suggested: [], calls: 1, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, errors: [] } },
    });
    const items = buildReviewItems(cr);
    const item = items.find(i => i.id === 'reconcile:A')!;
    expect(item).toBeTruthy();
    expect(item.blocking).not.toBe(false);
    expect(item.detail).toContain('FIXTURE SCHEDULE lists QTY 5');
    expect(items.find(i => i.id === 'gapfill:A')).toBeUndefined();
  });

  it('an OVER finding is informational only (blocking: false) — never sent to gap-fill, never blocks', () => {
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: marks({ A: 8 }), unreadable: [] }], {
      evidence: { ...EMPTY_EVIDENCE, gapFill: { findings: [finding({ direction: 'over', expected: 5, actual: 8, diff: 3 })], jobs: 0, jobsSkipped: 0, cachedJobs: 0, candidates: 0, suggested: [], calls: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, errors: [] } },
    });
    const items = buildReviewItems(cr);
    const item = items.find(i => i.id === 'reconcile:A')!;
    expect(item.blocking).toBe(false);
    expect(item.title).toContain('Possible over-count');
  });
});

describe('Fix round 3 / B11 — a multi-type finding answers per type, never a broadcast', () => {
  // The reviewer's own repro: S1 has 2 poles x 1 head (headsPerPole 1) = 2
  // heads; S2 has 1 pole x 2 heads (headsPerPole 2) = 2 heads. 4 heads
  // total. A schedule reconciliation for "S1+S2" is answered PER TYPE.
  const reconcileItem = (): ReviewItem => ({
    id: 'reconcile:S1+S2', kind: 'confirm', blocking: true,
    title: 'Possible shortfall: S1/S2 vs LUMINAIRE SCHEDULE',
    detail: 'LUMINAIRE SCHEDULE lists QTY 6; the plans account for 4.',
    type: 'S1/S2', actions: ['confirm', 'count'],
    reconcileMembers: [
      { key: 'S1', type: 'S1', description: 'Pole light', unit: 'heads', currentQty: 2, headsPerPole: 1 },
      { key: 'S2', type: 'S2', description: 'Dual-head pole light', unit: 'heads', currentQty: 2, headsPerPole: 2 },
    ],
  });
  const cr = (): CountResult => ({
    version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [],
    types: [
      { key: 'S1', type: 'S1', description: 'Pole light', category: 'site_lighting', count: 2, heads: 2, status: 'counted', reason: '', sheets: [], flags: [], wattage: null },
      { key: 'S2', type: 'S2', description: 'Dual-head pole light', category: 'site_lighting', count: 1, heads: 2, status: 'counted', reason: '', sheets: [], flags: [], wattage: null },
    ],
    loadCheck: { ran: false, countedWatts: 0, circuitVA: 0, gapPct: null, discrepancy: false, perPanel: [], suspectCircuits: [] },
    removedRows: [], flags: [], marks: [],
  });

  it('each type answered separately with the CORRECT total: heads set directly, poles derived from heads-per-pole', () => {
    const item = reconcileItem();
    // S1: the schedule actually meant 3 heads per pole worth (3 heads),
    // headsPerPole 1 -> poles re-derive to 3.
    const afterS1 = applyReconcileMemberResolution(item, 'S1', { action: 'count', qty: 3 }, 'Jake');
    // S2: 4 heads, headsPerPole 2 -> poles re-derive to 2.
    const afterBoth = applyReconcileMemberResolution(afterS1, 'S2', { action: 'count', qty: 4 }, 'Jake');
    const enforced = enforcedCounts(cr(), [afterBoth]);
    expect(enforced.byType.get('S1:heads')).toBe(3);
    expect(enforced.byType.get('S1')).toBe(3); // 3 heads / 1 per pole
    expect(enforced.byType.get('S2:heads')).toBe(4);
    expect(enforced.byType.get('S2')).toBe(2); // 4 heads / 2 per pole
    // The item itself only resolves (blocks clear) once EVERY type answered.
    expect(afterS1.resolution).toBeUndefined();
    expect(afterBoth.resolution).toBeTruthy();
  });

  it('a heads answer that is not a whole multiple of heads-per-pole leaves poles exactly as counted (never guessed)', () => {
    const item = reconcileItem();
    // S1: 5 heads is not a multiple of headsPerPole 1... use S2 instead,
    // whose headsPerPole is 2: 5 heads doesn't divide evenly.
    const afterS2 = applyReconcileMemberResolution(item, 'S2', { action: 'count', qty: 5 }, 'Jake');
    const enforced = enforcedCounts(cr(), [afterS2]);
    expect(enforced.byType.get('S2:heads')).toBe(5);
    expect(enforced.byType.get('S2')).toBe(1); // untouched — the plans' own directly-counted pole count
  });

  it('headsPerPole unknown: a heads answer sets heads only, poles stay exactly as directly counted', () => {
    const item = reconcileItem();
    item.reconcileMembers![0].headsPerPole = null; // the schedule never states S1's heads-per-pole
    const afterS1 = applyReconcileMemberResolution(item, 'S1', { action: 'count', qty: 7 }, 'Jake');
    const enforced = enforcedCounts(cr(), [afterS1]);
    expect(enforced.byType.get('S1:heads')).toBe(7);
    expect(enforced.byType.get('S1')).toBe(2); // untouched — directly counted, never derived from heads
  });

  it('"No more on this job" (confirm/reject) keeps each type at its OWN current heads — never a shared number', () => {
    const item = reconcileItem();
    const afterS1 = applyReconcileMemberResolution(item, 'S1', { action: 'confirm', reason: 'Confirmed with the GC on-site walk 9/24' }, 'Jake');
    const afterBoth = applyReconcileMemberResolution(afterS1, 'S2', { action: 'confirm', reason: 'Confirmed with the GC on-site walk 9/24' }, 'Jake');
    const enforced = enforcedCounts(cr(), [afterBoth]);
    // Untouched — each member's own currentQty, never one broadcast value.
    expect(enforced.byType.get('S1:heads')).toBe(2);
    expect(enforced.byType.get('S1')).toBe(2);
    expect(enforced.byType.get('S2:heads')).toBe(2);
    expect(enforced.byType.get('S2')).toBe(1);
  });

  it('a single-type finding needs no memberKey ambiguity — its own item.resolution mirrors the one member directly', () => {
    const single: ReviewItem = {
      id: 'reconcile:S1', kind: 'confirm', title: 't', detail: 'd', actions: ['confirm', 'count'],
      reconcileMembers: [{ key: 'S1', type: 'S1', description: '', unit: 'heads', currentQty: 2, headsPerPole: 1 }],
    };
    const resolved = applyReconcileMemberResolution(single, 'S1', { action: 'count', qty: 4 }, 'Jake');
    expect(resolved.resolution).toMatchObject({ action: 'count', qty: 4 });
  });
});

describe('4.5 — grouping legend-only zero items and $ risk ordering', () => {
  it('two or more legend-only zero-count types with no plan presence and no schedule row group into ONE item; nothing is dropped', () => {
    const a1 = {
      symbolLegend: [
        { symbol: 'OS', description: 'Occupancy sensor', category: 'lighting_control', sourceSheet: 'E-0.1' },
        { symbol: 'PC', description: 'Photocell', category: 'lighting_control', sourceSheet: 'E-0.1' },
        { symbol: 'MS', description: 'Motion sensor', category: 'lighting_control', sourceSheet: 'E-0.1' },
      ],
      quantities: [],
    };
    const [e2] = pick([['E-2', 'POWER PLAN']]);
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: [], unreadable: [] }], { evidence: EMPTY_EVIDENCE });
    const items = buildReviewItems(cr);
    expect(items.find(i => i.id === 'count:OS')).toBeUndefined();
    expect(items.find(i => i.id === 'count:PC')).toBeUndefined();
    expect(items.find(i => i.id === 'count:MS')).toBeUndefined();
    const group = items.find(i => i.id.startsWith('legend-zero:'))!;
    expect(group).toBeTruthy();
    expect(group.kind).toBe('count');
    expect(group.actions).toEqual(['count', 'markers', 'not_on_job']);
    expect(group.groupedTypes?.map(g => g.key).sort()).toEqual(['MS', 'OS', 'PC']);
    expect(group.title).toBe('3 legend items not found on any counted sheet — answer each one');
    // Fix round B6 — each member gets its OWN action; the group is not
    // resolved (still blocks) until every member has answered.
    let resolved = applyGroupMemberResolution(group, 'OS', { action: 'not_on_job', reason: 'Design-build scope, not this job' }, 'J');
    expect(resolved.resolution).toBeUndefined(); // PC, MS still unanswered
    resolved = applyGroupMemberResolution(resolved, 'PC', { action: 'count', qty: 4 }, 'J');
    expect(resolved.resolution).toBeUndefined(); // MS still unanswered
    resolved = applyGroupMemberResolution(resolved, 'MS', { action: 'not_on_job', reason: 'Design-build scope, not this job' }, 'J');
    expect(resolved.resolution).toBeTruthy(); // every member answered — now resolved
    const enforced = enforcedCounts(cr, [resolved]);
    expect(enforced.byType.get('OS')).toBeNull();
    expect(enforced.byType.get('PC')).toBe(4);
    expect(enforced.byType.get('MS')).toBeNull();
  });
  it('a single qualifying item is left alone — grouping one saves nothing', () => {
    const a1 = { symbolLegend: [{ symbol: 'OS', description: 'Occupancy sensor', category: 'lighting_control', sourceSheet: 'E-0.1' }], quantities: [] };
    const [e2] = pick([['E-2', 'POWER PLAN']]);
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: [], unreadable: [] }], { evidence: EMPTY_EVIDENCE });
    const items = buildReviewItems(cr);
    expect(items.find(i => i.id === 'count:OS')).toBeTruthy();
    expect(items.find(i => i.id.startsWith('legend-zero:'))).toBeUndefined();
  });
  it('a type WITH a schedule row, or found on an uncounted sheet, never joins the group', () => {
    const a1 = {
      equipment: [{ tag: 'EQ-1', description: 'Dryer 15 HP' }],
      symbolLegend: [
        { symbol: 'OS', description: 'Occupancy sensor', category: 'lighting_control', sourceSheet: 'E-0.1' },
        { symbol: 'PC', description: 'Photocell', category: 'lighting_control', sourceSheet: 'E-0.1' },
      ],
      quantities: [],
    };
    const [e2] = pick([['E-2', 'POWER PLAN']]);
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: [], unreadable: [] }], { evidence: EMPTY_EVIDENCE });
    // EQ-1 counted 0 with no marks — still no schedule row of its own (a
    // symbol-count zero, not a scheduleRows-owned quantity) so it's eligible
    // too, but B6 excludes it anyway (equipment); this confirms grouping
    // still requires 2+ non-equipment members (OS + PC).
    const items = buildReviewItems(cr);
    expect(items.find(i => i.id === 'count:EQ-1')).toBeTruthy();
    const group = items.find(i => i.id.startsWith('legend-zero:'))!;
    expect(group.groupedTypes!.map(g => g.key).sort()).toEqual(['OS', 'PC']);
  });
  it('B6 — equipment (by category, or an equipment keyword) and phone-board receptacles are NEVER grouped, however many otherwise qualify', () => {
    const a1 = {
      symbolLegend: [
        { symbol: 'MB', description: 'Meter base', category: 'equipment', sourceSheet: 'E-0.1' },
        { symbol: 'WW', description: 'Wireway', category: 'equipment', sourceSheet: 'E-0.1' },
        { symbol: 'LCP', description: 'Lighting control panel', category: 'equipment', sourceSheet: 'E-0.1' },
        { symbol: 'DC', description: 'Data concentrator', category: 'equipment', sourceSheet: 'E-0.1' },
        { symbol: 'DISCON A', description: '200A fused disconnect', category: 'equipment', sourceSheet: 'E-0.1' },
        // A receptacle described as "on phone board" — device category, but
        // still an individual $-risk item, never folded into the group.
        { symbol: 'PBD', description: 'Duplex receptacle on phone board', category: 'device', sourceSheet: 'E-0.1' },
        // Two ordinary, ungrouped-otherwise device types so the group still
        // forms (it just never includes any of the six above).
        { symbol: 'OS', description: 'Occupancy sensor', category: 'lighting_control', sourceSheet: 'E-0.1' },
        { symbol: 'PC', description: 'Photocell', category: 'lighting_control', sourceSheet: 'E-0.1' },
      ],
      quantities: [],
    };
    const [e2] = pick([['E-2', 'POWER PLAN']]);
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: [], unreadable: [] }], { evidence: EMPTY_EVIDENCE });
    const items = buildReviewItems(cr);
    for (const key of ['MB', 'WW', 'LCP', 'DC', 'DISCON A', 'PBD']) {
      const item = items.find(i => i.id === `count:${key}`);
      expect(item, `${key} should be its own item, not grouped`).toBeTruthy();
      expect(item!.actions).not.toEqual(['not_on_job']); // full default action set — an ordinary individual count item
    }
    const group = items.find(i => i.id.startsWith('legend-zero:'))!;
    expect(group.groupedTypes?.map(g => g.key).sort()).toEqual(['OS', 'PC']);
  });
  it('riskRank: equipment < poles < family/typical < wet/hazard device < commodity device < unscheduled < scope < other', () => {
    const equipment = countItem('count:MB', { category: 'equipment' });
    const pole = countItem('count:S1', { category: 'site_lighting' });
    const family = { ...countItem('family:X'), kind: 'area' as const };
    const typical = { ...countItem('typical:X') };
    const hazard = countItem('count:WPGFI', { category: 'device', type: 'WP GFI', description: 'Weatherproof GFCI receptacle' });
    const commodity = countItem('count:S', { category: 'device', type: 'S', description: 'Simplex receptacle' });
    const unscheduled = countItem('unscheduled:X');
    const ranks = [equipment, pole, family, typical, hazard, commodity, unscheduled, scopeItem].map(riskRankOf);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('4.6 — facility checklists on the same queue, always non-blocking', () => {
  it('a matching project type adds its checklist items; no match adds none', () => {
    const withChecklist = buildReviewItems(null, [], { projectType: 'Car Wash' });
    expect(withChecklist.length).toBeGreaterThan(0);
    expect(withChecklist.every(i => i.blocking === false && i.id.startsWith('checklist:car_wash:'))).toBe(true);
    expect(buildReviewItems(null, [], { projectType: 'Office TI' })).toEqual([]);
    expect(buildReviewItems(null, [])).toEqual([]);
  });
});

describe('Fix round S13 — a 5-10% spot-check sample of a high auto-accepted count', () => {
  const a1 = { fixtureSchedule: [{ type: 'A', description: '2x4 LED troffer', location: 'interior', wattage: 32 }] };
  const [e2] = pick([['E-2', 'POWER PLAN']]);

  it(`a type at or above ${SPOTCHECK_MIN_COUNT} gets ONE non-blocking spotcheck: item; below the threshold, none`, () => {
    const marksA25 = Array.from({ length: 25 }, (_, i) => ({ sheetKey: e2.key, typeKey: 'A', x: i, y: 0 }));
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: marks({ A: 25 }), unreadable: [] }], { evidence: EMPTY_EVIDENCE, marks: marksA25 });
    const items = buildReviewItems(cr);
    const item = items.find(i => i.id === 'spotcheck:A')!;
    expect(item).toBeTruthy();
    expect(item.blocking).toBe(false);
    // 25 * 7.5% = 1.875 -> rounds to 2, but the floor is 3.
    expect(item.title).toBe('Spot-check: confirm these 3 marks — Type A (25 auto-counted)');
    expect(item.actions).toEqual(['confirm']);

    const marksA19 = Array.from({ length: 19 }, (_, i) => ({ sheetKey: e2.key, typeKey: 'A', x: i, y: 0 }));
    const under = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: marks({ A: 19 }), unreadable: [] }], { evidence: EMPTY_EVIDENCE, marks: marksA19 });
    expect(buildReviewItems(under).find(i => i.id === 'spotcheck:A')).toBeUndefined();
  });

  it('never blocks the gate, and never changes the type\'s own count on its own', () => {
    const marksA30 = Array.from({ length: 30 }, (_, i) => ({ sheetKey: e2.key, typeKey: 'A', x: i, y: 0 }));
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: marks({ A: 30 }), unreadable: [] }], { evidence: EMPTY_EVIDENCE, marks: marksA30 });
    const items = buildReviewItems(cr);
    const item = items.find(i => i.id === 'spotcheck:A')!;
    expect(reviewItemIsOpen(item)).toBe(false); // blocking: false -> never open
    expect(enforcedCounts(cr, items).byType.get('A')).toBe(30);
  });

  it('spotCheckSamples is deterministic: the same marks always sample the same indices', () => {
    const m = Array.from({ length: 40 }, (_, i) => ({ sheetKey: e2.key, typeKey: 'A', x: i, y: 0 }));
    const cr = countResultFrom(a1, [{ sheet: e2, status: 'counted', placed: marks({ A: 40 }), unreadable: [] }], { evidence: EMPTY_EVIDENCE, marks: m });
    const a = spotCheckSamples(cr);
    const b = spotCheckSamples(cr);
    expect(a).toEqual(b);
    expect(a[0].sample.length).toBe(Math.round(40 * 0.075)); // 3 -> exactly the 7.5% rate, above the floor
    expect(new Set(a[0].sample.map(s => s.x)).size).toBe(a[0].sample.length); // no duplicate marks
  });
});

describe('next round A6 — legend items assigned by G.C. / another trade (Kissimmee strings)', () => {
  it('G.C. items are APT targets (counted, blocking at zero); the HVAC-installed fan at zero is information only', async () => {
    const { buildCountTargets } = await import('./countTargets');
    const { mergeCountsIntoTakeoff } = await import('./countMerge');
    const { buildReviewItems, reviewStatus } = await import('./reviewItems');
    const a1 = {
      fixtureSchedule: [],
      symbolLegend: [
        { symbol: 'S', description: 'Simplex receptacle, G.C. furnished/installed', category: 'device', sourceSheet: 'E-0.1' },
        { symbol: 'DF', description: 'Duplex receptacle / floor receptacle, G.C.', category: 'device', sourceSheet: 'E-0.1' },
        { symbol: 'EF', description: 'Exhaust fan recessed, installed by HVAC, wired by EC', category: 'equipment', sourceSheet: 'E-0.1' },
      ],
      quantities: [],
    };
    const { targets } = buildCountTargets(a1);
    const by = Object.fromEntries(targets.map(t => [t.key, t]));
    expect(by.S.assignment).toMatchObject({ aptScope: 'full', viaGc: true });
    expect(by.DF.assignment).toMatchObject({ aptScope: 'full', viaGc: true });
    expect(by.EF.assignment).toMatchObject({ aptScope: 'connection', otherTrade: 'HVAC' });
    const merged = mergeCountsIntoTakeoff(a1, targets, [], { countingRan: true });
    const cr = { version: 2, ran: true, model: 'm', targets, targetNotes: [], sheets: [], skippedSheets: [], types: merged.types, loadCheck: merged.loadCheck, removedRows: [], flags: [], marks: [] };
    const items = buildReviewItems(cr as never);
    const ef = items.find(i => i.id === 'count:EF')!;
    expect(ef.blocking).toBe(false);
    expect(ef.detail).toContain('installed by HVAC; APT wires / connects it — listed for information, not blocking');
    expect(items.find(i => i.id === 'count:S')!.blocking).toBeUndefined();
    // Only the fan open: clear. With S open too: needs review.
    expect(reviewStatus([ef])).toBe('clear');
    expect(reviewStatus(items)).toBe('needs_review');
  });
});
