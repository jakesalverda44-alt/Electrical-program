import React, { useState, useRef, useMemo, useEffect } from 'react';
import Icon from '../../components/Icon';
import { Bid, Gen, Toast } from '../../types';
import api from '../../api/client';

type DocCategory = 'plans' | 'contract' | 'proposal' | 'permit' | 'invoice' | 'other';

interface Doc {
  id: string;
  name: string;
  display_name: string;
  category: DocCategory;
  file_size: number;
  file_type: string;
  linked_id: string | null;
  linked_name: string | null;
  div: 'elec' | 'gen' | 'general';
  uploaded_by: string;
  created_at: string;
}

const CAT_META: Record<DocCategory, { label: string; color: string; bg: string }> = {
  plans:    { label: 'Plans',    color: 'var(--blue)',                    bg: 'var(--blue-soft)'  },
  contract: { label: 'Contract', color: 'var(--green)',                   bg: 'var(--green-soft)' },
  proposal: { label: 'Proposal', color: 'var(--amber)',                   bg: 'var(--amber-soft)' },
  permit:   { label: 'Permit',   color: '#F2854F',                        bg: 'rgba(242,133,79,.12)' },
  invoice:  { label: 'Invoice',  color: 'var(--green)',                   bg: 'var(--green-soft)' },
  other:    { label: 'Other',    color: 'var(--text3)',                   bg: 'var(--surface2)'   },
};

function fmtSize(bytes: number) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function extOf(name: string) { return (name.split('.').pop() ?? 'FILE').toUpperCase(); }
const EXT_ICON: Record<string, string> = { PDF:'doc', DWG:'building', DOCX:'doc', XLSX:'dollar', PNG:'file', JPG:'file' };

interface Props { bids: Bid[]; gens: Gen[]; showToast: (t: Toast) => void; userName: string; }

const BLANK = { category: 'other' as DocCategory, linkedId: '', name: '' };

export default function DocsPage({ bids, gens, showToast, userName }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [docs,         setDocs]         = useState<Doc[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [filterCat,    setFilterCat]    = useState<DocCategory | 'all'>('all');
  const [filterDiv,    setFilterDiv]    = useState<'all' | 'elec' | 'gen' | 'general'>('all');
  const [search,       setSearch]       = useState('');
  const [uploadForm,   setUploadForm]   = useState(BLANK);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragging,     setDragging]     = useState(false);
  const [selected,     setSelected]     = useState<Doc | null>(null);
  const [uploading,    setUploading]    = useState(false);

  useEffect(() => {
    api.get('/documents').then(r => setDocs(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const linkOptions = useMemo(() => [
    { id: '', name: '— No link —', div: 'general' as const },
    ...bids.map(b => ({ id: 'bid:' + b.id, name: `[Elec] ${b.name}`, div: 'elec' as const })),
    ...gens.map(g => ({ id: 'gen:' + g.id, name: `[Gen] ${g.customer}`, div: 'gen' as const })),
  ], [bids, gens]);

  const handleFiles = (files: File[]) => { if (files.length > 0) setPendingFiles(files); };

  const commitUpload = async () => {
    if (pendingFiles.length === 0) { showToast({ title: 'Select files first' }); return; }
    setUploading(true);
    try {
      const opt = linkOptions.find(o => o.id === uploadForm.linkedId);
      const newDocs: Doc[] = [];
      for (const f of pendingFiles) {
        const form = new FormData();
        form.append('file', f);
        form.append('display_name', uploadForm.name.trim() || f.name);
        form.append('category', uploadForm.category);
        form.append('linked_id', uploadForm.linkedId ? (uploadForm.linkedId.split(':')[1] ?? '') : '');
        form.append('linked_name', opt?.name ?? '');
        form.append('div', opt?.div ?? 'general');
        const res = await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        newDocs.push(res.data);
      }
      setDocs(prev => [...newDocs, ...prev]);
      setPendingFiles([]);
      setUploadForm(BLANK);
      showToast({ title: `${newDocs.length} file${newDocs.length > 1 ? 's' : ''} uploaded` });
      if (fileInput.current) fileInput.current.value = '';
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast({ title: message || 'Upload failed. Please try again.' });
    } finally {
      setUploading(false);
    }
  };

  const downloadDoc = (doc: Doc) => {
    const token = localStorage.getItem('token');
    const a = document.createElement('a');
    a.href = `/api/documents/${doc.id}/download`;
    // include auth token via fetch + blob for authenticated download
    fetch(`/api/documents/${doc.id}/download`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        a.href = url; a.download = doc.display_name;
        a.click(); URL.revokeObjectURL(url);
      })
      .catch(() => showToast({ title: 'Download failed' }));
  };

  const deleteDoc = async (id: string) => {
    await api.delete(`/documents/${id}`).catch(() => {});
    setDocs(prev => prev.filter(d => d.id !== id));
    if (selected?.id === id) setSelected(null);
    showToast({ title: 'Document removed' });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return docs.filter(d => {
      if (filterCat !== 'all' && d.category !== filterCat) return false;
      if (filterDiv !== 'all' && d.div !== filterDiv) return false;
      if (q && !d.display_name.toLowerCase().includes(q) && !(d.linked_name ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [docs, filterCat, filterDiv, search]);

  const byCategory = useMemo(() =>
    Object.entries(CAT_META).map(([cat, meta]) => ({
      cat: cat as DocCategory, label: meta.label,
      count: docs.filter(d => d.category === cat).length,
    })).filter(x => x.count > 0),
    [docs]
  );

  const INPUT: React.CSSProperties = {
    font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
    background: 'var(--surface)', border: '1px solid var(--border2)',
    borderRadius: 9, padding: '9px 12px', outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px' }}>
        <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)', padding: 0, marginBottom: 20 }}>
          {[
            { label: 'Total Documents', val: String(docs.length),                                        sub: 'in library',         tone: 'blue'  },
            { label: 'Plan Sets',       val: String(docs.filter(d => d.category === 'plans').length),    sub: 'uploaded plan sets', tone: 'amber' },
            { label: 'Contracts',       val: String(docs.filter(d => d.category === 'contract').length), sub: 'signed contracts',   tone: 'green' },
            { label: 'Proposals',       val: String(docs.filter(d => d.category === 'proposal').length), sub: 'quote documents',    tone: 'green' },
          ].map(s => (
            <div className="stat" key={s.label}>
              <div className="stat-top">
                <span className="stat-label">{s.label}</span>
                <span className={'stat-ic ' + s.tone}><Icon name="clip" size={16} stroke={1.8}/></span>
              </div>
              <div className="stat-val num">{s.val}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: docs.length > 0 && selected ? '1fr 300px' : '1fr', gap: 16 }}>
          <div>
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(Array.from(e.dataTransfer.files)); }}
              style={{ border: `2px dashed ${dragging ? 'var(--blue)' : 'var(--border2)'}`,
                borderRadius: 12, padding: '24px 28px', marginBottom: 16,
                background: dragging ? 'var(--blue-soft)' : 'var(--surface)', transition: 'all .15s' }}>
              <input ref={fileInput} type="file" multiple style={{ display: 'none' }}
                onChange={e => handleFiles(Array.from(e.target.files ?? []))}/>

              {pendingFiles.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>
                      <Icon name="cloudup" size={16} stroke={1.9}/>{' '}Drop files here or{' '}
                      <span style={{ color: 'var(--blue)', cursor: 'pointer' }} onClick={() => fileInput.current?.click()}>browse</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
                      Plans, contracts, proposals, permits, invoices — any file type
                    </div>
                  </div>
                  <button className="btn ghost" onClick={() => fileInput.current?.click()} style={{ fontSize: 13 }}>
                    <Icon name="plus" size={14} stroke={2.2}/> Select Files
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
                    {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} ready to upload
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                    {pendingFiles.map(f => (
                      <span key={f.name} style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 7,
                        background: 'var(--surface2)', color: 'var(--text2)' }}>{f.name}</span>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Category</label>
                      <select value={uploadForm.category} onChange={e => setUploadForm(f => ({ ...f, category: e.target.value as DocCategory }))} style={{ ...INPUT, cursor: 'pointer' }}>
                        {Object.entries(CAT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Link to Project</label>
                      <select value={uploadForm.linkedId} onChange={e => setUploadForm(f => ({ ...f, linkedId: e.target.value }))} style={{ ...INPUT, cursor: 'pointer' }}>
                        {linkOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Display Name (opt.)</label>
                      <input value={uploadForm.name} onChange={e => setUploadForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Leave blank to use filename" style={INPUT}/>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" onClick={commitUpload} disabled={uploading} style={{ fontSize: 13 }}>
                        <Icon name="cloudup" size={14} stroke={1.9}/> {uploading ? 'Saving…' : 'Upload'}
                      </button>
                      <button className="btn ghost" onClick={() => { setPendingFiles([]); if (fileInput.current) fileInput.current.value = ''; }} style={{ fontSize: 13 }}>✕</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Category chips */}
            {byCategory.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <button onClick={() => setFilterCat('all')} className={'chip' + (filterCat === 'all' ? ' active' : '')}>All ({docs.length})</button>
                {byCategory.map(c => {
                  const m = CAT_META[c.cat];
                  return (
                    <button key={c.cat} onClick={() => setFilterCat(c.cat)}
                      style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: filterCat === c.cat ? m.color : 'var(--surface2)',
                        color: filterCat === c.cat ? '#fff' : 'var(--text2)' }}>
                      {c.label} · {c.count}
                    </button>
                  );
                })}
              </div>
            )}

            {docs.length > 0 && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', borderRadius: 9, padding: '7px 12px', flex: 1 }}>
                  <Icon name="search" size={14} stroke={1.9}/>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents…"
                    style={{ border: 'none', background: 'transparent', font: 'inherit', fontSize: 13, color: 'var(--text)', outline: 'none', flex: 1 }}/>
                </div>
                <select value={filterDiv} onChange={e => setFilterDiv(e.target.value as any)} className="comm-filter">
                  <option value="all">All Divisions</option>
                  <option value="elec">Electrical</option>
                  <option value="gen">Generator</option>
                  <option value="general">General</option>
                </select>
              </div>
            )}

            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>Loading…</div>
            ) : docs.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
                No documents yet — upload files above.
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
                No documents match these filters.
              </div>
            ) : (
              <div className="panel">
                <table className="ctable">
                  <thead>
                    <tr><th>Document</th><th>Category</th><th>Linked To</th><th>Uploaded</th><th>Size</th><th></th></tr>
                  </thead>
                  <tbody>
                    {filtered.map(doc => {
                      const cat      = CAT_META[doc.category];
                      const ext      = extOf(doc.name);
                      const iconName = EXT_ICON[ext] ?? 'file';
                      const isActive = selected?.id === doc.id;
                      return (
                        <tr key={doc.id} onClick={() => setSelected(isActive ? null : doc)}
                          style={{ cursor: 'pointer', background: isActive ? 'var(--surface2)' : undefined }}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface2)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', flexShrink: 0 }}>
                                <Icon name={iconName as any} size={14} stroke={1.8}/>
                              </div>
                              <div>
                                <div className="nm">{doc.display_name}</div>
                                <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>.{ext}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 5,
                              background: cat.bg, color: cat.color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                              {cat.label}
                            </span>
                          </td>
                          <td className="sub" style={{ maxWidth: 180 }}>
                            {doc.linked_name
                              ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <Icon name="clip" size={11} stroke={1.8}/>{(doc.linked_name).replace(/^\[.*?\] /,'')}
                                </span>
                              : '—'}
                          </td>
                          <td className="sub">{fmtDate(doc.created_at)}</td>
                          <td className="sub">{fmtSize(doc.file_size)}</td>
                          <td>
                            <button onClick={e => { e.stopPropagation(); deleteDoc(doc.id); }}
                              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6 }}
                              title="Remove">
                              <Icon name="x" size={14} stroke={2}/>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selected && docs.length > 0 && (
            <div className="panel" style={{ alignSelf: 'start', position: 'sticky', top: 16 }}>
              <div className="panel-hdr">
                <span className="panel-title">Document Info</span>
                <button onClick={() => setSelected(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }}>
                  <Icon name="x" size={16} stroke={2}/>
                </button>
              </div>
              <div style={{ padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 10, background: CAT_META[selected.category].bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: CAT_META[selected.category].color }}>
                    <Icon name={EXT_ICON[extOf(selected.name)] as any ?? 'file'} size={22} stroke={1.6}/>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3 }}>{selected.display_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginTop: 3 }}>.{extOf(selected.name)} · {fmtSize(selected.file_size)}</div>
                  </div>
                </div>

                {[
                  ['Category',  CAT_META[selected.category].label],
                  ['Linked To', selected.linked_name || '—'],
                  ['Division',  selected.div === 'elec' ? 'Electrical' : selected.div === 'gen' ? 'Generator' : 'General'],
                  ['Uploaded',  fmtDate(selected.created_at)],
                  ['By',        selected.uploaded_by],
                ].map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v}</div>
                  </div>
                ))}

                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="btn ghost" onClick={() => downloadDoc(selected)} style={{ fontSize: 13 }}>
                    <Icon name="cloud" size={14} stroke={1.9}/> Download
                  </button>
                  <button className="btn ghost" onClick={() => deleteDoc(selected.id)}
                    style={{ fontSize: 13, color: '#E06A6A', borderColor: '#E06A6A' }}>
                    <Icon name="x" size={14} stroke={2}/> Remove
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
