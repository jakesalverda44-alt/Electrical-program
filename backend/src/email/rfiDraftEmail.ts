// Phase 4 Task 5.1 — the RFI submittal draft email: a numbered list of the
// workspace's open RFI questions, sent to the bid's contact as an Outlook
// DRAFT (never a send — the estimator reviews/sends from Outlook, same
// pattern as the "Email Bid to Team" and pre-bid-to-Chris drafts).
import { escapeHtml } from '../utils/escapeHtml';

export interface RfiQuestion {
  question: string;
}

export function rfiDraftSubject(projectName: string): string {
  return `${(projectName || '').trim() || 'Project'} – RFIs / Bid Clarifications`;
}

export function buildRfiDraftHtml(projectName: string, rfis: RfiQuestion[]): string {
  const items = rfis
    .map(r => `<li style="margin-bottom:8px;">${escapeHtml(r.question)}</li>`)
    .join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6;">
    <p>Hey,</p>
    <p>Please see the open questions below for ${escapeHtml((projectName || '').trim() || 'the project')}:</p>
    <ol>${items}</ol>
    <p>Let us know if you have any clarifications.</p>
  </div>`;
}
