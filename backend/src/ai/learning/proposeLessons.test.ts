// Level 2 learning, Task 12 — lesson proposals. Multi-bid histories here are
// SCRIPTED (labelled in each test name): no real bid has repeated answers
// yet. The real 36th Street export gives zero automatic proposals (one bid)
// and one manual proposal from its unlisted:H answer.
import { describe, it, expect } from 'vitest';
import { proposeLessons, reconcileProposals, lessonFromItem, suggestedScopeOf, type LessonSourceBid } from './proposeLessons';
import { load36th0930 } from '../../test/fixtures/realrun/live0930';
import type { ReviewItem } from '../reviewItems';
import type { LessonRow } from './learningDb';

const unl = (tag: string, reason: string, symbol = 'surface strip fixture (warehouse)', auto = false): ReviewItem => ({
  id: `unlisted:${tag}`, kind: 'count', title: `Type ${tag}`, detail: 'd', type: tag, description: symbol,
  resolution: { action: 'count', qty: 4, reason, by: auto ? 'CRM (from X)' : 'Jake', at: '2026-09-30T00:00:00Z', ...(auto ? { auto: { source: 'account_memory' as const, reason: 'r', evidence: [] } } : {}) },
});
const bid = (id: string, items: ReviewItem[], pt: string | null = 'self_storage', rule: string | null = null): LessonSourceBid => ({ bidId: id, bidName: `Bid ${id}`, projectType: pt, ruleId: rule, items });
const noj = (desc: string): ReviewItem => ({ id: `count:${desc}`, kind: 'count', title: desc, detail: 'Counted 0: not found on any counted plan sheet.', type: desc, description: desc, resolution: { action: 'not_on_job', reason: 'not used on this job', by: 'Jake', at: 't' } });

describe('patterns (SCRIPTED multi-bid histories)', () => {
  it('SCRIPTED 1 — an unlisted symbol answered as the same fixture on 2 bids → a review suggestion', () => {
    const p = proposeLessons([bid('a', [unl('H', 'H surface strip light, 4ft" × 13')]), bid('b', [unl('K', '4 ft LED strip light, surface')])], [], null);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ pattern: 'unlisted-meaning', appliesTo: ['review'], match: { itemPrefix: 'unlisted:', deviceClass: 'fixture.strip' }, suggestedScope: { kind: 'project_type', value: 'self_storage' } });
    expect(p[0].text).toMatch(/^An unscheduled tag drawn as "surface strip fixture \(warehouse\)" has been surface strip light, 4ft \(H on Bid a, K on Bid b\)\.$/);
  });
  it('SCRIPTED — one bid alone, or automatic answers, propose nothing', () => {
    expect(proposeLessons([bid('a', [unl('H', 'strip light 4ft'), unl('K', 'strip light 4ft')])], [], null)).toEqual([]);
    expect(proposeLessons([bid('a', [unl('H', 'strip light 4ft', undefined, true)]), bid('b', [unl('K', 'strip light 4ft', undefined, true)])], [], null)).toEqual([]);
  });
  it('SCRIPTED 2 — the shaded = new convention on 2 bids → a counter lesson', () => {
    const conv = (): ReviewItem => ({ id: 'remodel:conventions', kind: 'count', title: 'How?', detail: 'd', resolution: { action: 'answer', answer: 'Shaded / filled symbols are new; open symbols are existing — re-run the analysis to apply', by: 'Jake', at: 't' } });
    const p = proposeLessons([bid('a', [conv()]), bid('b', [conv()])], [], null);
    expect(p.map(x => [x.pattern, x.appliesTo])).toEqual([['status-convention', ['counter']]]);
  });
  it('SCRIPTED 3 — a legend entry not on the job on 3 bids → review only (never counter text)', () => {
    const p = proposeLessons([bid('a', [noj('Smoke detector')]), bid('b', [noj('smoke  detector')]), bid('c', [noj('Smoke Detector')], 'retail')], [], null);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ pattern: 'legend-not-drawn', appliesTo: ['review'], suggestedScope: { kind: 'all' } });
    expect(proposeLessons([bid('a', [noj('Smoke detector')]), bid('b', [noj('Smoke detector')])], [], null)).toEqual([]);
  });
  it('SCRIPTED 4 — the same confusion 3 times across 2 bids → a counter lesson', () => {
    const c = (bidId: string, n: number) => ({ bidId, bidName: `Bid ${bidId}`, from: 'receptacle.duplex' as const, to: 'receptacle.floor' as const, notADevice: false, at: 't', exampleId: `${bidId}${n}` });
    const p = proposeLessons([], [c('a', 1), c('a', 2), c('b', 1)], null);
    expect(p.map(x => [x.pattern, x.text, x.appliesTo])).toEqual([['repeated-confusion', 'Floor boxes have been mistaken for duplex receptacles.', ['counter']]]);
    expect(proposeLessons([], [c('a', 1), c('a', 2), c('a', 3)], null)).toEqual([]);
  });
  it('suggested scope: an account only when every bid shares a NON-default rule', () => {
    expect(suggestedScopeOf([{ projectType: 'retail', ruleId: 'r1' }, { projectType: 'retail', ruleId: 'r1' }], 'def')).toMatchObject({ kind: 'account', value: 'r1' });
    expect(suggestedScopeOf([{ projectType: 'retail', ruleId: 'def' }, { projectType: 'retail', ruleId: 'def' }], 'def')).toMatchObject({ kind: 'project_type', value: 'retail' });
    expect(suggestedScopeOf([{ projectType: 'retail', ruleId: null }, { projectType: 'storage', ruleId: null }], null)).toMatchObject({ kind: 'all' });
  });
});

describe('reconcile with the stored lessons', () => {
  const p = proposeLessons([bid('a', [unl('H', 'strip light 4ft')]), bid('b', [unl('K', 'strip light 4ft')])], [], null)[0];
  const stored = (status: LessonRow['status'], bids: string[]): LessonRow => ({ id: 'L1', lineageId: 'G', version: 1, text: p.text, appliesTo: ['review'], scopeKind: 'all', scopeValue: null, match: p.match, status, pattern: p.pattern, suggestedScope: null, proposedAt: 't', decidedBy: null, decidedAt: null,
    evidence: bids.map(b => ({ bidId: b, bidName: b, itemId: b === 'a' ? 'unlisted:H' : 'unlisted:K', answer: '4', at: 't' })) });
  it('a known lineage appends evidence instead of a new proposal', () => {
    const r = reconcileProposals([p], [stored('approved', ['a'])]);
    expect(r.inserts).toEqual([]);
    expect(r.appends[0].evidence.map(e => e.bidId)).toEqual(['a', 'b']);
  });
  it('a dismissed proposal does not come back without a new bid', () => {
    expect(reconcileProposals([p], [stored('dismissed', ['a', 'b'])])).toEqual({ inserts: [], appends: [] });
    const p3 = proposeLessons([bid('a', [unl('H', 'strip light 4ft')]), bid('b', [unl('K', 'strip light 4ft')]), bid('c', [unl('Q', 'strip light 4ft')])], [], null)[0];
    expect(reconcileProposals([p3], [stored('dismissed', ['a', 'b'])]).inserts).toHaveLength(1);
  });
});

describe('the real 36th Street export', () => {
  const live = load36th0930();
  const items = live.reviewItems as unknown as ReviewItem[];
  it('zero automatic proposals (one bid)', () => {
    expect(proposeLessons([bid(live.bid.id, items)], [], null)).toEqual([]);
  });
  it('from-item unlisted:H → one proposal with its evidence', () => {
    const p = lessonFromItem({ bidId: live.bid.id, bidName: live.bid.name, projectType: live.bid.project_type, ruleId: null, items }, items.find(i => i.id === 'unlisted:H')!, null)!;
    expect(p.evidence).toEqual([{ bidId: live.bid.id, bidName: '36th Street Warehouse', itemId: 'unlisted:H', answer: '13', reason: 'H surface strip light, 4ft" × 13', at: '2026-09-30T16:00:46.114Z' }]);
    expect(p.text).toBe('An unscheduled tag drawn as "surface strip fixture (warehouse)" has been surface strip light, 4ft (H on 36th Street Warehouse).');
    expect(p.appliesTo).toEqual(['review']);
    expect(p.match).toMatchObject({ itemPrefix: 'unlisted:', deviceClass: 'fixture.strip' });
  });
});
