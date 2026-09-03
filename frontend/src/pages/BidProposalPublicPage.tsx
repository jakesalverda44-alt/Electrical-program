import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';

interface PublicBid {
  id: string;
  name: string;
  gc: string;
  stage: string;
  proposal_token: string;
  proposal_sent_at?: string | null;
  proposal_viewed_at?: string | null;
  proposal_signed_at?: string | null;
  signer_name?: string | null;
}

const API = import.meta.env.VITE_API_URL || '/api';

// Phase 4 Task 2.4 — the public electrical proposal page: no auth, no app
// chrome. Renders the server-composed HTML (same BidData the .docx renders
// from — see backend/src/bidstd/proposalHtml.ts), a Download button for the
// exact filed .docx, and the Accept & Sign section (Task 3). Route `/bp/:token`
// — distinct from the generator pipeline's `/p/:token` (ProposalPublicPage.tsx).
export default function BidProposalPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [bid, setBid] = useState<PublicBid | null>(null);
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [downloading, setDownloading] = useState(false);
  // Phase 4 Task 3.3 — Accept & Sign.
  const [signerName, setSignerName] = useState('');
  const [hasSig, setHasSig] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const sigRef = useRef<SignatureCanvas>(null);

  useEffect(() => {
    // In-app previews pass ?preview=1 so the backend doesn't record a customer "view".
    const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
    fetch(`${API}/bids/p/${token}${isPreview ? '?preview=1' : ''}`)
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || 'Proposal not found');
        return body as { bid: PublicBid; html: string; fromFallback: boolean };
      })
      .then(data => {
        setBid(data.bid);
        setHtml(data.html);
        setStatus('ready');
      })
      .catch(err => {
        setErrorMsg(err instanceof Error ? err.message : 'Proposal not found');
        setStatus('error');
      });
  }, [token]);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API}/bids/p/${token}/download`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] || `Proposal — ${bid?.name || 'APT'}.docx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Best-effort — the estimator can regenerate/resend if this fails.
    } finally {
      setDownloading(false);
    }
  };

  const handleSign = async () => {
    if (!sigRef.current || sigRef.current.isEmpty() || !signerName.trim()) return;
    setSigning(true);
    setSignError('');
    try {
      const signatureDataUrl = sigRef.current.toDataURL('image/png');
      const res = await fetch(`${API}/bids/p/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerName: signerName.trim(), signatureDataUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Something went wrong. Please try again.');
      setBid(body.bid as PublicBid);
    } catch (err) {
      setSignError(err instanceof Error ? err.message : 'Something went wrong. Please try again or call us directly.');
    } finally {
      setSigning(false);
    }
  };

  if (status === 'loading') return <CenteredMsg>Loading your proposal…</CenteredMsg>;
  if (status === 'error') return <CenteredMsg>{errorMsg || 'Proposal not found or the link has expired. Please contact us.'}</CenteredMsg>;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
      <div style={{ background: '#1B3A6B', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 15, color: '#fff', lineHeight: 1.2 }}>Accurate Power &amp; Technology</div>
          <div style={{ fontSize: 11, color: '#93C5FD', fontWeight: 600 }}>Licensed Electrical Contractor · EC13007737</div>
        </div>
        <button onClick={download} disabled={downloading}
          style={{ background: '#fff', color: '#1B3A6B', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? .7 : 1 }}>
          {downloading ? 'Preparing…' : 'Download .docx'}
        </button>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px 60px' }}>
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.08)', overflow: 'hidden', marginBottom: 24 }}>
          {/* Server-rendered HTML — the exact same composed BidData the .docx
              renders from (backend/src/bidstd/proposalHtml.ts). */}
          <div dangerouslySetInnerHTML={{ __html: html }}/>
        </div>

        {/* Accept & Sign (Task 3) — signature canvas + typed name + Accept
            button; a page revisit renders the already-signed confirmation
            state straight from the API response (proposal_signed_at). */}
        {bid?.proposal_signed_at ? (
          <div style={{ background: '#fff', border: '1px solid #d1fae5', borderRadius: 12, padding: '28px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div style={{ fontWeight: 900, fontSize: 18, color: '#1e293b', marginBottom: 8 }}>Proposal Accepted</div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              Signed by {bid.signer_name || 'the customer'} on{' '}
              {new Date(bid.proposal_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
            </div>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.08)', padding: '28px' }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#1e293b', marginBottom: 4 }}>Sign to Accept This Proposal</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              Type your name, draw your signature below, then click <strong>Accept &amp; Sign</strong>.
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Your Name</div>
            <input type="text" value={signerName} onChange={e => setSignerName(e.target.value)}
              placeholder="Full name"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '10px 12px', border: '2px solid #e2e8f0', borderRadius: 9, marginBottom: 16, outline: 'none' }}/>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Signature</div>
            <div style={{ border: '2px solid #e2e8f0', borderRadius: 9, overflow: 'hidden', marginBottom: 14, background: '#fafafa' }}>
              <SignatureCanvas
                ref={sigRef}
                penColor="#1B3A6B"
                canvasProps={{ style: { width: '100%', height: 160, display: 'block' } }}
                onBegin={() => setSignError('')}
                onEnd={() => setHasSig(!sigRef.current?.isEmpty())}
              />
            </div>

            {signError && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#991b1b', fontWeight: 600 }}>
                {signError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => { sigRef.current?.clear(); setHasSig(false); setSignError(''); }}
                style={{ fontSize: 13, fontWeight: 600, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>
                Clear
              </button>
              <button onClick={handleSign} disabled={signing || !hasSig || !signerName.trim()}
                title={!signerName.trim() ? 'Enter your name' : !hasSig ? 'Draw your signature' : undefined}
                style={{ background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: 9, padding: '12px 32px', fontWeight: 800, fontSize: 15, cursor: (signing || !hasSig || !signerName.trim()) ? 'not-allowed' : 'pointer', opacity: (signing || !hasSig || !signerName.trim()) ? .55 : 1 }}>
                {signing ? 'Saving…' : 'Accept & Sign'}
              </button>
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: '#94a3b8' }}>
          Accurate Power &amp; Technology, Inc. · EC13007737 · CFC1430965 · LI45063
        </div>
      </div>
    </div>
  );
}

function CenteredMsg({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f9', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ maxWidth: 420, textAlign: 'center', padding: 32, color: '#64748b', fontSize: 15, lineHeight: 1.6 }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>📄</div>
        {children}
        <div style={{ marginTop: 20, fontSize: 13 }}>Accurate Power &amp; Technology · EC13007737</div>
      </div>
    </div>
  );
}
