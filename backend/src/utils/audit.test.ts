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

  it('uses the given retention window as a Postgres interval', async () => {
    query.mockResolvedValue({ rowCount: 0 });
    await purgeExpired(6);
    expect(query.mock.calls.every(c => c[1][0] === '6 months')).toBe(true);
  });

  it('clamps invalid windows to a 12-month default', async () => {
    query.mockResolvedValue({ rowCount: 0 });
    await purgeExpired(0);
    expect(query.mock.calls.every(c => c[1][0] === '12 months')).toBe(true);
  });

  it('returns counts only for tables that actually had rows removed', async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ rowCount: 3 }) // audit_log
      .mockResolvedValueOnce({ rowCount: 0 }) // bids
      .mockResolvedValueOnce({ rowCount: 2 }) // generator_proposals
      .mockResolvedValueOnce({ rowCount: 0 }) // documents
      .mockResolvedValueOnce({ rowCount: 0 }); // won_jobs
    const counts = await purgeExpired(12);
    expect(counts).toEqual({ audit_log: 3, generator_proposals: 2 });
  });
});
