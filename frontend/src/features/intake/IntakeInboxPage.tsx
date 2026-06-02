import React, { useState } from 'react';
import Icon from '../../components/Icon';
import { Bid, Toast } from '../../types';
import api from '../../api/client';

interface IntakeItem {
  id: string;
  from: string;
  subject: string;
  received: string;
  body: string;
  status: 'pending' | 'accepted' | 'rejected';
  fields: {
    bidName: string;
    loc: string;
    gc: string;
    due: string;
    contact: string;
    amount: number;
    sheets: number;
    confidence: Record<string, 'high' | 'medium' | 'low'>;
  };
}

const DEMO_ITEMS: IntakeItem[] = [
  {
    id: 'i1',
    from: 'estimating@brconstruction.com',
    subject: 'ITB – Lakewood Ranch Medical Expansion',
    received: '2026-06-02T09:14:00',
    status: 'pending',
    body: `Good morning,\n\nPlease find attached the invitation to bid for the Lakewood Ranch Medical Campus Expansion project. We are requesting pricing on Division 16 Electrical only.\n\nBid Due: June 14th, 2026 at 2:00 PM\nLocation: 8330 Lakewood Ranch Blvd, Lakewood Ranch, FL 34202\nGeneral Contractor: BR Construction Group\nEstimated Value: $420,000 – $480,000\nPlan Sheets: 48 sheets\n\nPlease confirm receipt and your intent to bid.\n\nBest,\nMark Ellison\nPre-Construction Manager\nBR Construction Group\n(941) 555-0147`,
    fields: {
      bidName: 'Lakewood Ranch Medical Expansion',
      loc: 'Lakewood Ranch, FL',
      gc: 'BR Construction Group',
      due: '2026-06-14',
      contact: 'Mark Ellison · (941) 555-0147',
      amount: 450000,
      sheets: 48,
      confidence: {
        bidName: 'high', loc: 'high', gc: 'high', due: 'high',
        contact: 'high', amount: 'medium', sheets: 'high',
      },
    },
  },
  {
    id: 'i2',
    from: 'bids@suncoastdev.net',
    subject: 'Bid Request – Osprey Commons Phase 2',
    received: '2026-06-01T15:42:00',
    status: 'pending',
    body: `Hi team,\n\nWe'd like to invite Accurate Power & Technology to bid on Phase 2 of Osprey Commons, a mixed-use development in Osprey, FL. Electrical scope includes site lighting, panel upgrades, and tenant fit-outs.\n\nBid deadline is June 20, 2026. Please pick up drawings from our office or request digital copies.\n\nEstimated electrical budget is roughly $280K based on Phase 1 actuals.\n\nContact me with any questions.\n\nSarah Nguyen\nSuncoast Development\n(941) 555-0211`,
    fields: {
      bidName: 'Osprey Commons Phase 2',
      loc: 'Osprey, FL',
      gc: 'Suncoast Development',
      due: '2026-06-20',
      contact: 'Sarah Nguyen · (941) 555-0211',
      amount: 280000,
      sheets: 0,
      confidence: {
        bidName: 'high', loc: 'high', gc: 'high', due: 'high',
        contact: 'high', amount: 'low', sheets: 'low',
      },
    },
  },
  {
    id: 'i3',
    from: 'procurement@gulfcoastbuilders.com',
    subject: 'Electrical Sub Needed – Siesta Village Retail',
    received: '2026-05-30T11:05:00',
    status: 'accepted',
    body: `To Whom It May Concern,\n\nGulf Coast Builders is seeking electrical subcontractor pricing for the Siesta Village Retail Center project in Sarasota. Bid documents are available via our ftp portal.\n\nBid Date: June 10, 2026\nPlans: 32 sheets\nLocation: 1200 Stickney Point Rd, Sarasota, FL 34231\n\nRegards,\nProcurement Team\nGulf Coast Builders`,
    fields: {
      bidName: 'Siesta Village Retail Center',
      loc: 'Sarasota, FL',
      gc: 'Gulf Coast Builders',
      due: '2026-06-10',
      contact: 'Procurement Team',
      amount: 0,
      sheets: 32,
      confidence: {
        bidName: 'high', loc: 'high', gc: 'high', due: 'high',
        contact: 'medium', amount: 'low', sheets: 'high',
      },
    },
  },
];

const REJECT_REASONS = [
  'Capacity — too busy',
  'Outside service area',
  'Scope not a fit',
  'No relationship with GC',
  'Timeline too tight',
  'Other',
];

function confBadge(level: 'high' | 'medium' | 'low') {
  const map = {
    high:   { label: 'High',   color: 'var(--green)',  bg: 'var(--green-soft)'  },
    medium: { label: 'Med',    color: 'var(--amber)',  bg: 'var(--amber-soft)'  },
    low:    { label: 'Low',    color: 'var(--red, #E06A6A)', bg: 'rgba(224,106,106,.12)' },
  };
  const c = map[level];
  return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
      background: c.bg, color: c.color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
      {c.label}
    </span>
  );
}

interface Props {
  onBidAccepted: (bid: Bid) => void;
  showToast: (t: Toast) => void;
  onPendingChange?: (count: number) => void;
}

export default function IntakeInboxPage({ onBidAccepted, showToast, onPendingChange }: Props) {
  const [items, setItems] = useState<IntakeItem[]>(DEMO_ITEMS);
  const [selected, setSelected] = useState<IntakeItem | null>(null);
  const [editing, setEditing] = useState<Partial<IntakeItem['fields']>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0]);
  const [saving, setSaving] = useState(false);

  const openItem = (item: IntakeItem) => {
    setSelected(item);
    setEditing({ ...item.fields });
    setRejectOpen(false);
  };

  const setField = (k: keyof IntakeItem['fields'], v: unknown) => {
    setEditing(prev => ({ ...prev, [k]: v }));
  };

  const handleAccept = async () => {
    if (!selected) return;
    const f = { ...selected.fields, ...editing };
    if (!f.bidName?.trim()) { showToast({ title: 'Bid name required' }); return; }
    setSaving(true);
    try {
      const r = await api.post('/bids', {
        name:    f.bidName,
        loc:     f.loc,
        gc:      f.gc,
        due:     f.due,
        contact: f.contact,
        amount:  Number(f.amount) || 0,
        sheets:  Number(f.sheets) || 0,
        stage:   'due',
      });
      const newBid: Bid = r.data;
      setItems(prev => {
        const next = prev.map(i => i.id === selected.id ? { ...i, status: 'accepted' as const } : i);
        onPendingChange?.(next.filter(i => i.status === 'pending').length);
        return next;
      });
      onBidAccepted(newBid);
      showToast({ title: 'Bid accepted', sub: `${f.bidName} added to pipeline` });
      setSelected(null);
    } catch {
      showToast({ title: 'Failed to accept', sub: 'Please try again' });
    } finally {
      setSaving(false);
    }
  };

  const handleReject = () => {
    if (!selected) return;
    setItems(prev => {
      const next = prev.map(i => i.id === selected.id ? { ...i, status: 'rejected' as const } : i);
      onPendingChange?.(next.filter(i => i.status === 'pending').length);
      return next;
    });
    showToast({ title: 'Bid declined', sub: rejectReason });
    setSelected(null);
    setRejectOpen(false);
  };

  const pending   = items.filter(i => i.status === 'pending');
  const processed = items.filter(i => i.status !== 'pending');

  const formatReceived = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const ItemRow = ({ item }: { item: IntakeItem }) => {
    const lowConf = Object.values(item.fields.confidence).some(c => c === 'low');
    const isActive = selected?.id === item.id;
    return (
      <div onClick={() => openItem(item)} style={{
        padding: '12px 18px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
        background: isActive ? 'var(--surface2)' : 'transparent',
        transition: 'background .15s',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{item.fields.bidName}</span>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 8 }}>
            {formatReceived(item.received)}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 3 }}>{item.from}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {item.status === 'accepted' && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--green-soft)', color: 'var(--green)', textTransform: 'uppercase' }}>Accepted</span>}
          {item.status === 'rejected' && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text3)', textTransform: 'uppercase' }}>Rejected</span>}
          {lowConf && item.status === 'pending' && (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="spark" size={11} stroke={1.8}/> Review fields
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="scroll view-enter">
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 60px)' }}>
        {/* Left: email list */}
        <div style={{ borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
          {pending.length > 0 && (
            <>
              <div style={{ padding: '12px 18px 8px', fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Pending Review · {pending.length}
              </div>
              {pending.map(i => <ItemRow key={i.id} item={i}/>)}
            </>
          )}
          {processed.length > 0 && (
            <>
              <div style={{ padding: '16px 18px 8px', fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Processed
              </div>
              {processed.map(i => <ItemRow key={i.id} item={i}/>)}
            </>
          )}
          {items.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Inbox empty</div>
          )}
        </div>

        {/* Right: detail */}
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
            <div style={{ textAlign: 'center' }}>
              <Icon name="doc" size={32} stroke={1.4}/>
              <div style={{ marginTop: 12 }}>Select an email to review</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', overflow: 'hidden' }}>
            {/* Email body */}
            <div style={{ overflowY: 'auto', padding: '24px 28px', borderRight: '1px solid var(--border)' }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', marginBottom: 6 }}>{selected.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>From: {selected.from}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Received: {formatReceived(selected.received)}</div>
              </div>
              <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }}/>
              <pre style={{ font: 'inherit', fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
                {selected.body}
              </pre>
            </div>

            {/* Extracted fields + actions */}
            <div style={{ overflowY: 'auto', padding: '24px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="sparkle" size={15} stroke={1.8}/> AI-Extracted Fields
              </div>

              {([
                ['bidName', 'Bid Name'],
                ['loc',     'Location'],
                ['gc',      'General Contractor'],
                ['due',     'Bid Due Date'],
                ['contact', 'Contact'],
              ] as [keyof IntakeItem['fields'], string][]).map(([k, label]) => {
                const conf = selected.fields.confidence[k] ?? 'low';
                return (
                  <div key={k} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</label>
                      {confBadge(conf)}
                    </div>
                    <input
                      style={{
                        width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
                        color: 'var(--text)', background: 'var(--surface)',
                        border: `1px solid ${conf === 'low' ? 'var(--amber)' : 'var(--border2)'}`,
                        borderRadius: 9, padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
                      }}
                      value={String((editing as any)[k] ?? '')}
                      onChange={e => setField(k, e.target.value)}
                      type={k === 'due' ? 'date' : 'text'}
                    />
                  </div>
                );
              })}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                {([['amount', 'Est. Amount ($)'], ['sheets', 'Plan Sheets']] as [keyof IntakeItem['fields'], string][]).map(([k, label]) => {
                  const conf = selected.fields.confidence[k] ?? 'low';
                  return (
                    <div key={k}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</label>
                        {confBadge(conf)}
                      </div>
                      <input
                        type="number" min={0}
                        style={{
                          width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
                          color: 'var(--text)', background: 'var(--surface)',
                          border: `1px solid ${conf === 'low' ? 'var(--amber)' : 'var(--border2)'}`,
                          borderRadius: 9, padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
                        }}
                        value={Number((editing as any)[k] ?? 0)}
                        onChange={e => setField(k, Number(e.target.value))}
                      />
                    </div>
                  );
                })}
              </div>

              {selected.status === 'pending' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
                  <button className="btn" onClick={handleAccept} disabled={saving}
                    style={{ fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)' }}>
                    <Icon name="check" size={14} stroke={2.2}/> {saving ? 'Accepting…' : 'Accept & Add to Pipeline'}
                  </button>
                  <button className="btn ghost" onClick={() => setRejectOpen(r => !r)} style={{ fontSize: 13 }}>
                    <Icon name="x" size={14} stroke={2.2}/> Reject Bid
                  </button>
                  {rejectOpen && (
                    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginTop: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>Reason for declining:</div>
                      <select value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                        style={{ width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
                          background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '8px 10px', marginBottom: 10 }}>
                        {REJECT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button className="btn" onClick={handleReject}
                        style={{ fontSize: 13, width: '100%', background: 'var(--slate)', borderColor: 'var(--slate)' }}>
                        Confirm Reject
                      </button>
                    </div>
                  )}
                </div>
              )}

              {selected.status !== 'pending' && (
                <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text3)', padding: '16px 0' }}>
                  {selected.status === 'accepted' ? '✓ Accepted and added to pipeline' : '✗ Rejected'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
