import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from './Icon';
import api from '../api/client';

interface Doc {
  id: string;
  display_name: string;
  name: string;
  category: string;
  file_size: number;
  uploaded_by: string;
  created_at: string;
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'contract', label: 'Signed Contract' },
  { value: 'plans',    label: 'Plans' },
  { value: 'permit',   label: 'Permit' },
  { value: 'invoice',  label: 'Invoice / PO' },
  { value: 'other',    label: 'Other (delivery, startup, photos…)' },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

function fmtSize(n: number) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** File attachments tied to a single record (generator or electrical bid). */
export default function RecordFiles({ linkedId, linkedName, div, emptyHint }: {
  linkedId: string; linkedName: string; div: 'gen' | 'elec'; emptyHint?: string;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState(div === 'elec' ? 'plans' : 'other');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/documents', { params: { linked_id: linkedId } })
      .then(({ data }) => setDocs(data))
      .finally(() => setLoading(false));
  }, [linkedId]);

  useEffect(() => { load(); }, [load]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('linked_id', linkedId);
      form.append('linked_name', linkedName);
      form.append('div', div);
      form.append('category', category);
      form.append('display_name', file.name);
      const { data } = await api.post('/documents', form);
      setDocs(prev => [data, ...prev]);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const download = (doc: Doc) => {
    const token = localStorage.getItem('crm_token');
    fetch(`/api/documents/${doc.id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = doc.display_name;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      });
  };

  const remove = async (doc: Doc) => {
    setDocs(prev => prev.filter(d => d.id !== doc.id));
    await api.delete(`/documents/${doc.id}`).catch(() => load());
  };

  return (
    <div className="dtl-section" style={{ marginTop: 18 }}>
      <div className="dtl-stage-label" style={{ marginBottom: 10 }}>Files · {docs.length}</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={category} onChange={e => setCategory(e.target.value)}
          style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 10px', outline: 'none' }}>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input ref={fileInput} type="file" onChange={onPick} style={{ display: 'none' }}/>
        <button className="btn" disabled={uploading} onClick={() => fileInput.current?.click()} style={{ flexShrink: 0 }}>
          <Icon name="plus" size={14} stroke={2.4}/>{uploading ? 'Uploading…' : 'Add file'}
        </button>
      </div>
      {error && (
        <div style={{ margin: '-4px 0 10px', padding: '8px 10px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 12.5, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12.5, color: 'var(--text3)', padding: '8px 0' }}>Loading…</div>
      ) : docs.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text3)', padding: '8px 0' }}>{emptyHint || 'No files yet.'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9 }}>
              <span style={{ flexShrink: 0, color: 'var(--text3)' }}><Icon name="clip" size={16} stroke={1.8}/></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.display_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {CAT_LABEL[d.category] || d.category}{d.file_size ? ` · ${fmtSize(d.file_size)}` : ''} · {fmtDate(d.created_at)}
                </div>
              </div>
              <button title="Download" onClick={() => download(d)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--blue)', padding: 4, flexShrink: 0 }}>
                <Icon name="arrow" size={15} stroke={2}/>
              </button>
              <button title="Delete" onClick={() => remove(d)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, flexShrink: 0 }}>
                <Icon name="x" size={14} stroke={2}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
