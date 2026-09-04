// @vitest-environment happy-dom
// Audit: frontend-code #13 — "a down backend and a 500 are indistinguishable to
// callers". Every failure message the app shows now comes from this one
// function, so its branches are worth pinning.
import { describe, it, expect } from 'vitest';
import { apiErrorMessage, normalizeApiError, isAbortError } from './client';

function axiosErr(extra: Record<string, unknown>) {
  return Object.assign(new Error('request failed'), { isAxiosError: true }, extra);
}

describe('normalizeApiError', () => {
  it('reports a transport failure as unreachable', () => {
    expect(normalizeApiError(axiosErr({ code: 'ERR_NETWORK' })))
      .toEqual({ status: null, message: 'Cannot reach the server', isNetwork: true });
  });

  it('reports a timeout as a timeout, not as unreachable', () => {
    expect(apiErrorMessage(axiosErr({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' })))
      .toBe('Request timed out');
  });

  it('collapses every 5xx to one message and never leaks the server body', () => {
    expect(apiErrorMessage(axiosErr({ response: { status: 500, data: { error: 'ECONNREFUSED at pg' } } })))
      .toBe('Server error');
    expect(apiErrorMessage(axiosErr({ response: { status: 503, data: 'upstream down' } })))
      .toBe('Server error');
  });

  it('uses the server message for a 4xx when there is one', () => {
    expect(apiErrorMessage(axiosErr({ response: { status: 400, data: { error: 'Name is required' } } })))
      .toBe('Name is required');
    expect(apiErrorMessage(axiosErr({ response: { status: 409, data: { message: 'Job number taken' } } })))
      .toBe('Job number taken');
  });

  it('falls back to per-status copy when the 4xx body carries no message', () => {
    expect(apiErrorMessage(axiosErr({ response: { status: 403, data: {} } })))
      .toBe('You do not have permission to do that');
    expect(apiErrorMessage(axiosErr({ response: { status: 404, data: '' } })))
      .toBe('Not found');
    expect(apiErrorMessage(axiosErr({ response: { status: 418, data: null } })))
      .toBe('Request failed (418)');
  });

  it('ignores an HTML error page rather than showing markup to the user', () => {
    expect(apiErrorMessage(axiosErr({ response: { status: 404, data: '<!doctype html><title>Nope</title>' } })))
      .toBe('Not found');
  });

  it('recognizes our own cancellations', () => {
    expect(isAbortError(axiosErr({ code: 'ERR_CANCELED' }))).toBe(true);
    expect(isAbortError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortError(axiosErr({ code: 'ERR_NETWORK' }))).toBe(false);
  });

  it('reuses the shape the interceptor already attached', () => {
    const err = axiosErr({ crmError: { status: 999, message: 'precomputed', isNetwork: false } });
    expect(apiErrorMessage(err)).toBe('precomputed');
  });
});
