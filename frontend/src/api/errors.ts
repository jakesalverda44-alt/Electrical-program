import axios, { AxiosError } from 'axios';

/**
 * Error normalization, kept separate from `client.ts` on purpose: it is pure
 * (no axios instance, no window, no storage), so it is directly testable and
 * still available to a component test that mocks the api client itself.
 */

export interface ApiError {
  /** HTTP status, or null when the request never reached the server. */
  status: number | null;
  /** Message fit to show a user. */
  message: string;
  /** True when the failure was transport-level (offline, DNS, refused, timeout). */
  isNetwork: boolean;
}

/** True for a request we cancelled ourselves; never worth reporting to the user. */
export function isAbortError(err: unknown): boolean {
  if (axios.isCancel(err)) return true;
  const code = (err as AxiosError | undefined)?.code;
  if (code === 'ERR_CANCELED') return true;
  return err instanceof Error && err.name === 'AbortError';
}

function serverMessage(data: unknown): string | null {
  if (typeof data === 'string' && data.trim() && !data.trim().startsWith('<')) return data.trim();
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail']) {
      const v = d[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * Turn anything thrown by axios (or by our own code) into the same three
 * fields, so every caller can render a failure without knowing about axios.
 */
export function normalizeApiError(err: unknown): ApiError {
  const cached = (err as { crmError?: ApiError } | null)?.crmError;
  if (cached) return cached;

  if (isAbortError(err)) {
    return { status: null, message: 'Request cancelled', isNetwork: false };
  }

  const ax = err as AxiosError | undefined;
  const status = ax?.response?.status ?? null;

  if (status === null) {
    // No response at all: either we timed out or we never reached the server.
    const timedOut = ax?.code === 'ECONNABORTED' || ax?.code === 'ETIMEDOUT'
      || /timeout/i.test(ax?.message ?? '');
    return timedOut
      ? { status: null, message: 'Request timed out', isNetwork: true }
      : { status: null, message: 'Cannot reach the server', isNetwork: true };
  }

  if (status >= 500) {
    return { status, message: 'Server error', isNetwork: false };
  }

  const fromServer = serverMessage(ax?.response?.data);
  if (fromServer) return { status, message: fromServer, isNetwork: false };

  if (status === 401) return { status, message: 'Your session has expired', isNetwork: false };
  if (status === 403) return { status, message: 'You do not have permission to do that', isNetwork: false };
  if (status === 404) return { status, message: 'Not found', isNetwork: false };
  if (status === 413) return { status, message: 'That file is too large', isNetwork: false };
  return { status, message: `Request failed (${status})`, isNetwork: false };
}

/** The user-facing sentence for a failed request. */
export function apiErrorMessage(err: unknown): string {
  return normalizeApiError(err).message;
}
