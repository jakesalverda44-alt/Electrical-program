import { describe, it, expect } from 'vitest';
import { mergeReminderPrefs, DEFAULT_REMINDER_PREFS } from './prefs';

describe('mergeReminderPrefs', () => {
  it('returns defaults for empty / missing input', () => {
    expect(mergeReminderPrefs({})).toEqual(DEFAULT_REMINDER_PREFS);
    expect(mergeReminderPrefs(null)).toEqual(DEFAULT_REMINDER_PREFS);
  });

  it('overrides only the provided fields, keeping other defaults', () => {
    const merged = mergeReminderPrefs({ reminders: { types: { bid_due_soon: { email: true, days: 7 } } } });
    expect(merged.types.bid_due_soon).toEqual({ app: true, email: true, days: 7 });
    // Untouched types keep their defaults
    expect(merged.types.followup_due).toEqual(DEFAULT_REMINDER_PREFS.types.followup_due);
  });

  it('reads an explicit recipients list', () => {
    const merged = mergeReminderPrefs({ reminders: { recipients: ['a@b.com'] } });
    expect(merged.recipients).toEqual(['a@b.com']);
  });

  it('ignores a non-array recipients value', () => {
    const merged = mergeReminderPrefs({ reminders: { recipients: 'oops' } });
    expect(merged.recipients).toEqual([]);
  });
});
