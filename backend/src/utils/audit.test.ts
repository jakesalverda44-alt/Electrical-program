import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/pool', () => ({ pool: { query: vi.fn() } }));

import { writeAudit, purgeExpired } from './audit';
import { pool } from '../db/pool';

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('writeAudit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts an audit row with the supplied fields', async () => {
    query.mockResolvedValue({ rowCount: 1 });
    const req: any = { user: { id: 'u1', name: 'Pat' } };
    await writeAudit(req, { action: 'award', entityType: 'bid', entityId: 'b1', summary: 'Awarded' });
    expect(query).toHaveBeenCalledOnce();
    const params = query.mock.calls[0][1];
    expect(params[0]).toBe('u1');           // user_id
    expect(params[2]).toBe('award');        // action
    expect(params[3]).toBe('bid');          // entity_type
    expect(params[4]).toBe('b1');           // entity_id
  });

  it('never throws when the insert fails (best-effort)', async () => {
    query.mockRejectedValue(new Error('db down'));
    const req: any = { user: { id: 'u1', name: 'Pat' } };
    await expect(writeAudit(req, { action: 'delete', entityType: 'gen' })).resolves.toBeUndefined();
  });
});

describe('purgeExpired', () => {
  beforeEach(() => vi.clearAllMocks());

  // The two fixed-window notification deletes (audit data #2) call
  // pool.query(sql) with no params at all — Postgres rejects a bind with
  // params the query text doesn't reference — so only the calls that DO pass
  // params are expected to carry the retentionMonths interval.
  it('uses the given retention window as a Postgres interval', async () => {
    query.mockResolvedValue({ rowCount: 0 });
    await purgeExpired(6);
    const withParams = query.mock.calls.filter(c => c[1] !== undefined);
    expect(withParams.length).toBe(5); // audit_log, bids, generator_proposals, documents, won_jobs
    expect(withParams.every(c => c[1][0] === '6 months')).toBe(true);
  });

  it('clamps invalid windows to a 12-month default', async () => {
    query.mockResolvedValue({ rowCount: 0 });
    await purgeExpired(0);
    const withParams = query.mock.calls.filter(c => c[1] !== undefined);
    expect(withParams.length).toBe(5);
    expect(withParams.every(c => c[1][0] === '12 months')).toBe(true);
  });

  it('returns counts only for tables that actually had rows removed', async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ rowCount: 3 }) // audit_log
      .mockResolvedValueOnce({ rowCount: 0 }) // bids
      .mockResolvedValueOnce({ rowCount: 2 }) // generator_proposals
      .mockResolvedValueOnce({ rowCount: 0 }) // documents
      .mockResolvedValueOnce({ rowCount: 0 }) // won_jobs
      .mockResolvedValueOnce({ rowCount: 0 }) // notifications_read
      .mockResolvedValueOnce({ rowCount: 5 }); // notifications_unread
    const counts = await purgeExpired(12);
    expect(counts).toEqual({ audit_log: 3, generator_proposals: 2, notifications_unread: 5 });
  });

  // Audit data #2/#17 — the two notification-retention deletes reuse the same
  // `run()` helper as the tables above, so they're still exercised by the two
  // "every call uses the interval" tests; this one checks their SQL/labels
  // specifically, independent of the retentionMonths window (they're fixed at
  // 60/180 days regardless of what's passed to purgeExpired).
  it('purges notifications on fixed 60-day (read) / 180-day (unread) windows, not the retentionMonths window', async () => {
    query.mockResolvedValue({ rowCount: 0 });
    await purgeExpired(6);
    const sqls = query.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => s.includes('notifications') && s.includes('read') && s.includes("60 days") && !s.includes('NOT read'))).toBe(true);
    expect(sqls.some(s => s.includes('NOT read') && s.includes("180 days"))).toBe(true);
  });
});
