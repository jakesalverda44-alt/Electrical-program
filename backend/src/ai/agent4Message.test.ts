import { describe, expect, it } from 'vitest';
import { buildAgent4UserMessage, AGENT1_TEXT_CAP, isAgent4Shape } from './agent4Message';

const baseInput = {
  price: '$425,000',
  internalNotes: 'Confirm generator lead time with GC before final.',
  agent1Output: '{"project":{"name":"AutoZone #4521"}}',
  agent2Output: '{"scopeOfWork":{"A_ServiceDistribution":["..."]}}',
  workspaceScope: null as Record<string, string> | null,
  savedEstimate: null as Record<string, unknown> | null,
};

describe('buildAgent4UserMessage', () => {
  it('always includes the price + internal notes header', () => {
    const msg = buildAgent4UserMessage(baseInput);
    expect(msg).toContain('Total Bid Price: $425,000');
    expect(msg).toContain('Confirm generator lead time with GC before final.');
  });

  it('emits the estimator-edited scope block with human titles for non-empty sections only', () => {
    const msg = buildAgent4UserMessage({
      ...baseInput,
      workspaceScope: {
        A: 'Service entrance per plan, 400A 208Y/120.',
        B: '',
        C: 'LED troffers per fixture schedule.',
        D: '   ', // whitespace-only counts as empty
      },
    });
    expect(msg).toContain('--- ESTIMATOR-EDITED SCOPE OF WORK (AUTHORITATIVE) ---');
    expect(msg).toContain('Service & Distribution:');
    expect(msg).toContain('Service entrance per plan, 400A 208Y/120.');
    expect(msg).toContain('Lighting:');
    expect(msg).toContain('LED troffers per fixture schedule.');
    // empty sections must not appear at all
    expect(msg).not.toContain('Branch Circuits:');
    expect(msg).not.toContain('Low Voltage / Data:');
  });

  it('omits the scope block entirely when every section is empty or missing', () => {
    const msg1 = buildAgent4UserMessage({ ...baseInput, workspaceScope: {} });
    const msg2 = buildAgent4UserMessage({ ...baseInput, workspaceScope: { A: '', B: '   ' } });
    const msg3 = buildAgent4UserMessage({ ...baseInput, workspaceScope: null });
    for (const msg of [msg1, msg2, msg3]) {
      expect(msg).not.toContain('ESTIMATOR-EDITED SCOPE OF WORK');
    }
  });

  it('emits the saved-estimate context block when an estimate exists', () => {
    const msg = buildAgent4UserMessage({
      ...baseInput,
      savedEstimate: {
        grand_total: 425000,
        overhead_pct: 10,
        profit_pct: 15,
        subtotals: { 'Interior Lighting': 50000, 'Branch Power': 30000 },
      },
    });
    expect(msg).toContain('--- SAVED ESTIMATE (CONTEXT) ---');
    expect(msg).toContain('425,000');
    expect(msg).toContain('10%');
    expect(msg).toContain('15%');
    expect(msg).toContain('Interior Lighting');
    expect(msg).toContain('50,000');
  });

  it('omits the saved-estimate block when there is no estimate', () => {
    const msg = buildAgent4UserMessage({ ...baseInput, savedEstimate: null });
    expect(msg).not.toContain('SAVED ESTIMATE');
  });

  it('leaves agent1 text untouched when under the cap', () => {
    const short = 'x'.repeat(100);
    const msg = buildAgent4UserMessage({ ...baseInput, agent1Output: short });
    expect(msg).toContain(short);
    expect(msg).not.toContain('TRUNCATED');
  });

  it('truncates agent1 text over the cap and appends a visible marker', () => {
    const long = 'y'.repeat(AGENT1_TEXT_CAP + 5000);
    const msg = buildAgent4UserMessage({ ...baseInput, agent1Output: long });
    expect(msg).toContain('[TRUNCATED — drawing analysis exceeded limit]');
    // the raw untruncated blob must not appear whole
    expect(msg).not.toContain(long);
    // exactly AGENT1_TEXT_CAP characters of 'y' should be preserved
    expect(msg).toContain('y'.repeat(AGENT1_TEXT_CAP));
  });

  it('preserves the agent2 block unchanged, uncapped', () => {
    const msg = buildAgent4UserMessage(baseInput);
    expect(msg).toContain('--- SCOPE & ESTIMATE (Agent 2) ---');
    expect(msg).toContain(baseInput.agent2Output);
  });
});

describe('isAgent4Shape', () => {
  it('true for a minimal new-shape object (sections + takeoff arrays)', () => {
    expect(isAgent4Shape({ sections: [], takeoff: [] })).toBe(true);
    expect(isAgent4Shape({ sections: [{ title: 'A. Service & Distribution', bullets: [] }], takeoff: [{ name: 'x', items: [] }] })).toBe(true);
  });

  it('false for an empty object', () => {
    expect(isAgent4Shape({})).toBe(false);
  });

  it('false for the old (pre-Phase-3) ProposalJSON shape', () => {
    expect(isAgent4Shape({ scopeOfWork: { A_ServiceDistribution: [] }, totalPrice: '$1' })).toBe(false);
  });

  it('false for null/undefined/non-objects', () => {
    expect(isAgent4Shape(null)).toBe(false);
    expect(isAgent4Shape(undefined)).toBe(false);
    expect(isAgent4Shape('a string')).toBe(false);
    expect(isAgent4Shape(42)).toBe(false);
  });

  it('false when only one of sections/takeoff is an array', () => {
    expect(isAgent4Shape({ sections: [], takeoff: 'not an array' })).toBe(false);
    expect(isAgent4Shape({ sections: 'not an array', takeoff: [] })).toBe(false);
  });
});
