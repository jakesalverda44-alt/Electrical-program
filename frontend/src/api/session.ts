/**
 * Session teardown, kept out of `client.ts` so a component test that mocks the
 * api client still gets the real implementation.
 */

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
