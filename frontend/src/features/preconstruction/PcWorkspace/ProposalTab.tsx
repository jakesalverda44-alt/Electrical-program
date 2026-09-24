import React, { memo } from 'react';
import Icon from '../../../components/Icon';
import { Bid } from '../../../types';
import SendBidProposalModal from '../SendBidProposalModal';
import { BidDataPreview, VerifyFailure } from '../bidDataPreview';
import KeepLineControl, { DoubleCountControl } from './KeepLineControl';
import ProposalPaper from './ProposalPaper';
import { AiResults } from './shared';

interface ProposalTabProps {
  bid: Bid;
  aiResults: AiResults;
  propPrice: string;
  setPropPrice: (v: string) => void;
  /** Fix round 2 / SF3 — true when propPrice was typed by hand and differs
   *  from the engine's current total. */
  priceMismatch?: boolean;
  /** Fix round 2 / SF3 — the engine's current (live) grand total, for the mismatch banner's message. */
  engineTotal?: number | null;
  /** Fix round 2 / SF3 — resets propPrice to engineTotal and resumes auto-sync. */
  onUseEngineTotal?: () => void;
  propNotes: string;
  setPropNotes: (v: string) => void;
  agent4StartError: string | null;
  setAgent4StartError: (v: string | null) => void;
  agent4Running: boolean;
  /** Stop analysis — stop a running Agent 4. */
  stopAgent4?: () => void;
  stoppingAgent4?: boolean;
  runAgent4Proposal: () => void;
  downloadDocx: () => void;
  docxBusy: boolean;
  downloadTakeoffXlsx: () => void;
  xlsxBusy: boolean;
  sendProposalOpen: boolean;
  setSendProposalOpen: (v: boolean) => void;
  /** Fix round B5/gap 2 — see SendBidProposalModal's own prop comment. */
  onJumpToEvidenceLine?: (lineKey: string) => void;
  onBidUpdated: (bid: Bid) => void;
  showToast: (t: import('../../../types').Toast) => void;
  generatePrebidPackage: () => void;
  prebidBusy: boolean;
  prebidResult: { scopeDocumentId: string | null; takeoffDocumentId: string | null } | null;
  downloadFiledDocument: (docId: string, filename: string) => void;
  emailPrebidToChris: () => void;
  chrisDraftBusy: boolean;
  chrisDraftLink: string | null;
  verifyFailures: VerifyFailure[] | null;
  proposalPreview: BidDataPreview | null;
  convertOpen: boolean;
  setConvertOpen: (v: boolean) => void;
  handleConvert: () => void;
}

function ProposalTab({ bid, aiResults, propPrice, setPropPrice, priceMismatch, engineTotal, onUseEngineTotal, propNotes, setPropNotes,
  agent4StartError, setAgent4StartError, agent4Running, stopAgent4, stoppingAgent4, runAgent4Proposal, downloadDocx, docxBusy,
  downloadTakeoffXlsx, xlsxBusy, sendProposalOpen, setSendProposalOpen, onJumpToEvidenceLine, onBidUpdated, showToast,
  generatePrebidPackage, prebidBusy, prebidResult, downloadFiledDocument, emailPrebidToChris,
  chrisDraftBusy, chrisDraftLink, verifyFailures, proposalPreview, convertOpen, setConvertOpen,
  handleConvert }: ProposalTabProps) {
  // Takeoff accuracy Task 7 — mirrors the server gate (409 on run-agent4 /
  // generate-docx / generate-takeoff-xlsx / draft-proposal).
  const reviewItems = (aiResults?.review_items as Array<{ resolution?: unknown }> | null | undefined) ?? [];
  const openReviewCount = reviewItems.filter(i => !i.resolution).length;
  // Fix round 1 / B5 — a run in progress (review 'pending') blocks too.
  const analysisPending = aiResults?.review_status === 'pending';
  const reviewBlocked = (aiResults?.review_status === 'needs_review' && openReviewCount > 0) || analysisPending;
  const agent4Raw    = aiResults?.agent4_output as string | undefined;
  const agent4Status = aiResults?.agent4_status as string | undefined;
  const agent4ErrMsg = aiResults?.agent4_error  as string | undefined;
  // A parsed agent4_output existing is enough to know a proposal is on
  // file and drives the button/badge state — the actual preview content
  // (Task 7) comes from proposalPreview, the composed BidData, which
  // already normalizes both Agent 4's new shape and a pre-Phase-3
  // legacy row into one consistent structure server-side.
  let propParseError = false;
  if (agent4Raw) {
    try { JSON.parse(agent4Raw); }
    catch { propParseError = true; }
  }
  const hasProposal = !!agent4Raw && !propParseError;
  const fieldStyle: React.CSSProperties = {
    width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
    color: 'var(--text)', background: 'var(--surface)',
    border: '1px solid var(--border2)', borderRadius: 8,
    padding: '8px 11px', outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 800, color: 'var(--text3)',
    textTransform: 'uppercase', letterSpacing: '.05em',
    display: 'block', marginBottom: 6,
  };
  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Input + action panel */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hdr">
          <span className="panel-title">
            <span className="pt-ic"><Icon name="doc" size={14} stroke={1.9}/></span>
            Agent 4 — Proposal Formatter
          </span>
          {hasProposal && (
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>
              <Icon name="check" size={12} stroke={2.2}/> Proposal ready
            </span>
          )}
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Total Bid Price ($)</label>
              <input type="number" value={propPrice}
                onChange={e => { setPropPrice(e.target.value); setAgent4StartError(null); }}
                placeholder="e.g. 285000" style={fieldStyle}/>
              {priceMismatch && engineTotal != null && (
                <div
                  data-testid="propprice-mismatch-warning"
                  style={{
                    marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: 'var(--amber-soft)', border: '1px solid rgba(224,165,59,.4)', color: 'var(--amber)',
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}
                >
                  <span>Differs from the engine total (${engineTotal.toFixed(2)}).</span>
                  <button type="button" className="btn ghost" style={{ fontSize: 11, alignSelf: 'flex-start' }}
                    onClick={onUseEngineTotal} data-testid="propprice-use-engine-total">
                    Use engine total
                  </button>
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Internal Notes for Agent 4 (optional)</label>
              <textarea value={propNotes} onChange={e => setPropNotes(e.target.value)}
                placeholder="Manual items, RFI outcomes, scope adjustments, pricing notes..."
                rows={3} style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }}/>
            </div>
          </div>
          {agent4StartError && (
            <div style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 8,
              background: 'var(--amber-soft)', border: '1px solid rgba(224,165,59,.4)',
              color: 'var(--amber)', fontSize: 12.5, fontWeight: 700,
            }}>
              {agent4StartError}
            </div>
          )}
          {/* Fix round 2 / N-R2-6 — the legacy note, here as well as in the Takeoff step. */}
          {!aiResults?.review_status && !!aiResults?.agent1_output && !aiResults?.run_id && (
            <div data-testid="proposal-legacy-note" style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--surface2)',
              border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 12.5, fontWeight: 700,
            }}>
              Analyzed before accuracy checks — re-run analysis to enable counting and account rules. Its account-rule questions are listed in the Takeoff step.
            </div>
          )}
          {reviewBlocked && (
            <div data-testid="proposal-review-blocked" style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 8,
              background: 'var(--amber-soft)', border: '1px solid rgba(224,165,59,.4)',
              color: 'var(--amber)', fontSize: 12.5, fontWeight: 700,
            }}>
              {analysisPending
                ? 'The takeoff analysis is running (or did not finish). The proposal can’t be generated, downloaded or sent until it completes.'
                : <>The takeoff needs review first: {openReviewCount} item{openReviewCount === 1 ? '' : 's'} open in the Takeoff step
                  (counts that came back zero or unreadable, or scope questions). The proposal can’t be generated, downloaded or sent until they’re resolved.</>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn" onClick={runAgent4Proposal}
              disabled={reviewBlocked || agent4Running || !propPrice.trim() || !aiResults?.agent2_output}
              style={{ fontSize: 13 }}>
              {agent4Running
                ? 'Generating proposal…'
                : (hasProposal || propParseError || agent4Status === 'error') ? '↺ Re-run Agent 4' : 'Run Agent 4 — Generate Proposal'}
            </button>
            {hasProposal && (
              <button className="btn" onClick={downloadDocx} disabled={docxBusy} style={{ fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)' }}>
                <Icon name="doc" size={14} stroke={1.9}/> {docxBusy ? 'Building…' : 'Download .docx'}
              </button>
            )}
            {hasProposal && (
              <button className="btn ghost" onClick={downloadTakeoffXlsx} disabled={xlsxBusy} style={{ fontSize: 13 }}>
                <Icon name="doc" size={14} stroke={1.9}/> {xlsxBusy ? 'Building…' : 'Download Takeoff (.xlsx)'}
              </button>
            )}
            {/* Phase 4 Task 1.4, reworked post-merge (2026-09-03) —
                creates an Outlook draft with the filed proposal
                attached; Jake reviews and sends it himself (GCs
                execute via contract/PO, not a web e-sign page).
                Enabled once a proposal exists; the backend 409s
                (surfaced via the modal's error state) if nothing has
                been downloaded/filed yet. */}
            {hasProposal && (
              <button className="btn ghost" onClick={() => setSendProposalOpen(true)} style={{ fontSize: 13, color: 'var(--blue)' }}>
                <Icon name="mail" size={14} stroke={1.9}/> Draft Proposal Email
              </button>
            )}
            {hasProposal && (
              <button className="btn" onClick={() => setConvertOpen(true)}
                style={{ fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)', marginLeft: 'auto' }}>
                <Icon name="check" size={14} stroke={2.2}/> Mark as Awarded
              </button>
            )}
          </div>
          {!aiResults?.agent2_output && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}>
              ⚠ Run the 3-agent plan analysis first — Agent 4 needs scope data from Agent 2.
            </div>
          )}
          {/* proposal_sent_at still stamps from draft-proposal's markSubmitted
              checkbox (Task 4) — proposal_viewed_at/proposal_signed_at are no
              longer written by anything (the public proposal page is gone),
              so this chip no longer reports them. */}
          {bid.proposal_sent_at && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
              <Icon name="check" size={12} stroke={2.2} style={{ color: 'var(--green)' }}/>{' '}
              Marked Submitted {new Date(bid.proposal_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {bid.proposal_sent_to?.[0] ? ` — to ${bid.proposal_sent_to[0]}${bid.proposal_sent_to.length > 1 ? ` +${bid.proposal_sent_to.length - 1}` : ''}` : ''}
            </div>
          )}
        </div>
      </div>

      {sendProposalOpen && (
        <SendBidProposalModal
          bid={bid}
          onClose={() => setSendProposalOpen(false)}
          onJumpToEvidenceLine={onJumpToEvidenceLine}
          onSent={({ bid: updatedBid, stageAdvanced, attached }) => {
            onBidUpdated(updatedBid);
            showToast({
              title: 'Outlook draft created',
              sub: [
                attached === 'pdf' ? 'PDF attached' : 'Word attached — install LibreOffice for PDF',
                stageAdvanced ? 'Stage advanced to Submitted' : null,
              ].filter(Boolean).join(' · '),
            });
          }}
        />
      )}

      {/* Takeoff accuracy Task 12 — the Pre-Bid Package for Chris moved to
          the end of the Takeoff step (it builds from the pre-bid draft, before
          any price). */}

      {/* Task 6/7 — the verify gate's failures never fail silently: list
          each check + its matched text with re-run guidance. */}
      {verifyFailures && verifyFailures.length > 0 && (
        <div className="panel" style={{ marginBottom: 16, borderColor: 'rgba(224,106,106,.4)' }}>
          <div className="panel-hdr" style={{ background: 'rgba(224,106,106,.12)' }}>
            <span className="panel-title" style={{ color: 'var(--red)' }}>
              <span className="pt-ic" style={{ background: 'rgba(224,106,106,.2)', color: 'var(--red)' }}>
                <Icon name="x" size={14} stroke={2.2}/>
              </span>
              Proposal Did Not Pass Verification
            </span>
          </div>
          <div style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text2)' }}>
            <div style={{ marginBottom: 10, lineHeight: 1.6 }}>
              This document did not pass the bid-standard checks below — fix the estimator notes/scope and{' '}
              <strong>↺ Re-run Agent 4</strong> above before sending it to the GC.
            </div>
            {verifyFailures.map((f, i) => (
              <div key={i} style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(224,106,106,.08)', borderRadius: 8, border: '1px solid rgba(224,106,106,.25)' }}>
                <div style={{ fontWeight: 800, color: 'var(--red)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>
                  {f.check.replace(/_/g, ' ')}
                </div>
                <div style={{ marginBottom: (f.matches ?? []).length ? 4 : 0 }}>{f.detail}</div>
                {f.check === 'possible_double_count' && f.category && f.line && f.flag && (
                  <DoubleCountControl bidId={bid.id} category={f.category} line={f.line} typeKey={f.flag.replace(/^dup:/, '')} showToast={showToast} />
                )}
                {(f.check === 'non_electrical' || f.check === 'excluded_scope' || f.check === 'count_line_ambiguous' || f.check === 'irrelevant_spec' || f.check === 'gc_scope') && f.category && f.line && (
                  <KeepLineControl bidId={bid.id} category={f.category} line={f.line} flag={f.flag ?? f.check} showToast={showToast} />
                )}
                {(f.matches ?? []).length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                    Matched: {(f.matches ?? []).map((m, mi) => (
                      <code key={mi} style={{ background: 'var(--surface3)', padding: '1px 5px', borderRadius: 4, marginRight: 5 }}>{m}</code>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent 4 in-progress indicator */}
      {agent4Running && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="spinner" style={{ width: 16, height: 16, border: '2px solid var(--border2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }}/>
            <span style={{ flex: 1 }}>Generating the proposal with Agent 4…</span>
            {stopAgent4 && (
              <button className="btn ghost" onClick={stopAgent4} disabled={stoppingAgent4} data-testid="stop-agent4"
                style={{ fontSize: 12.5, color: 'var(--red)', borderColor: 'rgba(224,106,106,.45)' }}
                title="Stops the AI run; you'll need to re-run. Tokens already used are still billed.">
                {stoppingAgent4 ? 'Stopping…' : 'Stop'}
              </button>
            )}
          </div>
        </div>
      )}
      {!agent4Running && aiResults?.agent4_status === 'cancelled' && (
        <div data-testid="agent4-stopped" style={{ marginBottom: 16, fontSize: 12.5, fontWeight: 700, color: 'var(--amber)' }}>
          Proposal generation stopped{aiResults?.agent4_error ? ` — ${String(aiResults.agent4_error)}` : ''}. Generate it again when ready.
        </div>
      )}

      {/* Agent 4 error state — DB-stored error or legacy parse failure */}
      {(agent4Status === 'error' || propParseError) && !agent4Running && (
        <div className="panel" style={{ marginBottom: 16, borderColor: 'rgba(224,165,59,.4)' }}>
          <div className="panel-hdr" style={{ background: 'var(--amber-soft)' }}>
            <span className="panel-title" style={{ color: 'var(--amber)' }}>
              <span className="pt-ic" style={{ background: 'rgba(224,165,59,.2)', color: 'var(--amber)' }}>
                <Icon name="zap" size={14} stroke={2}/>
              </span>
              Agent 4 Did Not Complete
            </span>
          </div>
          <div style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
            {agent4ErrMsg ?? 'The previous run was cut off before finishing.'} Click <strong>↺ Re-run Agent 4</strong> above to try again.
          </div>
        </div>
      )}
      {/* Proposal preview — Task 7: the composed BidData, sections by
          their real titles, exclusions, alternates, terms, price from
          the bid record. Same panel renders a legacy-shape row too —
          the backend's adapter already normalized it. */}
      {proposalPreview && (
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">Proposal Preview</span>
          </div>
          <ProposalPaper data={proposalPreview} fallbackName={bid.name} fallbackPrice={propPrice} />
        </div>
      )}

      {convertOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div className="panel" style={{ width: 380, padding: 28 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', marginBottom: 12 }}>Convert to Awarded Project?</div>
            <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 20 }}>
              This will mark <b>{bid.name}</b> as Awarded and add it to Electrical Projects.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn ghost" onClick={() => setConvertOpen(false)} style={{ flex: 1, fontSize: 13 }}>Cancel</button>
              <button className="btn" onClick={handleConvert}
                style={{ flex: 1, fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)' }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ProposalTab);
