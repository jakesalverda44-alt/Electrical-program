import axios, { AxiosError } from 'axios';

// A 30s ceiling on every request so a hung connection eventually fails instead
// of spinning forever. The long AI/backfill calls that need more already pass
// their own per-request `timeout`, which overrides this.
const api = axios.create({ baseURL: '/api', timeout: 30_000 });

// --- Session / unauthorized ------------------------------------------------

/**
 * Fired on `window` when the server tells us the session is gone. App.tsx
 * listens once and routes to /login with `?next=` so the user comes back to
 * the page they were on. Using an event rather than assigning to
 * location.href keeps it a client-side navigation, so in-memory state is not
 * thrown away by a full page load.
 */
export const UNAUTHORIZED_EVENT = 'crm:unauthorized';

export interface UnauthorizedDetail {
  /** Path to return to after signing in; defaults to the current location. */
  next?: string;
  /** Message to surface on the login screen. */
  error?: string;
}

export function clearSession() {
  localStorage.removeItem('crm_token');
  localStorage.removeItem('crm_user');
}

export function signalUnauthorized(detail: UnauthorizedDetail = {}) {
  clearSession();
  window.dispatchEvent(new CustomEvent<UnauthorizedDetail>(UNAUTHORIZED_EVENT, { detail }));
}

// A 401 from one of these is "those credentials are wrong", not "your session
// expired" — the caller shows its own message and must not be bounced.
const AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/microsoft/exchange',
];

// --- Error normalization ---------------------------------------------------

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

// --- Interceptors ----------------------------------------------------------

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('crm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    // Attach the normalized shape once so every downstream `apiErrorMessage`
    // call is a lookup rather than a re-parse.
    const normalized = normalizeApiError(err);
    try {
      Object.defineProperty(err, 'crmError', { value: normalized, enumerable: false, configurable: true });
    } catch {
      /* a frozen error object is not worth failing over */
    }

    const url = err.config?.url ?? '';
    const isAuthCall = AUTH_ENDPOINTS.some(p => url.startsWith(p));
    if (normalized.status === 401 && !isAuthCall) {
      signalUnauthorized();
    }
    return Promise.reject(err);
  }
);

export default api;
