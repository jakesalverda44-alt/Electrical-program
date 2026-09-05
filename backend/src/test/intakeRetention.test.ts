// Audit batch 3, Task 3 (audit-data-perf.md #14) — intake_items has no
// deleted_at and nothing ever purged it. purgeExpired now removes resolved
// (accepted/declined) items older than 180 days, and never touches 'pending'
// ones regardless of age — an unresolved invitation should keep showing in
// the inbox no matter how old it gets. lead_activity, proposal_activity,
// activity and communications are deliberately NOT purged (customer history);
// see the report.
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';
import { purgeExpired } from '../utils/audit';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('intake_items retention (audit data #14)', () => {
  it('purge removes a 200-day-old resolved intake item and keeps a 200-day-old pending one', async (ctx) => {
    if (!ok) return ctx.skip();
    const mk = async (status: 'pending' | 'accepted' | 'declined', ageDays: number) => {
      const { rows } = await pool.query(
        `INSERT INTO intake_items (name, status, created_at, updated_at)
         VALUES ($1, $2, now() - ($3 || ' days')::interval, now() - ($3 || ' days')::interval)
         RETURNING id`,
        [`Retention intake fixture ${status}/${ageDays}/${Math.random()}`, status, String(ageDays)]
      );
      return rows[0].id as string;
    };

    const oldAccepted = await mk('accepted', 200);   // resolved, past the window — purged
    const oldDeclined = await mk('declined', 200);   // resolved, past the window — purged
    const oldPending = await mk('pending', 200);     // never resolved — kept regardless of age
    const recentAccepted = await mk('accepted', 100); // resolved, inside the window — kept

    await purgeExpired(12);

    const { rows } = await pool.query(
      `SELECT id FROM intake_items WHERE id = ANY($1::uuid[])`,
      [[oldAccepted, oldDeclined, oldPending, recentAccepted]]
    );
    const remaining = new Set(rows.map(r => r.id));
    expect(remaining.has(oldAccepted)).toBe(false);
    expect(remaining.has(oldDeclined)).toBe(false);
    expect(remaining.has(oldPending)).toBe(true);
    expect(remaining.has(recentAccepted)).toBe(true);
  });
});
