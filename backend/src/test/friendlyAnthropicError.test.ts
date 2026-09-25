// Plans-panel fix round, Task 2 — Anthropic errors surfaced on the panel (or
// anywhere the job profile / sheet check show an error) must be
// human-readable, never the raw JSON error body. These are pure unit tests
// against friendlyAnthropicError(); jobProfileErrorMapping.test.ts covers it
// wired into the real error-storing paths.
import { describe, it, expect } from 'vitest';
import { friendlyAnthropicError, sanitizeStoredError, CREDIT_BALANCE_MESSAGE } from '../ai/friendlyError';

/** Shaped like a real `Anthropic.APIError` thrown by the SDK. */
function apiError(status: number, type: string, message: string) {
  const err = new Error(`${status} ${JSON.stringify({ type: 'error', error: { type, message } })}`) as Error & {
    status: number; type: string; error: { type: string; error: { type: string; message: string } };
  };
  err.status = status;
  err.type = type;
  err.error = { type: 'error', error: { type, message } } as unknown as { type: string; error: { type: string; message: string } };
  return err;
}

describe('friendlyAnthropicError', () => {
  it('maps "credit balance is too low" to the exact required message', () => {
    const err = apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Claude API. Please go to Plans & Billing to upgrade or purchase credits.');
    expect(friendlyAnthropicError(err)).toBe(CREDIT_BALANCE_MESSAGE);
    expect(CREDIT_BALANCE_MESSAGE).toBe(
      'Your Anthropic account is out of credits — add credits at console.anthropic.com → Plans & Billing, then click Read the plans again.'
    );
  });

  it('recognizes the credit-balance phrase even from a bare error-shaped object (no Error instance)', () => {
    const raw = { status: 400, error: { type: 'error', error: { type: 'invalid_request_error', message: 'credit balance is too low' } } };
    expect(friendlyAnthropicError(raw)).toBe(CREDIT_BALANCE_MESSAGE);
  });

  it('maps an authentication error', () => {
    const err = apiError(401, 'authentication_error', 'invalid x-api-key');
    expect(friendlyAnthropicError(err)).toMatch(/API key is missing or invalid/);
    expect(friendlyAnthropicError(err)).not.toMatch(/invalid x-api-key/);
  });

  it('maps a rate limit error', () => {
    const err = apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit');
    expect(friendlyAnthropicError(err)).toMatch(/rate-limiting requests/i);
    expect(friendlyAnthropicError(err)).not.toMatch(/per-minute rate limit/);
  });

  it('maps an overloaded error', () => {
    const err = apiError(529, 'overloaded_error', 'Overloaded');
    expect(friendlyAnthropicError(err)).toMatch(/temporarily overloaded/i);
  });

  it('maps a generic 5xx to a server-error message, never the raw body', () => {
    const err = apiError(500, 'api_error', 'Internal server error');
    const msg = friendlyAnthropicError(err);
    expect(msg).toMatch(/server error/i);
    expect(msg).not.toContain('{');
    expect(msg).not.toContain('"type"');
  });

  it('never lets raw JSON reach the message for any Anthropic-shaped error', () => {
    for (const [status, type] of [[400, 'invalid_request_error'], [403, 'permission_error'], [404, 'not_found_error'], [529, 'overloaded_error']] as const) {
      const err = apiError(status, type, 'some raw detail that must never leak');
      const msg = friendlyAnthropicError(err);
      expect(msg).not.toMatch(/\{|"type"|some raw detail/);
    }
  });

  it('passes through an already-friendly internal error unchanged (AgentTruncatedError-shaped)', () => {
    const err = new Error('Sheet reference reader ran out of room — raise its Max Tokens in Settings → AI; it stopped at 2,000 tokens.');
    err.name = 'AgentTruncatedError';
    expect(friendlyAnthropicError(err)).toBe(err.message);
  });

  it('passes through a plain cancellation message unchanged', () => {
    const err = new Error('The run was stopped');
    err.name = 'RunCancelledError';
    expect(friendlyAnthropicError(err)).toBe('The run was stopped');
  });

  it('falls back to a generic message for an unrecognized shape, never echoing raw JSON text', () => {
    const err = new Error('{"type":"error","error":{"type":"weird_error","message":"boom"}}');
    expect(friendlyAnthropicError(err)).not.toContain('{');
  });

  it('handles a non-Error, non-object thrown value without throwing', () => {
    expect(() => friendlyAnthropicError('just a string')).not.toThrow();
    expect(() => friendlyAnthropicError(undefined)).not.toThrow();
    expect(() => friendlyAnthropicError(null)).not.toThrow();
  });
});

describe('sanitizeStoredError — N2 (review eb39943): a stored raw JSON error is mapped on read', () => {
  it('recovers the SPECIFIC mapping from a stored "${status} ${json}" string (the SDK\'s own APIError.message shape)', () => {
    const raw = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    expect(sanitizeStoredError(raw)).toMatch(/API key is missing or invalid/);
    expect(sanitizeStoredError(raw)).not.toMatch(/\{|"type"|invalid x-api-key/);
  });

  it('recovers the overloaded mapping from a bare JSON body with no status prefix', () => {
    const raw = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
    expect(sanitizeStoredError(raw)).toMatch(/temporarily overloaded/i);
  });

  it('still catches "credit balance is too low" by substring even when the embedded body fails to parse as JSON', () => {
    const raw = '400 {not valid json but still says credit balance is too low}';
    expect(sanitizeStoredError(raw)).toBe(CREDIT_BALANCE_MESSAGE);
  });

  it('leaves an already-friendly message unchanged (idempotent)', () => {
    expect(sanitizeStoredError(CREDIT_BALANCE_MESSAGE)).toBe(CREDIT_BALANCE_MESSAGE);
    expect(sanitizeStoredError('The plans took too long to read — read them again.')).toBe('The plans took too long to read — read them again.');
  });

  it('passes null/empty through unchanged', () => {
    expect(sanitizeStoredError(null)).toBeNull();
    expect(sanitizeStoredError(undefined)).toBeNull();
    expect(sanitizeStoredError('')).toBe('');
  });
});
