import React, { useState } from 'react';
import api from '../../api/client';
import { Bid } from '../../types';
import Icon from '../../components/Icon';

interface Props {
  bid: Bid;
  onSent: (result: { bid: Bid; wonJob: unknown; stageAdvanced: boolean; link: string }) => void;
  onClose: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function defaultSubject(bid: Bid): string {
  const project = (bid.name || '').trim() || 'Project';
  const loc = (bid.loc || '').trim() || 'Location';
  return `${project} – ${loc} | Electrical Proposal`;
}

function defaultBodyText(bid: Bid): string {
  const project = (bid.name || '').trim() || 'the project';
  const loc = (bid.loc || '').trim();
  return `Hey,\n\nPlease find attached our electrical proposal for the ${project}${loc ? ` at ${loc}` : ''}.\nLet us know if you have any clarifications.`;
}

// Phase 4 Task 1.4 — mirrors SendProposalModal.tsx's (gens) UX for the
// electrical Send Proposal flow: prefilled recipient, editable subject/body,
// include-takeoff checkbox (off by default per the authority template's
// rule), explicit Send button with busy state.
export default function SendBidProposalModal({ bid, onSent, onClose }: Props) {
  const prefill = bid.contact && EMAIL_RE.test(bid.contact.trim()) ? bid.contact.trim() : '';
  const [to,      setTo]      = useState(prefill);
  const [cc,      setCc]      = useState('');
  const [subject, setSubject] = useState(defaultSubject(bid));
  const [bodyText, setBodyText] = useState(defaultBodyText(bid));
  const [includeTakeoff, setIncludeTakeoff] = useState(false);
  const [status,  setStatus]  = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errMsg,  setErrMsg]  = useState('');
  const [sentTo,  setSentTo]  = useState('');
  const [stageAdvanced, setStageAdvanced] = useState(false);

  const parseList = (v: string) => v.split(/[,;]/).map(s => s.trim()).filter(Boolean);

  const send = async () => {
    const toList = parseList(to);
    if (!toList.length) return;
    setStatus('sending');
    setErrMsg('');
    try {
      const r = await api.post(`/bids/${bid.id}/send-proposal`, {
        to: toList,
        cc: parseList(cc),
        subject,
        bodyText,
        includeTakeoff,
      });
      setSentTo(toList[0]);
      setStageAdvanced(!!r.data.stageAdvanced);
      onSent({ bid: r.data.bid, wonJob: r.data.wonJob, stageAdvanced: !!r.data.stageAdvanced, link: r.data.link });
      setStatus('sent');
    } catch (e: any) {
      setErrMsg(e?.response?.data?.error || e?.message || 'Failed to send');
      setStatus('error');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,.25)' }}>
        <div style={{ background: 'var(--navy, #1B3A6B)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="send" size={16} stroke={2} style={{ color: '#fff' }}/>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>Send Proposal to GC</span>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', color: 'rgba(255,255,255,.7)', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={16} stroke={2}/>
          </button>
        </div>

        {status === 'sent' ? (
          <div style={{ padding: '40px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>Proposal Sent</div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>An email was delivered to <strong>{sentTo}</strong></div>
            {stageAdvanced && (
              <div style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 700, marginTop: 8 }}>Stage advanced to Submitted</div>
            )}
            <button onClick={onClose} style={{ marginTop: 24, padding: '10px 28px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ padding: '20px 24px 24px' }}>
            <Field label="To (GC email — comma-separated for multiple)">
              <input type="text" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} placeholder="bids@generalcontractor.com"/>
            </Field>
            <Field label="Cc (optional)">
              <input type="text" value={cc} onChange={e => setCc(e.target.value)} style={inputStyle} placeholder="you@accuratepower.com"/>
            </Field>
            <Field label="Subject">
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle}/>
            </Field>
            <Field label="Message">
              <textarea value={bodyText} onChange={e => setBodyText(e.target.value)} rows={5}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}/>
            </Field>
            <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 16 }}>
              The public proposal link and Jake&apos;s signature are added automatically below your message.
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
              <input type="checkbox" checked={includeTakeoff}
                onChange={e => setIncludeTakeoff(e.target.checked)}
                style={{ accentColor: 'var(--green)', width: 16, height: 16 }}/>
              Include takeoff spreadsheet
              <span style={{ fontWeight: 500, color: 'var(--text3)' }}>(only if the GC asked for it)</span>
            </label>

            {status === 'error' && (
              <div style={{ background: 'rgba(224,106,106,.12)', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 600 }}>
                {errMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '10px 20px', border: '1px solid var(--border2)', background: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--text2)' }}>
                Cancel
              </button>
              <button onClick={send} disabled={status === 'sending' || !parseList(to).length}
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
