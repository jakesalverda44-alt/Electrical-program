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

// --- Token expiry ----------------------------------------------------------

/**
 * Decode a JWT's payload without verifying it. The signature is the server's
 * business; the client only needs `exp` so it can tell "logged out" from
 * "logged in with a token every request will 401 on".
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * True when the token is missing, undecodable, or past its `exp`. A token with
 * no `exp` claim is treated as expired: the server always sets one, so a token
 * without it is not one we issued.
 *
 * Restoring a session without this check booted the app fully "logged in",
 * fired the bootstrap requests, collected 401s and only then ejected the user —
 * a confusing flash-then-eject (audit code #7).
 */
export function isTokenExpired(token: string | null | undefined, now: number = Date.now()): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload) return true;
  const exp = payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return true;
  return exp * 1000 <= now;
}
