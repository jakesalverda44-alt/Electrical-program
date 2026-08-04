// Your saved signature, used to countersign contracts.
//
// Stored per user rather than as a company setting: the mark belongs to whoever signs,
// and the proposal copies the image at countersign time, so re-drawing it here never
// alters a contract that was already executed.
import React, { useEffect, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import api from '../../../api/client';
import { SectionTitle } from '../shared';

export function SignatureSection() {
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<SignatureCanvas>(null);

  useEffect(() => {
    api.get<{ signature_data?: string | null }>('/users/me')
      .then(r => setSaved(r.data.signature_data ?? null))
      .catch(() => setSaved(null))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!ref.current || ref.current.isEmpty()) return;
    setBusy(true);
    setError('');
    try {
      const signature_data = ref.current.toDataURL('image/png');
      await api.patch('/users/me/signature', { signature_data });
      setSaved(signature_data);
      setDrawing(false);
      setHasInk(false);
    } catch {
      setError("Couldn't save your signature. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionTitle title="My Signature"
        sub="Used to countersign contracts a customer has signed. Draw it once and it is applied with a single tap."/>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</div>
      ) : (
        <>
          {saved && !drawing && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: 14, background: '#fff', display: 'inline-block' }}>
                <img src={saved} alt="Your saved signature" style={{ height: 60, maxWidth: 320, objectFit: 'contain', display: 'block' }}/>
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="btn ghost" onClick={() => { setDrawing(true); setHasInk(false); }}>Replace signature</button>
              </div>
            </div>
          )}

          {(!saved || drawing) && (
            <div style={{ maxWidth: 520 }}>
              <div style={{ border: '2px solid var(--border2)', borderRadius: 10, overflow: 'hidden', background: '#fff', marginBottom: 12 }}>
                <SignatureCanvas
                  ref={ref}
                  penColor="#1B3A6B"
                  canvasProps={{ style: { width: '100%', height: 170, display: 'block' } }}
                  onEnd={() => setHasInk(!ref.current?.isEmpty())}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" onClick={() => { ref.current?.clear(); setHasInk(false); }}>Clear</button>
                <button className="btn" onClick={save} disabled={!hasInk || busy}>
                  {busy ? 'Saving…' : 'Save signature'}
                </button>
                {saved && (
                  <button className="btn ghost" onClick={() => { setDrawing(false); setHasInk(false); }}>Cancel</button>
                )}
              </div>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 12, fontSize: 13, color: '#b91c1c', fontWeight: 600 }}>{error}</div>
          )}

          {!saved && !drawing && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text3)' }}>
              No signature saved yet — you will not be able to countersign until there is one.
            </div>
          )}
        </>
      )}
    </div>
  );
}
