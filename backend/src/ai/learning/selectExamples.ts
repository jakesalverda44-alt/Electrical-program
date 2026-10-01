// Level 2 learning, Tasks 11 + 13 — which examples and lessons go into a
// counter call (pure, deterministic: the same bank and targets always give
// the same ordered list, so the cached prompt prefix is stable).
//
// Global by default (Jake): any client's verified example may be used, but
// ONLY for a target whose meaning agrees (meaning.ts — never the tag
// letter), never from the same bid or the same drawings (document sha),
// never one turned off for this bid; a conflicted cluster needs a strict
// match. Caps: 2 positives + 1 negative per target, 12 images and ~1,500
// image tokens per call, ≤ 1,000 characters of example text; ≤ 5 lessons /
// ≤ 400 tokens.
import { isGenericDemoTarget } from '../remodel/demolition';
import type { CountTarget } from '../countTargets';
import { meaningMatches, meaningOf, type Meaning } from './meaning';
import { hamming } from './visualHash';
import type { LessonMatch } from './learningDb';

export interface BankExample {
  id: string;
  polarity: 'positive' | 'negative';
  meaning: Meaning;
  confusedWith: Meaning | null;
  notADevice: boolean;
  quality: number;
  sourceBidId: string | null;
  sourceBidName: string | null;
  sourceDocSha: string | null;
  createdAt: string;
  dhash: bigint;
  conflicted: boolean;
}
export interface BankLesson { id: string; version: number; text: string; appliesTo: Array<'counter' | 'review'>; scopeKind: 'all' | 'project_type' | 'account'; scopeValue: string | null; match: LessonMatch }

export interface SelectContext {
  bidId: string;
  /** sha256 of every PDF in this run. */
  docShas: Set<string>;
  off: { all: boolean; examples: Set<string>; lessons: Set<string> };
  /** Targets with an earlier correction (any example of their meaning). */
  history?: Set<string>;
}

export const MAX_POSITIVES = 2;
export const MAX_NEGATIVES = 1;
export const MAX_IMAGES = 12;
export const MAX_IMAGE_TOKENS = 1500;
export const MAX_EXAMPLE_TEXT = 1000;
export const NEAR_DUP_HAMMING = 4;
export const MAX_LESSONS = 5;
export const MAX_LESSON_TOKENS = 400;
/** One example image ≈ (1.2" × px/in)² / 750 tokens. */
export const imageTokens = (pxPerIn: number) => Math.ceil((1.2 * pxPerIn) ** 2 / 750);

export interface Picked { example: BankExample; target: CountTarget; role: 'positive' | 'negative'; isTarget?: CountTarget; line: string }
export interface Selection { picked: Picked[]; skipped: Array<{ id: string; reason: string }>; imageTokens: number; textChars: number }

export function eligible(bank: BankExample[], ctx: SelectContext): { ok: BankExample[]; skipped: Array<{ id: string; reason: string }> } {
  const ok: BankExample[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const e of bank) {
    if (ctx.off.all || ctx.off.examples.has(e.id)) { skipped.push({ id: e.id, reason: 'turned off for this bid' }); continue; }
    if (e.sourceBidId === ctx.bidId) { skipped.push({ id: e.id, reason: 'from this bid' }); continue; }
    if (e.sourceDocSha && ctx.docShas.has(e.sourceDocSha)) { skipped.push({ id: e.id, reason: 'from these same drawings' }); continue; }
    ok.push(e);
  }
  return { ok, skipped };
}

const rank = (a: BankExample, b: BankExample) => (b.quality - a.quality) || String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id);

export function selectExamples(targets: CountTarget[], bank: BankExample[], ctx: SelectContext, pxPerIn: number): Selection {
  const { ok, skipped } = eligible(bank, ctx);
  const tgts = targets.filter(t => !isGenericDemoTarget(t) && t.role !== 'locate');
  const meanings = new Map(tgts.map(t => [t.key, meaningOf(t)]));
  const per = tgts.map((t, order) => {
    const tm = meanings.get(t.key)!;
    const pos = ok.filter(e => e.polarity === 'positive' && meaningMatches(tm, e.meaning, { strict: e.conflicted })).sort(rank);
    const neg = ok.filter(e => e.polarity === 'negative' && e.confusedWith && meaningMatches(tm, e.confusedWith, { strict: true })).sort(rank);
    return { t, order, pos, neg };
  });
  // Target priority: a negative first, then earlier corrections, then target order.
  per.sort((a, b) => (Number(b.neg.length > 0) - Number(a.neg.length > 0)) || (Number(ctx.history?.has(b.t.key) ?? false) - Number(ctx.history?.has(a.t.key) ?? false)) || a.order - b.order);
  const picked: Picked[] = [];
  const perImage = imageTokens(pxPerIn);
  let tokens = 0, chars = 0;
  const chosen: BankExample[] = [];
  const take = (e: BankExample, t: CountTarget, role: 'positive' | 'negative'): boolean => {
    if (picked.length >= MAX_IMAGES || tokens + perImage > MAX_IMAGE_TOKENS) return false;
    if (chosen.some(c => hamming(c.dhash, e.dhash) <= NEAR_DUP_HAMMING)) return false;
    const isTarget = role === 'negative' && !e.notADevice ? tgts.find(x => x.key !== t.key && meaningMatches(meanings.get(x.key)!, e.meaning, { strict: true })) : undefined;
    const line = exampleLine(picked.length + 1, e, t, role, isTarget);
    if (chars + line.length > MAX_EXAMPLE_TEXT) return false;
    picked.push({ example: e, target: t, role, ...(isTarget ? { isTarget } : {}), line });
    chosen.push(e);
    tokens += perImage; chars += line.length;
    return true;
  };
  for (const p of per) {
    // distinct source bids first
    const byBid = (xs: BankExample[]) => [...xs.filter((e, i) => xs.findIndex(y => y.sourceBidId === e.sourceBidId) === i), ...xs.filter((e, i) => xs.findIndex(y => y.sourceBidId === e.sourceBidId) !== i)];
    let n = 0;
    for (const e of byBid(p.pos)) { if (n >= MAX_POSITIVES) break; if (take(e, p.t, 'positive')) n++; }
    let m = 0;
    for (const e of byBid(p.neg)) { if (m >= MAX_NEGATIVES) break; if (take(e, p.t, 'negative')) m++; }
  }
  return { picked, skipped, imageTokens: tokens, textChars: chars };
}

const q = (s: string) => s.replace(/"/g, "'").slice(0, 90);
export const EXAMPLES_HEADER = 'EXAMPLES FROM OTHER PLAN SETS — hints only. THIS sheet\'s legend and schedule define every symbol and win over any example. Never count or mark an example image itself. Each example is a 1.2" close-up at the same scale as the tiles; the symbol is at the center.';

export function exampleLine(n: number, e: BankExample, t: CountTarget, role: 'positive' | 'negative', isTarget?: CountTarget): string {
  const conflict = e.conflicted ? ' This symbol has different meanings on different plan sets — use it only if this sheet\'s legend agrees.' : '';
  if (role === 'positive') return `Example X${n} — for COUNT TARGET "${q(t.type)}" (${q(t.description)}): verified by the estimator on another job as "${q(e.meaning.description)}".${conflict}`;
  const what = e.notADevice ? 'not a device' : isTarget ? `this sheet's target "${q(isTarget.type)}"` : `"${q(e.meaning.description)}"`;
  return `Example X${n} — NOT COUNT TARGET "${q(t.type)}": the counter once read this as ${q(e.confusedWith?.description ?? t.description)}; the estimator verified it is ${what}.${conflict}`;
}

/** Task 13 — the approved lessons that apply to this bid and these targets. */
export function selectLessons(targets: CountTarget[], lessons: BankLesson[], ctx: { projectType: string | null; accountRuleId: string | null; off: SelectContext['off'] }, appliesTo: 'counter' | 'review'): BankLesson[] {
  const meanings = targets.map(t => meaningOf(t));
  const out: BankLesson[] = [];
  let tokens = 0;
  for (const l of [...lessons].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!l.appliesTo.includes(appliesTo)) continue;
    if (ctx.off.all || ctx.off.lessons.has(l.id)) continue;
    if (l.scopeKind === 'project_type' && (!ctx.projectType || l.scopeValue !== ctx.projectType)) continue;
    if (l.scopeKind === 'account' && (!ctx.accountRuleId || l.scopeValue !== ctx.accountRuleId)) continue;
    if (appliesTo === 'counter' && !lessonHitsTargets(l.match, meanings)) continue;
    const tk = Math.ceil(l.text.length / 4) + 8;
    if (out.length >= MAX_LESSONS || tokens + tk > MAX_LESSON_TOKENS) break;
    out.push(l); tokens += tk;
  }
  return out;
}

export function lessonHitsTargets(match: LessonMatch, meanings: Meaning[]): boolean {
  if (!match.deviceClass && !match.meaningFp) return true;
  return meanings.some(m => (!match.deviceClass || m.deviceClass === match.deviceClass) && (!match.meaningFp || m.meaningFp === match.meaningFp));
}

export const LESSONS_HEADER = 'APPROVED LESSONS from the estimator\'s past corrections — this sheet\'s own notes, legend and schedule win if they disagree:';
export const lessonLine = (l: BankLesson, n: number) => `- L${n} v${l.version}: ${l.text.replace(/\s+/g, ' ').slice(0, 300)}`;
