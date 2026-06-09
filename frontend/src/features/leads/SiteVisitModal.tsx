import React, { useState } from 'react';
import Icon from '../../components/Icon';

interface Props {
  leadName: string;
  saving?: boolean;
  // siteVisitAt is an ISO string, or null for "no time yet".
  onConfirm: (siteVisitAt: string | null) => void;
  onClose: () => void;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1200, padding: 20,
};
const MODAL: React.CSSProperties = {
  background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 440,
  boxShadow: '0 24px 64px rgba(0,0,0,.35)', overflow: 'hidden',
};
const HDR: React.CSSProperties = {
  background: 'var(--amber, #F59E0B)', color: '#11192a',
  padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};
const BODY: React.CSSProperties = { padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 };
const FOOT: React.CSSProperties = {
  padding: '14px 22px', borderTop: '1px solid var(--border)',
  display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center',
};
const input: React.CSSProperties = {
  font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
  background: 'var(--surface)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '8px 11px', outline: 'none', boxSizing: 'border-box', width: '100%',
};
const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4, display: 'block' };

export default function SiteVisitModal({ leadName, saving, onConfirm, onClose }: Props) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  const schedule = () => {
    if (!date || !time) return;
    // Combine the local date + time into an absolute instant.
    const at = new Date(`${date}T${time}`);
    if (isNaN(at.getTime())) return;
    onConfirm(at.toISOString());
  };

  return (
    <div style={OVERLAY} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div style={MODAL}>
        <div style={HDR}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Schedule Site Visit</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#11192a', display: 'flex' }}>
            <Icon name="x" size={18} stroke={2.2}/>
          </button>
        </div>
        <div style={BODY}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            Set the site visit date &amp; time for <b>{leadName}</b>. This converts the lead to a generator proposal.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={label}>Date</label>
              <input style={input} type="date" value={date} autoFocus onChange={e => setDate(e.target.value)}/>
            </div>
            <div>
              <label style={label}>Time</label>
              <input style={input} type="time" value={time} onChange={e => setTime(e.target.value)}/>
            </div>
          </div>
        </div>
        <div style={FOOT}>
          <button
            className="btn ghost"
            style={{ fontSize: 12.5 }}
            disabled={saving}
            onClick={() => onConfirm(null)}
            title="Proceed without a time — the lead/proposal will be flagged as needing one"
          >
            No time yet
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn ghost" style={{ fontSize: 13 }} disabled={saving} onClick={onClose}>Cancel</button>
            <button className="btn amber" style={{ fontSize: 13 }} disabled={saving || !date || !time} onClick={schedule}>
              {saving ? 'Scheduling…' : 'Schedule & Convert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
