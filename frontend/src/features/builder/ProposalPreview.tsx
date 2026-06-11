import React, { useRef, useState } from 'react';
import { GenForm } from './genData';
import { GenTotals, genPriceRows, genModelNo, loadCenterFor } from './genCalc';
import { GEN_SPEC_DETAIL } from './genData';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import api from '../../api/client';

function fmt(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }
function fmtDec(n: number) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const NAVY   = '#0F2044';
const ACCENT = '#2563EB';
const GOLD   = '#C9A84C';
const GRAY_D = '#1F2937';
const GRAY_M = '#6B7280';
const GRAY_L = '#F3F4F6';
const BLUE_L = '#EFF6FF';
const BLUE_M = '#DBEAFE';

interface Props {
  form: GenForm;
  totals: GenTotals;
  proposalNo: string;
  onBack?: () => void;
  appSettings?: AppSettings;
  genId?: string;
  /** Embed mode: render only the document (no toolbar/back/print) — used by the public signing page. */
  embed?: boolean;
  /** Customer signature image (data URL). When present, the signature block shows it. */
  signatureImage?: string;
  /** Date the customer signed (display string). */
  signedDate?: string;
}

// ── Shared layout helpers ────────────────────────────────────────────────────

function PageHeader({ proposalNo, companyName, phone, licLine }: { proposalNo: string; companyName: string; phone?: string; licLine?: string }) {
  return (
    <div style={{ background: NAVY, padding: '10px 20px 0', marginBottom: 0, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', letterSpacing: '-0.3px' }}>
            {companyName}
          </div>
          {phone && (
            <div style={{ fontSize: 9.5, color: '#93C5FD', marginTop: 2 }}>{phone}</div>
          )}
          {licLine && (
            <div style={{ fontSize: 9, color: '#4A6A8A', marginTop: 1 }}>{licLine}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 8, color: '#4A6A8A', textTransform: 'uppercase', letterSpacing: '.08em' }}>Proposal No.</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', marginTop: 1 }}>{proposalNo}</div>
        </div>
      </div>
      <div style={{ height: 3, background: GOLD, marginLeft: -20, marginRight: -20 }}/>
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <>
      <div style={{ fontSize: 18, fontWeight: 900, color: NAVY, textAlign: 'center', marginTop: 20, marginBottom: 4 }}>{title}</div>
      <div style={{ height: 2, background: ACCENT, marginBottom: 14 }}/>
    </>
  );
}

function SigBlock({ signatureImage, signedDate, buyerName }: { signatureImage?: string; signedDate?: string; buyerName?: string }) {
  const line = { height: 1, background: '#D1D5DB', marginBottom: 4 };
  const lbl = { fontSize: 9, color: GRAY_M, fontWeight: 600 as const };
  const cell: React.CSSProperties = { padding: '8px 12px', flex: 1 };
  return (
    <div style={{ display: 'flex', background: GRAY_L, border: '1px solid #E5E7EB' }}>
      <div style={cell}>
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6 }}>"APT" Accurate Power Technology, Inc.</div>
        <div style={line}/>
        <div style={lbl}>By: Authorized Representative</div>
        <div style={{ height: 10 }}/>
        <div style={line}/>
        <div style={lbl}>Date</div>
      </div>
      <div style={{ width: 1, background: '#E5E7EB' }}/>
      <div style={cell}>
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6 }}>"BUYER"</div>
        {/* Buyer printed name */}
        <div style={{ minHeight: 14 }}>{buyerName && <span style={{ fontSize: 11, fontWeight: 700, color: GRAY_D }}>{buyerName}</span>}</div>
        <div style={line}/>
        <div style={lbl}>Name</div>
        <div style={{ height: 10 }}/>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            {/* Captured signature image, when signed */}
            {signatureImage
              ? <img src={signatureImage} alt="Buyer signature" style={{ height: 34, maxWidth: '100%', objectFit: 'contain', display: 'block', marginBottom: 2 }}/>
              : <div style={{ height: 34 }}/>}
            <div style={line}/>
            <div style={lbl}>Signature</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ minHeight: 34, display: 'flex', alignItems: 'flex-end' }}>
              {signedDate && <span style={{ fontSize: 10, color: GRAY_D, marginBottom: 2 }}>{signedDate}</span>}
            </div>
            <div style={line}/>
            <div style={lbl}>Date</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Clause helpers ───────────────────────────────────────────────────────────
function Clause({ num, label, text }: { num: string; label: string; text: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 9, fontSize: 9, lineHeight: '14px', color: GRAY_D, textAlign: 'justify' }}>
      <span style={{ textDecoration: 'underline', fontWeight: 700 }}>{num}. {label}.</span>{'  '}{text}
    </div>
  );
}
function SubClause({ label, text }: { label: string; text: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8, fontSize: 9, lineHeight: '14px', color: GRAY_D, textAlign: 'justify', paddingLeft: 18 }}>
      <span style={{ textDecoration: 'underline', fontWeight: 700 }}>{label}.</span>{'  '}{text}
    </div>
  );
}

// ── Spec table helper ────────────────────────────────────────────────────────
function SpecTable({ header, rows }: { header: string; rows: [string, string, string, string][] }) {
  const thStyle: React.CSSProperties = { background: NAVY, color: '#fff', fontSize: 9, fontWeight: 700, padding: '5px 8px', textAlign: 'left' };
  const labelCell: React.CSSProperties = { fontSize: 8.5, fontWeight: 700, color: GRAY_M, padding: '4px 8px', width: '22%' };
  const valCell: React.CSSProperties = { fontSize: 8.5, color: GRAY_D, padding: '4px 8px', width: '28%' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, border: '1px solid #E5E7EB' }}>
      <thead>
        <tr><th colSpan={4} style={thStyle}>{header}</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC' }}>
            <td style={labelCell}>{r[0]}</td>
            <td style={valCell}>{r[1]}</td>
            <td style={labelCell}>{r[2]}</td>
            <td style={valCell}>{r[3]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ProposalPreview({ form, totals, proposalNo, onBack, appSettings, genId, embed, signatureImage, signedDate }: Props) {
  const co = appSettings ?? DEFAULT_APP_SETTINGS;
  const previewRef = useRef<HTMLDivElement>(null);
  const [savingDrive, setSavingDrive] = useState(false);
  const [driveSaved, setDriveSaved] = useState(false);

  const handleSaveToDrive = async () => {
    if (!genId || !previewRef.current) return;
    setSavingDrive(true);
    setDriveSaved(false);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(previewRef.current, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true });
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
      const formData = new FormData();
      formData.append('file', pdf.output('blob'), `Proposal - ${form.customer}.pdf`);
      await api.post(`/gens/${genId}/drive-proposal`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDriveSaved(true);
    } catch {
      alert('Failed to save to Drive. Please try again.');
    } finally {
      setSavingDrive(false);
    }
  };
  const companyName = co.company_name || 'Accurate Power & Technology';
  const licLine = [co.company_license_ec, co.company_license_cfc, co.company_license_li].filter(Boolean).join(' · ');
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const spec = GEN_SPEC_DETAIL[form.brand]?.[form.size];
  const lc = loadCenterFor(form);
  const addrDisplay = [form.address, [form.city, form.state, form.zip].filter(Boolean).join(', ')].filter(Boolean).join('  |  ');
  const buyerAddr   = [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ');

  // Taxable items for breakdown
  const taxableGen   = totals.genP;
  const taxablePad   = totals.padAmt;
  const taxableBatt  = totals.batteryAmt;
  const taxableATS   = totals.extraATS;
  const taxableSMM   = totals.smmTotal;
  const taxableSurge = totals.surgeTotal;
  const taxableTotal = taxableGen + taxablePad + taxableBatt + taxableATS + taxableSMM + taxableSurge;
  const nonTaxable   = totals.laborAmt + totals.permitAmt + totals.startupAmt + totals.extraWireAmt + totals.liftAmt + totals.removalFee + totals.lcATS;

  const docStyle: React.CSSProperties = {
    maxWidth: 780, margin: '0 auto', fontFamily: 'inherit',
    background: '#fff', fontSize: 10, color: GRAY_D,
  };
  const pageStyle: React.CSSProperties = {
    padding: '0 36px 36px', marginBottom: 0,
  };

  return (
    <div className={embed ? 'proposal-embed' : 'scroll view-enter'}>
      {/* Toolbar — hidden in embed (public signing) mode */}
      {!embed && (
      <div className="pipe-toolbar no-print">
        <button className="btn ghost" onClick={onBack} style={{ fontSize: 13 }}>← Back to Builder</button>
        <span className="spacer"/>
        {genId && (
          <button
            className="btn ghost"
            onClick={handleSaveToDrive}
            disabled={savingDrive || driveSaved}
            style={{ fontSize: 13, color: driveSaved ? 'var(--green)' : undefined }}
          >
            {savingDrive ? 'Saving…' : driveSaved ? '✓ Saved to Drive' : 'Save to Drive'}
          </button>
        )}
        <button className="btn" onClick={() => window.print()} style={{ fontSize: 13 }}>Print / Save PDF</button>
      </div>
      )}

      <div className="preview-doc" ref={previewRef} style={{ maxWidth: 780, margin: '16px auto 40px', background: '#fff', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={docStyle}>

          {/* ═══ PAGE 1 — COVER ════════════════════════════════════════════ */}
          <div style={pageStyle}>
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine}/>

            <SectionHeading title="PROPOSAL"/>
            <div style={{ textAlign: 'center', fontSize: 11, color: GRAY_M, marginTop: -10, marginBottom: 14 }}>
              {form.jobType === 'swap-out' ? 'Generator Replacement Agreement' : 'Generator Installation Agreement'}
            </div>

            {/* Customer info grid */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9, marginBottom: 14, border: '1px solid #BFDBFE' }}>
              <tbody>
                <tr style={{ background: BLUE_M }}>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: 8, textTransform: 'uppercase', letterSpacing: '.05em', width: '25%' }}>Prepared For</td>
                  <td style={{ padding: '4px 8px', width: '25%' }}/>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: 8, textTransform: 'uppercase', letterSpacing: '.05em', width: '25%' }}>Proposal No.</td>
                  <td style={{ padding: '4px 8px', width: '25%' }}/>
                </tr>
                <tr style={{ background: BLUE_L }}>
                  <td style={{ padding: '5px 8px', fontWeight: 800, color: '#1B3A6B', fontSize: 11 }} colSpan={2}>{form.customer || '—'}</td>
                  <td style={{ padding: '5px 8px', fontWeight: 700, color: ACCENT, fontSize: 10 }} colSpan={2}>{proposalNo}</td>
                </tr>
                <tr style={{ background: BLUE_M }}>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>Attn / Contact</td>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>Phone</td>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>Email</td>
                  <td style={{ padding: '4px 8px' }}/>
                </tr>
                <tr style={{ background: BLUE_L }}>
                  <td style={{ padding: '5px 8px' }}>{form.attn || form.customer || '—'}</td>
                  <td style={{ padding: '5px 8px' }}>{form.phone || '—'}</td>
                  <td style={{ padding: '5px 8px' }}>{form.email || '—'}</td>
                  <td style={{ padding: '5px 8px' }}/>
                </tr>
                <tr style={{ background: BLUE_M }}>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: 8, textTransform: 'uppercase', letterSpacing: '.05em' }} colSpan={2}>Address</td>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: 8, textTransform: 'uppercase', letterSpacing: '.05em' }} colSpan={2}>Payment Terms</td>
                </tr>
                <tr style={{ background: BLUE_L }}>
                  <td style={{ padding: '5px 8px' }} colSpan={2}>{addrDisplay || '—'}</td>
                  <td style={{ padding: '5px 8px' }} colSpan={2}>{form.depositPct ?? 50}% due at signing</td>
                </tr>
                <tr style={{ background: BLUE_L }}>
                  <td style={{ padding: '4px 8px', color: GRAY_M, fontSize: 8.5 }} colSpan={2}>Date: {today}</td>
                  <td style={{ padding: '4px 8px' }} colSpan={2}/>
                </tr>
              </tbody>
            </table>

            {/* Cash price banner */}
            <div style={{ background: NAVY, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '.06em' }}>Cash Price</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmtDec(totals.total)}</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: '#93C5FD' }}>Deposit at signing</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmtDec(totals.deposit)}</div>
              </div>
            </div>

            {/* Intro */}
            <p style={{ fontSize: 9, lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 12 }}>
              {form.jobType === 'swap-out'
                ? <>{companyName} proposes to furnish all labor and material necessary to remove the existing generator and install a new {form.brand} {form.size} generator on your existing pad with existing transfer switch integration. Our price is in accordance with the <strong>{new Date().getFullYear()} National Electrical Code</strong>, the Bid Documents, and the following qualifications: {licLine || 'Licensed & Insured'}. <strong>THIS PROPOSAL AND ALL MATERIAL COSTS ARE VALID FOR {form.validDays ?? 30} DAYS.</strong></>
                : <>{companyName} proposes to furnish all labor and material necessary to provide the scope of work described in this proposal. Our price is in accordance with the <strong>{new Date().getFullYear()} National Electrical Code</strong>, the Bid Documents, and the following qualifications: {licLine || 'Licensed & Insured'}. <strong>THIS PROPOSAL AND ALL MATERIAL COSTS ARE VALID FOR {form.validDays ?? 30} DAYS.</strong></>
              }
            </p>

            {/* Scope of work table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, border: '1px solid #E5E7EB', fontSize: 9 }}>
              <tbody>
                {[
                  {
                    title: `APT to provide a ${form.brand} ${form.size} Generator — ${lc ? `${lc} Load Center` : `${form.jobType === 'swap-out' ? 'Existing ' : ''}${form.ats} ATS`}`,
                    desc: `The ${form.brand} Advantage: High Quality Power — advanced voltage/frequency regulation with ultra-low harmonic distortion protects electronics. Extraordinary Reliability — 5-year/2,000-hour warranty. Powerful Performance — Exclusive Power Boost; starts 5-ton A/C. Corrosion-Proof Enclosure — impact-resistant to -34°C. Fast Response. Quiet Operation.`,
                    shade: false,
                  },
                  {
                    title: form.jobType === 'swap-out'
                      ? 'Scope of Work — Generator Swap-Out Installation'
                      : 'Scope of Work — Home Standby Generator Installation',
                    desc: form.jobType === 'swap-out'
                      ? 'Remove existing generator and disconnect from electrical system. Furnish and install a new permanently mounted home standby generator on the existing code-compliant pad. Integrate electrical connections with existing ATS. Complete grounding, bonding, startup, testing, and commissioning per 2026 NEC.'
                      : 'Furnish and install a permanently mounted home standby generator and ATS on a code-compliant pad. Complete all electrical connections, integrate ATS for automatic transfer during outages. Includes grounding, bonding, utility coordination, startup, testing, and commissioning per 2026 NEC.',
                    shade: true,
                  },
                  ...(form.smm ? [{
                    title: 'Smart Management Module(s)',
                    desc: 'Provide and install SMM(s) for load management and permitting compliance per manufacturer specs and codes.',
                    shade: false,
                  }] : []),
                  ...(form.surgePro ? [{
                    title: 'Whole-Home Surge Protectors',
                    desc: 'Provide and install a whole-home surge protective device at the electrical service equipment per manufacturer requirements and local codes.',
                    shade: true,
                  }] : []),
                  {
                    title: "5-Year Manufacturer's Comprehensive Warranty",
                    desc: "APT provides the full 5-year manufacturer's comprehensive warranty on this installation.",
                    shade: false,
                  },
                  {
                    title: 'Permit Fees & Sales Tax Included',
                    desc: 'All required permit fees and applicable Florida sales tax are included in this proposal.',
                    shade: true,
                  },
                  {
                    title: form.jobType === 'swap-out' ? 'Gas — Existing Connections' : 'Gas Installation — Not Included',
                    desc: form.jobType === 'swap-out'
                      ? 'Gas reconnection to the existing supply line is included. New gas line installation is NOT included in this proposal.'
                      : 'Gas installation and connections are NOT included in this proposal.',
                    shade: false,
                  },
                  // Builder "Notes" field — appended as its own line item when filled in.
                  ...(form.notes && form.notes.trim() ? [{
                    title: 'Additional Notes',
                    desc: form.notes.trim(),
                    shade: true,
                  }] : []),
                ].map((row, idx) => ({ ...row, n: String(idx + 1) })).map(row => (
                  <tr key={row.n} style={{ background: row.shade ? '#F8FAFC' : '#fff', verticalAlign: 'top', borderBottom: '1px solid #E5E7EB' }}>
                    <td style={{ padding: '7px 6px', width: 20, fontWeight: 800, color: ACCENT, textAlign: 'center' }}>{row.n}</td>
                    <td style={{ padding: '7px 6px', width: '30%', fontWeight: 700, color: '#1B3A6B', lineHeight: '13px' }}>{row.title}</td>
                    <td style={{ padding: '7px 6px', color: GRAY_M, lineHeight: '13px', whiteSpace: 'pre-line' }}>{row.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontSize: 8, lineHeight: '13px', color: GRAY_M, textAlign: 'justify', marginBottom: 14 }}>
              By accepting this proposal, Buyer acknowledges receipt of and agrees to all terms and conditions contained in the attached Disclosures and Sales Agreement, both incorporated herein by reference, including payment terms, non-refundability of the deposit, and waiver of all warranties, express or implied.
            </p>

            <SigBlock/>
          </div>

          {/* ═══ PAGE 2 (OPTIONAL) — PRICE BREAKDOWN ══════════════════════ */}
          {form.includeBreakdown && (
            <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break">
              <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine}/>
              <SectionHeading title="PRICE BREAKDOWN"/>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9, marginBottom: 10 }}>
                <thead>
                  <tr style={{ background: NAVY }}>
                    <th style={{ padding: '6px 10px', color: '#fff', textAlign: 'left', fontWeight: 700 }}>Item</th>
                    <th style={{ padding: '6px 10px', color: '#fff', textAlign: 'left', fontWeight: 700, width: 100 }}>Tax Status</th>
                    <th style={{ padding: '6px 10px', color: '#fff', textAlign: 'right', fontWeight: 700, width: 100 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: `${form.brand} ${form.size} Generator`, tax: 'taxable', amt: taxableGen, show: true },
                    { label: 'Transfer Switch — included', tax: 'included', amt: null, show: true },
                    { label: 'Concrete Pad', tax: 'taxable', amt: taxablePad, show: taxablePad > 0 },
                    { label: 'Battery Maintainer', tax: 'taxable', amt: taxableBatt, show: taxableBatt > 0 },
                    { label: 'Additional ATS', tax: 'taxable', amt: taxableATS, show: taxableATS > 0 },
                    { label: 'SMM (Preventative Maintenance)', tax: 'taxable', amt: taxableSMM, show: taxableSMM > 0 },
                    { label: 'Surge Protector', tax: 'taxable', amt: taxableSurge, show: taxableSurge > 0 },
                    { label: `Labor & Electrical${form.extraWire > 0 ? ` + ${form.extraWire} ft extra wire` : ''}`, tax: '', amt: totals.laborAmt + totals.extraWireAmt, show: true },
                    { label: 'Permit Fee', tax: '', amt: totals.permitAmt, show: true },
                    { label: 'Startup & Commissioning', tax: '', amt: totals.startupAmt, show: true },
                    ...(totals.liftAmt > 0 ? [{ label: form.liftType === 'lull' ? 'Lull' : 'Crane', tax: '', amt: totals.liftAmt, show: true }] : []),
                    ...(totals.removalFee > 0 ? [{ label: form.jobType === 'swap-out' ? 'Removal / Disposal of Existing Generator' : 'Removal / Haul-Off', tax: '', amt: totals.removalFee, show: true }] : []),
                    ...(totals.lcATS > 0 ? [{ label: `LC ATS (${form.lcATS})`, tax: '', amt: totals.lcATS, show: true }] : []),
                  ].filter(r => r.show).map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : GRAY_L, borderBottom: '1px solid #E5E7EB' }}>
                      <td style={{ padding: '5px 10px', color: GRAY_D }}>{r.label}</td>
                      <td style={{ padding: '5px 10px', color: r.tax === 'taxable' ? ACCENT : GRAY_M, fontSize: 8 }}>{r.tax}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: r.amt === null ? GRAY_M : GRAY_D }}>{r.amt === null ? 'Included' : fmtDec(r.amt)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} style={{ padding: '3px 0' }}/>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #E5E7EB', background: GRAY_L }}>
                    <td style={{ padding: '5px 10px', color: GRAY_M, fontSize: 8.5 }}>Sales Tax ({form.taxRate}% on taxable items)</td>
                    <td/>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: GRAY_D, fontWeight: 700 }}>{fmtDec(totals.tax)}</td>
                  </tr>
                  <tr style={{ background: NAVY }}>
                    <td style={{ padding: '7px 10px', color: '#fff', fontWeight: 800, fontSize: 11 }} colSpan={2}>Cash Price Total</td>
                    <td style={{ padding: '7px 10px', color: '#fff', fontWeight: 900, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDec(totals.total)}</td>
                  </tr>
                  <tr style={{ background: GRAY_L }}>
                    <td style={{ padding: '5px 10px', color: GRAY_M, fontSize: 8.5 }} colSpan={2}>Deposit Due at Signing (50%)</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: GRAY_M }}>{fmtDec(totals.deposit)}</td>
                  </tr>
                </tbody>
              </table>
              <p style={{ fontSize: 8, color: GRAY_M, lineHeight: '13px' }}>
                Sales tax is applied to: generator, concrete pad, battery, additional ATS, SMM, and surge protector. Labor, permit fees, and startup/commissioning are non-taxable.
              </p>
            </div>
          )}

          {/* ═══ SPEC SHEET ════════════════════════════════════════════════ */}
          {spec && (
            <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break">
              <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine}/>
              <SectionHeading title={`${form.brand} ${form.size} Generator — Product Specifications`}/>
              <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#1B3A6B', marginTop: -10, marginBottom: 14 }}>Model: {spec.model}</div>

              <SpecTable header="ELECTRICAL SPECIFICATIONS" rows={[
                ['Rated Output (LP)', form.size, 'Operating Speed', spec.rpm + ' RPM'],
                ['Voltage / Phase',   spec.voltage, 'Amps @ 240V (LP)', spec.amps_lp],
                ['Amps @ 240V (NG)',  spec.amps_ng, 'Circuit Breaker',  spec.breaker],
                ['Voltage Regulation','±1.0% RMS',  'Harmonic Distortion','< 5% THD'],
              ]}/>

              <SpecTable header="ENGINE & UNIT SPECIFICATIONS" rows={[
                ['Engine',       spec.engine,      'Displacement', spec.displacement],
                ['Weight',       spec.weight,      'Dimensions (L×W×H)', spec.dims],
                ['Sound Level',  spec.sound,       'Wind Rating',  spec.wind],
                ['Controller',   spec.controller,  'Certifications', spec.certs],
                ['Warranty',     spec.warranty,    'Min. Clearance', '18 in from structure'],
              ]}/>

              {/* Fuel table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, border: '1px solid #E5E7EB', fontSize: 9 }}>
                <thead>
                  <tr style={{ background: NAVY }}>
                    {['FUEL CONSUMPTION', 'Natural Gas (CFH)', 'LP Gas (gal/hr)', 'LP Gas (BTU/hr)'].map((h, i) => (
                      <th key={i} style={{ padding: '5px 8px', color: '#fff', textAlign: 'left', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Full Load (100%)', spec.fuel_ng_full, spec.fuel_lp_full, `${Math.round(parseFloat(spec.fuel_lp_full) * 91500).toLocaleString()} BTU/hr`],
                    ['Half Load (50%)',  spec.fuel_ng_half, spec.fuel_lp_half, `${Math.round(parseFloat(spec.fuel_lp_half) * 91500).toLocaleString()} BTU/hr`],
                  ].map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC', borderBottom: '1px solid #E5E7EB' }}>
                      {row.map((cell, j) => (
                        <td key={j} style={{ padding: '4px 8px', fontSize: j === 0 ? 8.5 : 9, fontWeight: j === 0 ? 700 : 400, color: j === 0 ? GRAY_M : GRAY_D }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Features */}
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #E5E7EB', marginBottom: 8 }}>
                <thead>
                  <tr style={{ background: NAVY }}>
                    <th style={{ padding: '5px 8px', color: '#fff', textAlign: 'left', fontWeight: 700, fontSize: 9 }}>KEY FEATURES &amp; HIGHLIGHTS</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.features.map((f, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC', borderBottom: '1px solid #E5E7EB' }}>
                      <td style={{ padding: '4px 8px', fontSize: 8.5, color: GRAY_D }}>✓&nbsp;&nbsp;{f}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: 7.5, color: GRAY_M, textAlign: 'center', lineHeight: '12px' }}>
                Specifications subject to change without notice. Source: {form.brand} official product specifications. All ratings at 1.0 PF, 60Hz, per ISO-3046/1.
              </p>
            </div>
          )}

          {/* ═══ SALES AGREEMENT — PAGE 1 ══════════════════════════════════ */}
          <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break">
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine}/>
            <SectionHeading title="SALES AGREEMENT"/>

            <p style={{ fontSize: 9, lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 10 }}>
              This Sales Agreement (this "Agreement") is entered into effective ________________________, by and between{' '}
              <strong>Accurate Power &amp; Technology, Inc.</strong> ("APT"), a Florida corporation, 15519 US Highway 441 Suite A101, Eustis, FL 32726, and <strong>{form.customer || 'Buyer'}</strong> (the "Buyer"), address: {buyerAddr || '—'}. Accurate Power and Technology, Inc., All State Home Innovations, Inc., and Accurate Power and Technology, Inc. d/b/a "A Generator Guy" are collectively referred to as "APT."
            </p>
            <p style={{ fontSize: 9, lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 10 }}>
              In consideration of the mutual promises, covenants, and conditions hereinafter contained, the parties hereto agree as follows:
            </p>

            <Clause num="1" label="Sale of Goods" text="APT hereby sells and Buyer hereby purchases the goods and materials described in the Generator Proposal for the purchase price contained therein, plus any Additional Labor charges, permit and license fees, and all applicable sales, excise, or other taxes."/>
            <Clause num="2" label="Nonrefundable Deposit" text="Upon execution, Buyer shall pay the nonrefundable deposit stated in the Proposal. The deposit will not be refunded under any circumstances after APT orders the generator. APT will only refund deposits if APT materially breaches this Agreement. Unpaid balances accrue interest at 18% per annum."/>
            <Clause num="3" label="Cancellation" text={<><strong>ALL GENERATOR SALES ARE FINAL.</strong> Generators are built on demand and are not returnable. If Buyer cancels after a generator has been ordered, Buyer shall pay 25% of the contract face value or the actual value of the generator, whichever is greater.</>}/>
            <Clause num="4" label="Disclosures" text='Buyer acknowledges the Disclosures attached as Exhibit "A" were provided along with the Proposal and waives all claims of defective notice as to any matter disclosed therein.'/>
            <Clause num="5" label="Installation Disconnects" text="The project may require a power disconnect by the electric company. APT will do everything necessary to restore power in a timely manner. Buyer understands that the electric company and municipality are separate entities whose schedules cannot be controlled by APT, and delays may occur."/>
            <Clause num="6" label="After-Hours Charges" text="If delays force APT technicians to remain on-site after 3:00 PM, the homeowner will be billed at $185.00/hr until the inspector completes the inspection and power is restored."/>
            <Clause num="7" label="Installation" text="APT shall provide only the initial installation at the premises. Buyer is responsible for costs of any Additional Labor. Installation is deemed accepted when installed, inspected, and ready for use per APT's normal standards."/>
            <Clause num="8" label="Taxes" text="Buyer shall pay all federal, state, and local taxes on the generator and its installation, except taxes on APT's net income."/>
            <Clause num="9" label="Access to Site" text="Buyer grants APT complete, unrestricted access to the installation site, including gated communities. Buyer agrees to remove all obstacles."/>
            <Clause num="10" label="No Liability for Property Damage" text="APT assumes no responsibility for damage to plumbing, electrical, underground obstructions, sprinkler systems, lawn, or landscaping during installation."/>
            <Clause num="11" label="Buyer's Default" text="If Buyer fails to make any payment or becomes insolvent, APT may enter the premises and remove the generator."/>
            <Clause num="12" label="Title" text="Title passes to Buyer upon payment in full of the purchase price and all associated charges."/>
          </div>

          {/* ═══ SALES AGREEMENT — PAGE 2 ══════════════════════════════════ */}
          <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break">
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine}/>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, textAlign: 'center', marginTop: 16, marginBottom: 4 }}>SALES AGREEMENT (continued)</div>
            <div style={{ height: 2, background: ACCENT, marginBottom: 14 }}/>

            <Clause num="13" label="Warranties/Limitation of Liabilities" text="APT's warranties and liabilities are as follows:"/>
            <SubClause label="a. Limited Warranty" text="APT warrants only to the original Buyer that the generator will be free from defects in material and workmanship under normal use within twelve (12) months of installation. APT shall not be liable for special, exemplary, or consequential damages."/>
            <SubClause label="b. Limitation of Warranties" text="THE WARRANTIES IN PARAGRAPH 13(A) ARE IN LIEU OF ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. APT MAKES NO WARRANTY WITH RESPECT TO LABOR, ACCESSORIES, MATERIALS, OR PARTS NOT SUPPLIED BY APT."/>
            <SubClause label="c. Assignment of Manufacturer's Warranties" text="APT assigns to Buyer all rights in the manufacturer's warranties, to the extent permitted. Manufacturer's warranties can be extended for up to five (5) years on most generators."/>
            <Clause num="14" label="Risk of Loss" text="Risk of loss passes to Buyer upon delivery of the generator to the installation site."/>
            <Clause num="15" label="Security Interest" text="Buyer grants APT a security interest in the generator to secure payment. APT may file a copy of this Agreement as a financing statement. APT may retake possession if Buyer defaults."/>
            <Clause num="16" label="Personal Guaranty" text="Buyer (or its principals) agrees to personally guaranty payment of all sums due."/>
            <Clause num="17" label="Permits and Licenses" text="Buyer shall pay for and APT shall secure all permits or licenses required by any state or local authority."/>
            <Clause num="18" label="Breach of Agreement" text=""/>
            <SubClause label="a. Limitation of Action" text="No action shall be maintained by Buyer against APT unless Buyer notifies APT in writing within thirty (30) days of the alleged breach and APT fails to remedy within sixty (60) days."/>
            <SubClause label="b. Limitation of Damages" text="No cause of action shall include a claim for punitive, incidental, or consequential damages."/>
            <SubClause label="c. Indemnification" text="Buyer shall hold APT harmless from all claims arising from subsequent sale, reinstallation, or use of the generator by parties other than APT."/>
            <SubClause label="d. Reservation of Rights" text="If Buyer fails to pay, APT may cancel all warranties and cease work without breach."/>
            <Clause num="19" label="Integration" text="This Agreement is the final, complete, exclusive statement of the terms between the Parties and supersedes all prior agreements."/>
            <Clause num="20" label="Assignment" text="Not assignable by Buyer without APT's prior written consent."/>
            <Clause num="21" label="Binding Effect" text="Binding on the parties and their respective successors and assigns."/>
            <Clause num="22" label="Force Majeure" text="APT shall not be liable for failure to perform due to inability to obtain materials, transportation delays, government regulation, labor disputes, war, fire, flood, or other causes beyond APT's control."/>
            <Clause num="23" label="Waiver of Default" text="No waiver is effective unless in writing and signed by the Parties."/>
            <Clause num="24" label="Enforceability" text="Invalid provisions shall not affect the remainder of this Agreement."/>
            <Clause num="25" label="Notice" text="Notices must be in writing, sent by certified mail to the addresses stated herein."/>
            <Clause num="26" label="Attorney's Fees" text="If APT engages proceedings to enforce this Agreement, APT is entitled to recover reasonable attorneys' fees, costs, and disbursements."/>
            <Clause num="27" label="Governing Law" text="This Agreement is governed by Florida law. Venue lies in the Circuit Civil Court of the Fifth Judicial Circuit, Lake County, Florida."/>

            <p style={{ fontSize: 9, lineHeight: '14px', color: GRAY_D, marginBottom: 14 }}>
              <strong>In Witness Whereof</strong>, the parties have executed this Agreement on the day and year first written above.
            </p>
            <SigBlock signatureImage={signatureImage} signedDate={signedDate} buyerName={form.customer}/>
          </div>

          {/* ═══ EXHIBIT A — DISCLOSURES ═══════════════════════════════════ */}
          <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break">
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine}/>
            <SectionHeading title="EXHIBIT A — DISCLOSURES"/>

            <p style={{ fontSize: 9, lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 8 }}>
              <strong>Pre-Purchase Disclaimer:</strong>&nbsp; These disclosures are provided prior to purchase and incorporated by reference into the Sales Agreement.
            </p>
            <p style={{ fontSize: 9, lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 6 }}>
              <strong>Exclusions:</strong>&nbsp; APT excludes from the Proposal any repairs to existing inoperable equipment not in compliance with electrical codes. APT excludes utility in/out charges. Permits and Sales Tax are included in this Proposal. Additional costs for excluded items are the Buyer's responsibility.
            </p>
            <p style={{ fontSize: 9, lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 6 }}>
              <strong>Hours:</strong>&nbsp; All work is completed 7:00 AM – 3:30 PM, Monday–Friday. Overtime at Buyer's request is Buyer's responsibility. After 4:00 PM, overtime charges are passed to the consumer at $480/hr + $3/mile.
            </p>
            <p style={{ fontSize: 9, lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 12 }}>
              <strong>Insurance:</strong>&nbsp; APT is licensed and insured per Florida law with general liability, commercial auto, and workers' compensation coverage. Certificates available on request. APT is a Drug-Free Workplace.
            </p>

            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 8 }}>General Disclosures:</div>
            {[
              "APT does not guarantee any homeowner's insurance discount.",
              'Scheduled installation dates may be postponed due to weather or severe storm conditions.',
              `All quoted materials are valid for ${form.validDays ?? 30} days and may increase without warning.`,
              "In the event of a named hurricane threatening Buyer's location, APT will make reasonable accommodations to install before the storm's arrival, including evenings and weekends.",
              'APT installs generators in order by date of initial payment.',
              "Individual generator units carry their own warranties. Manufacturer's warranties can be extended up to five (5) years on most generators.",
              'Installation typically takes thirty (30) days from permit approval and material receipt.',
              `Payment schedule: ${form.depositPct ?? 50}% deposit at signing; 50% of remaining balance after electrical completion; remainder at startup and final inspection.`,
              'All contractors are paid at completion; proof of payment available on request.',
              'Invoices and Commencement Notices MUST be signed before work begins.',
              "Warning — Florida's Construction Law allows unpaid contractors, subcontractors, and material suppliers to file Liens against your property.",
              "During warranty, manufacturer pays for 30 minutes of diagnosis. Buyer is responsible for additional time and trip charges. APT's shop rate is $160/hr including travel; mileage at IRS standard rate.",
              'APT cannot quote what we cannot see. Unforeseen conditions may result in additional labor or material charges.',
              'No other equipment or services are provided beyond those listed herein. Code violations discovered during inspections will require additional work at additional cost to Buyer.',
            ].map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5, fontSize: 9, lineHeight: '13px', color: GRAY_D, textAlign: 'justify' }}>
                <span style={{ flexShrink: 0 }}>•</span>
                <span>{b}</span>
              </div>
            ))}

            <div style={{ marginTop: 20, height: 1, background: '#E5E7EB' }}/>
            <div style={{ marginTop: 8, fontSize: 8, color: GRAY_M, textAlign: 'center' }}>
              This proposal is valid for {form.validDays ?? 30} days. Accurate Power &amp; Technology, Inc. · Licensed &amp; Insured · FL
            </div>
          </div>

        </div>
      </div>

      <style>{`
        @media print {
          .no-print,
          .sidebar,
          .topbar,
          .mobile-nav,
          .mobile-more-overlay,
          .mobile-more-sheet,
          .toast-wrap { display: none !important; }
          .page-break { page-break-before: always; }
          .preview-doc { border: none !important; border-radius: 0 !important; margin: 0 !important; max-width: 100% !important; }
          .app,
          .main,
          .scroll { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; padding: 0 !important; }
          @page { margin: 0.55in; size: letter; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}
