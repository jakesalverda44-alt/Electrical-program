import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { GenForm } from '../features/builder/genData';
import { GenTotals, genPriceRows, calcGenTotals } from '../features/builder/genCalc';
import ProposalPreview from '../features/builder/ProposalPreview';

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
  const [signedSig, setSignedSig] = useState<string | null>(null);
  const [signedDate, setSignedDate] = useState<string>('');
  const sigRef = useRef<SignatureCanvas>(null);
  const sigWrapRef = useRef<HTMLDivElement>(null);
  const contractRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // In-app previews pass ?preview=1 so the backend doesn't record a customer "view".
    const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
    fetch(`${API}/gens/p/${token}${isPreview ? '?preview=1' : ''}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        setGen(data);
        setStatus(data.signed_at ? 'signed' : 'ready');
      })
      .catch(() => setStatus('error'));
  }, [token]);

  const handleSign = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) return;
    setSigning(true);
    setSignError('');
    const signatureData = sigRef.current.toDataURL('image/png');
    try {
      const res = await fetch(`${API}/gens/p/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureData }),
      });
      if (!res.ok) throw new Error();
      // Embed the signature into the on-page contract, let it paint, then rasterize
      // the FULL signed sales agreement to a PDF and archive it to the job's Drive folder.
      const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      setSignedSig(signatureData);
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

  // Rasterize the full signed contract (already rendered on the page) to a multi-page
  // PDF and upload it. jspdf/html2canvas load on demand. Non-fatal on failure —
  // signing itself already succeeded server-side.
  const saveSignedPdf = async () => {
    if (!contractRef.current) return;
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(contractRef.current, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true });
      const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = canvas.height * (pageW / canvas.width);
      const imgData = canvas.toDataURL('image/png');
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH);
        heightLeft -= pageH;
      }
      const fd = new FormData();
      fd.append('file', pdf.output('blob'), `Signed Contract - ${gen?.customer ?? 'Customer'}.pdf`);
      await fetch(`${API}/gens/p/${token}/proposal-pdf`, { method: 'POST', body: fd });
    } catch {
      /* non-fatal */
    }
  };

  if (status === 'loading') return <CenteredMsg>Loading your proposal…</CenteredMsg>;
  if (status === 'error')   return <CenteredMsg>Proposal not found or the link has expired. Please contact us.</CenteredMsg>;

  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  const form = parseSnapshot<GenForm>(gen?.form_data);
  // Older/legacy proposals may lack a stored totals snapshot — recompute from the form
  // so the full multi-page document still renders for the customer.
  const totals = parseSnapshot<GenTotals>(gen?.totals_data)
    ?? (form ? calcGenTotals(form as GenForm) : null);
  const address = form ? [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ') : '';
  const priceRows = form && totals ? genPriceRows(form as GenForm, totals as GenTotals, fmt) : [];

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

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px 60px' }}>
        {/* Proposal card */}
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.08)', overflow: 'hidden', marginBottom: 28 }}>
          <div style={{ background: '#1B3A6B', padding: '20px 28px' }}>
            <div style={{ fontSize: 13, color: '#C9A84C', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Generator Proposal</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{gen?.customer}</div>
            {gen?.proposal_no && <div style={{ fontSize: 12, color: '#C9A84C', marginTop: 4 }}>Proposal {gen.proposal_no}</div>}
          </div>
          <div style={{ padding: '24px 28px' }}>
            {form && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: 14 }}>
                <InfoBlock label="Attention" value={form.attn || gen?.customer || '—'}/>
                <InfoBlock label="Phone" value={form.phone || '—'}/>
                <InfoBlock label="Email" value={form.email || '—'}/>
                <InfoBlock label="Address" value={address || '—'}/>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>
              <InfoBlock label="Generator" value={`${gen?.mfr} ${gen?.kw}kW`}/>
              <InfoBlock label="Model" value={gen?.model || '—'}/>
              <InfoBlock label="Total" value={fmt(gen?.amount || 0)} accent/>
            </div>
            {priceRows.length > 0 && (
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginBottom: 20 }}>
                {priceRows.map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#475569', marginBottom: 7 }}>
                    <span>{r.label}</span>
                    <strong>{r.amount}</strong>
                  </div>
                ))}
                {!!Number(totals?.discountAmt || 0) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#b91c1c', marginBottom: 7 }}>
                    <span>Discount</span>
                    <strong>-{fmt(Number(totals?.discountAmt))}</strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#475569', marginBottom: 7 }}>
                  <span>Tax</span>
                  <strong>{fmt(Number(totals?.tax || gen?.tax || 0))}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, color: '#1B3A6B', borderTop: '2px solid #1B3A6B', paddingTop: 10, marginTop: 10 }}>
                  <strong>Total</strong>
                  <strong>{fmt(Number(totals?.total || gen?.amount || 0))}</strong>
                </div>
              </div>
            )}
            <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
              <p style={{ margin: '0 0 12px' }}>
                Accurate Power &amp; Technology, Inc. proposes to furnish all labor and material necessary to complete
                this generator installation. Our price is in accordance with the <strong>{new Date().getFullYear()} National Electrical Code</strong>.{' '}
                <strong>This proposal is valid for {(form as Partial<GenForm>)?.validDays ?? 30} days.</strong>
              </p>
              <p style={{ margin: 0 }}>
                By signing below, you acknowledge and agree to all terms and conditions of this proposal and the attached
                Sales Agreement, including the {(form as Partial<GenForm>)?.depositPct ?? 50}% deposit due at signing, non-refundability of the deposit, and all
                applicable disclosures.
              </p>
            </div>
          </div>
        </div>

        {/* Full sales contract — the actual document the customer is signing */}
        {form && totals && gen && (
          <div ref={contractRef} style={{ marginBottom: 28, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.08)', background: '#fff' }}>
            <ProposalPreview
              embed
              form={form as GenForm}
              totals={totals as GenTotals}
              proposalNo={gen.proposal_no || ''}
              signatureImage={signedSig ?? undefined}
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
              Draw your signature below using your mouse or finger, then click <strong>Accept &amp; Sign</strong>.
            </div>

            <div ref={sigWrapRef} style={{ border: '2px solid #e2e8f0', borderRadius: 9, overflow: 'hidden', marginBottom: 14, background: '#fafafa' }}>
              <SignatureCanvas
                ref={sigRef}
                penColor="#1B3A6B"
                canvasProps={{ style: { width: '100%', height: 160, display: 'block' } }}
                onBegin={() => { setCleared(false); setSignError(''); }}
              />
            </div>

            {signError && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#991b1b', fontWeight: 600 }}>
                {signError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => { sigRef.current?.clear(); setCleared(true); setSignError(''); }}
                style={{ fontSize: 13, fontWeight: 600, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>
                Clear
              </button>
              <button onClick={handleSign} disabled={signing}
                style={{ background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: 9, padding: '12px 32px', fontWeight: 800, fontSize: 15, cursor: signing ? 'not-allowed' : 'pointer', opacity: signing ? .7 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
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

function InfoBlock({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: accent ? 22 : 15, fontWeight: 800, color: accent ? '#1B3A6B' : '#1e293b' }}>{value}</div>
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
