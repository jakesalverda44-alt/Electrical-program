// Level 2 learning, Task 13 — approved lessons as REVIEW hints (pure). A
// matching item gets `lessonHints`; an unlisted-tag lesson also pre-fills
// `suggested` (the name), exactly like a scope question's pre-filled answer.
// Never a resolution, never `auto`; blocking, fingerprints and the scope hash
// are untouched.
import type { ReviewItem } from '../reviewItems';
import { fp } from '../textFingerprint';
import { selectLessons, type BankLesson } from './selectExamples';

export interface ReviewHintContext { projectType: string | null; accountRuleId: string | null; off: { all: boolean; examples: Set<string>; lessons: Set<string> } }

const matchesItem = (l: BankLesson, i: ReviewItem): boolean => {
  const m = l.match;
  if (m.itemPrefix && !i.id.startsWith(m.itemPrefix)) return false;
  if (m.unlistedSymbolFp && fp(i.description) !== m.unlistedSymbolFp) return false;
  if (m.typeKey && i.typeKey !== m.typeKey) return false;
  // S3 — a match that names a tag letter is never enough on its own: the description's meaning must agree too.
  if (m.typeKey && !m.meaningFp && !m.unlistedSymbolFp) return false;
  if (m.meaningFp) {
    const own = fp(i.description);
    const members = (i.groupedTypes ?? []).map(g => fp(g.description));
    if (own !== m.meaningFp && !members.includes(m.meaningFp)) return false;
  }
  return !!(m.itemPrefix || m.unlistedSymbolFp || m.typeKey || m.meaningFp);
};

/** The name an unlisted-tag lesson suggests ("… has been <name> (H on …)"). */
export function suggestedName(text: string): string | null {
  return /has been (.+?) \([^()]*\bon\b[^()]*\)\.?$/.exec(text)?.[1]?.trim() ?? null;
}

export function applyLessonHints(items: ReviewItem[], lessons: BankLesson[], ctx: ReviewHintContext): ReviewItem[] {
  const usable = selectLessons([], lessons, ctx, 'review');
  if (!usable.length) return items;
  return items.map(i => {
    const hits = usable.filter(l => matchesItem(l, i));
    if (!hits.length) return i;
    const out: ReviewItem = { ...i, lessonHints: hits.map(l => ({ lessonId: l.id, version: l.version, text: l.text })) };
    if (i.id.startsWith('unlisted:') && !i.resolution && !i.suggested) {
      const name = hits.map(l => suggestedName(l.text)).find(Boolean);
      if (name) out.suggested = name;
    }
    return out;
  });
}
