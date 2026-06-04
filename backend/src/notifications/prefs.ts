import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';

export type ReminderType = 'followup_due' | 'proposal_viewed_unsigned' | 'bid_due_soon';

export interface ReminderTypePref { app: boolean; email: boolean; days?: number }

export interface ReminderPrefs {
  recipients: string[];                       // explicit email recipients; empty => owners/admins
  types: Record<ReminderType, ReminderTypePref>;
}

// Sensible defaults: everything on in-app + email; nudges/bids look back/ahead 3 days.
export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  recipients: [],
  types: {
    followup_due:             { app: true, email: true },
    proposal_viewed_unsigned: { app: true, email: true, days: 3 },
    bid_due_soon:             { app: true, email: false, days: 3 },
  },
};

/** Merge a parsed notifications_json blob with defaults. Pure / unit-testable. */
export function mergeReminderPrefs(parsed: unknown): ReminderPrefs {
  const r = (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).reminders : null) as
    | { recipients?: unknown; types?: Record<string, Partial<ReminderTypePref>> } | null;
  const t = r?.types ?? {};
  return {
    recipients: Array.isArray(r?.recipients) ? (r!.recipients as string[]) : DEFAULT_REMINDER_PREFS.recipients,
    types: {
      followup_due:             { ...DEFAULT_REMINDER_PREFS.types.followup_due, ...(t.followup_due ?? {}) },
      proposal_viewed_unsigned: { ...DEFAULT_REMINDER_PREFS.types.proposal_viewed_unsigned, ...(t.proposal_viewed_unsigned ?? {}) },
      bid_due_soon:             { ...DEFAULT_REMINDER_PREFS.types.bid_due_soon, ...(t.bid_due_soon ?? {}) },
    },
  };
}

/** Read reminder preferences out of the notifications_json app setting. */
export async function getReminderPrefs(): Promise<ReminderPrefs> {
  try {
    const raw = await getSetting('notifications_json');
    return mergeReminderPrefs(raw ? JSON.parse(raw) : {});
  } catch {
    return DEFAULT_REMINDER_PREFS;
  }
}

/** Resolve email recipients: explicit list, or fall back to active owners/admins ("just me"). */
export async function resolveRecipients(prefs: ReminderPrefs): Promise<string[]> {
  if (prefs.recipients.length) return prefs.recipients;
  const { rows } = await pool.query(
    `SELECT email FROM users WHERE status = 'active' AND role IN ('owner','administrator') AND email <> ''`
  );
  return rows.map(r => r.email);
}

/** Active owner/admin user ids — used as the in-app target when a record has no salesperson. */
export async function ownerAdminIds(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE status = 'active' AND role IN ('owner','administrator')`
  );
  return rows.map(r => r.id);
}
