import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../components/Icon';
import { Bid, Toast } from '../../types';
import api from '../../api/client';

interface IntakeItem {
  id: string;
  name: string;
  gc: string | null;
  loc: string | null;
  contact: string | null;
  amount: number | null;
  sheets: number | null;
  due: string | null;
  notes: string | null;
  source: string;
  status: 'pending' | 'accepted' | 'declined';
  decline_reason: string | null;
  created_by_name: string | null;
  created_at: string;
}

const DECLINE_REASONS = [
  'Capacity — too busy',
  'Outside service area',
  'Scope not a fit',
  'No relationship with GC',
  'Timeline too tight',
  'Other',
];

const BLANK = { name: '', gc: '', loc: '', contact: '', amount: '', sheets: '', due: '', notes: '' };

interface Props {
  onBidAccepted: (bid: Bid) => void;
  showToast: (t: Toast) => void;
  onPendingChange?: (count: number) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '8px 10px', outline: 'none',
};

export default function IntakeInboxPage({ onBidAccepted, showToast, onPendingChange }: Props) {
  const [items, setItems] = useState<IntakeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IntakeItem | null>(null);
  const [edit, setEdit] = useState<typeof BLANK>(BLANK);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState(DECLINE_REASONS[0]);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<typeof BLANK>(BLANK);

  const report = useCallback((list: IntakeItem[]) => {
    onPendingChange?.(list.filter(i => i.status === 'pending').length);
  }, [onPendingChange]);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/intake')
      .then(r => { setItems(r.data); report(r.data); })
      .catch(() => { setItems([]); report([]); })
      .finally(() => setLoading(false));
  }, [report]);

  useEffect(() => { load(); }, [load]);

  const openItem = (item: IntakeItem) => {
    setSelected(item);
    setEdit({
      name: item.name || '', gc: item.gc || '', loc: item.loc || '', contact: item.contact || '',
      amount: item.amount != null ? String(item.amount) : '', sheets: item.sheets != null ? String(item.sheets) : '',
      due: item.due || '', notes: item.notes || '',
    });
    setDeclineOpen(false);
  };

  const handleAccept = async () => {
    if (!selected) return;
    if (!edit.name.trim() || !edit.gc.trim()) { showToast({ title: 'Name and GC are required' }); return; }
    setSaving(true);
    try {
      const r = await api.post(`/intake/${selected.id}/accept`, {
        name: edit.name, gc: edit.gc, loc: edit.loc, contact: edit.contact,
        amount: edit.amount, due: edit.due, notes: edit.notes,
      });
      onBidAccepted(r.data.bid as Bid);
      showToast({ title: 'Bid accepted', sub: `${edit.name} added to pipeline` });
      setSelected(null);
      load();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast({ title: message || 'Failed to accept', sub: 'Please try again' });
    } finally {
      setSaving(false);
    }
  };

  const handleDecline = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.post(`/intake/${selected.id}/decline`, { reason: declineReason });
      showToast({ title: 'Bid declined', sub: declineReason });
      setSelected(null);
      setDeclineOpen(false);
      load();
    } catch {
      showToast({ title: 'Failed to decline', sub: 'Please try again' });
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!addForm.name.trim()) { showToast({ title: 'Name is required' }); return; }
    setSaving(true);
    try {
      await api.post('/intake', addForm);
      showToast({ title: 'Added to inbox' });
      setAddForm(BLANK);
      setAddOpen(false);
      load();
    } catch {
      showToast({ title: 'Failed to add', sub: 'Please try again' });
    } finally {
      setSaving(false);
    }
  };

  const pending = items.filter(i => i.status === 'pending');
  const processed = items.filter(i => i.status !== 'pending');

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const ItemRow = ({ item }: { item: IntakeItem }) => {
    const isActive = selected?.id === item.id;
    return (
      <div onClick={() => openItem(item)} style={{
        padding: '12px 18px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
        background: isActive ? 'var(--surface2)' : 'transparent',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{item.name}</span>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 8 }}>{fmt(item.created_at)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 3 }}>{item.gc || '—'}{item.loc ? ` · ${item.loc}` : ''}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {item.status === 'accepted' && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--green-soft)', color: 'var(--green)', textTransform: 'uppercase' }}>Accepted</span>}
          {item.status === 'declined' && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text3)', textTransform: 'uppercase' }}>Declined</span>}
        </div>
      </div>
    );
  };

  const FormFields = (form: typeof BLANK, set: (k: keyof typeof BLANK, v: string) => void) => (
    <>
      {([['name', 'Bid Name *'], ['gc', 'General Contractor'], ['loc', 'Location'], ['contact', 'Contact']] as const).map(([k, label]) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }}>{label}</label>
          <input style={inputStyle} value={form[k]} onChange={e => set(k, e.target.value)} />
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }}>Due Date</label>
          <input type="date" style={inputStyle} value={form.due} onChange={e => set('due', e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }}>Est. Amount ($)</label>
          <input type="number" min={0} style={inputStyle} value={form.amount} onChange={e => set('amount', e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }}>Notes</label>
        <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
    </>
  );

  return (
    <div className="scroll view-enter">
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', height: 'calc(100vh - 60px)' }}>
        {/* Left: inbox list */}
        <div style={{ borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Intake Inbox</span>
            <button className="btn" onClick={() => { setAddOpen(true); setSelected(null); }} style={{ fontSize: 12, padding: '6px 12px' }}>
              <Icon name="plus" size={13} stroke={2.4}/> Add
            </button>
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              {pending.length > 0 && (
                <>
                  <div style={{ padding: '12px 18px 8px', fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Pending · {pending.length}</div>
                  {pending.map(i => <ItemRow key={i.id} item={i}/>)}
                </>
              )}
              {processed.length > 0 && (
                <>
                  <div style={{ padding: '16px 18px 8px', fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Processed</div>
                  {processed.map(i => <ItemRow key={i.id} item={i}/>)}
                </>
              )}
              {items.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Inbox empty. Click “Add” to log an incoming bid.</div>}
            </>
          )}
        </div>

        {/* Right: add form, or detail */}
        {addOpen ? (
          <div style={{ overflowY: 'auto', padding: '24px 28px', maxWidth: 460 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', marginBottom: 18 }}>Add Incoming Bid</div>
            {FormFields(addForm, (k, v) => setAddForm(prev => ({ ...prev, [k]: v })))}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn" onClick={handleAdd} disabled={saving} style={{ background: 'var(--green)', borderColor: 'var(--green)' }}>{saving ? 'Adding…' : 'Add to Inbox'}</button>
              <button className="btn ghost" onClick={() => { setAddOpen(false); setAddForm(BLANK); }}>Cancel</button>
            </div>
          </div>
        ) : !selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
            <div style={{ textAlign: 'center' }}>
              <Icon name="bell" size={32} stroke={1.4}/>
              <div style={{ marginTop: 12 }}>Select an item to review</div>
            </div>
          </div>
        ) : (
          <div style={{ overflowY: 'auto', padding: '24px 28px', maxWidth: 460 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', marginBottom: 4 }}>{selected.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 18 }}>
              Added by {selected.created_by_name || 'unknown'} · {fmt(selected.created_at)}
              {selected.source !== 'manual' ? ` · ${selected.source}` : ''}
            </div>

            {selected.status === 'pending' ? (
              <>
                {FormFields(edit, (k, v) => setEdit(prev => ({ ...prev, [k]: v })))}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <button className="btn" onClick={handleAccept} disabled={saving} style={{ fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)' }}>
                    <Icon name="check" size={14} stroke={2.2}/> {saving ? 'Accepting…' : 'Accept & Add to Pipeline'}
                  </button>
                  <button className="btn ghost" onClick={() => setDeclineOpen(o => !o)} style={{ fontSize: 13 }}>
                    <Icon name="x" size={14} stroke={2.2}/> Decline
                  </button>
                  {declineOpen && (
                    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginTop: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>Reason for declining:</div>
                      <select value={declineReason} onChange={e => setDeclineReason(e.target.value)} style={{ ...inputStyle, marginBottom: 10, cursor: 'pointer' }}>
                        {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button className="btn" onClick={handleDecline} disabled={saving} style={{ fontSize: 13, width: '100%', background: 'var(--slate)', borderColor: 'var(--slate)' }}>Confirm Decline</button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: 'var(--text3)' }}>
                {selected.status === 'accepted'
                  ? '✓ Accepted and added to the pipeline.'
                  : `✗ Declined${selected.decline_reason ? ` — ${selected.decline_reason}` : ''}.`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
