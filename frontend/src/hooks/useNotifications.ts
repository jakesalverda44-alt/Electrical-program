import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';
import { useApi } from './useApi';

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

  // optional: a failed notification poll is not worth telling the user about —
  // useApi parks the message in `error` and the next tick tries again. The
  // request and its cancellation are still the hook's job, not ours.
  const { data, reload } = useApi<{ notifications: Notification[]; unread: number }>(
    '/notifications',
    { enabled: authenticated },
  );

  useEffect(() => {
    if (!data) return;
    setNotifications(data.notifications);
    setUnread(data.unread);
  }, [data]);

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
    timer.current = setInterval(reload, 60_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [authenticated, reload]);

  return { notifications, unread, reload, markRead, markAllRead };
}
