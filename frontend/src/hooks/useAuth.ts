import { useState, useCallback } from 'react';
import api from '../api/client';
import { User } from '../types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(() => {
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
