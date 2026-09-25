// Plans-panel fix round, Task 2 — an Anthropic API error must never reach
// the Plans & Job Profile panel (or anywhere else the job profile or sheet
// check surface an error) as raw JSON. Every place that stores or returns
// an error from a model call runs it through friendlyAnthropicError() first
// and logs the ORIGINAL error object separately (logger.error({ err }, …)):
// the raw text stays in the server log only, never in a DB `error` column
// or a JSON response body.
//
// Duck-typed on purpose: a real `Anthropic.APIError` (status, .error — the
// parsed `{type:"error",error:{type,message}}` response body — and .type,
// the SDK's own convenience copy of that inner type) and a plain
// test-double shaped the same way are both handled the same way.
//
// A error that ISN'T shaped like an Anthropic API response (no status, no
// nested error body — an AgentTruncatedError, a RunCancelledError, a plain
// bug) already carries a human-authored message from elsewhere in this
// codebase; it passes through unchanged rather than being replaced with a
// less specific generic line.

interface AnthropicLikeError {
  status?: number;
  type?: string | null;
  error?: { type?: string; message?: string; error?: { type?: string; message?: string } } | null;
  message?: string;
}

function errorType(e: AnthropicLikeError): string {
  return String(e.type ?? e.error?.error?.type ?? e.error?.type ?? '');
}

function errorBodyText(e: AnthropicLikeError): string {
  return String(e.error?.error?.message ?? e.error?.message ?? '');
}

const TRY_AGAIN = 'then click Read the plans again.';

export const CREDIT_BALANCE_MESSAGE =
  'Your Anthropic account is out of credits — add credits at console.anthropic.com → Plans & Billing, ' + TRY_AGAIN;

/** A human-readable message for an Anthropic API failure (or any other
 *  error) — never the raw error body. Callers keep logging the original
 *  `err` to the server log; this is only what a person ever sees. */
export function friendlyAnthropicError(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as AnthropicLikeError;
  const status = typeof e.status === 'number' ? e.status : undefined;
  const type = errorType(e);
  // Every scrap of text an Anthropic error might carry, just for the
  // substring check below — never surfaced verbatim. Includes a plain
  // string `err` too (sanitizeStoredError passes one): `e` is `{}` in that
  // case, so `e.message` alone would miss it.
  const text = `${errorBodyText(e)} ${e.message ?? ''} ${typeof err === 'string' ? err : ''}`;

  if (/credit balance is too low/i.test(text)) return CREDIT_BALANCE_MESSAGE;

  // A real Anthropic API error response carries a status and/or a body
  // error type; a plain internal error (AgentTruncatedError,
  // RunCancelledError, a bug) carries neither.
  if (status !== undefined || type) {
    if (status === 401 || type === 'authentication_error') {
      return 'Your Anthropic API key is missing or invalid — check Settings → AI → API Key, ' + TRY_AGAIN;
    }
    if (status === 403 || type === 'permission_error') {
      return "Your Anthropic account doesn't have access to this model — check Settings → AI, " + TRY_AGAIN;
    }
    if (status === 429 || type === 'rate_limit_error') {
      return 'Anthropic is rate-limiting requests right now — wait a minute, ' + TRY_AGAIN;
    }
    if (status === 529 || type === 'overloaded_error') {
      return "Anthropic's service is temporarily overloaded — wait a few minutes, " + TRY_AGAIN;
    }
    if (status && status >= 500) {
      return 'Anthropic had a server error reading the plans — wait a moment, ' + TRY_AGAIN;
    }
    if (status === 400 || type === 'invalid_request_error') {
      // A bad request to Anthropic is a bug in what we sent, not something
      // the estimator can fix — still never the raw body.
      return "Couldn't read the plans — the request to Anthropic was rejected. Contact support if this keeps happening.";
    }
    // Some other Anthropic-shaped status/type this mapping doesn't name.
    return "Couldn't reach Anthropic to read the plans — wait a moment, " + TRY_AGAIN;
  }

  // Not Anthropic-API-shaped: pass through our own error's message (already
  // human-authored elsewhere in this codebase) rather than genericizing it.
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const looksRaw = /^\s*\{|"type"\s*:\s*"error"/.test(msg);
  if (msg && !looksRaw && msg.length <= 300) return msg;
  return "Couldn't reach Anthropic to read the plans — wait a moment, " + TRY_AGAIN;
}

/** N2 (review eb39943) — a row written before this mapping existed (or
 *  before a bug in it was fixed) can still hold a raw Anthropic JSON body in
 *  bid_job_profile.error / bid_sheet_check.error. Every READ of either
 *  column runs the stored text through this, so an old row is never shown
 *  raw just because the mapping that would have caught it wasn't there yet
 *  when it was written. Idempotent: an already-friendly message (including
 *  one this function itself already produced) passes through unchanged.
 *
 *  The SDK's own `APIError.message` is always `"${status} ${json}"` (or
 *  just the json/status alone) — this recovers that structure and runs it
 *  through the SAME mapping `friendlyAnthropicError` uses live, so an old
 *  row gets the SPECIFIC message (credit balance, rate limit, overloaded,
 *  …), not just a generic one, whenever the raw text is still parseable. */
export function sanitizeStoredError(raw: string | null | undefined): string | null {
  if (!raw) return raw ?? null;
  const looksRaw = /^\s*\{|"type"\s*:\s*"error"|^\d{3}\s*\{/.test(raw);
  if (!looksRaw) return raw;
  const m = /^(\d{3})?\s*(\{[\s\S]*\})\s*$/.exec(raw.trim());
  if (m) {
    try {
      const parsed = JSON.parse(m[2]);
      return friendlyAnthropicError({ status: m[1] ? Number(m[1]) : undefined, error: parsed });
    } catch { /* not actually parseable JSON — fall through to the generic message below */ }
  }
  return friendlyAnthropicError(raw); // still catches "credit balance is too low" by substring, else generic
}
