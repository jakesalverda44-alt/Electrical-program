import { useState, useCallback, useEffect } from 'react';
import api from '../api/client';
import { signalUnauthorized } from '../api/session';
import { User } from '../types';

// Roles with administrative rights (mirror of the backend PRIVILEGED_ROLES).
// Used for UI gating only — the server is the real authorization boundary.
export const PRIVILEGED_ROLES = ['owner', 'administrator', 'manager'];

export function isPrivileged(user?: { role?: string } | null): boolean {
  return !!user?.role && PRIVILEGED_ROLES.includes(user.role);
}

// Module-level, not component state: React 18 StrictMode double-invokes
// effects in development, and the exchange code is one-time-use server-side —
// a second call with the same code would 404 even though the first actually
// succeeded. Guard survives that double-invoke (and any other remount).
let msExchangeInFlightFor: string | null = null;

export function useAuth() {
  // Captured synchronously on the very first render — BEFORE any effect runs.
  // The unauthenticated view (App.tsx) redirects everything but /login,
  // /reset-password, and /p/:token to /login via a wildcard <Navigate>, which
  // drops the query string; that redirect's own effect could otherwise race
  // ahead of ours and lose ?mscode before we ever read it.
  const [pendingMsCode] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('mscode')
  );

  const [user, setUser] = useState<User | null>(() => {
    const s = localStorage.getItem('crm_user');
    return s ? JSON.parse(s) : null;
  });

  // Handle ?mscode=... redirect from Microsoft OAuth: exchange the one-time
  // code for the real app token via a POST, rather than trusting a JWT handed
  // straight off the URL (audit: Security #8, High).
  useEffect(() => {
    if (!pendingMsCode || msExchangeInFlightFor === pendingMsCode) return;
    msExchangeInFlightFor = pendingMsCode;
    (async () => {
      try {
        const { data } = await api.post('/auth/microsoft/exchange', { code: pendingMsCode });
        localStorage.setItem('crm_token', data.token);
        localStorage.setItem('crm_user', JSON.stringify(data.user));
        window.history.replaceState({}, '', window.location.pathname);
        setUser(data.user as User);
      } catch {
        window.history.replaceState({}, '', window.location.pathname);
        // Route rather than reload: App.tsx's crm:unauthorized listener puts us
        // on /login with this message.
        signalUnauthorized({ next: '/dashboard', error: 'Microsoft sign-in failed. Please try again.' });
      }
    })();
  }, [pendingMsCode]);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('crm_token', data.token);
    localStorage.setItem('crm_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user as User;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
    setUser(null);
  }, []);

  return { user, login, logout };
}
