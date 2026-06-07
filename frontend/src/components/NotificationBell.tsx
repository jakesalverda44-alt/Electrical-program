import React, { useState, useRef, useEffect } from 'react';
import Icon from './Icon';
import { useNotifications, Notification } from '../hooks/useNotifications';

function timeAgo(ts: string) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function NotificationBell({ authenticated, onNav }: { authenticated: boolean; onNav: (view: string) => void }) {
  const { notifications, unread, markRead, markAllRead } = useNotifications(authenticated);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleClick = (n: Notification) => {
    if (!n.read) markRead(n.id);
    if (n.link_view) { onNav(n.link_view); setOpen(false); }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label="Notifications">
        <Icon name="bell" size={18} stroke={1.8}/>
        {unread > 0 && <span className="dot"/>}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 340, maxHeight: 420, overflowY: 'auto',
          background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,.28)', zIndex: 200,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Notifications{unread > 0 ? ` · ${unread}` : ''}</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ border: 'none', background: 'none', color: 'var(--blue)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>You're all caught up.</div>
          ) : (
            notifications.map(n => (
              <button key={n.id} onClick={() => handleClick(n)}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                  padding: '11px 16px', borderBottom: '1px solid var(--border)',
                  background: n.read ? 'transparent' : 'var(--blue-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }}/>}
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{n.title}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text2)', margin: '3px 0 0', lineHeight: 1.4 }}>{n.body}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{timeAgo(n.created_at)}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
