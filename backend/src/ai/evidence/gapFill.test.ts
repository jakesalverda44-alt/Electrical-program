// Evidence round 4.4 — gap-fill's pure half: the reply -> validated
// candidates (in displayed inches), and "excluding existing marks".
import { describe, it, expect } from 'vitest';
import { parseGapFillReply, dedupeAgainstExisting, candidateToPdfPoint, GAPFILL_DEDUP_RADIUS_IN } from './gapFill';
import type { SheetGeom } from './viewports';

const RECT = { left: 10, top: 5, width: 20, height: 10 };
// A Kissimmee-shaped /Rotate 270 sheet, 1728 x 2592 pt.
const GEOM: SheetGeom = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };

describe('parseGapFillReply', () => {
  it('maps fractions of the search rect to displayed inches, keeps confidence and note', () => {
    const r = parseGapFillReply(JSON.stringify({ marks: [{ x: 0.5, y: 0.5, confidence: 'high', note: 'clear circle-slash' }] }), RECT);
    expect(r).toEqual([{ xIn: 20, yIn: 10, confidence: 'high', note: 'clear circle-slash' }]);
  });
  it('rejects an out-of-range fraction, never clamps into a false position', () => {
    const r = parseGapFillReply(JSON.stringify({ marks: [{ x: 1.5, y: 0.2 }, { x: 0.1, y: 0.1 }] }), RECT)!;
    expect(r).toHaveLength(1);
  });
  it('defaults an unknown confidence word to "medium", never throws', () => {
    const r = parseGapFillReply(JSON.stringify({ marks: [{ x: 0.1, y: 0.1, confidence: 'sure!' }] }), RECT)!;
    expect(r[0].confidence).toBe('medium');
  });
  it('caps candidates at MAX_GAPFILL_CANDIDATES', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ x: 0.01 * i, y: 0.01 * i }));
    const r = parseGapFillReply(JSON.stringify({ marks: many }), RECT)!;
    expect(r.length).toBeLessThanOrEqual(8);
  });
  it('an empty list is a real answer ("nothing more found"), not null', () => {
    expect(parseGapFillReply(JSON.stringify({ marks: [] }), RECT)).toEqual([]);
  });
  it('null when the reply has no usable "marks" array at all', () => {
    expect(parseGapFillReply(JSON.stringify({ symbols: [] }), RECT)).toBeNull();
    expect(parseGapFillReply('not json', RECT)).toBeNull();
  });
});

describe('dedupeAgainstExisting — "excluding existing marks"', () => {
  it('drops a candidate within the radius of an existing SAME-type mark', () => {
    const existing = [candidateToPdfPoint({ xIn: 20, yIn: 10 }, GEOM)];
    const close = dedupeAgainstExisting([{ xIn: 20.1, yIn: 10.1, confidence: 'high', note: '' }], existing, GEOM);
    expect(close).toEqual([]);
  });
  it('keeps a candidate well outside the radius', () => {
    const existing = [candidateToPdfPoint({ xIn: 20, yIn: 10 }, GEOM)];
    const far = dedupeAgainstExisting([{ xIn: 20 + GAPFILL_DEDUP_RADIUS_IN + 1, yIn: 10, confidence: 'high', note: '' }], existing, GEOM);
    expect(far).toHaveLength(1);
  });
});

describe('candidateToPdfPoint — round-trips through the rotation', () => {
  it('a displayed-inch position maps to a PDF point and back consistently', () => {
    const c = { xIn: 12, yIn: 6 };
    const p = candidateToPdfPoint(c, GEOM);
    const p2 = candidateToPdfPoint(c, GEOM);
    expect(p).toEqual(p2);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});
