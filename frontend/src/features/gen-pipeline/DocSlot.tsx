import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useShowToast } from '../../contexts/AppContext';

interface DocRow { id: string; display_name: string; category: string; storage_url: string | null; }

/** Single labeled upload slot backed by the generic /documents API (one doc per
 *  category per gen) — used post-quote for things like the Sizer Report that
 *  aren't part of the proposal itself. */
export default function DocSlot({ genId, category, label, accept = 'application/pdf', onUploaded }: { genId: string; category: string; label: string; accept?: string; onUploaded?: (file: File) => void }) {
  const showToast = useShowToast();
  const [doc, setDoc] = useState<DocRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    api.get('/documents', { params: { linked_id: genId } })
      .then(({ data }) => setDoc((data as DocRow[]).find(d => d.category === category) || null))
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  };
  useEffect(load, [genId, category]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('linked_id', genId);
      form.append('div', 'gen');
      form.append('category', category);
      form.append('display_name', label);
      await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
      onUploaded?.(file);
    } catch {
      showToast({ title: 'Upload failed', sub: 'Try again' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    if (!doc) return;
    setBusy(true);
    try { await api.delete(`/documents/${doc.id}`); setDoc(null); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', border: '1px solid var(--border2)', borderRadius: 9 }}>
      <input ref={fileRef} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }}/>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: doc ? 'var(--text)' : 'var(--text3)', marginTop: 2 }}>
          {loading ? 'Loading…' : doc ? (doc.display_name || 'Uploaded') : 'Not uploaded'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {doc?.storage_url && (
          <a href={doc.storage_url} target="_blank" rel="noreferrer" className="btn ghost" style={{ fontSize: 11, height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center' }}>View</a>
        )}
        <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy} style={{ fontSize: 11, height: 28, padding: '0 10px' }}>
          {busy ? '…' : doc ? 'Replace' : 'Upload'}
        </button>
        {doc && (
          <button className="btn ghost" onClick={remove} disabled={busy} style={{ fontSize: 11, height: 28, padding: '0 10px', color: 'var(--red)' }}>Remove</button>
        )}
      </div>
    </div>
  );
}
