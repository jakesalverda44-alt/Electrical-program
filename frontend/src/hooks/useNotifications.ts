import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link_view?: string;
  link_id?: string;
  read: boolean;
  created_at: string;
}

/** Polls the user's notifications on an interval and exposes read actions. */
export function useNotifications(authenticated: boolean) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications');
      setNotifications(data.notifications);
      setUnread(data.unread);
    } catch { /* ignore transient errors */ }
  }, []);

  const markRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnread(u => Math.max(0, u - 1));
    try { await api.post(`/notifications/${id}/read`); } catch { /* ignore */ }
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
    try { await api.post('/notifications/read-all'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    reload();
    timer.current = setInterval(reload, 60_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [authenticated, reload]);

  return { notifications, unread, reload, markRead, markAllRead };
}
