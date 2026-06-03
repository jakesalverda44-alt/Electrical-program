import React from 'react';
import Icon from './Icon';
import { Toast as ToastType } from '../types';

export default function Toast({ toast }: { toast: ToastType }) {
  return (
    <div className="toast-wrap">
      <div className="toast">
        <span className="t-ic"><Icon name="check" size={18} stroke={2.4}/></span>
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
