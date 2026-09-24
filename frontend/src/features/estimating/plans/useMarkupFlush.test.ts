// @vitest-environment happy-dom
// Re-run reset fix round S6 — the workspace saves pending plan markup before
// a re-run; a failed save blocks the re-run.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMarkupFlush } from './useMarkupFlush';

type Status = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

function setup(initial: Status) {
  let flush: (() => Promise<boolean>) | null = null;
  const register = vi.fn((f: (() => Promise<boolean>) | null) => { flush = f; });
  const retryNow = vi.fn();
  const hook = renderHook(({ status }: { status: Status }) => useMarkupFlush(status, retryNow, register, { pollMs: 5, timeoutMs: 2000 }), { initialProps: { status: initial } });
  return { hook, retryNow, register, flush: () => flush! };
}

describe('useMarkupFlush', () => {
  it('nothing pending: resolves true without a save', async () => {
    const { flush, retryNow } = setup('saved');
    await expect(flush()()).resolves.toBe(true);
    expect(retryNow).not.toHaveBeenCalled();
  });

  it('pending markup: forces the save and resolves true once saved', async () => {
    const { hook, flush, retryNow } = setup('pending');
    const p = flush()();
    expect(retryNow).toHaveBeenCalledTimes(1);
    act(() => hook.rerender({ status: 'saving' }));
    act(() => hook.rerender({ status: 'saved' }));
    await expect(p).resolves.toBe(true);
  });

  it('a failed save resolves false (the re-run is blocked)', async () => {
    const { hook, flush } = setup('pending');
    const p = flush()();
    act(() => hook.rerender({ status: 'saving' }));
    act(() => hook.rerender({ status: 'error' }));
    await expect(p).resolves.toBe(false);
  });

  it('unregisters on unmount', () => {
    const { hook, register } = setup('idle');
    hook.unmount();
    expect(register).toHaveBeenLastCalledWith(null);
  });
});
