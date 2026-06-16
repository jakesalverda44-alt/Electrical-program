import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../components/Icon';
import { Bid } from '../../types';
import api from '../../api/client';
import { useShowToast } from '../../contexts/AppContext';

interface IntakeItem {
  id: string;
  name: string;
  gc: string | null;
  loc: string | null;
  contact: string | null;
  amount: number | null;
  sheets: number | null;
  sq_ft: number | null;
  due: string | null;
  notes: string | null;
  source: string;
  status: 'pending' | 'accepted' | 'declined';
  decline_reason: string | null;
  created_by_name: string | null;
  created_at: string;
  read_at: string | null;        // null = unread (not yet opened)
  // Email-sourced (source === 'email') metadata
  web_link: string | null;
  from_email: string | null;
  received_at: string | null;
  body_snippet: string | null;
  attachment_names: string[] | null;
  // Set when the "new bid" email was sent to the team from the Accept panel.
  team_notified_at: string | null;
  team_notified_to: string[] | null;
}

const DECLINE_REASONS = [
  'Capacity — too busy',
  'Outside service area',
  'Scope not a fit',
  'No relationship with GC',
  'Timeline too tight',
  'Other',
];

const BLANK = { name: '', gc: '', loc: '', contact: '', amount: '', sheets: '', sq_ft: '', due: '', notes: '' };

interface Props {
  onBidAccepted: (bid: Bid) => void;
  onUnreadChange?: (count: number) => void;   // unread (unopened) bids, for the sidebar badge
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '8px 10px', outline: 'none',
};

export default function IntakeInboxPage({ onBidAccepted, onUnreadChange }: Props) {
  const showToast = useShowToast();
  const [items, setItems] = useState<IntakeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IntakeItem | null>(null);
  const [edit, setEdit] = useState<typeof BLANK>(BLANK);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState(DECLINE_REASONS[0]);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<typeof BLANK>(BLANK);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  // "Email new bid to the team" option (opt-in, off by default) + its editable recipients.
  const [notifyTeam, setNotifyTeam] = useState(false);
  const [notifyEmails, setNotifyEmails] = useState('');
  const [teamDefaults, setTeamDefaults] = useState<{ emails: string[]; mailConfigured: boolean }>({ emails: [], mailConfigured: false });

  useEffect(() => {
    api.get('/intake/notify-defaults')
      .then(r => setTeamDefaults({ emails: r.data?.emails ?? [], mailConfigured: !!r.data?.mailConfigured }))
      .catch(() => setTeamDefaults({ emails: [], mailConfigured: false }));
  }, []);

  const report = useCallback((list: IntakeItem[]) => {
    onUnreadChange?.(list.filter(i => !i.read_at).length);
  }, [onUnreadChange]);

  // Keep the sidebar badge in lockstep with local state — opening, importing, or refreshing
  // all change the unread set, so report on every items change (not just on load).
  useEffect(() => { report(items); }, [items, report]);

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
      sq_ft: item.sq_ft != null ? String(item.sq_ft) : '',
      due: item.due ? item.due.slice(0, 10) : '', notes: item.notes || '',
    });
    setDeclineOpen(false);
    // Reset the team-email option for each item (off by default), prefilled & editable.
    setNotifyTeam(false);
    setNotifyEmails(teamDefaults.emails.join(', '));
    // Opening an unread item marks it read (persisted), and updates the count locally.
    if (!item.read_at) {
      const stamp = new Date().toISOString();
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, read_at: stamp } : i));
      api.post(`/intake/${item.id}/read`).catch(() => {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, read_at: null } : i)); // revert on failure
      });
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.post('/intake/refresh');
      const n = r.data?.imported ?? 0;
      showToast({ title: n > 0 ? `Imported ${n} new ${n === 1 ? 'email' : 'emails'}` : 'No new tagged emails' });
      load();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast({ title: 'Refresh failed', sub: message || 'Could not reach the mailbox' });
    } finally {
      setRefreshing(false);
    }
  };

  const handleAccept = async () => {
    if (!selected) return;
    if (!edit.name.trim() || !edit.gc.trim()) { showToast({ title: 'Name and GC are required' }); return; }
    const teamEmails = notifyTeam
      ? notifyEmails.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
      : [];
    setSaving(true);
    try {
      const r = await api.post(`/intake/${selected.id}/accept`, {
        name: edit.name, gc: edit.gc, loc: edit.loc, contact: edit.contact,
        amount: edit.amount, sq_ft: edit.sq_ft, due: edit.due, notes: edit.notes,
        notifyTeam, notifyEmails: teamEmails,
      });
      onBidAccepted(r.data.bid as Bid);
      const notified: string[] | null = r.data.teamNotifiedTo ?? null;
      showToast({
        title: 'Bid accepted',
        sub: notified?.length
          ? `${edit.name} added · emailed ${notified.length} ${notified.length === 1 ? 'teammate' : 'teammates'}`
          : `${edit.name} added to pipeline`,
      });
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
      showToast({ title: 'Bid rejected', sub: declineReason });
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

  const unreadCount = items.filter(i => !i.read_at).length;
  const shown = unreadOnly ? items.filter(i => !i.read_at) : items;
  const pending = shown.filter(i => i.status === 'pending');
  const processed = shown.filter(i => i.status !== 'pending');

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const ItemRow = ({ item }: { item: IntakeItem }) => {
    const isActive = selected?.id === item.id;
    const unread = !item.read_at;
    return (
      <div onClick={() => openItem(item)} style={{
        padding: '12px 18px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
        background: isActive ? 'var(--surface2)' : 'transparent',
        borderLeft: unread ? '3px solid var(--blue)' : '3px solid transparent',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            {unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }}/>}
            <span style={{ fontSize: 13, fontWeight: unread ? 900 : 700, color: unread ? 'var(--text)' : 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
          </span>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 8 }}>{fmt(item.created_at)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: unread ? 700 : 600, marginBottom: 3 }}>{item.gc || '—'}{item.loc ? ` · ${item.loc}` : ''}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {item.status === 'accepted' && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--green-soft)', color: 'var(--green)', textTransform: 'uppercase' }}>Accepted</span>}
          {item.status === 'declined' && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text3)', textTransform: 'uppercase' }}>Rejected</span>}
          {item.team_notified_at && (
            <span title={item.team_notified_to?.length ? `Sent to ${item.team_notified_to.join(', ')}` : 'Sent to the team'} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--blue-soft, var(--surface2))', color: 'var(--blue)', textTransform: 'uppercase' }}>
              <Icon name="check" size={11} stroke={2.6}/> Team
            </span>
          )}
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
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }}>Square Footage</label>
        <input type="number" min={0} style={inputStyle} value={form.sq_ft} onChange={e => set('sq_ft', e.target.value)} />
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
          <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Intake Inbox</span>
                {unreadCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 900, color: '#fff', background: 'var(--blue)', borderRadius: 10, padding: '1px 8px', minWidth: 18, textAlign: 'center' }}>{unreadCount}</span>
                )}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" onClick={handleRefresh} disabled={refreshing} style={{ fontSize: 12, padding: '6px 12px' }} title="Pull new bid-tagged emails from Outlook">
                  <Icon name="sync" size={13} stroke={2.2}/> {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
                <button className="btn" onClick={() => { setAddOpen(true); setSelected(null); }} style={{ fontSize: 12, padding: '6px 12px' }}>
                  <Icon name="plus" size={13} stroke={2.4}/> Add
                </button>
              </div>
            </div>
            <div style={{ display: 'inline-flex', background: 'var(--surface2)', borderRadius: 8, padding: 2 }}>
              {([['unread', `Unread${unreadCount ? ` · ${unreadCount}` : ''}`], ['all', 'All']] as const).map(([key, label]) => {
                const active = (key === 'unread') === unreadOnly;
                return (
                  <button key={key} onClick={() => setUnreadOnly(key === 'unread')} style={{
                    fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: 'none',
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text3)',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
                  }}>{label}</button>
                );
              })}
            </div>
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
              {shown.length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  {items.length === 0
                    ? 'Inbox empty. Click “Add” to log an incoming bid.'
                    : unreadOnly ? 'No unread items. Switch to “All” to see everything.' : 'No items.'}
                </div>
              )}
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

            {selected.source === 'email' && (
              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>From Outlook</div>
                {selected.from_email && (
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>{selected.from_email}</div>
                )}
                {selected.body_snippet && (
                  <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5, marginBottom: 8 }}>{selected.body_snippet}</div>
                )}
                {selected.attachment_names && selected.attachment_names.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>Attachments ({selected.attachment_names.length})</div>
                    {selected.attachment_names.map((a, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', fontWeight: 600, marginBottom: 2 }}>
                        <Icon name="file" size={12} stroke={2}/> {a}
                      </div>
                    ))}
                  </div>
                )}
                {selected.web_link && (
                  <a href={selected.web_link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--blue)', textDecoration: 'none' }}>
                    <Icon name="doc" size={13} stroke={2}/> Open original email
                  </a>
                )}
              </div>
            )}

            {selected.status === 'pending' ? (
              <>
                {FormFields(edit, (k, v) => setEdit(prev => ({ ...prev, [k]: v })))}

                {/* Opt-in: email this new commercial bid to the team (off by default). */}
                <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: teamDefaults.mailConfigured ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>
                    <input
                      type="checkbox"
                      checked={notifyTeam}
                      disabled={!teamDefaults.mailConfigured}
                      onChange={e => {
                        const c = e.target.checked;
                        setNotifyTeam(c);
                        if (c && !notifyEmails.trim()) setNotifyEmails(teamDefaults.emails.join(', '));
                      }}
                    />
                    Email this new bid to the team
                  </label>
                  {!teamDefaults.mailConfigured && (
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6 }}>Email isn’t configured — set it up in Settings to enable this.</div>
                  )}
                  {notifyTeam && (
                    <div style={{ marginTop: 10 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }}>Recipients</label>
                      <textarea
                        style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }}
                        value={notifyEmails}
                        onChange={e => setNotifyEmails(e.target.value)}
                        placeholder="name@company.com, name2@company.com"
                      />
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>Comma-separated. Sent from your Outlook mailbox when you accept.</div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <button className="btn" onClick={handleAccept} disabled={saving} style={{ fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)' }}>
                    <Icon name="check" size={14} stroke={2.2}/> {saving ? 'Accepting…' : 'Accept & Add to Pipeline'}
                  </button>
                  <button className="btn ghost" onClick={() => setDeclineOpen(o => !o)} style={{ fontSize: 13 }}>
                    <Icon name="x" size={14} stroke={2.2}/> Reject
                  </button>
                  {declineOpen && (
                    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginTop: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>Reason for rejecting:</div>
                      <select value={declineReason} onChange={e => setDeclineReason(e.target.value)} style={{ ...inputStyle, marginBottom: 10, cursor: 'pointer' }}>
                        {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button className="btn" onClick={handleDecline} disabled={saving} style={{ fontSize: 13, width: '100%', background: 'var(--slate)', borderColor: 'var(--slate)' }}>Confirm Reject</button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: 'var(--text3)' }}>
                {selected.status === 'accepted'
                  ? '✓ Accepted and added to the pipeline.'
                  : `✗ Rejected${selected.decline_reason ? ` — ${selected.decline_reason}` : ''}.`}
                {selected.team_notified_at && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--blue)', fontWeight: 700 }}>
                    <Icon name="check" size={14} stroke={2.4}/>
                    Emailed to the team on {fmt(selected.team_notified_at)}
                    {selected.team_notified_to?.length ? ` · ${selected.team_notified_to.length} ${selected.team_notified_to.length === 1 ? 'recipient' : 'recipients'}` : ''}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
