import { describe, it, expect, vi } from 'vitest';
import { isRetryableError, backoffDelay, callWithRetry } from './retry';

describe('isRetryableError', () => {
  it('retries rate limits, overload, and 5xx', () => {
    for (const status of [429, 500, 502, 503, 504, 529]) {
      expect(isRetryableError({ status })).toBe(true);
    }
  });
  it('does not retry client errors', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableError({ status })).toBe(false);
    }
  });
  it('retries connection/timeout errors with no status', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableError({ name: 'APIConnectionError', message: 'socket hang up' })).toBe(true);
    expect(isRetryableError(new Error('totally unrelated'))).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('grows with attempt and respects the cap', () => {
    const d0 = backoffDelay(0, 1000, 30000);
    const d3 = backoffDelay(3, 1000, 30000);
    expect(d0).toBeGreaterThanOrEqual(500);
    expect(d0).toBeLessThanOrEqual(1000);
    expect(d3).toBeLessThanOrEqual(30000);
    const capped = backoffDelay(20, 1000, 30000);
    expect(capped).toBeLessThanOrEqual(30000);
  });
});

describe('callWithRetry', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(callWithRetry(fn, { baseDelayMs: 1, maxDelayMs: 2 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 529 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('ok');
    const onRetry = vi.fn();
    await expect(callWithRetry(fn, { baseDelayMs: 1, maxDelayMs: 2, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on a non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });
    await expect(callWithRetry(fn, { baseDelayMs: 1, maxDelayMs: 2 })).rejects.toEqual({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget is exhausted', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429 });
    await expect(callWithRetry(fn, { retries: 2, baseDelayMs: 1, maxDelayMs: 2 })).rejects.toEqual({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
