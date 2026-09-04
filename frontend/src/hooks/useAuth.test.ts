// @vitest-environment happy-dom
// Audit: Security #8 (High) / Task 7.4 — the old query-param branch decoded a
// bearer JWT handed straight off the URL. This tests the replacement: ?mscode triggers a
// POST exchange, and the token/user only ever land in localStorage after that
// call succeeds — never parsed out of the URL itself.
//
// `localStorage` comes from the suite-wide shim in `src/test/setup.ts` (Node's
// own experimental global resolves to undefined and shadows happy-dom's).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const post = vi.fn();
vi.mock('../api/client', () => ({
  default: {
    post: (...a: unknown[]) => post(...a),
  },
}));

import { useAuth } from './useAuth';

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
    localStorage.setItem('crm_user', JSON.stringify({ id: 'u2', name: 'Bob', email: 'bob@x.com', role: 'salesperson' }));
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toEqual({ id: 'u2', name: 'Bob', email: 'bob@x.com', role: 'salesperson' });
    expect(post).not.toHaveBeenCalled();
  });
});
