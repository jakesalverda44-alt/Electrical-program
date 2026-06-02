import React from 'react';
import Icon from './Icon';
import { Toast as ToastType } from '../types';

export default function Toast({ toast }: { toast: ToastType }) {
  return (
    <div className="toast-wrap">
      <div className="toast">
        <span className="t-ic"><Icon name="check" size={18} stroke={2.4}/></span>
        <div><b>{toast.title}</b><small>{toast.sub}</small></div>
      </div>
    </div>
  );
}
