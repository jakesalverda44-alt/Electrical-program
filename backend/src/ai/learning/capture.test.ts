import { describe, it, expect } from 'vitest';
import { capturesFromMarkupBatch, type MarkerLike } from './capture';

const mk = (over: Partial<MarkerLike>): MarkerLike => ({
  id: 'm1', documentId: 'd1', pageIndex: 0, kind: 'count', status: 'confirmed', label: 'A', lineKey: null, source: 'estimator',
  points: [{ x: 100, y: 100 }], ...over,
});
const moveTo = (id: string) => ({ creates: [], updates: [{ id, points: [{ x: 300, y: 320 }] }], deletes: [] });

describe('moving a count marker recaptures at the new position', () => {
  it('an estimator-created marker moved -> marker_move at the NEW point with its type', () => {
    const caps = capturesFromMarkupBatch(moveTo('m1'), [mk({})]);
    expect(caps).toHaveLength(1);
    expect(caps[0].kind).toBe('marker_move');
    expect(caps[0].payload).toMatchObject({ markupId: 'm1', point: { x: 300, y: 320 }, to: { label: 'A', lineKey: null }, quality: 3 });
  });
  it('an AI marker moved still captures (unchanged)', () => {
    const caps = capturesFromMarkupBatch(moveTo('m1'), [mk({ source: 'ai_count' })]);
    expect(caps.map(c => c.kind)).toEqual(['marker_move']);
  });
  it('an unmoved estimator marker (same points) captures nothing; a non-count marker is ignored', () => {
    expect(capturesFromMarkupBatch({ creates: [], updates: [{ id: 'm1', points: [{ x: 100, y: 100 }] }], deletes: [] }, [mk({})])).toEqual([]);
    expect(capturesFromMarkupBatch(moveTo('m1'), [mk({ kind: 'line' })])).toEqual([]);
  });
});
