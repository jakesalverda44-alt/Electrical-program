import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { GenForm } from '../features/builder/genData';
import { GenTotals, calcGenTotals, migrateGenForm } from '../features/builder/genCalc';
import ProposalPreview from '../features/builder/ProposalPreview';
import { buildContractPdf, signedContractFilename } from '../lib/signedContractPdf';

interface GenData {
  id: string;
  customer: string;
  mfr: string;
  model: string;
  kw: number;
  amount: number;
  tax: number;
  addons: number;
  stage: string;
  signed_at?: string;
  proposal_no?: string;
  form_data?: Partial<GenForm> | string | null;
  totals_data?: Partial<GenTotals> | string | null;
  signature_data?: string | null;
  initials_data?: string | null;
}

const API = import.meta.env.VITE_API_URL || '/api';

function parseSnapshot<T extends object>(raw: unknown): Partial<T> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Partial<T>; } catch { return null; }
  }
  return raw;
}

export default function ProposalPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [gen,    setGen]    = useState<GenData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'signed' | 'error'>('loading');
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const [cleared, setCleared] = useState(false);
  const [hasSig, setHasSig] = useState(false);
  const [hasInit, setHasInit] = useState(false);
  const [signedSig, setSignedSig] = useState<string | null>(null);
  const [signedInitials, setSignedInitials] = useState<string | null>(null);
  const [signedDate, setSignedDate] = useState<string>('');
  const sigRef = useRef<SignatureCanvas>(null);
  const initRef = useRef<SignatureCanvas>(null);
  const sigWrapRef = useRef<HTMLDivElement>(null);
  const contractRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // In-app previews pass ?preview=1 so the backend doesn't record a customer "view".
    const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
    fetch(`${API}/gens/p/${token}${isPreview ? '?preview=1' : ''}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        setGen(data);
        // Seed the marks from the stored record, not just from an in-session signing:
        // a customer reopening their link should see the executed contract, not a
        // blank one with an "accepted" banner over it.
        if (data.signed_at) {
          if (data.signature_data) setSignedSig(data.signature_data);
          if (data.initials_data) setSignedInitials(data.initials_data);
          setSignedDate(new Date(data.signed_at).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          }));
        }
        setStatus(data.signed_at ? 'signed' : 'ready');
      })
      .catch(() => setStatus('error'));
  }, [token]);

  const handleSign = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) return;
    if (!initRef.current || initRef.current.isEmpty()) return;
    setSigning(true);
    setSignError('');
    const signatureData = sigRef.current.toDataURL('image/png');
    const initialsData = initRef.current.toDataURL('image/png');
    try {
      const res = await fetch(`${API}/gens/p/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureData, initialsData }),
      });
      if (!res.ok) throw new Error();
      // Embed the signature and initials into the on-page contract, let it paint, then
      // rasterize the FULL signed sales agreement to a PDF and archive it to the job's
      // Drive folder.
      const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      setSignedSig(signatureData);
      setSignedInitials(initialsData);
      setSignedDate(today);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      await saveSignedPdf();
      setStatus('signed');
    } catch {
      setSignError('Something went wrong. Please try again or call us directly.');
    } finally {
      setSigning(false);
    }
  };

  // Rasterize the full signed contract (already rendered on the page) and upload it.
  // Non-fatal: signing itself already succeeded server-side, so a failure here must not
  // block the customer. But it is NOT silent — this runs on the buyer's phone, where an
  // 8-page rasterize can exhaust memory or lose the tab, and a swallowed error meant the
  // job quietly ended up with no archived contract and nobody knew. The report lets the
  // rep see it, and they can rebuild the identical PDF from the gen card.
  const saveSignedPdf = async () => {
    if (!contractRef.current) return;
    try {
      const blob = await buildContractPdf(contractRef.current);
      const fd = new FormData();
      fd.append('file', blob, signedContractFilename(gen?.customer ?? ''));
      const res = await fetch(`${API}/gens/p/${token}/proposal-pdf`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
    } catch (err) {
      reportArchiveFailure(err);
    }
  };

  // Best-effort telemetry for the case above. Deliberately swallows its own errors:
  // if we cannot even report the failure, there is nothing further to do, and the
  // customer must not see an error on a signing that actually worked.
  const reportArchiveFailure = (err: unknown) => {
    try {
      fetch(`${API}/gens/p/${token}/archive-failed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: err instanceof Error ? err.message : String(err) }),
      }).catch(() => {});
    } catch { /* nothing left to try */ }
  };

  if (status === 'loading') return <CenteredMsg>Loading your proposal…</CenteredMsg>;
  if (status === 'error')   return <CenteredMsg>Proposal not found or the link has expired. Please contact us.</CenteredMsg>;

  const rawForm = parseSnapshot<GenForm>(gen?.form_data);
  // Older sent/signed proposals used pre-unification field names (ats/smm/surgePro/lcATS/
  // additionalATS) — migrate so those scope-of-work lines still render correctly if a
  // customer revisits an old link.
  const form = rawForm ? migrateGenForm(rawForm as unknown as Record<string, unknown>) as unknown as Partial<GenForm> : null;
  // Older/legacy proposals may lack a stored totals snapshot — recompute from the form
  // so the full multi-page document still renders for the customer.
  const totals = parseSnapshot<GenTotals>(gen?.totals_data)
    ?? (form ? calcGenTotals(form as GenForm) : null);

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
      {/* Nav bar */}
      <div style={{ background: '#1B3A6B', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <img src="/apt-logo.png" alt="APT" style={{ height: 36, borderRadius: 6, background: '#fff', padding: '3px 6px', objectFit: 'contain' }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}/>
        <div>
          <div style={{ fontWeight: 900, fontSize: 15, color: '#fff', lineHeight: 1.2 }}>Accurate Power &amp; Technology</div>
          <div style={{ fontSize: 11, color: '#93C5FD', fontWeight: 600 }}>Licensed Electrical Contractor · EC13007737</div>
        </div>
      </div>

      <div className="ppp-outer" style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px 60px' }}>
        {/* Full proposal document — exactly what prints to PDF: cover, scope, signature
            blocks, sales agreement, disclosures, spec sheet, and the price breakdown only
            when the rep enabled it on the proposal. */}
        {/* Full sales contract — the actual document the customer is signing */}
        {form && totals && gen && (
          <div ref={contractRef} style={{ marginBottom: 28, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.08)', background: '#fff' }}>
            <ProposalPreview
              embed
              form={form as GenForm}
              totals={totals as GenTotals}
              proposalNo={gen.proposal_no || ''}
              signatureImage={signedSig ?? undefined}
              initialsImage={signedInitials ?? undefined}
              signedDate={signedDate || undefined}
            />
          </div>
        )}

        {/* Signature section */}
        {status === 'signed' ? (
          <div style={{ background: '#fff', border: '1px solid #d1fae5', borderRadius: 12, padding: '36px 28px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 26 }}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#1e293b', marginBottom: 8 }}>Proposal Accepted</div>
            <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, maxWidth: 400, margin: '0 auto' }}>
              Thank you, {gen?.customer}. We have received your signature and will be in touch shortly to schedule your installation.
            </div>
            <div style={{ marginTop: 20, fontSize: 13, color: '#64748b', paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
              Questions? Reply to our email or call us directly.
            </div>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.08)', padding: '28px' }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#1e293b', marginBottom: 4 }}>Sign to Accept This Proposal</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              Draw your signature and your initials below, then click <strong>Accept &amp; Sign</strong>.
              Your initials are applied to each page of the agreement that calls for them.
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Signature</div>
            <div ref={sigWrapRef} style={{ border: '2px solid #e2e8f0', borderRadius: 9, overflow: 'hidden', marginBottom: 16, background: '#fafafa' }}>
              <SignatureCanvas
                ref={sigRef}
                penColor="#1B3A6B"
                canvasProps={{ style: { width: '100%', height: 160, display: 'block' } }}
                onBegin={() => { setCleared(false); setSignError(''); }}
                onEnd={() => setHasSig(!sigRef.current?.isEmpty())}
              />
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Initials</div>
            <div style={{ border: '2px solid #e2e8f0', borderRadius: 9, overflow: 'hidden', marginBottom: 14, background: '#fafafa', maxWidth: 220 }}>
              <SignatureCanvas
                ref={initRef}
                penColor="#1B3A6B"
                canvasProps={{ style: { width: '100%', height: 90, display: 'block' } }}
                onBegin={() => { setSignError(''); }}
                onEnd={() => setHasInit(!initRef.current?.isEmpty())}
              />
            </div>

            {signError && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#991b1b', fontWeight: 600 }}>
                {signError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => {
                  sigRef.current?.clear(); initRef.current?.clear();
                  setHasSig(false); setHasInit(false);
                  setCleared(true); setSignError('');
                }}
                style={{ fontSize: 13, fontWeight: 600, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>
                Clear
              </button>
              {/* Both marks are required: signing with an empty initials box would leave
                  every "CUST INT" line on the agreement blank, which is the exact gap
                  that sent people back to printing and wet-signing. */}
              <button onClick={handleSign} disabled={signing || !hasSig || !hasInit}
                title={!hasSig || !hasInit ? 'Draw both your signature and your initials' : undefined}
                style={{ background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: 9, padding: '12px 32px', fontWeight: 800, fontSize: 15, cursor: (signing || !hasSig || !hasInit) ? 'not-allowed' : 'pointer', opacity: (signing || !hasSig || !hasInit) ? .55 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
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
