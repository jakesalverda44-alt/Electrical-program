import React from 'react';

// Chrome shared by every proposal document, whatever it sells: the branded page header,
// section headings, the signature block, the clause helpers and the money formatters.
// Extracted from ProposalPreview so a second product's document (EV charger installs)
// composes the same furniture instead of forking 1,500 lines — branding, signature
// blocks and the initials footer then cannot drift apart between the two.
//
// Deliberately NOT here: the Sales Agreement and Disclosures pages. Those read as
// generator sales terms throughout ("ALL GENERATOR SALES ARE FINAL", ordering a unit from
// the manufacturer, a security interest in the generator, the 50% deposit draw schedule),
// so they are not product-independent and stay in ProposalPreview.

export const NAVY   = '#0F2044';
export const ACCENT = '#2563EB';
export const GOLD   = '#C9A84C';
export const GRAY_D = '#1F2937';
export const GRAY_M = '#6B7280';
export const GRAY_L = '#F3F4F6';
export const BLUE_L = '#EFF6FF';
export const BLUE_M = '#DBEAFE';

// The sign sits outside the currency symbol — a credit line reads "-$200.00", not
// "$-200.00". Only a negative custom line item can reach these as a negative today.
export function fmt(n: number) { return (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); }
export function fmtDec(n: number) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Parses a bare "YYYY-MM-DD" as a local calendar date (not UTC midnight) so the
// displayed promo date can't shift a day off in negative-UTC timezones.
export function fmtDateLocal(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

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
// outside a full document render (e.g. tests) is a no-op.
export type FontFn = (n: number) => number;
export const identityFs: FontFn = n => n;

export function PageHeader({ proposalNo, companyName, phone, licLine, fs = identityFs }: { proposalNo: string; companyName: string; phone?: string; licLine?: string; fs?: FontFn }) {
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

export function SectionHeading({ title }: { title: string }) {
  return (
    <>
      <div style={{ fontSize: 18, fontWeight: 900, color: NAVY, textAlign: 'center', marginTop: 20, marginBottom: 4 }}>{title}</div>
      <div style={{ height: 2, background: ACCENT, marginBottom: 14 }}/>
    </>
  );
}

export function SigBlock({ signatureImage, signedDate, countersignImage, countersignDate, buyerName, fs = identityFs }: { signatureImage?: string; signedDate?: string; countersignImage?: string; countersignDate?: string; buyerName?: string; fs?: FontFn }) {
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
export function Clause({ num, label, text, fs = identityFs }: { num: string; label?: string; text: React.ReactNode; fs?: FontFn }) {
  return (
    <div style={{ marginBottom: 9, fontSize: fs(9), lineHeight: '14px', color: GRAY_D, textAlign: 'justify' }}>
      <span style={{ textDecoration: 'underline', fontWeight: 700 }}>{num}.{label ? ` ${label}.` : ''}</span>{'  '}{text}
    </div>
  );
}

export function SubClause({ label, text, fs = identityFs }: { label: string; text: React.ReactNode; fs?: FontFn }) {
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
export function CustInitFooter({ initialsImage, fs = identityFs }: { initialsImage?: string; fs?: FontFn } = {}) {
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
