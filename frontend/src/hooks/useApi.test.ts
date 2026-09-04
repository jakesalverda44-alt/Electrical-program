// @vitest-environment happy-dom
// Audit: frontend-code #3 (High, "Zero request cancellation app-wide — stale
// responses win the race") and #13 (no timeout / opaque network errors).
//
// These four cases are the whole reason the hook exists. On main there was no
// hook at all and every one of the 37 call sites reproduced case (a).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const get = vi.fn();
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    default: { get: (...a: unknown[]) => get(...a) },
  };
});

import { useApi } from './useApi';

/** A promise plus the handles to settle it later. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  get.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useApi', () => {
  it('applies only the last response when the url changes twice in quick succession', async () => {
    const first = deferred<{ data: string }>();
    const second = deferred<{ data: string }>();
    get.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(({ url }) => useApi<string>(url), {
      initialProps: { url: '/bids/a/qualify' },
    });

    rerender({ url: '/bids/b/qualify' });

    // B answers first, then A's slower response lands. Without the abort check
    // the hook would end up showing A's data on B's url.
    await act(async () => { second.resolve({ data: 'B' }); });
    await act(async () => { first.resolve({ data: 'A' }); });

    await waitFor(() => expect(result.current.data).toBe('B'));
    expect(result.current.data).toBe('B');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('aborts the in-flight request on unmount and applies no state after it', async () => {
    const pending = deferred<{ data: string }>();
    get.mockImplementation(() => pending.promise);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result, unmount } = renderHook(() => useApi<string>('/dashboard'));
    const signal = get.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);

    await act(async () => { pending.resolve({ data: 'late' }); });

    // No update was applied, and React logged no "update on unmounted" warning.
    expect(result.current.data).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('surfaces the normalized message for a network failure', async () => {
    get.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true }));

    const { result } = renderHook(() => useApi<string>('/dashboard'));

    await waitFor(() => expect(result.current.error).toBe('Cannot reach the server'));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('surfaces the normalized message for a 500', async () => {
    get.mockRejectedValue(Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status: 500, data: { error: 'boom' } },
    }));

    const { result } = renderHook(() => useApi<string>('/dashboard'));

    await waitFor(() => expect(result.current.error).toBe('Server error'));
  });

  it('reload() cancels the request already in flight before starting the next', async () => {
    const first = deferred<{ data: string }>();
    const second = deferred<{ data: string }>();
    get.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => useApi<string>('/intake/unread-count'));
    const firstSignal = get.mock.calls[0][1].signal as AbortSignal;

    await act(async () => { result.current.reload(); });

    expect(firstSignal.aborted).toBe(true);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    await act(async () => { second.resolve({ data: 'fresh' }); });
    await act(async () => { first.resolve({ data: 'stale' }); });

    await waitFor(() => expect(result.current.data).toBe('fresh'));
    expect(result.current.data).toBe('fresh');
  });

  it('makes no request while disabled, then fetches when enabled flips', async () => {
    get.mockResolvedValue({ data: 'ok' });

    const { result, rerender } = renderHook(
      ({ enabled }) => useApi<string>('/users', { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(get).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toBe('ok'));
  });

  it('does not refetch when an equal-by-value params object is passed on a new render', async () => {
    get.mockResolvedValue({ data: [] });

    const { result, rerender } = renderHook(
      ({ id }) => useApi<unknown[]>('/documents', { params: { linked_id: id } }),
      { initialProps: { id: 'b1' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(get).toHaveBeenCalledTimes(1);

    rerender({ id: 'b1' });
    expect(get).toHaveBeenCalledTimes(1);

    rerender({ id: 'b2' });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
