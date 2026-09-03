// Phase 4 Task 1 — the GC submittal email (and its internal Chris variant),
// built verbatim from the authority template:
//   ~/.claude/skills/apt-electrical-bid/templates/submittal_email.md
// "Short and non-formal. Never include the price or a scope summary."
//
// Pure — no DB, no I/O. bidSubmittalEmail.test.ts locks the exact strings
// against drift and guards that no amount ever leaks into either body.
import { escapeHtml } from '../utils/escapeHtml';

export interface SubmittalBidLike {
  name?: string | null;
  loc?: string | null;
  /** Accepted so a full bid row can be passed straight through — deliberately
   *  UNUSED by every string below (see the guard test). */
  amount?: number | string | null;
}

const JAKE_SIGNATURE_LINES = [
  'Jake Salverda',
  'Commercial A.E. – Central FL Region',
  'Accurate Power & Technology',
  '352-801-8997',
];

/** Subject line: "[Project Name] – [Location] | Electrical Proposal", verbatim. */
export function defaultSubmittalSubject(bid: SubmittalBidLike): string {
  const project = (bid.name || '').trim() || 'Project';
  const loc = (bid.loc || '').trim() || 'Location';
  return `${project} – ${loc} | Electrical Proposal`;
}

/** The editable message body (everything before the link + signature), verbatim
 *  structure from the template's "Hey, … Let us know if you have any clarifications." */
export function defaultSubmittalBodyText(bid: SubmittalBidLike): string {
  const project = (bid.name || '').trim() || 'the project';
  const loc = (bid.loc || '').trim();
  return [
    'Hey,',
    '',
    `Please find attached our electrical proposal for the ${project}${loc ? ` at ${loc}` : ''}.`,
    'Let us know if you have any clarifications.',
  ].join('\n');
}

function nl2br(text: string): string {
  return escapeHtml(text).split('\n').join('<br>');
}

/**
 * Build the final HTML actually sent to the GC. `bodyText` is whatever the
 * sender edited (defaults to defaultSubmittalBodyText's template); the
 * proposal link line and Jake's four-line signature are ALWAYS appended by
 * this function, never editable, so "View and accept online: <link>" and the
 * signature can never be stripped by an edit — see Task 1.3.
 */
export function buildBidSubmittalHtml(opts: { bodyText: string; proposalLink?: string }): string {
  const blocks: string[] = [nl2br(opts.bodyText || '')];
  if (opts.proposalLink) {
    const escapedLink = escapeHtml(opts.proposalLink);
    blocks.push(`View and accept online: <a href="${escapedLink}">${escapedLink}</a>`);
  }
  blocks.push(['Thanks,', ...JAKE_SIGNATURE_LINES].map(escapeHtml).join('<br>'));
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6;">${blocks.join('<br><br>')}</div>`;
}

// ── Internal — pre-bid package to Chris ─────────────────────────────────────
// A different email entirely (per the template): drafted, never sent.

export function defaultPrebidChrisSubject(bid: SubmittalBidLike): string {
  // FIX-11 (post-review) — this subject never included location (per the
  // template's "[Project Name] – Pre-Bid Scope + Takeoff" verbatim, unlike
  // the GC submittal subject which does); the `loc` local computed here was
  // dead — removed.
  const project = (bid.name || '').trim() || 'Project';
  return `${project} – Pre-Bid Scope + Takeoff`;
}

export interface PrebidChrisBodyInput extends SubmittalBidLike {
  /** Drawing set date(s), e.g. "07.15.2026" — the template's "Drawings dated [date]." */
  planDate?: string | null;
}

export function buildPrebidChrisBodyHtml(bid: PrebidChrisBodyInput): string {
  const project = (bid.name || '').trim() || 'the project';
  const loc = (bid.loc || '').trim();
  const planDate = (bid.planDate || '').trim();
  const lines = [
    'Chris,',
    '',
    `Scope doc and takeoff attached for ${project}${loc ? `, ${loc}` : ''}.${planDate ? ` Drawings dated ${planDate}.` : ''}`,
    'Confidence coded — FIRM off the schedules, APPROX are symbol counts with ranges, VERIFY needs a second look. Notes at the bottom of the takeoff.',
    '',
    'Jake',
  ];
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6;">${nl2br(lines.join('\n'))}</div>`;
}
