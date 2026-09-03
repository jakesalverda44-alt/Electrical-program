import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

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

        {/* Accept & Sign — Task 3 mounts the signature canvas + typed name +
            Accept button here, replacing this placeholder once signed_at
            reads back on this bid. */}
        {bid?.proposal_signed_at ? (
          <div style={{ background: '#fff', border: '1px solid #d1fae5', borderRadius: 12, padding: '28px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
            <div style={{ fontWeight: 900, fontSize: 18, color: '#1e293b', marginBottom: 8 }}>Proposal Accepted</div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              Signed by {bid.signer_name || 'the customer'} on{' '}
              {new Date(bid.proposal_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
            </div>
          </div>
        ) : null}

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
