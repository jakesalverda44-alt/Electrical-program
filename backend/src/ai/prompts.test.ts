// Phase 3 Task 5.5 — locks AGENT4_SYSTEM to the new data-only contract: the
// boilerplate it used to own (6 scope bullets, 10 terms, closing block) now
// lives ONLY in backend/src/bidstd/boilerplate.ts, never duplicated back
// into the editable prompt where a future edit could silently drift.
import { describe, expect, it } from 'vitest';
import { AGENT4_SYSTEM } from './prompts';
import { standardTerms } from '../bidstd/boilerplate';

describe('AGENT4_SYSTEM — data-only contract (Task 5)', () => {
  it('does not contain the 25%-deposit sentence (boilerplate.ts owns it exclusively)', () => {
    const depositSentence = standardTerms('x')[2];
    expect(AGENT4_SYSTEM).not.toContain(depositSentence);
    expect(AGENT4_SYSTEM).not.toContain('25% of the contract value');
  });

  it('does not contain the standard 6-bullet scope opening text', () => {
    expect(AGENT4_SYSTEM).not.toContain('normal business hours, 8:00 AM');
    expect(AGENT4_SYSTEM).not.toContain('obtain all required electrical permits');
  });

  it('does not contain the closing block strings', () => {
    expect(AGENT4_SYSTEM).not.toContain('Respectfully,');
    expect(AGENT4_SYSTEM).not.toContain('Due Upon Acceptance to Secure Order');
    expect(AGENT4_SYSTEM).not.toContain('Thank you for the opportunity');
  });

  it('does not ask the model to echo a total price field', () => {
    expect(AGENT4_SYSTEM).not.toContain('"totalPrice"');
  });

  it('does not use the pre-Phase-3 rfisToResolve/TBD-scope-bullet pattern', () => {
    expect(AGENT4_SYSTEM).not.toContain('rfisToResolve');
    expect(AGENT4_SYSTEM).not.toContain('write the scope bullet with TBD language');
  });

  it('output schema is the new data-only shape (sections/takeoff, not scopeOfWork)', () => {
    expect(AGENT4_SYSTEM).toContain('"sections"');
    expect(AGENT4_SYSTEM).toContain('"takeoff"');
    expect(AGENT4_SYSTEM).toContain('"fixture_types"');
    expect(AGENT4_SYSTEM).toContain('"allowances_bullets"');
    expect(AGENT4_SYSTEM).not.toContain('"scopeOfWork"');
  });

  it('still instructs the required ECFECI language and the banned-word list', () => {
    expect(AGENT4_SYSTEM).toContain('ECFECI');
    expect(AGENT4_SYSTEM).toContain('Southern Lighting Source');
    expect(AGENT4_SYSTEM).toContain('RFI');
    expect(AGENT4_SYSTEM).toContain('TBD');
  });
});
