import { describe, expect, it } from 'vitest';
import { carryOverResolutions, validateResolution, reviewResolutionsForAgent4, buildReviewItems, type ReviewItem } from './reviewItems';
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
    expect(items).toEqual([{
      id: 'scope:power_poles', kind: 'scope_question', title: 'Power poles', detail: 'Who furnishes and installs the power poles? (APT / GC / Owner)',
      term: 'power_poles', question: 'Who furnishes and installs the power poles? (APT / GC / Owner)', options: ['APT', 'GC', 'Owner'], notes: ['AI count: 8 poles'],
    }]);
  });
});
