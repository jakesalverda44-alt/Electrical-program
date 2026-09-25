// Plans-panel fix round — review eb39943, B1 (blocker): the "spec" discipline
// was reverted entirely. The classifier's discipline enum, its prompt, and
// its cache key must be byte-identical to main (76d5539) — a plan sheet must
// never be silently reclassified 'spec' and dropped from analysis or
// counting. These are regression guards against ever re-introducing it.
import { describe, it, expect } from 'vitest';
import { parseClassifierJSON, SELECT_DISCIPLINES } from '../ai/pageClassifier';
import { PAGE_CLASSIFIER_SYSTEM } from '../ai/prompts';
import { classifierCacheKey } from '../services/sheetCheck';

describe('the classifier discipline / prompt / cache key are unchanged from main', () => {
  it('"spec" is not a discipline the classifier prompt offers', () => {
    expect(PAGE_CLASSIFIER_SYSTEM).not.toMatch(/\bspec\b/i);
  });

  it('a classifier reply claiming discipline "spec" is not accepted — it falls back to "unknown", never drops the page', () => {
    const out = parseClassifierJSON(
      JSON.stringify([{ page: 1, sheetNo: 'E-0.1', title: 'ELECTRICAL SPECIFICATIONS', discipline: 'spec', cls: 'plan' }]),
      [1]
    );
    expect(out).toHaveLength(1);
    expect(out[0].discipline).toBe('unknown'); // not a valid enum value -> the parser's own invalid-value fallback
    expect(out[0].sheetNo).toBe('E-0.1'); // the sheet number itself is still read
  });

  it('SELECT_DISCIPLINES is exactly what main shipped (no "spec")', () => {
    expect([...SELECT_DISCIPLINES].sort()).toEqual(['cover', 'electrical', 'fuel', 'lowvoltage', 'unknown'].sort());
  });

  it('the classifier cache key hashes the exact prompt text main shipped (a changed prompt would bust every bid\'s cache)', () => {
    // Locked to the value computed from main's (76d5539) PAGE_CLASSIFIER_SYSTEM
    // text — if this ever changes, every existing plan set's cached
    // classification is invalidated, which is worth a deliberate decision,
    // not an incidental prompt edit.
    expect(classifierCacheKey('claude-haiku-test')).toBe('claude-haiku-test|d93daf3c9f8d');
  });
});
