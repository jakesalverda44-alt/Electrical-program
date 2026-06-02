import React, { useState, useRef, useEffect } from 'react';
import Icon from './Icon';

export default function SearchBox() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node) && !q) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, q]);

  return (
    <div className={'search-wrap' + (open ? ' open' : '')} ref={wrapRef}>
      <button className="icon-btn search-toggle" onClick={() => setOpen(o => !o)}>
        <Icon name="search" size={18} stroke={1.9}/>
      </button>
      <div className="search-field">
        <input
          ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setQ(''); setOpen(false); } }}
          placeholder="Search proposals, projects, GCs…"
        />
        {q && <button className="search-clear" onClick={() => { setQ(''); inputRef.current?.focus(); }}><Icon name="x" size={14} stroke={2.2}/></button>}
      </div>
    </div>
  );
}
