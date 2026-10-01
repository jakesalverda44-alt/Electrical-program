// UI cleanup round 2A — pure helpers for the takeoff review panel.
import type { ResolutionAction, ReviewItem, ReviewResolution } from '../TakeoffReviewPanel';
export { isRealReason } from '../../../estimating/reasons';

export function resolutionText(r: ReviewResolution): string {
  const who = `${r.by}${r.carriedOver ? ', from the previous run' : ''}`;
  // Fewer-questions round — an automatic answer never reads as typed by a person.
  if (r.auto && r.action === 'count') return `${r.qty} EA — ${who}`;
  switch (r.action) {
    case 'count': return `${r.qty} EA — entered by ${who}`;
    case 'markers': return `${r.qty} EA — confirmed markers on the plans (${who})${r.reason ? `. ${r.reason}` : ''}`;
    case 'not_on_job': return `Not on this job — ${r.reason} (${who})`;
    case 'answer': return `${r.answer}${r.qty != null ? ` (${r.qty} EA)` : ''} (${who})`;
    case 'confirm': return `Confirmed${r.qty != null ? ` — ${r.qty} EA` : ''}: ${r.reason} (${who})`;
  }
}

export function actionsOf(item: ReviewItem): ResolutionAction[] {
  if (item.actions?.length) return item.actions;
  if (item.kind === 'scope_question') return ['answer'];
  return item.id.endsWith(':heads') ? ['count', 'not_on_job'] : ['count', 'markers', 'not_on_job'];
}

/** Next round A7 — the cause an item is listed under (the server tags it;
 *  older runs are grouped the same way here). */
export function groupKey(i: ReviewItem): string {
  if (i.group) return i.group;
  // Fix round N8 — a run from before gapfill:/reconcile:/spotcheck: existed
  // never carries these ids, so this fallback only ever needs to classify
  // ids that ARE these prefixes on a current run whose `.group` was
  // stripped somewhere (defensive; `i.group` above already covers the
  // normal case).
  if (i.id.startsWith('checklist:')) return 'checklist';
  // Remodel round A1-A3.
  if (i.id.startsWith('legend-unused:')) return 'legend-unused';
  if (i.id.startsWith('remodel:') || i.id.startsWith('status:') || i.id.startsWith('statuscrop:') || i.id.startsWith('demodup:') || i.id.startsWith('demosheet') || i.id.startsWith('demounit:') || i.id.startsWith('demosuggest:') || i.id.startsWith('democompare:') || i.id.startsWith('demoreuse:') || i.id.startsWith('reuse:')) return 'remodel';
  if (i.id.startsWith('unlisted:')) return 'unlisted';
  if (i.blocking === false && i.id.startsWith('spotcheck:')) return 'spotcheck';
  if (i.blocking === false) return 'info';
  if (i.id.startsWith('legend-zero:')) return 'legend-zero';
  if (i.id.startsWith('textzero:')) return 'textzero';
  if (i.id.startsWith('gapfill:')) return 'gapfill';
  if (i.id.startsWith('consistency:')) return 'consistency';
  if (i.id.startsWith('synonym:') || i.id.startsWith('combined:')) return 'synonym';
  if (i.id.startsWith('classconflict:')) return 'classconflict';
  if (i.id.startsWith('reconcile:')) return 'reconcile';
  if (i.id.startsWith('counting:')) return 'counting';
  if (i.id.startsWith('refsheet:')) return 'refsheets';
  if (i.id.startsWith('sheet:') || i.id.startsWith('file:')) return 'sheets';
  if (i.id.startsWith('scope:')) return 'scope';
  if (i.id.startsWith('viewport:')) return 'viewport';
  if (i.id.startsWith('typical:')) return 'typical';
  if (i.id.startsWith('family:')) return 'family';
  if (i.id.startsWith('schedule:')) return 'schedule';
  if (i.id.startsWith('unscheduled:')) return 'unscheduled';
  if (i.id.startsWith('coverage:')) return 'coverage';
  // UI cleanup round 2A — the backend's groupOf already returns 'recount'.
  if (i.id.startsWith('recount:')) return 'recount';
  if (i.id.endsWith(':heads')) return 'heads';
  if (i.kind === 'area') return 'area';
  if (i.kind === 'count') return /^Could not be counted/.test(i.detail) ? 'unreadable' : 'zero';
  return 'other';
}

// Evidence round 4.5, fix round N8 — grouped in the SAME $-risk order the
// backend's riskRank() sorts the underlying list into (equipment/poles/
// family/reconciliation/typical mismatches first, then commodity devices,
// then admin/scope/informational): 'zero' comes first (it's where an
// equipment or pole type at $0 quantity lands — the single highest-$-risk
// bucket after counting/sheets problems), gapfill/reconcile sit with
// family/typical (all schedule-vs-plans mismatches), and scope questions —
// ranked near the BOTTOM server-side (riskRank 40) — no longer jump the
// queue just because they're a different kind of item. spotcheck (S13) is
// informational, grouped with photometric/checklist/info at the tail.
export const GROUP_ORDER = ['counting', 'refsheets', 'sheets', 'remodel', 'zero', 'textzero', 'unlisted', 'family', 'gapfill', 'consistency', 'reconcile', 'synonym', 'classconflict', 'schedule', 'typical', 'area', 'viewport', 'unreadable', 'recount', 'coverage', 'heads', 'legend-zero', 'unscheduled', 'scope', 'other', 'photometric', 'spotcheck', 'checklist', 'legend-unused', 'info'];

/** Short group headings (the count of open questions is shown beside them). */
export function groupHeading(key: string): string {
  if (key === 'zero') return 'Not found on the plans';
  if (key === 'unreadable') return 'Couldn’t be read clearly';
  if (key.startsWith('area')) return `Same area? ${key.replace(/^area:?/, '') || 'two plans of one level'}`;
  switch (key) {
    case 'scope': return 'Scope questions';
    case 'legend-zero': return 'Legend items not found';
    case 'textzero': return 'Not drawn as symbols — from notes and schedules';
    case 'unscheduled': return 'Not on the fixture schedule';
    case 'remodel': return 'Remodel — new, existing, demolition';
    case 'unlisted': return 'Tags not on the schedule';
    case 'legend-unused': return 'Legend symbols not used — for information';
    case 'coverage': return 'Partly covered';
    case 'viewport': return 'Enlarged plans';
    case 'typical': return 'Typicals';
    case 'family': return 'Same fixture on two schedules';
    case 'gapfill': return 'Possible missed marks';
    case 'reconcile': return 'Schedule and plans don’t match';
    case 'synonym': return 'Same device, two names?';
    case 'consistency': return 'Dense-sheet second count';
    case 'classconflict': return 'One receptacle, two types?';
    case 'spotcheck': return 'Spot-checks — for information';
    case 'schedule': return 'Schedules not fully read';
    case 'heads': return 'Pole heads';
    case 'sheets': return 'Pages not counted';
    case 'refsheets': return 'Referenced sheets missing';
    case 'counting': return 'Counting';
    case 'recount': return 'Recount found fewer';
    case 'photometric': return 'Photometric sheet only — for information';
    case 'checklist': return 'Facility checklist — for information';
    case 'info': return 'By others — for information';
    default: return 'Other';
  }
}

/** How many answers an item needs, and how many it has. A legend group or a
 *  gap-fill/reconcile finding is one item with several members, each answered
 *  on its own; a member waiting on its second number ("needs") is not done. */
export function unitsOf(item: ReviewItem): { total: number; answered: number } {
  let total = 1;
  let answered = item.resolution ? 1 : 0;
  if (item.groupedTypes?.length) {
    total = item.groupedTypes.length;
    answered = item.groupedTypes.filter(m => m.resolution).length;
  } else if (item.reconcileMembers?.length) {
    total = item.reconcileMembers.length;
    answered = item.reconcileMembers.filter(m => m.resolution && !m.resolution.needs).length;
  }
  if (item.resolution) answered = total;
  return { total, answered };
}

/** Progress over the blocking items only (information items never count).
 *  Fewer-questions Task 4 — `excludeStep: 'scope'`: the Takeoff list's own
 *  progress leaves out the questions answered on the Scope step. */
export function reviewProgress(items: ReviewItem[], opts: { excludeStep?: 'scope' } = {}): { total: number; answered: number; open: number } {
  let total = 0;
  let answered = 0;
  for (const i of items) {
    if (i.blocking === false) continue;
    if (opts.excludeStep && i.step === opts.excludeStep) continue;
    const u = unitsOf(i);
    total += u.total;
    answered += u.answered;
  }
  return { total, answered, open: total - answered };
}

export interface ReviewGroup { key: string; items: ReviewItem[]; info: boolean }

export function orderedGroups(openItems: ReviewItem[]): ReviewGroup[] {
  const groups = new Map<string, ReviewItem[]>();
  for (const i of openItems) { const k = groupKey(i); groups.set(k, [...(groups.get(k) ?? []), i]); }
  const order = (k: string) => { const base = GROUP_ORDER.indexOf(k.startsWith('area') ? 'area' : k); return base < 0 ? 99 : base; };
  return [...groups.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([key, items]) => ({ key, items, info: items.every(i => i.blocking === false) }));
}

/** Card order the "Next unanswered" button and focus walk through (blocking groups only). */
export function openOrder(openItems: ReviewItem[]): string[] {
  // Review fix S3 — information items that share a group with blocking ones are skipped.
  return orderedGroups(openItems).filter(g => !g.info).flatMap(g => g.items.filter(i => i.blocking !== false).map(i => i.id));
}

export type CardKind = 'checklist' | 'legendGroup' | 'typicalAssign' | 'reconcile' | 'unlisted' | 'choice' | 'quantity' | 'count' | 'confirm';

export function cardKindOf(item: ReviewItem): CardKind {
  const acts = actionsOf(item);
  if (item.id.startsWith('textzero:')) return 'checklist';
  if (item.groupedTypes?.length) return 'legendGroup';
  if (item.id.startsWith('typicalassign:') && item.reconcileMembers?.length) return 'typicalAssign';
  if (item.reconcileMembers?.length) return 'reconcile';
  if (item.id.startsWith('unlisted:')) return 'unlisted';
  if (acts.includes('answer')) return 'choice';
  if (acts.includes('confirm') && acts.includes('count')) return 'quantity';
  if (acts.includes('count')) return 'count';
  return 'confirm';
}

/** A zero-count item where "Not on this job" is the likeliest answer. */
export function notOnJobFirst(item: ReviewItem): boolean {
  return actionsOf(item).includes('not_on_job') && item.id.startsWith('count:') && !item.id.endsWith(':heads');
}

/** Ready-made reasons for the single-item reason picker. Each one is an honest
 *  statement the estimator chooses to attest to, and passes isRealReason.
 *  Equipment gets none: it must be typed (fix S16). */
export function reasonPresets(item: ReviewItem, action: 'not_on_job' | 'confirm' | 'keep'): string[] {
  if (item.category === 'equipment') return [];
  if (action === 'not_on_job') {
    // Review fix B2 — these say "not shown on the plans", which is only true of a
    // genuine zero count (or a legend-zero member). Anything that WAS found on the
    // plans (unlisted, unscheduled, typical, heads, coverage, demo units...) needs a
    // typed reason. Review fix S2 — no "by others" preset: GC-furnished is APT scope.
    if (!notOnJobFirst(item) && !item.groupedTypes?.length) return [];
    // Re-check R2 — an unreadable type wasn't shown to be absent, so "not shown on the
    // plans" would overstate what was checked: typed reason only.
    if (/^Could not be counted/.test(item.detail ?? '')) return [];
    return ['Not shown on the plans for this job', 'On the legend only — not used on this job', 'Existing to remain — no new work'];
  }
  if (action === 'keep') return ['Checked the plans — keep the current count'];
  const id = item.id;
  // Accuracy round (R) — the site-pole family questions, the pole-line
  // questions and the over-stated warning: a canned reason can't say which
  // count is right — typed reason only.
  if (/^(family|family-same|typicalalign|typicalassign|typicalassignover|pipepoles):/.test(id)) return [];
  if (id.startsWith('spotcheck:')) return ['Checked these marks on the plans — they are right'];
  if (id.startsWith('sheet:') || id.startsWith('file:')) return ['Checked — nothing on this page is missing from the takeoff'];
  if (id.startsWith('refsheet:')) return ['Checked — the takeoff doesn’t need this sheet'];
  if (id.startsWith('demosheet')) return ['Added the demolition in Labor & Pricing'];
  // Review fix B1 — counting:* (counts not verified) clears the biggest gate on the job: typed reason only.
  if (id.startsWith('counting:')) return [];
  // Review fix S5 — panel-dup asks "two panels or one?"; a canned reason can't say which: typed only.
  if (id.startsWith('panel-dup:')) return [];
  if (id.startsWith('schedule:')) return ['Checked the circuits in Labor & Pricing'];
  if (item.kind === 'count' && item.aiCount != null) return [`Checked on the plans — ${item.aiCount} is right`];
  return ['Checked — the takeoff is right as it is'];
}

/** Button text for an answer option. The payload always sends `option`, never the label. */
export function choiceLabel(item: ReviewItem, option: string, _index?: number): { label: string; hint?: string } {
  if (item.id.startsWith('area:')) {
    const keep = /^Same area — keep (\d+)$/.exec(option);
    if (keep) return { label: `Same area — keep the larger (${keep[1]})` };
    const sum = /^Different areas — sum (\d+)$/.exec(option);
    if (sum) return { label: `Different areas — add them (${sum[1]})` };
  }
  if (item.id.startsWith('reuse:')) {
    if (option.startsWith('Existing, reused')) return { label: 'Existing reused', hint: 'no new install, no demolition' };
    if (option.startsWith('New install')) return { label: 'New install', hint: 'the old one is removed' };
  }
  return { label: option };
}
