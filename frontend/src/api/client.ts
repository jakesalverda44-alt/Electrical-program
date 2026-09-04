import axios, { AxiosError } from 'axios';
import { normalizeApiError } from './errors';
import { signalUnauthorized } from './session';

// A 30s ceiling on every request so a hung connection eventually fails instead
// of spinning forever. The long AI/backfill calls that need more already pass
// their own per-request `timeout`, which overrides this.
const api = axios.create({ baseURL: '/api', timeout: 30_000 });

// A 401 from one of these is "those credentials are wrong", not "your session
// expired" — the caller shows its own message and must not be bounced.
const AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/microsoft/exchange',
];

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

// Re-exported so `import api, { apiErrorMessage } from '.../api/client'` keeps
// working; new code should import these from their own modules.
export { apiErrorMessage, normalizeApiError, isAbortError } from './errors';
export type { ApiError } from './errors';
export { UNAUTHORIZED_EVENT, clearSession, signalUnauthorized } from './session';
export type { UnauthorizedDetail } from './session';

export default api;
