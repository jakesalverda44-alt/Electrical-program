import { describe, it, expect } from 'vitest';
import { feederRoutesForSheet } from './feederRoutes';
import type { FeedersResponse } from '../FeedersPanel';

describe('C7 — feederRoutesForSheet', () => {
  it('only the routes on the sheet being viewed, with a label', () => {
    const edge = (id: string, doc: string, page: number) => ({ id, from: id.split('→')[0], to: id.split('→')[1], kind: 'feeder', spec: null, status: 'estimated' as const, lengthFt: 16, tier: 'suggested', underground: false, math: '', holds: [], quotes: [], endpoints: [], quantities: null, verticalFt: 0, makeupFt: 6,
      route: { documentId: doc, pageIndex: page, sheetKey: null, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } });
    const data = { edges: [edge('DISCON A→PANEL A', 'd1', 48), edge('XFMR→METER', 'd1', 14)] } as unknown as FeedersResponse;
    expect(feederRoutesForSheet(data, 'd1', 48)).toEqual([{ id: 'DISCON A→PANEL A', label: 'DISCON A → PANEL A · 16 ft (suggested)', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], underground: false, status: 'estimated' }]);
    expect(feederRoutesForSheet(null, 'd1', 48)).toEqual([]);
  });
});
