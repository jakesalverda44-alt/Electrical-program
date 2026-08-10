import React, { useRef, useState } from 'react';
import { EvForm, evTierLabel } from './evData';
import { EvTotals } from './evCalc';
import { activeCustomItems, customItemAmount } from './genCalc';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { useIsMobile } from '../../hooks/useIsMobile';
import api from '../../api/client';
import {
  NAVY, ACCENT, GRAY_D, GRAY_M, GRAY_L, BLUE_L, BLUE_M,
  fmtDec, embedFontSize, embedDocStyle, embedPageStyle,
  PageHeader, SectionHeading, SigBlock,
} from './proposalChrome';

// The Tesla Wall Connector proposal. Shares its branding, page furniture and signature
// block with the generator proposal through proposalChrome, but carries its own scope and
// pricing: the customer buys the charger from Tesla, so APT sells the installation alone.
//
// It deliberately ends at the signature block. The generator document's Sales Agreement and
// Disclosures are written as generator sales terms throughout — final sale of a
// built-to-order unit, a security interest in that unit, a 50% deposit draw schedule — none
// of which describe installing equipment the customer already owns. EV-specific terms need
// to come from APT's attorney before they can appear here.

interface Props {
  form: EvForm;
  totals: EvTotals;
  proposalNo: string;
  onBack?: () => void;
  appSettings?: AppSettings;
  genId?: string;
  /** Embed mode: render only the document (no toolbar/back/print) — used by the public signing page. */
  embed?: boolean;
  signatureImage?: string;
  signedDate?: string;
  countersignImage?: string;
  countersignDate?: string;
}

export default function EvProposalPreview({ form, totals, proposalNo, onBack, appSettings, genId, embed, signatureImage, signedDate, countersignImage, countersignDate }: Props) {
  const co = appSettings ?? DEFAULT_APP_SETTINGS;
  const previewRef = useRef<HTMLDivElement>(null);
  const [savingDrive, setSavingDrive] = useState(false);
  const [driveSaved, setDriveSaved] = useState(false);
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
  const addrDisplay = [form.address, [form.city, form.state, form.zip].filter(Boolean).join(', ')].filter(Boolean).join('  |  ');
  const customItems = activeCustomItems(form);
  const tierLabel = evTierLabel(form.distanceTier);

  const docStyle: React.CSSProperties = embedDocStyle(!!embed, isMobile);
  const pageStyle: React.CSSProperties = embedPageStyle(!!embed, isMobile);

  const scopeRows: { title: string; desc: React.ReactNode; shade: boolean }[] = [
    {
      title: 'Scope of Work — Tesla Wall Connector Installation',
      desc: `Furnish and install a dedicated circuit from the existing electrical panel to the charger location (${tierLabel.toLowerCase()}), including breaker, wire, conduit, mounting of the Wall Connector, terminations, grounding, testing and energization per ${new Date().getFullYear()} NEC.`,
      shade: true,
    },
    {
      title: 'Equipment — Customer Supplied',
      desc: 'The Tesla Wall Connector is supplied by the customer. APT furnishes all wire, conduit, breaker and mounting hardware required to complete the installation.',
      shade: false,
    },
    ...(form.panelUpgrade ? [{
      title: 'Service Upgrade to 200A',
      desc: 'Upgrade the existing electrical service to 200A to support the added charging load, including panel, main breaker, grounding and utility coordination.',
      shade: true,
    }] : []),
    ...(customItems.length ? [{
      title: 'Additional Work Included',
      desc: customItems.map(it => `• ${it.desc.trim()}`).join('\n'),
      shade: !form.panelUpgrade,
    }] : []),
    {
      title: '1-Year Workmanship Warranty',
      desc: "APT warrants the installation against defects in workmanship for one (1) year from the date of completion. The Tesla Wall Connector itself carries Tesla's manufacturer warranty.",
      shade: false,
    },
    ...(form.notes && form.notes.trim() ? [{
      title: 'Additional Notes',
      desc: form.notes.trim(),
      shade: true,
    }] : []),
  ];

  const breakdownRows: { label: string; amt: number }[] = [
    { label: `Wall Connector Installation — ${tierLabel}`, amt: totals.tierAmt },
    ...(totals.panelUpgradeAmt ? [{ label: 'Service Upgrade to 200A', amt: totals.panelUpgradeAmt }] : []),
    ...customItems.map(it => ({ label: it.desc.trim(), amt: customItemAmount(it) })),
  ];

  return (
    <div className={embed ? 'proposal-embed' : 'scroll view-enter'}>
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

          {/* ═══ PAGE 1 — PROPOSAL ═══════════════════════════════════════ */}
          <div style={pageStyle} data-doc-page>
            <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>

            <SectionHeading title="PROPOSAL"/>
            <div style={{ textAlign: 'center', fontSize: 11, color: GRAY_M, marginTop: -10, marginBottom: 14 }}>
              EV Charger Installation Agreement
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
                  <td style={{ padding: '5px 8px' }} colSpan={2}>
                    {form.depositPct > 0 ? `${form.depositPct}% due at signing` : 'Due upon completion'}
                  </td>
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
              {totals.deposit > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: fs(9), color: '#93C5FD' }}>Deposit at signing</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmtDec(totals.deposit)}</div>
                </div>
              )}
            </div>

            {/* Intro */}
            <p style={{ fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify', marginBottom: 12 }}>
              {companyName} proposes to furnish all labor and material necessary to install the customer's
              Tesla Wall Connector as described below. Our price is in accordance with the{' '}
              <strong>{new Date().getFullYear()} National Electrical Code</strong> and the following
              qualifications: {licLine || 'Licensed & Insured'}.{' '}
              <strong>THIS PROPOSAL AND ALL MATERIAL COSTS ARE VALID FOR {form.validDays ?? 30} DAYS.</strong>
            </p>

            {/* Scope of work table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, border: '1px solid #E5E7EB', fontSize: fs(9) }}>
              <tbody>
                {scopeRows.map((row, idx) => ({ ...row, n: String(idx + 1) })).map(row => (
                  <tr key={row.n} style={{ background: row.shade ? '#F8FAFC' : '#fff', verticalAlign: 'top', borderBottom: '1px solid #E5E7EB' }}>
                    <td style={{ padding: '7px 6px', width: 20, fontWeight: 800, color: ACCENT, textAlign: 'center' }}>{row.n}</td>
                    <td style={{ padding: '7px 6px', width: '30%', fontWeight: 700, color: '#1B3A6B', lineHeight: '13px' }}>{row.title}</td>
                    <td style={{ padding: '7px 6px', color: GRAY_M, lineHeight: '13px', whiteSpace: 'pre-line' }}>{row.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <SigBlock signatureImage={signatureImage} signedDate={signedDate} countersignImage={countersignImage} countersignDate={countersignDate} buyerName={form.customer} fs={fs}/>
          </div>

          {/* ═══ PAGE 2 (OPTIONAL) — PRICE BREAKDOWN ═════════════════════ */}
          {form.includeBreakdown && (
            <div style={{ ...pageStyle, pageBreakBefore: 'always' }} className="page-break" data-doc-page>
              <PageHeader proposalNo={proposalNo} companyName={companyName} phone={co.company_phone} licLine={licLine} fs={fs}/>
              <SectionHeading title="PRICE BREAKDOWN"/>
              {/* No Tax Status column: an EV quote's tax is a flat materials passthrough, so
                  there is no per-row taxable/non-taxable status to report. */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fs(9), marginBottom: 10 }}>
                <thead>
                  <tr style={{ background: NAVY }}>
                    <th style={{ padding: '6px 10px', color: '#fff', textAlign: 'left', fontWeight: 700 }}>Item</th>
                    <th style={{ padding: '6px 10px', color: '#fff', textAlign: 'right', fontWeight: 700, width: 120 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : GRAY_L, borderBottom: '1px solid #E5E7EB' }}>
                      <td style={{ padding: '5px 10px', color: GRAY_D }}>{r.label}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: GRAY_D }}>{fmtDec(r.amt)}</td>
                    </tr>
                  ))}
                  {totals.discountAmt > 0 && (
                    <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                      <td style={{ padding: '5px 10px', color: GRAY_D }}>Discount</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: GRAY_D }}>{fmtDec(-totals.discountAmt)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={2} style={{ padding: '3px 0' }}/>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #E5E7EB', background: GRAY_L }}>
                    <td style={{ padding: '5px 10px', color: GRAY_M, fontSize: fs(8.5) }}>Sales Tax</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: GRAY_D, fontWeight: 700 }}>{fmtDec(totals.tax)}</td>
                  </tr>
                  <tr style={{ background: NAVY }}>
                    <td style={{ padding: '7px 10px', color: '#fff', fontWeight: 800, fontSize: 11 }}>Cash Price Total</td>
                    <td style={{ padding: '7px 10px', color: '#fff', fontWeight: 900, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDec(totals.total)}</td>
                  </tr>
                  {totals.deposit > 0 && (
                    <tr style={{ background: GRAY_L }}>
                      <td style={{ padding: '5px 10px', color: GRAY_M, fontSize: fs(8.5) }}>Deposit Due at Signing ({form.depositPct}%)</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: GRAY_M }}>{fmtDec(totals.deposit)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
