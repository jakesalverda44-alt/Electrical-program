// @vitest-environment happy-dom
// Audit: frontend-code #1 (High) — 27 `try { … } finally { setSaving(false) }`
// blocks with no `catch`, so a failed save stopped the spinner and did nothing
// else; frontend-code #5 and ux #2 — the success toast fired whether or not the
// request resolved. This hook is what those sites were migrated onto.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AppProviders } from '../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from './useAppSettings';
import { useMutation } from './useMutation';
import { Toast, User } from '../types';

const shown: Toast[] = [];
const user: User = { id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'owner' };

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders
      user={user}
      showToast={t => { shown.push(t); }}
      settings={DEFAULT_APP_SETTINGS}
      reloadSettings={() => {}}
    >
      {children}
    </AppProviders>
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const httpError = (status: number, data: unknown) =>
  Object.assign(new Error('boom'), { isAxiosError: true, response: { status, data } });

beforeEach(() => { shown.length = 0; });

describe('useMutation', () => {
  it('calls onSuccess and shows the success toast on the resolved value only', async () => {
    const onSuccess = vi.fn();
    const fn = vi.fn().mockResolvedValue({ id: 'bid-1' });

    const { result } = renderHook(
      () => useMutation(fn, { onSuccess, successToast: r => ({ title: 'Saved', sub: (r as { id: string }).id }) }),
      { wrapper },
    );

    await act(async () => { await result.current.run(); });

    expect(onSuccess).toHaveBeenCalledWith({ id: 'bid-1' });
    expect(shown).toEqual([{ title: 'Saved', sub: 'bid-1' }]);
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('shows an error-variant toast and rolls back when the request fails', async () => {
    const rollback = vi.fn();
    const optimistic = vi.fn(() => rollback);
    const fn = vi.fn().mockRejectedValue(httpError(500, { error: 'db down' }));

    const { result } = renderHook(
      () => useMutation(fn, { optimistic, successToast: { title: 'Status updated' }, errorTitle: 'Update failed' }),
      { wrapper },
    );

    await act(async () => { await result.current.run(); });

    expect(optimistic).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
    // No success toast, and the failure is marked as one.
    expect(shown).toEqual([{ variant: 'error', title: 'Update failed', sub: 'Server error' }]);
    expect(result.current.error).toBe('Server error');
  });

  it('takes the error message from apiErrorMessage, not from the raw error', async () => {
    const fn = vi.fn().mockRejectedValue(httpError(400, { error: 'Name is required' }));
    const { result } = renderHook(() => useMutation(fn), { wrapper });

    await act(async () => { await result.current.run(); });

    expect(result.current.error).toBe('Name is required');
    expect(shown[0].sub).toBe('Name is required');
    expect(shown[0].variant).toBe('error');
  });

  it('does not start a second request while one is in flight', async () => {
    const first = deferred<string>();
    const fn = vi.fn().mockImplementation(() => first.promise);

    const { result } = renderHook(() => useMutation(fn), { wrapper });

    let a: Promise<unknown> | undefined;
    let b: Promise<unknown> | undefined;
    act(() => {
      a = result.current.run();
      b = result.current.run();
    });

    expect(fn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.saving).toBe(true));

    await act(async () => { first.resolve('ok'); await Promise.all([a, b]); });

    // The second caller got the first call's result rather than nothing.
    await expect(b).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);

    // Once settled, a later run is allowed through again.
    fn.mockResolvedValue('again');
    await act(async () => { await result.current.run(); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('swallows the error by default and rethrows only when asked', async () => {
    const fn = vi.fn().mockRejectedValue(httpError(500, {}));

    const quiet = renderHook(() => useMutation(fn), { wrapper });
    await act(async () => { await expect(quiet.result.current.run()).resolves.toBeUndefined(); });

    const loud = renderHook(() => useMutation(fn, { rethrow: true }), { wrapper });
    await act(async () => { await expect(loud.result.current.run()).rejects.toThrow(); });
  });

  it('suppresses the failure toast when errorToast is false', async () => {
    const fn = vi.fn().mockRejectedValue(httpError(500, {}));
    const { result } = renderHook(() => useMutation(fn, { errorToast: false }), { wrapper });

    await act(async () => { await result.current.run(); });

    expect(shown).toEqual([]);
    expect(result.current.error).toBe('Server error');
  });

  it('passes run() arguments through to fn, optimistic and onSuccess', async () => {
    const fn = vi.fn().mockResolvedValue('done');
    const optimistic = vi.fn(() => () => {});
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => useMutation(fn as (id: string, phase: string) => Promise<string>, { optimistic, onSuccess }),
      { wrapper },
    );

    await act(async () => { await result.current.run('b1', 'permit'); });

    expect(fn).toHaveBeenCalledWith('b1', 'permit');
    expect(optimistic).toHaveBeenCalledWith('b1', 'permit');
    expect(onSuccess).toHaveBeenCalledWith('done', 'b1', 'permit');
  });
});
