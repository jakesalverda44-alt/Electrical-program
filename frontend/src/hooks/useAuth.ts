import { useState, useCallback } from 'react';
import api from '../api/client';
import { User } from '../types';

// Roles with administrative rights (mirror of the backend PRIVILEGED_ROLES).
// Used for UI gating only — the server is the real authorization boundary.
export const PRIVILEGED_ROLES = ['owner', 'administrator', 'manager'];

export function isPrivileged(user?: { role?: string } | null): boolean {
  return !!user?.role && PRIVILEGED_ROLES.includes(user.role);
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(() => {
    // Handle ?mstoken=... redirect from Microsoft OAuth
    const params = new URLSearchParams(window.location.search);
    const msToken = params.get('mstoken');
    if (msToken) {
      // Decode the JWT payload to get user info (no verify needed — same JWT secret, already trusted)
      try {
        const payload = JSON.parse(atob(msToken.split('.')[1])) as User & { exp: number };
        if (payload.exp * 1000 > Date.now()) {
          localStorage.setItem('crm_token', msToken);
          localStorage.setItem('crm_user', JSON.stringify({ id: payload.id, name: payload.name, email: payload.email, role: payload.role }));
          window.history.replaceState({}, '', '/');
          return { id: payload.id, name: payload.name, email: payload.email, role: payload.role };
        }
      } catch { /* bad token, fall through */ }
    }
    const s = localStorage.getItem('crm_user');
    return s ? JSON.parse(s) : null;
  });

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
