import { describe, it, expect } from 'vitest';
import { compactForHandoff } from './compactPayload';

describe('compactForHandoff (pure)', () => {
  it('compacts 2-space-pretty JSON with no indentation whitespace at all', () => {
    const pretty = JSON.stringify({ panels: [{ name: 'MDP', amps: 400 }], equipment: [] }, null, 2);
    expect(pretty).toContain('\n  '); // sanity: the input really is pretty-printed
    const compact = compactForHandoff(pretty);
    expect(compact).not.toContain('\n  ');
    expect(compact).not.toContain('\n');
    expect(JSON.parse(compact)).toEqual({ panels: [{ name: 'MDP', amps: 400 }], equipment: [] });
  });

  it('leaves already-compact JSON as compact (idempotent-ish — same data, no growth)', () => {
    const compact = JSON.stringify({ a: 1, b: [1, 2, 3] });
    expect(compactForHandoff(compact)).toBe(compact);
  });

  it('compacts JSON wrapped in markdown fences', () => {
    const fenced = '```json\n' + JSON.stringify({ a: 1 }, null, 2) + '\n```';
    const compact = compactForHandoff(fenced);
    expect(compact).toBe('{"a":1}');
  });

  it('falls back to the original text unchanged when it is not parseable JSON at all', () => {
    const prose = 'Agent 1 could not complete analysis — the response was cut off mid-sentence';
    expect(compactForHandoff(prose)).toBe(prose);
  });

  it('shrinks a realistic multi-field payload measurably', () => {
    const pretty = JSON.stringify({
      project: { name: 'Test Project', address: '123 Main St', sqFt: 5000 },
      panels: [
        { name: 'MDP', amps: 400, voltage: '480/277', phase: 3, circuits: 42, confidence: 'VERIFIED' },
        { name: 'PP-1', amps: 225, voltage: '208/120', phase: 3, circuits: 30, confidence: 'ASSUMED' },
      ],
      quantities: [
        { category: 'Interior Lighting', item: 'LED Troffer 2x4', qty: 48, unit: 'EA', confidence: 'VERIFIED' },
      ],
    }, null, 2);
    const compact = compactForHandoff(pretty);
    expect(compact.length).toBeLessThan(pretty.length);
    // Same data survives the round trip — only whitespace was removed.
    expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
  });
});
