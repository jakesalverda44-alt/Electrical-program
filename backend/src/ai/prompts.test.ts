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

  it('still instructs the required ECFECI language and the banned-word list; the supplier comes from the account terms, not the prompt', () => {
    expect(AGENT4_SYSTEM).toContain('ECFECI');
    // Takeoff accuracy Task 8 — Southern Lighting Source moved into the Default
    // account rule; the prompt defers to the ACCOUNT TERMS block.
    expect(AGENT4_SYSTEM).not.toContain('Southern Lighting Source');
    expect(AGENT4_SYSTEM).toContain('ACCOUNT TERMS block');
    expect(AGENT4_SYSTEM).toContain('RFI');
    expect(AGENT4_SYSTEM).toContain('TBD');
  });
});

describe('agent1PromptWithCountingSections (takeoff accuracy Task 2)', () => {
  it('default prompt already carries the four counting arrays', async () => {
    const { AGENT1_SYSTEM, agent1PromptWithCountingSections } = await import('./prompts');
    for (const k of ['fixtureSchedule', 'symbolLegend', 'panelCircuits', 'furnishStatements']) expect(AGENT1_SYSTEM).toContain(`"${k}"`);
    expect(agent1PromptWithCountingSections('')).toBe(AGENT1_SYSTEM);
  });
  it('appends the counting sections to a customized prompt that predates them', async () => {
    const { agent1PromptWithCountingSections, AGENT1_COUNTING_SECTIONS } = await import('./prompts');
    const out = agent1PromptWithCountingSections('My custom analyzer prompt.');
    expect(out.startsWith('My custom analyzer prompt.')).toBe(true);
    expect(out).toContain(AGENT1_COUNTING_SECTIONS);
    expect(out).toContain('"furnishStatements"');
    // Already has them -> untouched.
    expect(agent1PromptWithCountingSections('custom with fixtureSchedule')).toBe('custom with fixtureSchedule');
  });
});

describe('evidence round 3.4 / fix round S12 — the parser replaces Agent 1\'s schedule quantities only where it read them', () => {
  it('the default prompt and a customized one both carry the SCHEDULE QUANTITIES rule', async () => {
    const { AGENT1_SYSTEM, AGENT1_COUNTING_SECTIONS, agent1PromptWithCountingSections } = await import('./prompts');
    // Fix round S12 — no ban: Agent 1's quantities stand wherever no parser source replaces them.
    expect(AGENT1_COUNTING_SECTIONS).toMatch(/SCHEDULE QUANTITIES — list every equipment-schedule item/);
    expect(AGENT1_COUNTING_SECTIONS).toMatch(/they stand wherever the schedules could not be read/);
    expect(AGENT1_COUNTING_SECTIONS).not.toMatch(/never put a quantity/);
    expect(AGENT1_SYSTEM).toContain('SCHEDULE QUANTITIES');
    expect(agent1PromptWithCountingSections('My custom analyzer prompt.')).toContain('SCHEDULE QUANTITIES');
  });
  it('the evidence readers are narrow: none of them counts devices', async () => {
    const { VIEWPORT_SYSTEM, TYPICALS_SYSTEM, SCHEDULE_ROWS_SYSTEM } = await import('./prompts');
    expect(VIEWPORT_SYSTEM).toMatch(/You do not count anything/);
    expect(TYPICALS_SYSTEM).toMatch(/You do not count anything on the plans/);
    expect(TYPICALS_SYSTEM).toMatch(/never guess/);
    expect(SCHEDULE_ROWS_SYSTEM).toMatch(/ROW BY ROW\. Never summarize, merge or skip rows/);
  });
});
