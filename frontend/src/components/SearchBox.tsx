import React, { useState, useRef, useEffect } from 'react';
import Icon from './Icon';
import { Bid, Gen } from '../types';

interface Result {
  id: string;
  label: string;
  sub: string;
  section: string;
  icon: string;
}

interface Props {
  bids?: Bid[];
  gens?: Gen[];
  onNav?: (section: string) => void;
}

export default function SearchBox({ bids = [], gens = [], onNav }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setQ(''); setOpen(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const results: Result[] = q.trim().length < 2 ? [] : (() => {
    const lq = q.toLowerCase();
    const out: Result[] = [];
    for (const b of bids) {
      if (out.length >= 8) break;
      if ([b.name, b.gc, b.loc, b.contact].some(v => v?.toLowerCase().includes(lq))) {
        out.push({ id: 'b-' + b.id, label: b.name, sub: `${b.gc} · ${b.loc} · ${b.stage}`, section: b.stage === 'awarded' ? 'elec-projects' : 'elec-proposals', icon: 'pipeline' });
      }
    }
    for (const g of gens) {
      if (out.length >= 12) break;
      if ([g.customer, g.loc, g.mfr, g.model].some(v => v?.toLowerCase().includes(lq))) {
        out.push({ id: 'g-' + g.id, label: g.customer, sub: `${g.mfr} ${g.model} · ${g.kw}kW · ${g.stage}`, section: g.stage === 'awarded' ? 'gen-projects' : 'gen-proposals', icon: 'bolt' });
      }
    }
    return out;
  })();

  const go = (r: Result) => { onNav?.(r.section); setQ(''); setOpen(false); };

  return (
    <div className={'search-wrap' + (open ? ' open' : '')} ref={wrapRef} style={{ position: 'relative' }}>
      <button className="icon-btn search-toggle" onClick={() => setOpen(o => !o)}>
        <Icon name="search" size={18} stroke={1.9}/>
      </button>
      <div className="search-field">
        <input
          ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { setQ(''); setOpen(false); }
            if (e.key === 'Enter' && results.length > 0) go(results[0]);
          }}
          placeholder="Search bids, customers, GCs…"
        />
        {q && <button className="search-clear" onClick={() => { setQ(''); inputRef.current?.focus(); }}><Icon name="x" size={14} stroke={2.2}/></button>}
      </div>
      {open && q.length >= 2 && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6, width: 340,
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,.3)', zIndex: 999, overflow: 'hidden',
        }}>
          {results.length === 0 ? (
            <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>No results for "{q}"</div>
          ) : results.map(r => (
            <button key={r.id} onClick={() => go(r)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text3)' }}>
                <Icon name={r.icon as any} size={14} stroke={1.9}/>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</div>
              </div>
              <Icon name="arrow" size={12} stroke={2} style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--text3)' }}/>
            </button>
          ))}
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
            {results.length} result{results.length !== 1 ? 's' : ''} — press Enter to open first
          </div>
        </div>
      )}
    </div>
  );
}
