// Retry helper for transient AI/network failures (rate limits, overloaded, 5xx,
// dropped connections). Anthropic calls in the takeoff pipeline are long-running
// and otherwise fail permanently on a momentary blip; this makes a single run far
// more likely to complete end-to-end.

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/** True for errors worth retrying: rate limits, overload, 5xx, and network errors. */
export function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status);
  // No HTTP status → connection/timeout error.
  const text = `${(err as { name?: string })?.name ?? ''} ${(err as Error)?.message ?? ''}`;
  return /APIConnection|Connection|Timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(text);
}

/** Exponential backoff with jitter, capped at maxDelayMs. */
export function backoffDelay(attempt: number, baseDelayMs = 1000, maxDelayMs = 30000): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2)); // 50–100% of the window
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

/**
 * Run fn, retrying transient failures with exponential backoff. Non-retryable
 * errors (e.g. 400/401/404) throw immediately. Re-throws the last error once
 * retries are exhausted.
 */
export async function callWithRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryableError(err)) throw err;
      const delay = backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      opts.onRetry?.(attempt + 1, err, delay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
