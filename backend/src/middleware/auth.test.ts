import { describe, it, expect, vi, beforeEach } from 'vitest';

// The AI-permission gate reads settings/users; mock those so we can drive the
// "evaluation throws" path and assert it fails CLOSED.
vi.mock('../db/getSetting', () => ({ getSetting: vi.fn() }));
vi.mock('../db/pool', () => ({ pool: { query: vi.fn() } }));

import { requireRole, requireAdmin, isPrivileged, requireAIPermission } from './auth';
import { getSetting } from '../db/getSetting';

type Res = {
  statusCode?: number;
  body?: unknown;
  status: (c: number) => Res;
  json: (b: unknown) => Res;
};

function mockRes(): Res {
  const res: Res = {
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
}

describe('isPrivileged', () => {
  it('is true for owner/administrator/manager', () => {
    expect(isPrivileged({ role: 'owner' })).toBe(true);
    expect(isPrivileged({ role: 'administrator' })).toBe(true);
    expect(isPrivileged({ role: 'manager' })).toBe(true);
  });
  it('is false for non-privileged roles and missing user', () => {
    expect(isPrivileged({ role: 'salesperson' })).toBe(false);
    expect(isPrivileged({ role: 'estimator' })).toBe(false);
    expect(isPrivileged(undefined)).toBe(false);
    expect(isPrivileged({})).toBe(false);
  });
});

describe('requireRole', () => {
  it('calls next() when the user has an allowed role', () => {
    const req: any = { user: { id: '1', role: 'administrator' } };
    const res = mockRes();
    const next = vi.fn();
    requireRole('owner', 'administrator')(req, res as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('rejects with 403 when the role is not allowed', () => {
    const req: any = { user: { id: '1', role: 'salesperson' } };
    const res = mockRes();
    const next = vi.fn();
    requireRole('owner', 'administrator')(req, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects with 401 when there is no authenticated user', () => {
    const req: any = {};
    const res = mockRes();
    const next = vi.fn();
    requireAdmin(req, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('requireAdmin allows the legacy manager role', () => {
    const req: any = { user: { id: '1', role: 'manager' } };
    const res = mockRes();
    const next = vi.fn();
    requireAdmin(req, res as any, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('requireAIPermission — fails closed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies (500) and does NOT call next() when the permission check throws', async () => {
    (getSetting as any).mockRejectedValue(new Error('db down'));
    const req: any = { user: { id: '1', role: 'estimator' } };
    const res = mockRes();
    const next = vi.fn();
    await requireAIPermission('run_analysis')(req, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });
});
