// Takeoff accuracy, Task 7 — the Needs-review list (Decision 6) and its gate.
//
// Two kinds of item, one list:
//   * 'count'          — a type from the schedule/legend whose final count is
//                        0 or unreadable (or a pole type's heads when the
//                        schedule gives no heads-per-pole). Never ASSUMED:
//                        the estimator enters a count, confirms markers on
//                        the plans, or marks it "Not on this job" (reason
//                        required).
//   * 'scope_question' — a furnish/install term an account rule marks `ask`
//                        with no explicit statement on the drawings (Task 8).
//                        Answered from the listed options.
// Any open item puts the takeoff in 'needs_review', which blocks Agent 4,
// proposal .docx / GC takeoff .xlsx generation and the proposal send.
//
// Pure: building, merging (a re-run keeps the estimator's earlier
// resolutions — their work is never silently discarded) and validating a
// resolution. The DB/route half lives in routes/preconstruction.ts.
import type { CountResult } from './countingStage';

export type ReviewItemKind = 'count' | 'scope_question' | 'area' | 'confirm';
export type ResolutionAction = 'count' | 'markers' | 'not_on_job' | 'answer' | 'confirm';

export interface ReviewResolution {
  action: ResolutionAction;
  qty?: number;
  reason?: string;
  answer?: string;
  /** Scope questions (fix round 1 / B7) — the structured parties the answer
   *  stands for, so nothing downstream re-parses display text. */
  furnishBy?: string;
  installBy?: string;
  by: string;
  at: string;
  /** True when this resolution was made on an earlier analysis run and
   *  carried forward to this one. */
  carriedOver?: boolean;
}

export interface ReviewItem {
  /** Stable across re-runs: `count:<TYPEKEY>`, `count:<TYPEKEY>:heads`,
   *  `scope:<term>`, `area:<TYPEKEY>`, `coverage:<TYPEKEY>`,
   *  `unscheduled:<slug>`, `counting:not_run`, `counting:no_schedule`,
   *  `sheet:<file#page>`, `file:<name>`. */
  id: string;
  kind: ReviewItemKind;
  title: string;
  detail: string;
  // count
  typeKey?: string;
  type?: string;
  description?: string;
  category?: string;
  aiCount?: number;
  sheets?: string[];
  /** B3 — an unscheduled Agent 1 row: the text a resolved count is written
   *  back under (takeoff item), in `category`. */
  rowItem?: string;
  /** Actions the estimator may use on this item (UI + validation). */
  actions?: ResolutionAction[];
  // scope question
  term?: string;
  question?: string;
  options?: string[];
  /** B7 — per option, the parties it stands for (same order as options). */
  optionParties?: Array<{ furnishBy: string; installBy: string }>;
  notes?: string[];
  // area question (B4)
  keepQty?: number;
  sumQty?: number;
  /** N4 — what the item was built from; a resolution is carried to a new
   *  run only when this is unchanged. */
  fingerprint?: string;
  /** N4 — an earlier run's resolution for this item that was NOT carried
   *  over because the drawings/counts changed; shown for re-confirmation. */
  previousResolution?: ReviewResolution;
  resolution?: ReviewResolution;
}

export interface ScopeQuestionInput {
  term: string;
  label: string;
  question: string;
  options: string[];
  optionParties?: Array<{ furnishBy: string; installBy: string }>;
  notes: string[];
}

export function reviewItemIsOpen(i: ReviewItem): boolean {
  return !i.resolution;
}

export function reviewStatus(items: ReviewItem[]): 'clear' | 'needs_review' {
  return items.some(reviewItemIsOpen) ? 'needs_review' : 'clear';
}

function slug(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

const AREA_SAME = (n: number) => `Same area — keep ${n}`;
const AREA_DIFFERENT = (n: number) => `Different areas — sum ${n}`;

export function buildReviewItems(countResult: CountResult | null, scopeQuestions: ScopeQuestionInput[] = []): ReviewItem[] {
  const items: ReviewItem[] = [];
  const targetByKey = new Map((countResult?.targets ?? []).map(t => [t.key, t]));

  // B2 — counting did not run, or ran with nothing from a schedule/legend:
  // the fixture counts are Agent 1's own and unverified. Never "clear".
  if (countResult && !countResult.ran) {
    items.push({
      id: 'counting:not_run',
      kind: 'confirm',
      title: countResult.noScheduleOrLegend ? 'No fixture schedule/legend found — counts not verified' : 'Counting did not run — counts not verified',
      detail: `Counting did not run: ${countResult.notRunReason ?? 'unknown reason'}. Confirm the fixture/device takeoff as the drawing analysis read it (with a reason), or enter the fixture types and re-run the analysis so they are counted.`,
      actions: ['confirm'],
      fingerprint: `not_run|${countResult.notRunReason ?? ''}`,
    });
  } else if (countResult && countResult.noScheduleOrLegend) {
    items.push({
      id: 'counting:no_schedule',
      kind: 'confirm',
      title: 'No fixture schedule/legend found — counts not verified',
      detail: 'The drawing analysis found no luminaire schedule and no device/symbol legend, so no fixture or device types were counted — those quantities are the analysis\'s own reading. Confirm them (with a reason), or enter the fixture types and re-run the analysis so they are counted.',
      actions: ['confirm'],
      fingerprint: `no_schedule|${countResult.targets.map(t => t.key).join(',')}`,
    });
  }
  // S3 — plan pages / files the counter never looked at.
  for (const s of (countResult?.skippedSheets ?? []) as Array<{ file: string; page: number; label: string; reason: string; suspect?: boolean }>) {
    if (!s.suspect) continue;
    items.push({
      id: `sheet:${s.file}#${s.page}`,
      kind: 'confirm',
      title: `Not counted: ${s.label}`,
      detail: `This page looks like an electrical plan but was not counted (${s.reason}). Confirm nothing on it is missing from the takeoff, or re-run the analysis after fixing the upload.`,
      actions: ['confirm'],
      fingerprint: `sheet|${s.reason}`,
    });
  }
  for (const f of countResult?.unclassifiedFiles ?? []) {
    items.push({
      id: `file:${f}`,
      kind: 'confirm',
      title: `Not counted: ${f}`,
      detail: 'The page classifier returned nothing for this PDF, so none of its pages were counted. Confirm it holds no electrical plans, or re-run the analysis.',
      actions: ['confirm'],
      fingerprint: 'file',
    });
  }

  for (const t of countResult?.types ?? []) {
    const sheets = t.sheets.filter(s => s.count > 0).map(s => `${s.label}: ${s.count}${s.used ? '' : ` (not used — ${s.ignoredReason ?? 'ignored'})`}`);
    const fp = `${t.status}|${t.count}|${sheets.join(';')}`;
    const base = { typeKey: t.key, type: t.type, description: t.description, category: t.category, aiCount: t.count, sheets, fingerprint: fp };
    const title = `Type ${t.type}${t.description ? ` — ${t.description}` : ''}`;
    if (t.status !== 'counted') {
      items.push({
        id: `count:${t.key}`,
        kind: 'count',
        title,
        detail: t.status === 'zero' ? `Counted 0: ${t.reason}.` : `Could not be counted: ${t.reason}.`,
        actions: ['count', 'markers', 'not_on_job'],
        ...base,
      });
    }
    if (t.status === 'counted' && t.areaQuestion) {
      const q = t.areaQuestion;
      items.push({
        id: `area:${t.key}`,
        kind: 'area',
        title: `${title}: same area or different areas?`,
        detail: `${q.sheets.map(s => `${s.label} ${s.count}`).join(' / ')} — same area (keep ${q.keep}) or different areas (sum ${q.sum})?`,
        options: [AREA_SAME(q.keep), AREA_DIFFERENT(q.sum)],
        keepQty: q.keep,
        sumQty: q.sum,
        actions: ['answer', 'count'],
        ...base,
      });
    }
    if (t.status === 'counted' && t.coverage?.length) {
      items.push({
        id: `coverage:${t.key}`,
        kind: 'count',
        title: `${title}: partial coverage`,
        detail: `${t.coverage.join(' ')} Enter the full count, confirm ${t.count} (with a reason), or mark it not on this job.`,
        actions: ['count', 'markers', 'confirm', 'not_on_job'],
        ...base,
      });
    }
    const target = targetByKey.get(t.key);
    if (t.category === 'site_lighting' && t.status === 'counted' && t.count > 0 && t.heads == null) {
      items.push({
        id: `count:${t.key}:heads`,
        kind: 'count',
        title: `Type ${t.type} — fixture heads`,
        detail: `${t.count} pole${t.count === 1 ? '' : 's'} counted, but the schedule does not say how many heads each pole carries.`,
        typeKey: `${t.key}:heads`, type: `${t.type} heads`, description: target?.description ?? t.description, category: t.category,
        aiCount: 0, sheets, actions: ['count', 'not_on_job'], fingerprint: fp,
      });
    }
  }
  // B3 — Agent 1 rows that match no scheduled type: held, never dropped.
  for (const r of countResult?.removedRows ?? []) {
    if (!r.unscheduled) continue;
    const qty = Number(r.row.qty);
    if (!(qty > 0)) continue;
    const item = String(r.row.item ?? '').trim() || 'Unnamed fixture';
    const sheet = String(r.row.sourceSheet ?? '').trim();
    items.push({
      id: `unscheduled:${slug(`${item} ${sheet}`)}`,
      kind: 'count',
      title: `Unscheduled fixture: ${item}`,
      detail: `The drawing analysis found ${qty} × ${item}${sheet ? ` (${sheet})` : ''}, but it is not on the fixture schedule. Count it, or mark it not on this job.`,
      rowItem: item,
      category: String(r.row.category ?? 'Interior Lighting'),
      aiCount: qty,
      sheets: sheet ? [`${sheet}: ${qty}`] : [],
      actions: ['count', 'not_on_job'],
      fingerprint: `unscheduled|${qty}|${sheet}`,
    });
  }
  for (const q of scopeQuestions) {
    items.push({
      id: `scope:${q.term}`,
      kind: 'scope_question',
      title: q.label,
      detail: q.question,
      term: q.term,
      question: q.question,
      options: q.options,
      ...(q.optionParties ? { optionParties: q.optionParties } : {}),
      notes: q.notes,
      actions: ['answer'],
      fingerprint: `scope|${q.options.join('|')}|${q.notes.join('|')}`,
    });
  }
  return items;
}

/** Next round A4 — the post-Agent-1 safety net: a sheet Agent 1 says the
 *  drawings reference (its `missingSheets`, after the hygiene dropped the
 *  ones actually loaded) that the sheet check did not already know about
 *  (as present, missing or skipped). One blocking item per sheet: upload it
 *  (the supplement pass), or confirm the takeoff doesn't need it (reason). */
export function referencedSheetItems(
  missingSheets: unknown,
  known: { loadedSheetKeys: Set<string>; checkRefKeys: Set<string> },
  normalize: (raw: string) => string | null,
): ReviewItem[] {
  const out: ReviewItem[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(missingSheets) ? missingSheets : []) {
    const text = typeof raw === 'string' ? raw : typeof (raw as { sheet?: unknown })?.sheet === 'string' ? String((raw as { sheet: string }).sheet) : '';
    const id = /([A-Za-z]{1,3}\s?[-.]?\s?\d{1,3}(?:\.\d{1,2})?[A-Za-z]?)/.exec(text)?.[1] ?? '';
    const key = id ? normalize(id) : null;
    if (!key || seen.has(key) || known.loadedSheetKeys.has(key) || known.checkRefKeys.has(key)) continue;
    seen.add(key);
    out.push({
      id: `refsheet:${key}`,
      kind: 'confirm',
      title: `Referenced sheet ${id.replace(/\s+/g, '')} not in analysis`,
      detail: `The drawing analysis found a reference to ${text.trim().slice(0, 160)}, which is not in the uploaded set and the sheet check did not flag. Upload it (it is analysed and counted into this run), or confirm the takeoff doesn't need it (with a reason).`,
      actions: ['confirm'],
      fingerprint: `refsheet|${key}`,
    });
  }
  return out;
}

/** A re-run rebuilds the list; any item with the same id that the estimator
 *  already resolved keeps that resolution (flagged carriedOver) — but only
 *  when the item was built from the same evidence (N4: its fingerprint). When
 *  the drawings or counts changed, the earlier answer is shown as
 *  `previousResolution` and the item is open again for re-confirmation.
 *  Resolutions for items that no longer exist are dropped. A carried-over
 *  scope answer is kept only if it is still a valid option. */
export function carryOverResolutions(fresh: ReviewItem[], previous: ReviewItem[] | null | undefined): ReviewItem[] {
  const prev = new Map((previous ?? []).filter(p => p.resolution).map(p => [p.id, p]));
  return fresh.map(i => {
    const p = prev.get(i.id);
    if (!p) return i;
    const r = p.resolution!;
    if ((i.kind === 'scope_question' || i.kind === 'area') && r.action === 'answer' && !(i.options ?? []).includes(r.answer ?? '')) {
      return { ...i, previousResolution: r };
    }
    if (p.fingerprint !== undefined && i.fingerprint !== undefined && p.fingerprint !== i.fingerprint) {
      return { ...i, previousResolution: r };
    }
    return { ...i, resolution: { ...r, carriedOver: true } };
  });
}

export interface ResolveInput {
  action: ResolutionAction;
  qty?: unknown;
  reason?: unknown;
  answer?: unknown;
}

export type ResolveCheck =
  | { ok: true; resolution: Omit<ReviewResolution, 'by' | 'at'> }
  | { ok: false; error: string };

/** N6 — a reason is a real explanation: 10+ characters with a word in it. */
export function isRealReason(reason: string): boolean {
  return reason.trim().length >= 10 && /[A-Za-z]{3,}/.test(reason);
}

/** Validates a resolution against its item. `markerCount` is the number of
 *  CONFIRMED markers for the type on the sheets it is counted from (computed
 *  by the route) — only used for action 'markers'. */
export function validateResolution(item: ReviewItem, input: ResolveInput, markerCount: number | null): ResolveCheck {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const allowed = item.actions ?? (item.kind === 'scope_question' ? ['answer'] : ['count', 'markers', 'not_on_job']);
  if (!allowed.includes(input.action)) {
    if (item.kind === 'scope_question') return { ok: false, error: 'A scope question is answered by choosing one of its options.' };
    return { ok: false, error: `This item is resolved by: ${allowed.join(', ')}.` };
  }
  if (input.action === 'answer') {
    const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
    const idx = (item.options ?? []).indexOf(answer);
    if (idx < 0) return { ok: false, error: `Choose one of: ${(item.options ?? []).join(', ')}.` };
    if (item.kind === 'area') {
      const qty = answer === item.options![0] ? item.keepQty : item.sumQty;
      return { ok: true, resolution: { action: 'answer', answer, qty, ...(reason ? { reason } : {}) } };
    }
    const parties = item.optionParties?.[idx];
    return { ok: true, resolution: { action: 'answer', answer, ...(parties ? { furnishBy: parties.furnishBy, installBy: parties.installBy } : {}), ...(reason ? { reason } : {}) } };
  }
  switch (input.action) {
    case 'count': {
      const qty = typeof input.qty === 'number' ? input.qty : Number(input.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100_000) {
        return { ok: false, error: 'Enter a whole-number count of at least 1 (use "Not on this job" if there are none).' };
      }
      return { ok: true, resolution: { action: 'count', qty, ...(reason ? { reason } : {}) } };
    }
    case 'markers': {
      if (!markerCount || markerCount < 1) {
        return { ok: false, error: 'No confirmed markers for this type on the sheets it is counted from — confirm or place them in the Plans view first.' };
      }
      return { ok: true, resolution: { action: 'markers', qty: markerCount } };
    }
    case 'not_on_job': {
      if (!isRealReason(reason)) return { ok: false, error: 'Say why this is not on this job (at least 10 characters).' };
      return { ok: true, resolution: { action: 'not_on_job', reason } };
    }
    case 'confirm': {
      if (!isRealReason(reason)) return { ok: false, error: 'Give the reason you are confirming this (at least 10 characters).' };
      return { ok: true, resolution: { action: 'confirm', reason, ...(item.aiCount != null && item.kind === 'count' ? { qty: item.aiCount } : {}) } };
    }
    default:
      return { ok: false, error: 'Unknown action.' };
  }
}

/** Fix round 1 / B1 — the quantities the GC documents MUST carry, decided by
 *  the counter and the estimator. Keyed by count type key; `null` = not on
 *  this job (the line must not appear). Poles' heads under `<KEY>:heads`.
 *  Unscheduled rows resolved with a count are returned separately. */
export interface EnforcedCounts {
  byType: Map<string, number | null>;
  extraLines: Array<{ category: string; item: string; qty: number }>;
}

export function enforcedCounts(countResult: CountResult | null, items: ReviewItem[] | null | undefined): EnforcedCounts {
  const byType = new Map<string, number | null>();
  const extraLines: EnforcedCounts['extraLines'] = [];
  const list = items ?? [];
  const res = (id: string) => list.find(i => i.id === id)?.resolution;
  for (const t of countResult?.types ?? []) {
    let qty: number | null | undefined;
    const direct = res(`count:${t.key}`);
    if (t.status === 'counted') qty = t.count;
    if (direct) qty = direct.action === 'not_on_job' ? null : (direct.qty ?? qty);
    const area = res(`area:${t.key}`);
    if (area) qty = area.qty ?? qty;
    const cov = res(`coverage:${t.key}`);
    if (cov) qty = cov.action === 'not_on_job' ? null : (cov.qty ?? qty);
    if (qty !== undefined && (qty === null || qty > 0)) byType.set(t.key, qty);
    if (t.category === 'site_lighting') {
      const heads = res(`count:${t.key}:heads`);
      if (heads) byType.set(`${t.key}:heads`, heads.action === 'not_on_job' ? null : (heads.qty ?? null));
      else if (t.heads != null && t.status === 'counted') byType.set(`${t.key}:heads`, t.heads);
    }
  }
  for (const i of list) {
    if (!i.id.startsWith('unscheduled:') || !i.resolution || i.resolution.action !== 'count') continue;
    extraLines.push({ category: i.category ?? 'Interior Lighting', item: i.rowItem ?? i.title, qty: i.resolution.qty! });
  }
  return { byType, extraLines };
}

/** The block Agent 4 receives, authoritative over Agent 1/2 for these items. */
export function reviewResolutionsForAgent4(items: ReviewItem[] | null | undefined): string | null {
  const resolved = (items ?? []).filter(i => i.resolution);
  if (!resolved.length) return null;
  const lines = resolved.map(i => {
    const r = i.resolution!;
    if (i.kind === 'scope_question') {
      return r.furnishBy ? `- ${i.title}: furnished by ${r.furnishBy}, installed by ${r.installBy}.` : `- ${i.title}: ${r.answer}`;
    }
    if (i.kind === 'confirm') return `- ${i.title}: confirmed by the estimator (${r.reason}).`;
    if (r.action === 'not_on_job') return `- ${i.title}: NOT ON THIS JOB — omit it from the takeoff and scope.`;
    if (i.kind === 'area') return `- ${i.title.replace(/: same area or different areas\?$/, '')}: ${r.qty} EA (${r.answer}).`;
    if (r.action === 'confirm') return `- ${i.title}: ${r.qty ?? i.aiCount} EA (confirmed by the estimator).`;
    return `- ${i.title}: ${r.qty} EA (${r.action === 'markers' ? 'confirmed on the plans' : 'counted by the estimator'}).`;
  });
  return `--- ESTIMATOR-RESOLVED TAKEOFF REVIEW (AUTHORITATIVE) ---\nThese override the drawing analysis and scope for the items named. Use these quantities and answers exactly.\n${lines.join('\n')}`;
}
