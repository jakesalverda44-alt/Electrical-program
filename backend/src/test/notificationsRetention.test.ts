// Audit batch 3, Task 2 (audit-data-perf.md #2, #17) — notifications used to
// regenerate every day a follow-up/bid/lead stayed open because the dedup key
// included the calendar day, and nothing ever purged old rows. This covers
// the three behavioral guarantees the fix makes: (1) re-running the hourly
// scan on the same open record is a no-op, (2) the fix holds across a
// calendar-day boundary — not just within one process run — because the
// dedup key no longer has a day segment to roll over, and (3) the new
// retention windows in purgeExpired delete only what's outside them.
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser } from './harness';
import { runReminderScan } from '../notifications/engine';
import { purgeExpired } from '../utils/audit';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('notifications: dedup no longer keys on the calendar day (audit data #2)', () => {
  it('running the hourly scan twice on the same still-open task creates exactly one row', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('owner');
    const { rows: taskRows } = await pool.query(
      `INSERT INTO tasks (title, due_date, status, assigned_to)
       VALUES ($1, CURRENT_DATE, 'open', $2) RETURNING id`,
      [`Retention scan task ${Date.now()}`, owner.id]
    );
    const taskId = taskRows[0].id as string;

    await runReminderScan();
    await runReminderScan();

    const { rows } = await pool.query(
      `SELECT dedup_key FROM notifications WHERE type='followup_due' AND link_id=$1`, [taskId]
    );
    expect(rows).toHaveLength(1);
    // The dedup key is record+user only — no date segment — which is the
    // actual mechanism that makes a later calendar day a no-op too (see next
    // test): there's nothing in the key for a day rollover to change.
    expect(rows[0].dedup_key).toBe(`followup:${taskId}:${owner.id}`);
    // Generous timeout: runReminderScan() scans every open task/lead/bid/proposal
    // in the whole test DB, which this project's test history has left with
    // thousands of synthetic owner/admin users (see the report) — a single
    // scan legitimately takes several seconds here, though it would not in
    // production's real ~2-user scale.
  }, 30_000);

  it('a scan on a later calendar day still does not duplicate the row', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('owner');
    const { rows: taskRows } = await pool.query(
      `INSERT INTO tasks (title, due_date, status, assigned_to)
       VALUES ($1, CURRENT_DATE, 'open', $2) RETURNING id`,
      [`Retention day-boundary task ${Date.now()}`, owner.id]
    );
    const taskId = taskRows[0].id as string;

    await runReminderScan();
    const before = await pool.query(
      `SELECT id, created_at FROM notifications WHERE type='followup_due' AND link_id=$1`, [taskId]
    );
    expect(before.rows).toHaveLength(1);

    // Simulate "the next calendar day" by backdating the row itself — since
    // runReminderScan computes the dedup key client-side with no reference to
    // wall-clock date at all (the old `:${day}` segment is gone), moving the
    // existing row's created_at into yesterday and scanning again is
    // equivalent to the scan actually running a day later.
    await pool.query(`UPDATE notifications SET created_at = created_at - interval '25 hours' WHERE id = $1`, [before.rows[0].id]);

    await runReminderScan();

    const after = await pool.query(
      `SELECT id FROM notifications WHERE type='followup_due' AND link_id=$1`, [taskId]
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].id).toBe(before.rows[0].id); // same row, not a new one
  }, 30_000);

  it('a multi-row batch insert creates one row per task and stays a no-op on rescans', async (ctx) => {
    if (!ok) return ctx.skip();
    // Exercises createNotificationsBulk's single UNNEST insert covering several
    // records at once — the case the old N sequential createNotification calls
    // (one per record × target-user) handled as N round trips instead of one.
    const owner = await makeUser('owner');
    const [t1, t2, t3] = await Promise.all([1, 2, 3].map(async (n) => {
      const { rows } = await pool.query(
        `INSERT INTO tasks (title, due_date, status, assigned_to) VALUES ($1, CURRENT_DATE, 'open', $2) RETURNING id`,
        [`Bulk task ${n} ${Date.now()}_${Math.random()}`, owner.id]
      );
      return rows[0].id as string;
    }));

    await runReminderScan();

    const { rows: after } = await pool.query(
      `SELECT link_id FROM notifications WHERE type='followup_due' AND link_id = ANY($1::uuid[])`,
      [[t1, t2, t3]]
    );
    expect(new Set(after.map(r => r.link_id)).size).toBe(3); // one row per task

    // Re-running must not add a 4th, 5th, 6th row.
    await runReminderScan();
    const { rows: again } = await pool.query(
      `SELECT count(*)::int AS n FROM notifications WHERE type='followup_due' AND link_id = ANY($1::uuid[])`,
      [[t1, t2, t3]]
    );
    expect(again[0].n).toBe(3);
  }, 30_000);
});

describe('notifications retention windows (audit data #2)', () => {
  it('purge removes read rows only past 60 days and unread rows only past 180 days', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('owner');
    const mk = async (read: boolean, ageDays: number) => {
      const { rows } = await pool.query(
        `INSERT INTO notifications (user_id, type, title, read, created_at)
         VALUES ($1, 'followup_due', $2, $3, now() - ($4 || ' days')::interval)
         RETURNING id`,
        [owner.id, `Retention fixture ${read}/${ageDays}/${Math.random()}`, read, String(ageDays)]
      );
      return rows[0].id as string;
    };

    const readOld = await mk(true, 61);     // past the 60-day read window — purged
    const readRecent = await mk(true, 59);  // inside it — kept
    const unreadOld = await mk(false, 181); // past the 180-day unread window — purged
    const unreadRecent = await mk(false, 179); // inside it — kept

    await purgeExpired(12);

    const { rows } = await pool.query(
      `SELECT id FROM notifications WHERE id = ANY($1::uuid[])`,
      [[readOld, readRecent, unreadOld, unreadRecent]]
    );
    const remaining = new Set(rows.map(r => r.id));
    expect(remaining.has(readOld)).toBe(false);
    expect(remaining.has(unreadOld)).toBe(false);
    expect(remaining.has(readRecent)).toBe(true);
    expect(remaining.has(unreadRecent)).toBe(true);
  });
});
