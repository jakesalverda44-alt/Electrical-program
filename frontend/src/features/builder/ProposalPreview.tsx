import React, { useRef, useState } from 'react';
import { GenForm } from './genData';
import { GenTotals, genPriceRows, genModelNo, loadCenterFor } from './genCalc';
import { GEN_SPEC_DETAIL, DEFAULT_PRICES } from './genData';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { useIsMobile } from '../../hooks/useIsMobile';
import api from '../../api/client';

function fmt(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }
function fmtDec(n: number) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// Parses a bare "YYYY-MM-DD" as a local calendar date (not UTC midnight) so the
// displayed promo date can't shift a day off in negative-UTC timezones.
function fmtDateLocal(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

const NAVY   = '#0F2044';
const ACCENT = '#2563EB';
const GOLD   = '#C9A84C';
const GRAY_D = '#1F2937';
const GRAY_M = '#6B7280';
const GRAY_L = '#F3F4F6';
const BLUE_L = '#EFF6FF';
const BLUE_M = '#DBEAFE';

// ── Embed-mode (public e-sign page) sizing helpers ──────────────────────────
// The source contract document uses 8-9px body copy — fine on a printed page or
// the in-app desktop preview, illegible in the ~271px-wide mobile signing view
// (the mobile-field-pack audit's worst customer-facing finding). These are pure
// functions of (embed, isMobile) so they're unit-testable without rendering the
// full multi-page document, and so every hardcoded fontSize/padding site in the
// component can share one gate: print/PDF (embed=false) and desktop embed never
// change; only embed+mobile bumps sizes.
export function embedFontSize(n: number, embed: boolean, isMobile: boolean): number {
  return embed && isMobile ? Math.max(n, 11) : n;
}

export function embedDocStyle(embed: boolean, isMobile: boolean): React.CSSProperties {
  return {
    maxWidth: 780, margin: '0 auto', fontFamily: 'inherit',
    background: '#fff', fontSize: embed && isMobile ? 12 : 10, color: GRAY_D,
  };
}

export function embedPageStyle(embed: boolean, isMobile: boolean): React.CSSProperties {
  return {
    padding: embed && isMobile ? '0 12px 24px' : '0 36px 36px', marginBottom: 0,
  };
}

// Shared shape for the `fs` size-derivation function threaded into the small
// layout sub-components below. Defaults to identity so any sub-component used
// outside the ProposalPreview render (e.g. future reuse, tests) is a no-op.
type FontFn = (n: number) => number;
const identityFs: FontFn = n => n;

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
  /** Customer initials image (data URL). When present, it is stamped on every
   *  "CUST INT" rule and the Sales Agreement effective-date blank fills in. */
  initialsImage?: string;
  /** Date the customer signed (display string). */
  signedDate?: string;
  /** APT countersignature image (data URL) and its date. Present once the contract is
   *  executed by both parties. */
  countersignImage?: string;
  countersignDate?: string;
}

// ── Shared layout helpers ────────────────────────────────────────────────────

function PageHeader({ proposalNo, companyName, phone, licLine, fs = identityFs }: { proposalNo: string; companyName: string; phone?: string; licLine?: string; fs?: FontFn }) {
  return (
    <div style={{ background: NAVY, padding: '10px 20px 0', marginBottom: 0, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', letterSpacing: '-0.3px' }}>
            {companyName}
          </div>
          {phone && (
            <div style={{ fontSize: fs(9.5), color: '#93C5FD', marginTop: 2 }}>{phone}</div>
          )}
          {licLine && (
            <div style={{ fontSize: fs(9), color: '#4A6A8A', marginTop: 1 }}>{licLine}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: fs(8), color: '#4A6A8A', textTransform: 'uppercase', letterSpacing: '.08em' }}>Proposal No.</div>
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

function SigBlock({ signatureImage, signedDate, countersignImage, countersignDate, buyerName, fs = identityFs }: { signatureImage?: string; signedDate?: string; countersignImage?: string; countersignDate?: string; buyerName?: string; fs?: FontFn }) {
  const line = { height: 1, background: '#D1D5DB', marginBottom: 4 };
  const lbl = { fontSize: fs(9), color: GRAY_M, fontWeight: 600 as const };
  const cell: React.CSSProperties = { padding: '8px 12px', flex: 1 };
  return (
    <div style={{ display: 'flex', background: GRAY_L, border: '1px solid #E5E7EB' }}>
      {/* APT side — filled once someone countersigns, which is what takes the contract
          from "signed by the buyer" to executed by both parties. */}
      <div style={cell}>
        <div style={{ fontSize: fs(10), fontWeight: 700, color: NAVY, marginBottom: 6 }}>"APT" Accurate Power Technology, Inc.</div>
        {countersignImage
          ? <img src={countersignImage} alt="APT signature" style={{ height: 34, maxWidth: '100%', objectFit: 'contain', display: 'block', marginBottom: 2 }}/>
          : <div style={{ height: 34 }}/>}
        <div style={line}/>
        <div style={lbl}>By: Authorized Representative</div>
        <div style={{ height: 10 }}/>
        <div style={{ minHeight: 14, display: 'flex', alignItems: 'flex-end' }}>
          {countersignDate && <span style={{ fontSize: fs(10), color: GRAY_D, marginBottom: 2 }}>{countersignDate}</span>}
        </div>
        <div style={line}/>
        <div style={lbl}>Date</div>
      </div>
      <div style={{ width: 1, background: '#E5E7EB' }}/>
      <div style={cell}>
        <div style={{ fontSize: fs(10), fontWeight: 700, color: NAVY, marginBottom: 6 }}>"BUYER"</div>
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
              {signedDate && <span style={{ fontSize: fs(10), color: GRAY_D, marginBottom: 2 }}>{signedDate}</span>}
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
function Clause({ num, label, text, fs = identityFs }: { num: string; label?: string; text: React.ReactNode; fs?: FontFn }) {
  return (
    <div style={{ marginBottom: 9, fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify' }}>
      <span style={{ textDecoration: 'underline', fontWeight: 700 }}>{num}.{label ? ` ${label}.` : ''}</span>{'  '}{text}
    </div>
  );
}
function SubClause({ label, text, fs = identityFs }: { label: string; text: React.ReactNode; fs?: FontFn }) {
  return (
    <div style={{ marginBottom: 8, fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify', paddingLeft: 18 }}>
      <span style={{ textDecoration: 'underline', fontWeight: 700 }}>{label}.</span>{'  '}{text}
    </div>
  );
}
// Customer-initials line that appears at the foot of each Sales Agreement / Exhibit
// page in the source document ("CUST INT ______"). When the buyer has e-signed, their
// drawn initials are stamped onto the rule the same way SigBlock stamps the signature —
// on paper these get initialed page by page, so leaving them blank on an e-signed
// contract left it looking half-executed.
function CustInitFooter({ initialsImage, fs = identityFs }: { initialsImage?: string; fs?: FontFn } = {}) {
  return (
    <div style={{ marginTop: 16, textAlign: 'right', fontSize: fs(8.5), color: GRAY_M, fontWeight: 700, letterSpacing: '.03em' }}>
      {initialsImage ? (
        <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 6 }}>
          CUST INT
          <img src={initialsImage} alt="Customer initials"
            style={{ height: 22, maxWidth: 90, objectFit: 'contain', display: 'block' }}/>
        </span>
      ) : 'CUST INT ________'}
    </div>
  );
}

// ── Spec table helper ────────────────────────────────────────────────────────
function SpecTable({ header, rows, fs = identityFs }: { header: string; rows: [string, string, string, string][]; fs?: FontFn }) {
  const thStyle: React.CSSProperties = { background: NAVY, color: '#fff', fontSize: fs(9), fontWeight: 700, padding: '5px 8px', textAlign: 'left' };
  const labelCell: React.CSSProperties = { fontSize: fs(8.5), fontWeight: 700, color: GRAY_M, padding: '4px 8px', width: '22%' };
  const valCell: React.CSSProperties = { fontSize: fs(8.5), color: GRAY_D, padding: '4px 8px', width: '28%' };
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
export default function ProposalPreview({ form, totals, proposalNo, onBack, appSettings, genId, embed, signatureImage, initialsImage, signedDate, countersignImage, countersignDate }: Props) {
  const co = appSettings ?? DEFAULT_APP_SETTINGS;
  const previewRef = useRef<HTMLDivElement>(null);
  const [savingDrive, setSavingDrive] = useState(false);
  const [driveSaved, setDriveSaved] = useState(false);
  // Public e-sign page only: floors the smallest body-copy sizes and tightens the
  // page gutters when the customer opens the link on a phone. Non-embed (in-app
  // preview/print/PDF) and desktop embed are untouched — see embedFontSize et al.
  const isMobile = useIsMobile();
  const fs = (n: number) => embedFontSize(n, !!embed, isMobile);

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
  const taxableGenStand = totals.genStandAmt;
  const taxableBatt  = totals.batteryAmt;
  const taxableATS   = totals.atsAmt;
  const taxableSMM   = totals.smmTotal;
  const taxableSurge = totals.surgeTotal;
  const taxableWarranty = totals.extWarrantyAmt;
  const taxableEmPanel  = totals.emPanelAmt;
  const nonTaxable   = totals.laborAmt + totals.permitAmt + totals.startupAmt + totals.extraWireAmt + totals.liftAmt + totals.removalFee;
  // Promo date range for the extended-warranty scope line / breakdown row, if set.
  const warrantyPromoRange = [fmtDateLocal(form.extWarrantyPromoStart), fmtDateLocal(form.extWarrantyPromoEnd)].filter(Boolean).join(' – ');

  const docStyle: React.CSSProperties = embedDocStyle(!!embed, isMobile);
  const pageStyle: React.CSSProperties = embedPageStyle(!!embed, isMobile);

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
          <div style={pageStyle} data-doc-page>
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>

            <SectionHeading title="PROPOSAL"/>
            <div style={{ textAlign: 'center', fontSize: 11, color: GRAY_M, marginTop: -10, marginBottom: 14 }}>
              {form.jobType === 'swap-out' ? 'Generator Replacement Agreement' : 'Generator Installation Agreement'}
            </div>

            {/* Customer info grid */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fs(9), marginBottom: 14, border: '1px solid #BFDBFE' }}>
              <tbody>
                <tr style={{ background: BLUE_M }}>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: fs(8), textTransform: 'uppercase', letterSpacing: '.05em', width: '25%' }}>Prepared For</td>
                  <td style={{ padding: '4px 8px', width: '25%' }}/>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: fs(8), textTransform: 'uppercase', letterSpacing: '.05em', width: '25%' }}>Proposal No.</td>
                  <td style={{ padding: '4px 8px', width: '25%' }}/>
                </tr>
                <tr style={{ background: BLUE_L }}>
                  <td style={{ padding: '5px 8px', fontWeight: 800, color: '#1B3A6B', fontSize: 11 }} colSpan={2}>{form.customer || '—'}</td>
                  <td style={{ padding: '5px 8px', fontWeight: 700, color: ACCENT, fontSize: fs(10) }} colSpan={2}>{proposalNo}</td>
                </tr>
                <tr style={{ background: BLUE_M }}>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: fs(8), textTransform: 'uppercase', letterSpacing: '.05em' }}>Attn / Contact</td>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: fs(8), textTransform: 'uppercase', letterSpacing: '.05em' }}>Phone</td>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: fs(8), textTransform: 'uppercase', letterSpacing: '.05em' }}>Email</td>
                  <td style={{ padding: '4px 8px' }}/>
                </tr>
                <tr style={{ background: BLUE_L }}>
                  <td style={{ padding: '5px 8px' }}>{form.attn || form.customer || '—'}</td>
                  <td style={{ padding: '5px 8px' }}>{form.phone || '—'}</td>
                  <td style={{ padding: '5px 8px' }}>{form.email || '—'}</td>
                  <td style={{ padding: '5px 8px' }}/>
                </tr>
                <tr style={{ background: BLUE_M }}>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: fs(8), textTransform: 'uppercase', letterSpacing: '.05em' }} colSpan={2}>Address</td>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: GRAY_M, fontSize: fs(8), textTransform: 'uppercase', letterSpacing: '.05em' }} colSpan={2}>Payment Terms</td>
                </tr>
                <tr style={{ background: BLUE_L }}>
                  <td style={{ padding: '5px 8px' }} colSpan={2}>{addrDisplay || '—'}</td>
                  <td style={{ padding: '5px 8px' }} colSpan={2}>{form.depositPct ?? 50}% due at signing</td>
                </tr>
                <tr style={{ background: BLUE_L }}>
                  <td style={{ padding: '4px 8px', color: GRAY_M, fontSize: fs(8.5) }} colSpan={2}>Date: {today}</td>
                  <td style={{ padding: '4px 8px' }} colSpan={2}/>
                </tr>
              </tbody>
            </table>

            {/* Cash price banner */}
            <div style={{ background: NAVY, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: fs(9), fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '.06em' }}>Cash Price</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmtDec(totals.total)}</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: fs(9), color: '#93C5FD' }}>Deposit at signing</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmtDec(totals.deposit)}</div>
              </div>
            </div>

            {/* Intro */}
            <p style={{ fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 12 }}>
              {form.jobType === 'swap-out'
                ? <>{companyName} proposes to furnish all labor and material necessary to remove the existing generator and install a new {form.brand} {form.size} generator on your existing pad with existing transfer switch integration. Our price is in accordance with the <strong>{new Date().getFullYear()} National Electrical Code</strong>, the Bid Documents, and the following qualifications: {licLine || 'Licensed & Insured'}. <strong>THIS PROPOSAL AND ALL MATERIAL COSTS ARE VALID FOR {form.validDays ?? 30} DAYS.</strong></>
                : <>{companyName} proposes to furnish all labor and material necessary to provide the scope of work described in this proposal. Our price is in accordance with the <strong>{new Date().getFullYear()} National Electrical Code</strong>, the Bid Documents, and the following qualifications: {licLine || 'Licensed & Insured'}. <strong>THIS PROPOSAL AND ALL MATERIAL COSTS ARE VALID FOR {form.validDays ?? 30} DAYS.</strong></>
              }
            </p>

            {/* Scope of work table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, border: '1px solid #E5E7EB', fontSize: fs(9) }}>
              <tbody>
                {[
                  {
                    title: `APT to provide a ${form.brand} ${form.size} Generator${lc ? ` — ${lc} Load Center` : form.atsQty > 0 ? ` — ${form.jobType === 'swap-out' ? 'Existing ' : ''}${form.atsSize} ATS${form.atsQty > 1 ? ` (${form.atsQty})` : ''}` : ''}`,
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
                  ...(form.smmQty > 0 ? [{
                    title: `Smart Management Module${form.smmQty > 1 ? `s (${form.smmQty})` : ''}`,
                    desc: 'Provide and install SMM(s) for load management and permitting compliance per manufacturer specs and codes.',
                    shade: false,
                  }] : []),
                  ...(form.surgeProQty > 0 ? [{
                    title: `Whole-Home Surge Protector${form.surgeProQty > 1 ? `s (${form.surgeProQty})` : ''}`,
                    desc: 'Provide and install a whole-home surge protective device at the electrical service equipment per manufacturer requirements and local codes.',
                    shade: true,
                  }] : []),
                  ...(form.silverServicePromo !== 'none' ? [{
                    title: `${form.silverServicePromo === '2yr' ? 2 : 1}-Year Silver Service — Included`,
                    desc: (<>APT includes {form.silverServicePromo === '2yr' ? 2 : 1} year{form.silverServicePromo === '2yr' ? 's' : ''} of Silver Service preventative maintenance at no additional cost — <s>{fmtDec(DEFAULT_PRICES.silverService * (form.silverServicePromo === '2yr' ? 2 : 1))}</s>{' '}<strong>FREE</strong> (Promo).</>),
                    shade: false,
                  }] : []),
                  {
                    title: form.extWarranty === 'none'
                      ? "5-Year Manufacturer's Comprehensive Warranty"
                      : '5-Year Standard + 10-Year Extended Warranty',
                    desc: form.extWarranty === 'promo'
                      ? (form.brand === 'Kohler'
                        ? (<>APT provides the full 5-year manufacturer's comprehensive warranty, extended to 10 years at no additional cost — <s>{fmtDec(DEFAULT_PRICES.extendedWarranty)}</s>{' '}<strong>FREE</strong> (Kohler Promotion{warrantyPromoRange ? `, valid ${warrantyPromoRange}` : ''}).</>)
                        : (<>APT provides the full 5-year manufacturer's comprehensive warranty through Generac, extended to 10 years at no additional cost — <s>{fmtDec(DEFAULT_PRICES.extendedWarranty)}</s>{' '}<strong>FREE</strong> (included by APT).</>))
                      : form.extWarranty === 'paid'
                      ? `APT provides the full 5-year manufacturer's comprehensive warranty, extended to 10 years for ${fmtDec(DEFAULT_PRICES.extendedWarranty)}.`
                      : "APT provides the full 5-year manufacturer's comprehensive warranty on this installation.",
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

            <p style={{ fontSize: fs(8), lineHeight: '13px', color: GRAY_M, textAlign: 'justify', marginBottom: 14 }}>
              By accepting this proposal, Buyer acknowledges receipt of and agrees to all terms and conditions contained in the attached Disclosures and Sales Agreement, both incorporated herein by reference, including payment terms, non-refundability of the deposit, and waiver of all warranties, express or implied.
            </p>

            <SigBlock signatureImage={signatureImage} signedDate={signedDate} countersignImage={countersignImage} countersignDate={countersignDate} buyerName={form.customer} fs={fs}/>
          </div>

          {/* ═══ PAGE 2 (OPTIONAL) — PRICE BREAKDOWN ══════════════════════ */}
          {form.includeBreakdown && (
            <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break" data-doc-page>
              <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>
              <SectionHeading title="PRICE BREAKDOWN"/>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fs(9), marginBottom: 10 }}>
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
                    { label: `${lc} Load Center — included`, tax: 'included', amt: null, amtText: 'Included', show: !!lc },
                    { label: `ATS (${form.atsSize}) — included`, tax: 'included', amt: null, amtText: 'Included', show: !lc && totals.atsIncluded > 0 },
                    { label: 'ATS / Transfer Switch — NOT included (liquid-cooled)', tax: '', amt: null, amtText: 'Not Included', show: !lc && totals.atsIncluded === 0 && totals.atsBillableQty === 0 },
                    { label: 'Concrete Pad', tax: 'taxable', amt: taxablePad, show: taxablePad > 0 },
                    { label: form.genStand === 'small' ? 'Gen Stand — Adjustable 8–24"' : 'Gen Stand — Adjustable 32–72"', tax: 'taxable', amt: taxableGenStand, show: taxableGenStand > 0 },
                    { label: 'Battery Maintainer', tax: 'taxable', amt: taxableBatt, show: taxableBatt > 0 },
                    { label: `ATS — additional (${totals.atsBillableQty} × ${form.atsSize})`, tax: 'taxable', amt: taxableATS, show: taxableATS > 0 },
                    { label: `SMM (Preventative Maintenance) × ${form.smmQty}`, tax: 'taxable', amt: taxableSMM, show: taxableSMM > 0 },
                    { label: `Surge Protector × ${form.surgeProQty}`, tax: 'taxable', amt: taxableSurge, show: taxableSurge > 0 },
                    { label: 'Extended Warranty (10-Year)', tax: 'taxable', amt: taxableWarranty, show: form.extWarranty === 'paid' },
                    { label: `Extended Warranty (10-Year) — ${form.brand === 'Kohler' ? 'Kohler Promo' : 'Included by APT'} (FREE${form.brand === 'Kohler' && warrantyPromoRange ? `, valid ${warrantyPromoRange}` : ''})`, tax: 'taxable', amt: 0, show: form.extWarranty === 'promo' },
                    { label: 'Emergency Panel', tax: 'taxable', amt: taxableEmPanel, show: taxableEmPanel > 0 },
                    { label: `${form.silverServicePromo === '2yr' ? 2 : 1}-Year Silver Service — Promo (FREE)`, tax: '', amt: 0, show: form.silverServicePromo !== 'none' },
                    { label: `Labor & Electrical${form.extraWire > 0 ? ` + ${form.extraWire} ft extra wire` : ''}`, tax: '', amt: totals.laborAmt + totals.extraWireAmt, show: true },
                    { label: 'Gas Line', tax: '', amt: totals.gasLineAmt, show: totals.gasLineAmt > 0 },
                    { label: 'Permit Fee', tax: '', amt: totals.permitAmt, show: true },
                    { label: 'Startup & Commissioning', tax: '', amt: totals.startupAmt, show: true },
                    ...(totals.liftAmt > 0 ? [{ label: form.liftType === 'lull' ? 'Lull' : 'Crane', tax: '', amt: totals.liftAmt, show: true }] : []),
                    ...(totals.removalFee > 0 ? [{ label: form.jobType === 'swap-out' ? 'Removal / Disposal of Existing Generator' : 'Removal / Haul-Off', tax: '', amt: totals.removalFee, show: true }] : []),
                  ].filter(r => r.show).map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : GRAY_L, borderBottom: '1px solid #E5E7EB' }}>
                      <td style={{ padding: '5px 10px', color: GRAY_D }}>{r.label}</td>
                      <td style={{ padding: '5px 10px', color: r.tax === 'taxable' ? ACCENT : GRAY_M, fontSize: fs(8) }}>{r.tax}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: r.amt === null ? GRAY_M : GRAY_D }}>{r.amt === null ? (r as { amtText?: string }).amtText ?? 'Included' : fmtDec(r.amt)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} style={{ padding: '3px 0' }}/>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #E5E7EB', background: GRAY_L }}>
                    <td style={{ padding: '5px 10px', color: GRAY_M, fontSize: fs(8.5) }}>Sales Tax ({form.taxRate}% on taxable items)</td>
                    <td/>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: GRAY_D, fontWeight: 700 }}>{fmtDec(totals.tax)}</td>
                  </tr>
                  <tr style={{ background: NAVY }}>
                    <td style={{ padding: '7px 10px', color: '#fff', fontWeight: 800, fontSize: 11 }} colSpan={2}>Cash Price Total</td>
                    <td style={{ padding: '7px 10px', color: '#fff', fontWeight: 900, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDec(totals.total)}</td>
                  </tr>
                  <tr style={{ background: GRAY_L }}>
                    <td style={{ padding: '5px 10px', color: GRAY_M, fontSize: fs(8.5) }} colSpan={2}>Deposit Due at Signing (50%)</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: GRAY_M }}>{fmtDec(totals.deposit)}</td>
                  </tr>
                </tbody>
              </table>
              <p style={{ fontSize: fs(8), color: GRAY_M, lineHeight: '13px' }}>
                Sales tax is applied to: generator, concrete pad, battery, additional ATS, SMM, surge protector, emergency panel, and extended warranty (when purchased). Labor, permit fees, startup/commissioning, gas line, lift/crane, and removal are non-taxable. Any discount is applied proportionally across taxable and non-taxable items.
              </p>
            </div>
          )}

          {/* ═══ SPEC SHEET ════════════════════════════════════════════════ */}
          {spec && (
            <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break" data-doc-page>
              <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>
              <SectionHeading title={`${form.brand} ${form.size} Generator — Product Specifications`}/>
              <div style={{ textAlign: 'center', fontSize: fs(10), fontWeight: 700, color: '#1B3A6B', marginTop: -10, marginBottom: 14 }}>Model: {spec.model}</div>

              <SpecTable header="ELECTRICAL SPECIFICATIONS" rows={[
                ['Rated Output (LP)', form.size, 'Operating Speed', spec.rpm + ' RPM'],
                ['Voltage / Phase',   spec.voltage, 'Amps @ 240V (LP)', spec.amps_lp],
                ['Amps @ 240V (NG)',  spec.amps_ng, 'Circuit Breaker',  spec.breaker],
                ['Voltage Regulation','±1.0% RMS',  'Harmonic Distortion','< 5% THD'],
              ]} fs={fs}/>

              <SpecTable header="ENGINE & UNIT SPECIFICATIONS" rows={[
                ['Engine',       spec.engine,      'Displacement', spec.displacement],
                ['Weight',       spec.weight,      'Dimensions (L×W×H)', spec.dims],
                ['Sound Level',  spec.sound,       'Wind Rating',  spec.wind],
                ['Controller',   spec.controller,  'Certifications', spec.certs],
                ['Warranty',     spec.warranty,    'Min. Clearance', '18 in from structure'],
              ]} fs={fs}/>

              {/* Fuel table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, border: '1px solid #E5E7EB', fontSize: fs(9) }}>
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
                        <td key={j} style={{ padding: '4px 8px', fontSize: j === 0 ? fs(8.5) : fs(9), fontWeight: j === 0 ? 700 : 400, color: j === 0 ? GRAY_M : GRAY_D }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Features */}
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #E5E7EB', marginBottom: 8 }}>
                <thead>
                  <tr style={{ background: NAVY }}>
                    <th style={{ padding: '5px 8px', color: '#fff', textAlign: 'left', fontWeight: 700, fontSize: fs(9) }}>KEY FEATURES &amp; HIGHLIGHTS</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.features.map((f, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC', borderBottom: '1px solid #E5E7EB' }}>
                      <td style={{ padding: '4px 8px', fontSize: fs(8.5), color: GRAY_D }}>✓&nbsp;&nbsp;{f}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: fs(7.5), color: GRAY_M, textAlign: 'center', lineHeight: '12px' }}>
                Specifications subject to change without notice. Source: {form.brand} official product specifications. All ratings at 1.0 PF, 60Hz, per ISO-3046/1.
              </p>
            </div>
          )}

          {/* ═══ SALES AGREEMENT — PAGE 1 ══════════════════════════════════ */}
          <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break" data-doc-page>
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>
            <SectionHeading title="SALES AGREEMENT"/>

            <p style={{ fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 10 }}>
              This Sales Agreement (this "Agreement") is entered into effective{' '}
              {signedDate
                ? <strong style={{ color: GRAY_D }}>{signedDate}</strong>
                : '________________________'}, by and between{' '}
              <strong>Accurate Power &amp; Technology, Inc.</strong> ("APT"), a Florida corporation with its principal place of business at 15519 US Highway 441 Suite A101 Eustis, Fl 32726, and <strong>{form.customer || '________________________'}</strong> (the "Buyer"), having its address at {buyerAddr || '________________________'}. For avoidance of doubt, Accurate Power and Technology, Inc., All State Home Innovations, Inc. and Accurate Power and Technology, Inc. d/b/a "A Generator Guy" are collectively referred to as "APT" throughout this Agreement. APT and the Buyer may be referred to as the Party or the Parties throughout this Agreement.
            </p>
            <p style={{ fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 10 }}>
              In consideration of the mutual promises, covenants, and conditions hereinafter contained, the parties hereto agree as follows:
            </p>

            <Clause num="1" label="Sale of Goods" text="APT hereby sells and Buyer hereby purchases the goods and materials described in the Generator Proposal (attached hereto and incorporated by this reference as if fully stated herein) for the purchase price contained in the Generator Proposal, plus any charges for Additional Labor (as defined in Paragraph 5 below), permit and license fees, and all applicable sales, excise, or other taxes." fs={fs}/>
            <Clause num="2" label="Nonrefundable Deposit" text="Upon Buyer's execution of this Agreement, Buyer shall pay to APT the nonrefundable deposit contained in the Generator Proposal, which deposit will be applied against the purchase price contained in the Generator Proposal. The nonrefundable deposit will not be refundable under any circumstances after APT orders a generator from the manufacturer. APT will only refund deposits in the unlikely event that APT materially breaches this Agreement by wrongfully failing to tender the generator to Buyer. If APT does not receive the deposit by the date and time specified in the Generator Proposal, then this Agreement shall be null and void and neither Party shall have any further obligations or claim against the other for damages or equitable relief of any kind. The balance of the contract purchase price shall be paid in accordance to the schedule stated in the Generator Proposal. If Buyer fails or refuses to pay APT all or any part of the contract purchase price when due, interest shall accrue and be paid to APT in addition to the unpaid purchase price at the rate of eighteen percent (18%) per annum on the unpaid amount." fs={fs}/>
            <Clause num="3" label="Cancellation" text="ALL GENERATOR SALES ARE FINAL. Generators are built on demand and are not returnable. Once APT orders the generator from the manufacturer, APT is not able to return or resell the generator. For this reason, Buyer agrees that Buyer shall pay 25% of the face value of the contract if Buyer cancels after a generator has been ordered or the actual value of the generator, whichever is greater." fs={fs}/>
            <Clause num="4" label="Disclosures" text={'Buyer acknowledges that the Disclosures attached hereto as Exhibit "A", which is incorporated by this reference as though such Disclosures were fully incorporated herein, were provided to the Buyer along with the Generator Proposal. Buyer waives all claims of defective notice as to any matter so disclosed.'} fs={fs}/>
            <Clause num="5" label="Installation Disconnects" text="Buyer understands that the generator project may require a disconnect of power that can only be done by my electric company, and to get the power restored the same day an inspection with my municipality will also be required. Furthermore, the buyer understands that my contractor Accurate Power and Technology will do everything necessary to have my power restored in a timely manner. The Buyer also understands that their electric company and municipality are both separate entities who's schedules and employees cannot be controlled by Accurate Power and therefore may be a delay in power restoration. It's not likely but it can happen, and we just want you to be aware of the what if's that we have ran into." fs={fs}/>
            <Clause num="6" text="I understand that if one or both entities is/are delayed forcing the technicians employed by Accurate Power to remain at my property after 3pm, I the homeowner will be billed Accurate Power's standard after hour charge of $185.00/hr. until the municipality inspector finishes his/her inspection, the power company restores my power, and technician employed by Accurate Power is able to leave my property." fs={fs}/>
            <Clause num="7" label="Installation" text="APT shall provide only the initial installation of the generator at the premises designated in the Generator Proposal. APT may hire third-party contractors (the &quot;Additional Labor&quot;), such as a carpenter, or manual laborer, as needed to facilitate such installation. Buyer understands and agrees that APT is not responsible for the work of such Additional Labor, and Buyer shall reimburse APT for the cost of hiring such Additional Labor. The generator installation shall be deemed accepted by Buyer when it has been installed, inspected, and it is ready for use in accordance with APT's normal standards of installation." fs={fs}/>

            <CustInitFooter initialsImage={initialsImage} fs={fs}/>
          </div>

          {/* ═══ SALES AGREEMENT — PAGE 2 ══════════════════════════════════ */}
          <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break" data-doc-page>
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, textAlign: 'center', marginTop: 16, marginBottom: 4 }}>SALES AGREEMENT (continued)</div>
            <div style={{ height: 2, background: ACCENT, marginBottom: 14 }}/>

            <Clause num="8" label="Taxes" text="Buyer shall pay all federal, state, and local sales, use, property, excise or other taxes imposed on or with respect to the generator and its installation, except taxes levied on APT's net income." fs={fs}/>
            <Clause num="9" label="Access to Site" text="Buyer agrees that APT shall have complete use of and unrestricted access to the installation site during generator installation. Buyer further agrees to remove all obstacles, waste, or debris from the installation site which may affect APT's ability to access the installation site or install the generator. APT requires unlimited access to gated communities during the installation period, and it is Buyer's responsibility to ensure APT has such access." fs={fs}/>
            <Clause num="10" label="No Liability for Property Damage" text="APT assumes no responsibility for damage to plumbing, electrical, underground obstructions, or sprinkler systems, lawn or landscaping during generator installation. Buyer agrees to indemnify and hold harmless APT for any damage to Buyer's property resulting from installation of the generator." fs={fs}/>
            <Clause num="11" label="Buyer's Default" text="If Buyer fails to make any payment due hereunder or becomes insolvent or a party to or acquiesces in any bankruptcy or receivership proceeding or any similar action affecting Buyer's affairs or property, APT may enter upon the premises where the generator may be found and remove the same, without prejudice to any other remedies APT may have. Thereupon, APT may sell the generator so acquired upon commercially reasonably terms as APT may elect and apply the proceeds thereof against the Buyer's obligations hereunder." fs={fs}/>
            <Clause num="12" label="Title" text="Title to the generator shall pass to Buyer immediately upon payment in full of the purchase price, and all associated costs and charges required hereunder." fs={fs}/>
            <Clause num="13" label="Warranties/Limitation of Liabilities" text="APT's warranties and liabilities with regard to the generator and its installation are as follows:" fs={fs}/>
            <SubClause label="a. Limited Warranty" text="Upon completion of the initial installation of the generator, APT warrants only to the original Buyer that the generator will be free from defects in material and workmanship under normal use at the installation site. After the initial installation provided for hereunder, APT shall have no obligation or liability to Buyer for damage to the generator resulting from the repair, maintenance or subsequent reinstallation of the generator by any party other than APT. APT's obligations under this limited material and workmanship warranty, and Buyer's exclusive remedy, shall be limited solely to the repair, exchange or replacement, at APT's election, of any material(s) or workmanship which may thus prove defective under normal use and service, within twelve (12) months from the installation date, and which APT's examination shall disclose to its satisfaction to be defective. This warranty excludes re-used projects, lamps, items furnished by others, unauthorized service, negligent care, vandalism, lightning, or other damages. The express warranties herein are in lieu of all other warranties and in no event shall APT be liable for special, exemplary or consequential damages." fs={fs}/>
            <SubClause label="b. Limitation of Warranties and Liabilities" text="THE WARRANTIES STATED IN PARAGRAPH 11(A) ARE EXPRESSLY IN LIEU OF ALL OTHER WARRANTIES, EXPRESSED OR IMPLIED, INCLUDING THE WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE, AND ALL OTHER OBLIGATIONS OR LIABILITIES ON APT'S PART. APT NEITHER ASSUMES NOR AUTHORIZES ANY OTHER PERSON TO ASSUME FOR IT, ANY OTHER LIABILITY IN CONNECTION WITH THE SALE OF THIS GENERATOR. THERE ARE NO WARRANTIES WHICH EXTEND BEYOND THE TERMS OF PARAGRAPH 11(A) OF THIS AGREEMENT. THESE WARRANTIES SHALL NOT APPLY TO THIS GENERATOR OR ANY PART THEREOF WHICH HAS BEEN SUBJECT TO ACCIDENT, NEGLIGENCE, ALTERATION, ABUSE, OR MISUSE. APT MAKES NO WARRANTY WHATSOEVER WITH RESPECT TO LABOR ACCESSORIES, MATERIALS, OR PARTS NOT SUPPLIED BY APT. AS USED IN THESE WARRANTIES, THE TERM &quot;ORIGINAL BUYER&quot; SHALL MEAN THAT PERSON OR ENTITY NAMED HEREIN FOR WHOM THE GENERATOR IS ORIGINALLY INSTALLED." fs={fs}/>
            <SubClause label="c. Assignment of Manufacturer's Warranties" text="APT hereby assigns to Buyer all of its rights and interests in the warranties, if any, provided by the manufacturer of the generator, to the extent that this assignment is not prohibited by the terms of any agreement between APT and the manufacturer. Manufacturer's warranties can be extended for up to five (5) years on most generators." fs={fs}/>
            <Clause num="14" label="Risk of Loss" text="The risk of loss for the generator shall pass to Buyer upon its delivery to the installation site." fs={fs}/>

            <CustInitFooter initialsImage={initialsImage} fs={fs}/>
          </div>

          {/* ═══ SALES AGREEMENT — PAGE 3 ══════════════════════════════════ */}
          <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break" data-doc-page>
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, textAlign: 'center', marginTop: 16, marginBottom: 4 }}>SALES AGREEMENT (continued)</div>
            <div style={{ height: 2, background: ACCENT, marginBottom: 14 }}/>

            <Clause num="15" label="Security Interest" text="Buyer hereby grants to APT a security interest in the generator to secure payment of the purchase price. A copy of this Agreement may be filed by APT at any time as a financing statement in order to perfect APT's security interest, and Buyer agrees to execute a UCC-1 financing statement to perfect this security interest on demand by APT. APT shall have the right to retake possession of any generator or other merchandise or materials sold to Buyer hereunder and such retaking shall not be construed to be a waiver of APT's lien rights or of any other remedy at law, in equity or otherwise." fs={fs}/>
            <Clause num="16" label="Personal Guaranty" text="As a material inducement to enter into this Agreement, Buyer (or its principals) agrees to personally guaranty payment for all sums due hereunder." fs={fs}/>
            <Clause num="17" label="Permits and Licenses" text="Buyer shall pay for and APT shall secure all permits or licenses required by any state or local authority in connection with the performance of APT's obligations hereunder." fs={fs}/>
            <Clause num="18" label="Breach of Agreement" text="" fs={fs}/>
            <SubClause label="a. Limitation of Action" text="No action at law or in equity shall be maintained by Buyer against APT for APT's alleged breach of this Agreement and/or violation of any federal or state law now in effect or hereafter enacted with respect to any obligation or duty incurred hereunder by APT, unless (i) Buyer notifies APT in writing at the address specified in this Agreement within thirty (30) days from the date of such alleged breach or violation, and provided APT does not remedy or correct the breach or violation within sixty (60) days from the receipt of the notice; and (ii) such action at law or in equity is commenced by Buyer within one (1) year from the finish date of the generator installation, unless extended by ninety (90) days to allow for notice to APT and its response as provided by this paragraph. Notwithstanding the foregoing, nothing contained in this paragraph shall be construed to abridge or limit the warranties contained in Paragraph 11 hereof." fs={fs}/>
            <SubClause label="b. Limitation of Damages" text="If Buyer or APT brings any action at law or equity pursuant to Paragraph 16(a), no cause of action by Buyer or APT shall include a claim, nor may recovery be had against Buyer or APT, for any punitive, incidental, or consequential damages, including but not limited to, damages to property, for loss of use, loss of time, loss of profits or income." fs={fs}/>
            <SubClause label="c. Indemnification and Limited Covenant Not to Sue" text="Buyer shall hold APT harmless and indemnify APT against any and all debts, obligations, costs and damages, including attorney's fees, arising from any claims or causes of action, whether in law or equity or sounding in contract, tort or otherwise, which may be asserted against APT by any person or entity not a party to this Agreement, resulting from the subsequent sale by Buyer, reinstallation by the Buyer, its agents and affiliates, use, repair (other than by APT), maintenance of (other than by APT) or decision to purchase, the generator, provided, however, that this indemnity and hold harmless provision shall not apply to APT's own acts of negligence or willful misconduct in the initial installation of the generator or in APT's repair or replacement thereof. Buyer, its agents, employees, officers, heirs, executors, administrators, and assigns, further agree not to prosecute, maintain or recover upon any rights, claims, demands, damages or causes of action that Buyer could assert against APT, now or in the future, arising from the sale, installation, reinstallation, use, repair or maintenance of the generator, except as specifically provided for in Paragraph 16(a) hereof." fs={fs}/>
            <SubClause label="d. Reservation of Rights" text="In the event Buyer fails to pay APT as agreed, APT reserves the right to cancel all warranties and to cease work on the project until payment is made, or Buyer makes other suitable arrangements satisfactory to APT. Any such cessation of performance shall not constitute a breach of this Agreement by APT." fs={fs}/>
            <Clause num="19" label="Integration" text="This Agreement constitutes the final, complete, exclusive, and fully integrated statement of the terms of the Agreement between the Parties pertaining to the sale and installation of the generator and supersedes all prior and contemporaneous agreements and undertakings of the Parties in connection with this sale." fs={fs}/>
            <Clause num="20" label="Assignment and Delegation" text="This Agreement is not assignable nor is the performance of the duties delegable by the Buyer without APT's prior written consent." fs={fs}/>
            <Clause num="21" label="Binding Effect" text="This Agreement shall inure to the benefit of, and be binding upon, the parties hereto and their respective next-of-kin, legatees, administrators, executors, legal representatives, nominees, successors and assigns." fs={fs}/>

            <CustInitFooter initialsImage={initialsImage} fs={fs}/>
          </div>

          {/* ═══ SALES AGREEMENT — PAGE 4 ══════════════════════════════════ */}
          <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break" data-doc-page>
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, textAlign: 'center', marginTop: 16, marginBottom: 4 }}>SALES AGREEMENT (continued)</div>
            <div style={{ height: 2, background: ACCENT, marginBottom: 14 }}/>

            <Clause num="22" label="Force Majeure" text="APT shall not be liable for any failure to perform as a result of its inability to obtain materials, parts or supplies through its usual and regular sources (or on a timely basis), interruption of transportation, delays in delivery, government regulation, labor disputes, strikes, war, fire, flood, accidents, or other causes beyond APT's control making it impractical for APT to perform." fs={fs}/>
            <Clause num="23" label="Waiver of Default" text="No modification, addition to or waiver of any right, obligation or default shall be effective unless in writing and signed by the Parties. One or more waivers of any right, obligation or default shall not be construed as a waiver of any subsequent or other right, obligation or default." fs={fs}/>
            <Clause num="24" label="Enforceability" text="If any of the provisions of this Agreement, or portions thereof, are found to be invalid by any court of competent jurisdiction, the remainder or this Agreement shall nevertheless remain in full force and effect." fs={fs}/>
            <Clause num="25" label="Notice" text="Notices hereunder shall be in writing and shall be deemed to have been fully given and received when sent by certified or registered mail, return receipt requested, postage prepaid, and properly addressed to the respective Parties at the addresses above, or at such addresses as the Parties may later specify for such purpose." fs={fs}/>
            <Clause num="26" label="Attorney's Fees" text="If APT is required to engage in any proceedings, legal or otherwise, to enforce its rights under this Agreement, APT shall be entitled to recover from Buyer, in addition to any other such sums due, the reasonable attorneys' fees, costs, and necessary disbursements involved in said proceedings." fs={fs}/>
            <Clause num="27" label="Governing Law, Jurisdiction, and Venue" text="This Agreement shall be interpreted under the laws of the State of Florida without regard to its choice of law principles. APT and Buyer agree that any legal or equitable action for claims, debts or obligations arising out of, or to enforce the terms of, this Agreement may be brought in the Circuit Civil Court of the Fifth Judicial Circuit in and for Lake County, Florida, and that such court shall have personal jurisdiction over the parties and venue of the action shall be appropriate in such court." fs={fs}/>

            <p style={{ fontSize: fs(9), lineHeight: '14px', color: GRAY_D, marginTop: 12, marginBottom: 14 }}>
              <strong>In Witness Whereof</strong>, the parties hereto have executed this Agreement on the day and year first above written.
            </p>
            <SigBlock signatureImage={signatureImage} signedDate={signedDate} countersignImage={countersignImage} countersignDate={countersignDate} buyerName={form.customer} fs={fs}/>

            <CustInitFooter initialsImage={initialsImage} fs={fs}/>
          </div>

          {/* ═══ EXHIBIT A — DISCLOSURES (PAGE 1) ══════════════════════════ */}
          <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break" data-doc-page>
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>
            <SectionHeading title="EXHIBIT A: DISCLOSURES"/>

            <p style={{ fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 8 }}>
              <strong>Pre-Purchase Disclaimer and Disclosure Notification:</strong>&nbsp; These disclaimers and disclosures are provided to APT's customers prior to the purchase of any Services or Products from APT and are incorporated by reference into the Sales Agreement when the Buyer agrees to a Generator Proposal.
            </p>
            <p style={{ fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 6 }}>
              <strong>Exclusions:</strong>&nbsp; APT excludes from the Generator Proposal any repairs to existing inoperable equipment and systems that do not comply with electrical codes, regulations, or specifications. APT excludes from the Generator Proposal any utility in and out charges. Permits and Sales Tax are included in the Generator Proposal. Additional taxes, fees, and costs related to these excluded items are the sole responsibility of the Buyer.
            </p>
            <p style={{ fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 6 }}>
              <strong>Time:</strong>&nbsp; All work will be completed between the hours of 7:00 a.m. and 3:30 p.m. Monday through Friday unless otherwise noted in the Generator Proposal. Overtime to accelerate the schedule at the request of the Buyer is the responsibility of the Buyer. During Disconnect this is sometimes unavoidable. We will schedule Disconnects with the power providers when needed. During major outages around the city or county, reconnects are sometimes delayed. Any time after the 4PM cut-off, overtime charges will be passed on to the consumer at a rate of $480 per hour plus $3/mile.
            </p>
            <p style={{ fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 12 }}>
              <strong>Insurance:</strong>&nbsp; APT is licensed and insured according to the laws of the State of Florida. APT carries general liability coverage, commercial automobile coverage, and worker's compensation coverage. Certificates of insurance are available on request. APT is a Drug-Free Workplace.
            </p>

            <div style={{ fontSize: fs(10), fontWeight: 700, color: NAVY, marginBottom: 8 }}>General Disclosures:</div>
            {[
              'APT does not guarantee the Buyer any homeowner’s insurance discount.',
              'Scheduled installation dates may be postponed due to weather such as heavy rain or electrical storms. During severe weather conditions, scheduled disconnects may be postponed due to municipality resource allocations or re-routes.',
              'All quoted materials are good for 30 days. There is no reference to the cost of materials and can go up at any time without warning.',
              'In the event that a named hurricane is formed that threatens the Buyer’s location, APT, will, in its sole discretion, make reasonable accommodations to install the generator before the storm’s arrival. In this event, APT employees may work unusual hours including evenings and weekends in order to complete the installation.',
              'APT installs generators in order by the date of their initial payment.',
              'Individual generator units each carry their own warranties. Please inquire about the manufacturer’s warranty for your purchase. Manufacturer’s warranties can be extended for up to five (5) years on most generators.',
              'Installation timeframes are typically thirty (30) days from the time APT acquires an approved permit and all materials. All efforts will be made to complete Buyer’s installation in a timely manner.',
              'It is APT’s policy to collect payment in a draw-like manner. A deposit of at least 50% will be taken at the contract signing; 50 percent of the remaining balance is due after the electrical is complete, and the remaining gas portion is due upon gas completion. The remainder due under the Generator Proposal and Sales Agreement is due at completion of startup and final inspection and satisfaction is agreed.',
              'All contractors will be paid at completion and proof of payment will be provided at job completion upon request.',
            ].map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5, fontSize: fs(9), lineHeight: '13px', color: GRAY_D, textAlign: 'justify' }}>
                <span style={{ flexShrink: 0 }}>•</span>
                <span>{b}</span>
              </div>
            ))}

            <CustInitFooter initialsImage={initialsImage} fs={fs}/>
          </div>

          {/* ═══ EXHIBIT A — DISCLOSURES (PAGE 2) ══════════════════════════ */}
          <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break" data-doc-page>
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, textAlign: 'center', marginTop: 16, marginBottom: 4 }}>EXHIBIT A: DISCLOSURES (continued)</div>
            <div style={{ height: 2, background: ACCENT, marginBottom: 14 }}/>

            {[
              'Invoices and Commencement Notices MUST be signed before work will begin.',
              'Warning--- Florida’s Construction Law allows unpaid contractors, sub-contractors, and material suppliers to file Liens against your property.',
              'During warranty, manufacturer generally pays for 30 minutes for diagnosis. Buyer will be responsible for additional time and trip charges. APT’s shop rate is $160.00 per hour, including travel time. Mileage will be at the standard IRS rate.',
              'APT cannot quote what we cannot see. Unforeseen problems that arise during generator installation may result in additional labor or materials charges.',
              'No other equipment or services is provided other than those listed herein. During inspections, code violations are sometimes found, and APT is made to bring the prior work to code compliance before proceeding. Such additional work will be completed at an additional cost to the Buyer.',
            ].map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5, fontSize: fs(9), lineHeight: '13px', color: GRAY_D, textAlign: 'justify' }}>
                <span style={{ flexShrink: 0 }}>•</span>
                <span>{b}</span>
              </div>
            ))}

            <div style={{ marginTop: 20, height: 1, background: '#E5E7EB' }}/>
            <div style={{ marginTop: 8, fontSize: fs(8), color: GRAY_M, textAlign: 'center' }}>
              This proposal is valid for {form.validDays ?? 30} days. Accurate Power &amp; Technology, Inc. · Licensed &amp; Insured · FL
            </div>

            <CustInitFooter initialsImage={initialsImage} fs={fs}/>
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
