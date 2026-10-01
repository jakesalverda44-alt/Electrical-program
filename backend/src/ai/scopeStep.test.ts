// Fewer-questions round Task 4 — scope questions carry step 'scope' (the UI
// answers them on the Scope step); blocking is unchanged.
import { describe, it, expect } from 'vitest';
import { buildReviewItems, reviewStatus, reviewItemIsOpen } from './reviewItems';

describe('scope questions on the Scope step', () => {
  const items = buildReviewItems(null, [{ term: 'lighting', label: 'Lighting fixtures', question: 'Who?', options: ['A', 'B'], notes: [] }]);
  it('carry step scope and still block', () => {
    const q = items.find(i => i.id === 'scope:lighting')!;
    expect(q.step).toBe('scope');
    expect(q.kind).toBe('scope_question');
    expect(q.blocking).toBeUndefined();
    expect(reviewItemIsOpen(q)).toBe(true);
    expect(reviewStatus(items)).toBe('needs_review');
  });
  it('no other item gets a step', () => {
    expect(items.filter(i => i.step).map(i => i.id)).toEqual(['scope:lighting']);
  });
});
