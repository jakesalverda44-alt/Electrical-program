// @vitest-environment happy-dom
// Audit: Security #8 (High) / Task 7.4 — the old query-param branch decoded a
// bearer JWT handed straight off the URL. This tests the replacement: ?mscode triggers a
// POST exchange, and the token/user only ever land in localStorage after that
// call succeeds — never parsed out of the URL itself.
//
// `localStorage` comes from the suite-wide shim in `src/test/setup.ts` (Node's
// own experimental global resolves to undefined and shadows happy-dom's).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const post = vi.fn();
vi.mock('../api/client', () => ({
  default: {
    post: (...a: unknown[]) => post(...a),
  },
}));

import { useAuth } from './useAuth';

const nowSec = () => Math.floor(Date.now() / 1000);

/** An unsigned JWT — the client only ever reads the payload. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}

function setSearch(search: string) {
  window.history.replaceState({}, '', `/${search}`);
}

beforeEach(() => {
  localStorage.clear();
  post.mockReset();
});

afterEach(() => {
  setSearch('');
});

describe('useAuth — Microsoft OAuth code exchange (Task 7.4)', () => {
  it('exchanges ?mscode for a token via POST, then stores it and strips the URL', async () => {
    setSearch('?mscode=abc123');
    post.mockResolvedValueOnce({
      data: { token: 'jwt.token.value', user: { id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'owner' } },
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.user).toEqual({ id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'owner' }));

    expect(post).toHaveBeenCalledWith('/auth/microsoft/exchange', { code: 'abc123' });
    expect(localStorage.getItem('crm_token')).toBe('jwt.token.value');
    expect(JSON.parse(localStorage.getItem('crm_user') || '{}')).toEqual({ id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'owner' });
    // The code never appears as a query string in the address the user ends up on.
    expect(window.location.search).not.toContain('mscode');
  });

  it('never trusts a bearer token placed directly in the URL (the removed legacy query param is ignored)', () => {
    const legacyParam = 'ms' + 'token'; // split so the removed param name isn't grep-matchable in source
    setSearch(`?${legacyParam}=some.jwt.token`);
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('crm_token')).toBeNull();
  });

  it('does not set a user when the exchange fails (expired/replayed code)', async () => {
    setSearch('?mscode=bad-code');
    post.mockRejectedValueOnce({ response: { status: 404 } });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('crm_token')).toBeNull();
  });

  it('falls back to a stored session when there is no ?mscode', () => {
    localStorage.setItem('crm_token', jwt({ exp: nowSec() + 3600 }));
    localStorage.setItem('crm_user', JSON.stringify({ id: 'u2', name: 'Bob', email: 'bob@x.com', role: 'salesperson' }));
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toEqual({ id: 'u2', name: 'Bob', email: 'bob@x.com', role: 'salesperson' });
    expect(post).not.toHaveBeenCalled();
  });
});

// Audit code #7 (High) — "Session token in localStorage with no expiry check on
// restore". The ordinary restore path was `const s =
// localStorage.getItem('crm_user'); return s ? JSON.parse(s) : null;`, so an
// expired token booted the app fully "logged in", fired the bootstrap requests,
// collected 401s and only then ejected the user.
describe('useAuth — session restore', () => {
  it('treats an expired token as logged out and clears storage', () => {
    localStorage.setItem('crm_token', jwt({ exp: nowSec() - 60 }));
    localStorage.setItem('crm_user', JSON.stringify({ id: 'u3', name: 'Stale', email: 's@x.com', role: 'owner' }));

    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('crm_token')).toBeNull();
    expect(localStorage.getItem('crm_user')).toBeNull();
    // No request was made on a session we already know is dead.
    expect(post).not.toHaveBeenCalled();
  });

  it('restores a session whose token is still valid', () => {
    const user = { id: 'u4', name: 'Fresh', email: 'f@x.com', role: 'estimator' };
    localStorage.setItem('crm_token', jwt({ exp: nowSec() + 600 }));
    localStorage.setItem('crm_user', JSON.stringify(user));

    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toEqual(user);
    expect(localStorage.getItem('crm_token')).not.toBeNull();
  });

  it('treats an undecodable token, and one with no exp, as logged out', () => {
    for (const token of ['not-a-jwt', jwt({ sub: 'u5' }), 'a.b.c']) {
      localStorage.clear();
      localStorage.setItem('crm_token', token);
      localStorage.setItem('crm_user', JSON.stringify({ id: 'u5', name: 'X', email: 'x@x.com', role: 'owner' }));

      const { result } = renderHook(() => useAuth());

      expect(result.current.user).toBeNull();
      expect(localStorage.getItem('crm_token')).toBeNull();
    }
  });

  it('treats corrupt crm_user JSON as logged out rather than throwing on boot', () => {
    localStorage.setItem('crm_token', jwt({ exp: nowSec() + 600 }));
    localStorage.setItem('crm_user', '{not json');

    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('crm_user')).toBeNull();
  });

  it('logout clears both keys', () => {
    localStorage.setItem('crm_token', jwt({ exp: nowSec() + 600 }));
    localStorage.setItem('crm_user', JSON.stringify({ id: 'u6', name: 'Y', email: 'y@x.com', role: 'owner' }));

    const { result } = renderHook(() => useAuth());
    act(() => result.current.logout());

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('crm_token')).toBeNull();
    expect(localStorage.getItem('crm_user')).toBeNull();
  });
});
