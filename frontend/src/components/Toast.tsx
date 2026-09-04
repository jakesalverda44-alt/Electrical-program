import React from 'react';
import Icon from './Icon';
import { Toast as ToastType } from '../types';

/**
 * `variant` decides the icon and the accent. It defaults to 'success' because
 * that is what every existing caller meant — but before this the green check
 * was rendered for "Delete failed" too, so a glance at the corner of the
 * screen could not tell a success from a failure (audit ux #3).
 */
const VARIANT_ICON: Record<NonNullable<ToastType['variant']>, string> = {
  success: 'check',
  error: 'alert',
  info: 'info',
};

export default function Toast({ toast }: { toast: ToastType }) {
  const variant = toast.variant ?? 'success';
  return (
    <div className="toast-wrap">
      <div
        className={'toast' + (variant === 'error' ? ' t-error' : variant === 'info' ? ' t-info' : '')}
        role={variant === 'error' ? 'alert' : 'status'}
        aria-live={variant === 'error' ? 'assertive' : 'polite'}
      >
        <span className="t-ic"><Icon name={VARIANT_ICON[variant]} size={18} stroke={2.4}/></span>
        <div style={{ flex: 1 }}><b>{toast.title}</b><small>{toast.sub}</small></div>
        {toast.action && (
          <button onClick={toast.action.onClick}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,.4)', borderRadius: 6,
              color: '#fff', fontSize: 12, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
