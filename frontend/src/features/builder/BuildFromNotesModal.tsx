import React, { useState } from 'react';
import Icon from '../../components/Icon';
import { Gen } from '../../types';
import api from '../../api/client';

interface Props {
  genId: string;
  onClose: () => void;
  onSuccess: (updatedGen: Gen) => void;
}

type Status = 'idle' | 'loading' | 'error';

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1100, padding: 20,
};
const MODAL: React.CSSProperties = {
  background: 'var(--surface)', borderRadius: 14,
  width: '100%', maxWidth: 520,
  boxShadow: '0 24px 64px rgba(0,0,0,.35)',
  overflow: 'hidden',
};
const HDR: React.CSSProperties = {
  background: 'var(--navy, #1B3A6B)', color: '#fff',
  padding: '16px 20px', display: 'flex', alignItems: 'center',
  justifyContent: 'space-between',
};
const BODY: React.CSSProperties = { padding: '20px 22px' };
const TEXTAREA: React.CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 13, fontWeight: 500,
  color: 'var(--text)', background: 'var(--surface)',
  border: '1px solid var(--border2)', borderRadius: 9,
  padding: '11px 14px', outline: 'none', boxSizing: 'border-box',
  resize: 'vertical', minHeight: 160,
};

export default function BuildFromNotesModal({ genId, onClose, onSuccess }: Props) {
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleGenerate = async () => {
    if (!notes.trim()) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const { data } = await api.post<Gen>(`/gens/${genId}/build-from-notes`, { notes });
      onSuccess(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || 'Something went wrong. Please try again.';
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  return (
    <div style={OVERLAY} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div style={MODAL}>
        <div style={HDR}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: .7, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>
              AI Proposal Builder
            </div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Build from Site Notes</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.7)', padding: 4 }}>
            <Icon name="x" size={18} stroke={2}/>
          </button>
        </div>

        <div style={BODY}>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 14px', lineHeight: 1.55 }}>
            Paste your site visit notes below. Claude will extract the generator specs and automatically populate the proposal form.
          </p>
          <textarea
            style={TEXTAREA}
            placeholder="e.g. Customer wants a 22KW Generac, natural gas, new install on back left of house. Long driveway — lull needed to set unit. Include SMM plan and surge pro. Customer email: john@example.com"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={status === 'loading'}
          />

          {status === 'error' && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(224,106,106,.1)', border: '1px solid rgba(224,106,106,.3)', fontSize: 13, color: '#E06A6A', fontWeight: 600 }}>
              {errorMsg}
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onClose} disabled={status === 'loading'} style={{ fontSize: 13 }}>
              Cancel
            </button>
            <button
              className="btn"
              onClick={handleGenerate}
              disabled={!notes.trim() || status === 'loading'}
              style={{ fontSize: 13, background: 'var(--navy, #1B3A6B)', borderColor: 'var(--navy, #1B3A6B)', color: '#fff', minWidth: 160 }}
            >
              {status === 'loading' ? (
                <>
                  <span style={{ opacity: .7 }}>Generating…</span>
                </>
              ) : (
                <>
                  <Icon name="bolt" size={14} stroke={2}/>Generate Proposal
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
