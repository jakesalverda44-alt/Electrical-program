import { isAbortError, normalizeApiError } from '../api/errors';

/**
 * Sends a browser-side failure somewhere a human will eventually see it.
 *
 * `console` appears exactly twice in non-test frontend code (audit
 * frontend-code #15), so before this a production failure left no trace at
 * all: not in the UI, not in the console, not on a server.
 *
 * Three rules, in order of importance:
 *  1. It never throws. Reporting a failure must not become a second failure.
 *  2. It never awaits. Callers are error paths, already doing damage control.
 *  3. It is rate limited client-side, so a render loop cannot turn one bug into
 *     a flood of requests.
 */

const MAX_PER_WINDOW = 10;
const WINDOW_MS = 60_000;

let sentAt: number[] = [];

/** Exported for tests; resets the client-side rate limiter. */
export function resetReportErrorLimit() {
  sentAt = [];
}

function withinRateLimit(now: number): boolean {
  sentAt = sentAt.filter(t => now - t < WINDOW_MS);
  if (sentAt.length >= MAX_PER_WINDOW) return false;
  sentAt.push(now);
  return true;
}

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name, stack: err.stack };
  }
  // An axios rejection is not an Error subclass in every path; use the same
  // normalization the UI shows so the log line and the toast agree.
  const normalized = normalizeApiError(err);
  if (normalized.status !== null || normalized.isNetwork) {
    return { message: `${normalized.status ?? 'network'}: ${normalized.message}` };
  }
  try {
    return { message: typeof err === 'string' ? err : JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

export function reportError(err: unknown, context: string): void {
  try {
    // A request we cancelled ourselves is not a failure.
    if (isAbortError(err)) return;

    const { message, stack } = describe(err);
    if (!message) return;

    // In dev the console IS the sink — a network round-trip to a backend the
    // developer is already watching adds nothing. Under vitest the console is
    // skipped (every deliberately-failing test would print a stack) and the
    // transport path is taken instead, which is what the tests exercise; with
    // no `crm_token` in storage it returns just below, so it stays a no-op.
    if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
      console.warn(`[${context}]`, err);
      return;
    }

    if (!withinRateLimit(Date.now())) return;

    const token = localStorage.getItem('crm_token');
    if (!token) return;

    // `fetch` rather than the api client: this must work from inside the api
    // client's own failure path without recursing, and `keepalive` lets it
    // survive the page unload that a crash often precedes.
    void fetch('/api/client-errors', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: message.slice(0, 2_000),
        stack: stack ? stack.slice(0, 4_000) : undefined,
        context: context.slice(0, 200),
        url: window.location.href.slice(0, 2_000),
        userAgent: navigator.userAgent.slice(0, 500),
      }),
    }).catch(() => {
      // optional: if the report itself cannot be delivered there is nothing
      // left to try, and the user must not see an error about an error.
    });
  } catch {
    // Rule 1. Storage disabled, no fetch, a frozen error object — none of it
    // may propagate into the caller's error path.
  }
}

export default reportError;
