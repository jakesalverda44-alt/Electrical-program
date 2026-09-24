// Evidence round 4.3 — crop-check reply parsing: accept only on a clear
// "accept", never by a parse failure defaulting the other way.
import { describe, it, expect } from 'vitest';
import { parseCropCheckReply } from './cropCheck';

const KEYS = new Set(['GFCI', 'WP GFI']);

describe('parseCropCheckReply', () => {
  it('accept / reject / reclass, matched by id', () => {
    const text = JSON.stringify({ decisions: [
      { id: 'c1', decision: 'accept', note: 'matches the example' },
      { id: 'c2', decision: 'reject', note: 'that is a note callout, not a symbol' },
      { id: 'c3', decision: 'reclass', type: 'wp gfi', note: 'weatherproof, not plain GFCI' },
    ] });
    const r = parseCropCheckReply(text, ['c1', 'c2', 'c3'], KEYS)!;
    expect(r).toEqual([
      { id: 'c1', decision: 'accept', reclassKey: null, note: 'matches the example' },
      { id: 'c2', decision: 'reject', reclassKey: null, note: 'that is a note callout, not a symbol' },
      { id: 'c3', decision: 'reclass', reclassKey: 'WP GFI', note: 'weatherproof, not plain GFCI' },
    ]);
  });
  it('an id the reply never answers defaults to reject, never accept', () => {
    const r = parseCropCheckReply(JSON.stringify({ decisions: [{ id: 'c1', decision: 'accept' }] }), ['c1', 'c2'], KEYS)!;
    expect(r[1]).toMatchObject({ id: 'c2', decision: 'reject' });
  });
  it('reclass to a type that is not a real count target is rejected, not accepted as that type', () => {
    const r = parseCropCheckReply(JSON.stringify({ decisions: [{ id: 'c1', decision: 'reclass', type: 'NOT A TARGET' }] }), ['c1'], KEYS)!;
    expect(r[0]).toMatchObject({ decision: 'reject', reclassKey: null });
  });
  it('an unknown decision word is rejected, not accepted', () => {
    const r = parseCropCheckReply(JSON.stringify({ decisions: [{ id: 'c1', decision: 'maybe' }] }), ['c1'], KEYS)!;
    expect(r[0].decision).toBe('reject');
  });
  it('null when the reply has no usable "decisions" array — the caller leaves every candidate pending', () => {
    expect(parseCropCheckReply(JSON.stringify({ answers: [] }), ['c1'], KEYS)).toBeNull();
    expect(parseCropCheckReply('not json', ['c1'], KEYS)).toBeNull();
  });
});
