// Takeoff accuracy Task 13 — the Proposal Preview as a white page in the
// Cowork proposal's format: header block, bold intro, navy section bands,
// small-bullet lists with bold leads, the borderless takeoff table with
// light-blue section rows and numbered items, the terms, and the price in
// words + figures. Strings that the .docx computes (header lines, intro,
// price line, takeoff descriptions) come from the backend's `paper` block so
// the two never drift. Above the page: what the account terms corrected and
// the output-hygiene warnings.
import React from 'react';
import type { BidDataPreview, PreviewBullet } from '../bidDataPreview';
import './proposalPaper.css';

function Bullet({ b }: { b: PreviewBullet }) {
  if (typeof b === 'string') return <li>{b}</li>;
  return <li><b>{b.b}</b>{b.t}</li>;
}

function Band({ children }: { children: React.ReactNode }) {
  return <div className="pp-band">{children}</div>;
}

export default function ProposalPaper({ data, fallbackName, fallbackPrice }: { data: BidDataPreview; fallbackName: string; fallbackPrice: string }) {
  const paper = data.paper;
  const header = paper?.headerLines ?? [
    { text: data.client || '—', bold: true },
    ...(data.contact ? [{ text: `Attn:  ${data.contact}` }] : []),
    { text: `Re:  ${data.project_name || fallbackName}` },
    ...(data.project_address ? [{ text: data.project_address }] : []),
    ...(data.job_number ? [{ text: `Job No:  ${data.job_number}` }] : []),
  ];
  const corrections = data.accountCorrections ?? [];
  const warnings = data.hygieneWarnings ?? [];
  return (
    <div>
      {warnings.length > 0 && (
        <div className="pp-notes pp-notes-warn" data-testid="pp-hygiene">
          <b>Fix before sending ({warnings.length})</b>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {corrections.length > 0 && (
        <div className="pp-notes" data-testid="pp-corrections">
          <b>Account terms applied ({corrections.length})</b> — changes made to the AI draft so it follows this account's furnish/install rules:
          <ul>{corrections.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      <div className="pp-wrap">
        <div className="pp-sheet" data-testid="proposal-paper">
          <div className="pp-hdr">
            {header.map((h, i) => <p key={i} className={h.bold ? 'pp-bold' : undefined}>{h.text}</p>)}
          </div>
          {paper?.introLine && <p className="pp-intro">{paper.introLine}</p>}

          <Band>SCOPE OF WORK</Band>
          <ul className="pp-bullets">{data.scope.map((b, i) => <Bullet key={i} b={b} />)}</ul>
          {data.sections.map((s, si) => (
            <React.Fragment key={si}>
              <Band>{s.title}</Band>
              <ul className="pp-bullets">{s.bullets.map((b, i) => <Bullet key={i} b={b} />)}</ul>
            </React.Fragment>
          ))}

          {data.exclusions.length > 0 && (
            <>
              <Band>EXCLUSIONS &amp; CLARIFICATIONS</Band>
              <ul className="pp-bullets">{data.exclusions.map((b, i) => <Bullet key={i} b={b} />)}</ul>
            </>
          )}

          {data.takeoff.length > 0 && (
            <>
              <Band>ELECTRICAL QUANTITY TAKEOFF</Band>
              <table className="pp-table">
                <colgroup>
                  <col style={{ width: '7.9%' }} /><col style={{ width: '38.7%' }} /><col style={{ width: '7.9%' }} /><col style={{ width: '7.7%' }} /><col style={{ width: '37.8%' }} />
                </colgroup>
                <thead>
                  <tr><th className="pp-c">ITEM</th><th>DESCRIPTION</th><th className="pp-c">UNIT</th><th className="pp-c">QTY</th><th>SOURCE / NOTES</th></tr>
                </thead>
                <tbody>
                  {data.takeoff.map((cat, ci) => (
                    <React.Fragment key={ci}>
                      <tr className="pp-sec"><td colSpan={5}>{cat.name}</td></tr>
                      {cat.items.map((it, ii) => (
                        <tr key={ii}>
                          <td className="pp-c">{ii + 1}</td>
                          <td>{paper?.takeoffDescriptions?.[ci]?.[ii] ?? [it.item, it.description].filter(Boolean).join(' — ')}</td>
                          <td className="pp-c">{it.unit}</td>
                          <td className="pp-c">{String(it.qty ?? '')}</td>
                          <td>{it.source}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {data.terms.length > 0 && (
            <>
              <Band>TERMS, CONDITIONS &amp; SPECIAL REQUIREMENTS</Band>
              <ul className="pp-bullets">{data.terms.map((b, i) => <Bullet key={i} b={b} />)}</ul>
            </>
          )}

          <p className="pp-price-h">Proposal Price Summary</p>
          <p className="pp-price" data-testid="pp-price">{paper?.priceLine ?? `Total Electrical Scope — ${data.total_price || fallbackPrice}`}</p>
          {!!data.alternates?.length && <ul className="pp-bullets">{data.alternates.map((b, i) => <Bullet key={i} b={b} />)}</ul>}
          <div className="pp-close pp-muted">
            <p>Respectfully,</p>
            <p>(Cost based on Terms Above — Due Upon Acceptance to Secure Order)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
