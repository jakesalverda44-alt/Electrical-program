import React, { useState } from 'react';
import api from '../../api/client';
import { Gen } from '../../types';
import Icon from '../../components/Icon';

interface Props {
  genId: string;
  defaultEmail: string;
  proposalNo: string;
  total: string;
  deposit: string;
  onSent: (updatedGen: Gen) => void;
  onClose: () => void;
}

export default function SendProposalModal({ genId, defaultEmail, proposalNo, total, deposit, onSent, onClose }: Props) {
  const [to,      setTo]      = useState(defaultEmail);
  const [subject, setSubject] = useState(`Your Generator Proposal — ${proposalNo}`);
  const [note,    setNote]    = useState('');
  const [status,  setStatus]  = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errMsg,  setErrMsg]  = useState('');

  const send = async () => {
    if (!to.trim()) return;
    setStatus('sending');
    try {
      const r = await api.post(`/gens/${genId}/send`, { to: to.trim(), subject, note, proposalNo, total, deposit });
      onSent(r.data.gen);
      setStatus('sent');
    } catch (e: any) {
      setErrMsg(e?.message || 'Failed to send');
      setStatus('error');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, width: 480, boxShadow: '0 8px 40px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: 'var(--navy, #1B3A6B)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="send" size={16} stroke={2} style={{ color: '#fff' }}/>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>Send Proposal</span>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', color: 'rgba(255,255,255,.7)', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={16} stroke={2}/>
          </button>
        </div>

        {status === 'sent' ? (
          <div style={{ padding: '40px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>Proposal Sent</div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>An email was delivered to <strong>{to}</strong></div>
            <button onClick={onClose} style={{ marginTop: 24, padding: '10px 28px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ padding: '20px 24px 24px' }}>
            <Field label="To (customer email)">
              <input type="email" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} placeholder="customer@email.com"/>
            </Field>
            <Field label="Subject">
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle}/>
            </Field>
            <Field label="Note (optional — shown in email body)">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder="e.g. Let me know if you have any questions!"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}/>
            </Field>

            {/* Proposal summary */}
            <div style={{ background: 'var(--surface2)', borderRadius: 9, padding: '12px 14px', marginBottom: 20, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text3)', fontWeight: 600 }}>Proposal</span>
                <span style={{ fontWeight: 700 }}>{proposalNo}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text3)', fontWeight: 600 }}>Total</span>
                <span style={{ fontWeight: 800, color: 'var(--accent)' }}>{total}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text3)', fontWeight: 600 }}>Deposit</span>
                <span style={{ fontWeight: 700 }}>{deposit}</span>
              </div>
            </div>

            {status === 'error' && (
              <div style={{ background: 'rgba(224,106,106,.12)', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 600 }}>
                {errMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '10px 20px', border: '1px solid var(--border2)', background: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--text2)' }}>
                Cancel
              </button>
              <button onClick={send} disabled={status === 'sending' || !to.trim()}
                style={{ padding: '10px 24px', background: 'var(--navy, #1B3A6B)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: status === 'sending' ? 'not-allowed' : 'pointer', opacity: status === 'sending' ? .7 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                {status === 'sending' ? 'Sending…' : <><Icon name="send" size={14} stroke={2} style={{ color: '#fff' }}/> Send Proposal</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '9px 11px', outline: 'none',
};
