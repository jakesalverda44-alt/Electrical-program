import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { GenForm } from '../features/builder/genData';
import { GenTotals, genPriceRows } from '../features/builder/genCalc';

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

function esc(s: string) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

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
  const [cleared, setCleared] = useState(false);
  const sigRef = useRef<SignatureCanvas>(null);

  useEffect(() => {
    fetch(`${API}/gens/p/${token}`)
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
    const signatureData = sigRef.current.toDataURL('image/png');
    try {
      const res = await fetch(`${API}/gens/p/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureData }),
      });
      if (!res.ok) throw new Error();
      setStatus('signed');
      // Best-effort: snapshot a signed PDF into the job's files. Signing already
      // succeeded, so any failure here is non-fatal and silently ignored.
      if (gen) void saveSignedPdf(signatureData, gen);
    } catch {
      alert('Something went wrong. Please try again or contact us.');
    } finally {
      setSigning(false);
    }
  };

  // Render a self-contained signed copy, rasterize to a PDF, and upload it.
  // jspdf/html2canvas are loaded on demand so they never weigh down the main app.
  const saveSignedPdf = async (signatureData: string, g: GenData) => {
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
      const form = parseSnapshot<GenForm>(g.form_data);
      const totals = parseSnapshot<GenTotals>(g.totals_data);
      const addr = form ? [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ') : '';
      const node = document.createElement('div');
      node.style.cssText = 'position:fixed;left:-99999px;top:0;width:760px;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#1e293b;';
      node.innerHTML = `
        <div style="background:#1B3A6B;padding:20px 28px;">
          <div style="font-size:13px;color:#93C5FD;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Generator Proposal</div>
          <div style="font-size:22px;font-weight:900;color:#fff;">${esc(g.customer)}</div>
          ${g.proposal_no ? `<div style="font-size:12px;color:#93C5FD;margin-top:4px;">Proposal ${esc(g.proposal_no)}</div>` : ''}
        </div>
        <div style="padding:24px 28px;">
          ${form ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;background:#f8fafc;border:1px solid #e2e8f0;padding:14px;border-radius:8px;">
              <div><div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Attention</div><div style="font-size:13px;font-weight:700;">${esc(form.attn || g.customer)}</div></div>
              <div><div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Phone</div><div style="font-size:13px;font-weight:700;">${esc(form.phone || '—')}</div></div>
              <div><div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Email</div><div style="font-size:13px;font-weight:700;">${esc(form.email || '—')}</div></div>
              <div><div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Address</div><div style="font-size:13px;font-weight:700;">${esc(addr || '—')}</div></div>
            </div>
          ` : ''}
          <div style="display:flex;gap:32px;margin-bottom:24px;">
            <div><div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Generator</div><div style="font-size:15px;font-weight:800;">${esc(g.mfr)} ${g.kw}kW</div></div>
            <div><div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Model</div><div style="font-size:15px;font-weight:800;">${esc(g.model || '—')}</div></div>
            <div><div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Total</div><div style="font-size:22px;font-weight:800;color:#1B3A6B;">${money(g.amount || 0)}</div></div>
          </div>
          ${form && totals ? `
            <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-bottom:20px;">
              ${genPriceRows(form as GenForm, totals as GenTotals, money).map(r => `
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#475569;margin-bottom:6px;">
                  <span>${esc(r.label)}</span><strong>${esc(r.amount)}</strong>
                </div>
              `).join('')}
              ${Number(totals.discountAmt || 0) > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#b91c1c;margin-bottom:6px;"><span>Discount</span><strong>-${money(Number(totals.discountAmt))}</strong></div>` : ''}
              <div style="display:flex;justify-content:space-between;font-size:12px;color:#475569;margin-bottom:6px;"><span>Tax</span><strong>${money(Number(totals.tax || g.tax || 0))}</strong></div>
              <div style="display:flex;justify-content:space-between;font-size:18px;color:#1B3A6B;border-top:2px solid #1B3A6B;padding-top:10px;margin-top:10px;"><strong>Total</strong><strong>${money(Number(totals.total || g.amount || 0))}</strong></div>
            </div>
          ` : ''}
          <div style="font-size:13px;color:#64748b;line-height:1.7;border-top:1px solid #e2e8f0;padding-top:20px;">
            <p style="margin:0 0 12px;">Accurate Power &amp; Technology, Inc. proposes to furnish all labor and material necessary to complete this generator installation. Our price is in accordance with the <strong>2026 National Electrical Code</strong>. <strong>This proposal is valid for 30 days.</strong></p>
            <p style="margin:0;">By signing below, you acknowledge and agree to all terms and conditions of this proposal and the attached Sales Agreement, including the 50% deposit due at signing, non-refundability of the deposit, and all applicable disclosures.</p>
          </div>
          <div style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:20px;">
            <div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Accepted &amp; Signed</div>
            <img src="${signatureData}" style="height:90px;display:block;margin-bottom:6px;"/>
            <div style="font-size:13px;color:#1e293b;font-weight:700;">${esc(g.customer)}</div>
            <div style="font-size:12px;color:#64748b;">Signed ${esc(new Date().toLocaleString('en-US'))}</div>
          </div>
        </div>`;
      document.body.appendChild(node);
      try {
        const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' });
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
        const form = new FormData();
        form.append('file', pdf.output('blob'), `Signed Proposal - ${g.customer}.pdf`);
        await fetch(`${API}/gens/p/${token}/proposal-pdf`, { method: 'POST', body: form });
      } finally {
        node.remove();
      }
    } catch {
      /* non-fatal */
    }
  };

  if (status === 'loading') return <CenteredMsg>Loading your proposal…</CenteredMsg>;
  if (status === 'error')   return <CenteredMsg>Proposal not found or the link has expired. Please contact us.</CenteredMsg>;

  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  const form = parseSnapshot<GenForm>(gen?.form_data);
  const totals = parseSnapshot<GenTotals>(gen?.totals_data);
  const address = form ? [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ') : '';
  const priceRows = form && totals ? genPriceRows(form as GenForm, totals as GenTotals, fmt) : [];

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', fontFamily: 'Arial, sans-serif' }}>
      {/* Nav bar */}
      <div style={{ background: '#1B3A6B', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 17, color: '#fff' }}>Accurate Power &amp; Technology</div>
        <div style={{ height: 3, width: 40, background: '#D4AF37', borderRadius: 2, marginLeft: 4 }}/>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px 60px' }}>
        {/* Proposal card */}
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.08)', overflow: 'hidden', marginBottom: 28 }}>
          <div style={{ background: '#1B3A6B', padding: '20px 28px' }}>
            <div style={{ fontSize: 13, color: '#93C5FD', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Generator Proposal</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{gen?.customer}</div>
            {gen?.proposal_no && <div style={{ fontSize: 12, color: '#93C5FD', marginTop: 4 }}>Proposal {gen.proposal_no}</div>}
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
                this generator installation. Our price is in accordance with the <strong>2026 National Electrical Code</strong>.{' '}
                <strong>This proposal is valid for 30 days.</strong>
              </p>
              <p style={{ margin: 0 }}>
                By signing below, you acknowledge and agree to all terms and conditions of this proposal and the attached
                Sales Agreement, including the 50% deposit due at signing, non-refundability of the deposit, and all
                applicable disclosures.
              </p>
            </div>
          </div>
        </div>

        {/* Signature section */}
        {status === 'signed' ? (
          <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 12, padding: '28px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#166534', marginBottom: 6 }}>Proposal Accepted</div>
            <div style={{ fontSize: 14, color: '#166534' }}>
              Thank you, {gen?.customer}! We have received your signature and will be in touch shortly to schedule your installation.
            </div>
            <div style={{ marginTop: 20, fontSize: 13, color: '#4ade80' }}>
              Questions? Reply to the email we sent or call us directly.
            </div>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.08)', padding: '28px' }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#1e293b', marginBottom: 4 }}>Sign to Accept This Proposal</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              Draw your signature below using your mouse or finger, then click <strong>Accept &amp; Sign</strong>.
            </div>

            <div style={{ border: '2px solid #e2e8f0', borderRadius: 9, overflow: 'hidden', marginBottom: 14, background: '#fafafa' }}>
              <SignatureCanvas
                ref={sigRef}
                penColor="#1B3A6B"
                canvasProps={{ width: 700, height: 160, style: { width: '100%', height: 160, display: 'block' } }}
                onBegin={() => setCleared(false)}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => { sigRef.current?.clear(); setCleared(true); }}
                style={{ fontSize: 13, fontWeight: 600, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>
                Clear
              </button>
              <button onClick={handleSign} disabled={signing}
                style={{ background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: 9, padding: '12px 32px', fontWeight: 800, fontSize: 15, cursor: signing ? 'not-allowed' : 'pointer', opacity: signing ? .7 : 1 }}>
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
