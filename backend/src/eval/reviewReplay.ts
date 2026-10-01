// Fewer-questions round Task 0 — the review list of the two 2026-09-30 live
// runs, replayed through the current code (pure orchestration: no model, no
// DB). Per job:
//   * counting: the counting-stage replay (test/fixtures/realrun/replay0930.ts)
//     → countResult;
//   * scope questions: REBUILT from the export's stored `scope_question` items
//     (term, label, question, options, optionParties, notes, suggested). The
//     export has no `account_terms`, so scopeQuestionsFor(accountTerms) cannot
//     be re-run; the stored items are exactly what it produced on the live run;
//   * buildReviewItems(cr, scope, { inventoryTitles }) → finalizeReview(fresh,
//     { previous }) — the pipeline's own path. `projectType` is NOT passed:
//     the pipeline (routes/preconstruction.ts) does not pass it either, so the
//     facility checklists never reach a live run's list.
// reviewCounts() is the round's measure: "asked" = blocking, unanswered and
// not on the Scope step.
import { replayKissimmee0930, replay36th0930 } from '../test/fixtures/realrun/replay0930';
import { loadKissimmeeLive0930, load36th0930, type Live0930 } from '../test/fixtures/realrun/live0930';
import { buildReviewItems, finalizeReview, type ReviewItem, type ScopeQuestionInput, type BuildReviewItemsOptions, type FinalizeReviewOptions } from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

export type ReplayJob = 'kissimmee' | '36th';

export interface KindCounts { asked: number; info: number; auto: number; scopeStep: number; answered: number }
export interface ReviewCounts {
  total: number;
  /** Blocking, no resolution, not on the Scope step. */
  asked: number;
  /** On the Scope step (still blocking until answered). */
  scopeStep: number;
  /** blocking:false. */
  info: number;
  /** Resolved with an `auto` record. */
  auto: number;
  /** Resolved by a person (or carried over), not automatic. */
  answered: number;
  /** id prefix → counts. */
  byKind: Record<string, KindCounts>;
  /** Rows inside grouped items (groupedTypes / reconcileMembers). */
  members: number;
}

/** The id prefix an item is counted under ("count:", "area:", …). */
export function kindOf(i: ReviewItem): string {
  const m = /^([a-z-]+)(?::|$)/i.exec(i.id);
  return m ? m[1] : i.id;
}

type WithAuto = ReviewItem & { step?: string; resolution?: ReviewItem['resolution'] & { auto?: unknown } };

export function reviewCounts(items: ReviewItem[]): ReviewCounts {
  const out: ReviewCounts = { total: items.length, asked: 0, scopeStep: 0, info: 0, auto: 0, answered: 0, byKind: {}, members: 0 };
  for (const i0 of items) {
    const i = i0 as WithAuto;
    const k = kindOf(i);
    const b = out.byKind[k] ?? (out.byKind[k] = { asked: 0, info: 0, auto: 0, scopeStep: 0, answered: 0 });
    out.members += (i.groupedTypes?.length ?? 0) + (i.reconcileMembers?.length ?? 0);
    if (i.resolution?.auto) { out.auto++; b.auto++; continue; }
    if (i.resolution) { out.answered++; b.answered++; continue; }
    if (i.blocking === false) { out.info++; b.info++; continue; }
    if (i.step === 'scope') { out.scopeStep++; b.scopeStep++; continue; }
    out.asked++; b.asked++;
  }
  return out;
}

/** The scope questions as the live run built them (see the header). */
export function scopeQuestionsFromExport(live: Live0930): ScopeQuestionInput[] {
  return (live.reviewItems as Array<Record<string, unknown>>).filter(i => i.kind === 'scope_question').map(i => ({
    term: String(i.term), label: String(i.title), question: String(i.question ?? i.detail), options: (i.options as string[]) ?? [],
    ...(i.optionParties ? { optionParties: i.optionParties as ScopeQuestionInput['optionParties'] } : {}),
    notes: (i.notes as string[]) ?? [],
    ...(i.suggested ? { suggested: String(i.suggested) } : {}),
  }));
}

export function inventoryTitlesOf(live: Live0930): string[] {
  return (live.inventory as Array<{ title?: string }>).map(p => String(p.title ?? '')).filter(Boolean);
}

/** The account rule's aliases as the pipeline would pass them. The export
 *  has no account_terms: Kissimmee's stored scope questions name the rule
 *  "AutoZone" ("Account rule (AutoZone): …"), so its name is used as the one
 *  alias (STATED — the live rule's full alias list is in the live DB only);
 *  36th Street's run asked no account question (no account rule assumed). */
export function accountAliasesOf(job: ReplayJob): string[] {
  return job === 'kissimmee' ? ['AutoZone'] : [];
}

export interface ReplayReviewOptions {
  /** The previous run's stored items (default none). */
  previous?: ReviewItem[] | null;
  /** Extra finalizeReview options (later tasks). */
  finalize?: Partial<FinalizeReviewOptions>;
  build?: Partial<BuildReviewItemsOptions>;
  /** A count result already replayed (saves the counting replay). */
  countResult?: CountResult;
}

export interface ReplayReview { job: ReplayJob; countResult: CountResult; fresh: ReviewItem[]; items: ReviewItem[]; counts: ReviewCounts; live: Live0930 }

export async function replayCount(job: ReplayJob): Promise<CountResult> {
  return job === 'kissimmee' ? (await replayKissimmee0930()).cr : (await replay36th0930()).stage.countResult;
}

export function reviewFromCount(job: ReplayJob, cr: CountResult, opts: ReplayReviewOptions = {}): ReplayReview {
  const live = job === 'kissimmee' ? loadKissimmeeLive0930() : load36th0930();
  const fresh = buildReviewItems(cr, scopeQuestionsFromExport(live), {
    inventoryTitles: inventoryTitlesOf(live),
    agent1Panels: ((live.agent1 as Record<string, unknown>).panels as BuildReviewItemsOptions['agent1Panels']) ?? [],
    accountAliases: accountAliasesOf(job),
    ...(opts.build ?? {}),
  } as BuildReviewItemsOptions);
  const items = finalizeReview(fresh, { previous: opts.previous ?? null, ...(opts.finalize ?? {}) } as FinalizeReviewOptions);
  return { job, countResult: cr, fresh, items, counts: reviewCounts(items), live };
}

export async function replayReview(job: ReplayJob, opts: ReplayReviewOptions = {}): Promise<ReplayReview> {
  return reviewFromCount(job, opts.countResult ?? await replayCount(job), opts);
}

/** The stored answers of the live export, keyed by item id. */
export function storedAnswers(live: Live0930): Map<string, ReviewItem> {
  return new Map((live.reviewItems as unknown as ReviewItem[]).filter(i => i.resolution || i.groupedTypes?.some(m => m.resolution)).map(i => [i.id, i]));
}

export interface BaselineItem { id: string; kind: string; group?: string; blocking?: boolean; typeKey?: string; title: string; members?: string[] }
export interface ReviewBaselineJob { counts: ReviewCounts; items: BaselineItem[]; storedAnswers?: Record<string, unknown> }

/** One job's entry of eval/review-baseline-<date>.json. */
export function baselineSnapshot(r: ReplayReview, storedIds: string[] = []): ReviewBaselineJob {
  const stored = storedAnswers(r.live);
  return {
    counts: r.counts,
    items: r.items.map(i => ({
      id: i.id, kind: i.kind, ...(i.group ? { group: i.group } : {}), ...(i.blocking === false ? { blocking: false } : {}),
      ...(i.typeKey ? { typeKey: i.typeKey } : {}), title: i.title,
      ...(i.groupedTypes ? { members: i.groupedTypes.map(g => g.key) } : i.reconcileMembers ? { members: i.reconcileMembers.map(m => m.key) } : {}),
    })),
    ...(storedIds.length ? { storedAnswers: Object.fromEntries(storedIds.map(id => [id, stored.get(id)?.resolution ?? null])) } : {}),
  };
}
