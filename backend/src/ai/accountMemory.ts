// Fewer-questions round Task 6 (Jake's approval 5) — answers given on
// another bid of the SAME account are offered back, labelled "From <bid>"
// and undoable. Pure.
//
// Account = the matched, NON-default account rule (accountTerms.ruleId):
// the Default rule is never an account, and nothing is ever matched across
// rules. Sources are other bids' CURRENT review_items, answers given by a
// person only (never an automatic answer — so automatic answers never
// chain). Keys are exact (fp() normalized), never fuzzy:
//   zero|<TAG>|fp(description)                 checklist / legend-zero / zero-count
//                                              rows → "not on this job" ONLY
//                                              (counts are per store: never remembered)
//   typical|fp(host)|<DEVICE>|fp(quote)        typical: / typicalqty: → the quantity
//                                              (a prototype package)
//   pipepoles|fp(item)                         → the answer
//   reuse|<TAG>|fp(quotes)                     → the answer
//   scope|<term>                               → `suggested` only (pre-filled, never applied)
// Not remembered: area:, unlisted:, per-pole typicalassign members (pole ids
// are per site; the tag binding already covers poles).
import { fp } from './textFingerprint';
import { validateResolution, memoryBy, withGroupResolution, type ReviewItem, type ReviewResolution, type GroupedMember } from './reviewItems';

export { fp };
const tag = (s: string | null | undefined) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

export interface MemorySourceBid { bidId: string; bidName: string; createdAt: string; items: ReviewItem[] }
export interface Memory {
  key: string;
  bidId: string;
  bidName: string;
  createdAt: string;
  /** What is applied: a not-on-job / count / answer, or (scope) a suggestion. */
  kind: 'resolution' | 'suggested';
  resolution: Pick<ReviewResolution, 'action' | 'qty' | 'answer' | 'reason'>;
  /** The source answer, for the evidence line. */
  sourceTitle: string;
  sourceBy: string;
  sourceAt: string;
}

const human = (r: ReviewResolution | undefined): r is ReviewResolution => !!r && !r.auto;

/** The memory key of an item (null = not remembered). */
export function itemMemoryKey(i: ReviewItem): string | null {
  if (i.id.startsWith('typical:') || i.id.startsWith('typicalqty:')) {
    if (!i.memoryText) return null;
    const [host, device, quote] = i.memoryText.split('|');
    return `typical|${fp(host)}|${tag(device)}|${fp(quote)}`;
  }
  if (i.id.startsWith('pipepoles:')) return i.memoryText ? `pipepoles|${fp(i.memoryText)}` : null;
  if (i.id.startsWith('reuse:')) return i.memoryText ? `reuse|${tag(i.id.slice('reuse:'.length))}|${fp(i.memoryText.split('|').join(' '))}` : null;
  if (i.kind === 'scope_question' && i.term) return `scope|${i.term}`;
  if (i.id.startsWith('count:') && !i.id.endsWith(':heads') && i.typeKey && /^Counted 0/.test(i.detail)) return `zero|${tag(i.type ?? i.typeKey)}|${fp(i.description)}`;
  return null;
}
export function memberMemoryKey(m: GroupedMember): string {
  return `zero|${tag(m.type)}|${fp(m.description)}`;
}
const GROUPS = ['legend-zero:', 'legend-unused:', 'textzero:'];

/** Every remembered answer of the source bids (newest bid first). */
export function collectMemories(sources: MemorySourceBid[]): Memory[] {
  const out: Memory[] = [];
  const sorted = [...sources].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const b of sorted) {
    for (const i of b.items ?? []) {
      const base = { bidId: b.bidId, bidName: b.bidName, createdAt: b.createdAt };
      if (GROUPS.some(p => i.id.startsWith(p))) {
        for (const m of i.groupedTypes ?? []) {
          if (!human(m.resolution) || m.resolution.action !== 'not_on_job') continue;
          out.push({ ...base, key: memberMemoryKey(m), kind: 'resolution', resolution: { action: 'not_on_job', reason: m.resolution.reason }, sourceTitle: `${m.type}${m.description && m.description !== m.type ? ` — ${m.description}` : ''}`, sourceBy: m.resolution.by, sourceAt: m.resolution.at });
        }
        continue;
      }
      const key = itemMemoryKey(i);
      if (!key || !human(i.resolution)) continue;
      const r = i.resolution;
      if (key.startsWith('zero|')) {
        if (r.action !== 'not_on_job') continue; // counts are per store
        out.push({ ...base, key, kind: 'resolution', resolution: { action: 'not_on_job', reason: r.reason }, sourceTitle: i.title, sourceBy: r.by, sourceAt: r.at });
      } else if (key.startsWith('typical|')) {
        if (r.action !== 'count' && r.action !== 'not_on_job') continue;
        out.push({ ...base, key, kind: 'resolution', resolution: { action: r.action, ...(r.qty != null ? { qty: r.qty } : {}), ...(r.reason ? { reason: r.reason } : {}) }, sourceTitle: i.title, sourceBy: r.by, sourceAt: r.at });
      } else if (key.startsWith('scope|')) {
        if (r.action !== 'answer' || !r.answer) continue;
        out.push({ ...base, key, kind: 'suggested', resolution: { action: 'answer', answer: r.answer }, sourceTitle: i.title, sourceBy: r.by, sourceAt: r.at });
      } else {
        if (r.action !== 'answer' || !r.answer) continue;
        out.push({ ...base, key, kind: 'resolution', resolution: { action: 'answer', answer: r.answer, ...(r.reason ? { reason: r.reason } : {}) }, sourceTitle: i.title, sourceBy: r.by, sourceAt: r.at });
      }
    }
  }
  return out;
}

const valueOf = (m: Memory) => m.resolution.action === 'not_on_job' ? 'not on this job' : m.resolution.action === 'count' ? String(m.resolution.qty) : String(m.resolution.answer);

/** One memory per key: the newest answer of each source bid; bids that
 *  disagree → null with the "bids differ" line. */
export function decide(memories: Memory[], key: string): { memory: Memory; agreeing: Memory[] } | { differ: string } | null {
  const perBid = new Map<string, Memory>();
  for (const m of memories) if (m.key === key && !perBid.has(m.bidId)) perBid.set(m.bidId, m);
  const ms = [...perBid.values()];
  if (!ms.length) return null;
  const values = new Set(ms.map(valueOf));
  if (values.size > 1) return { differ: ms.map(m => `${m.bidName} ${valueOf(m)}`).join(', ') };
  return { memory: ms[0], agreeing: ms };
}

export interface AccountContext { ruleId: string; ruleName: string }

function autoOf(d: { memory: Memory; agreeing: Memory[] }, account: AccountContext): NonNullable<ReviewResolution['auto']> {
  const m = d.memory;
  return {
    source: 'account_memory',
    reason: `Same account (${account.ruleName}) — answered this way on ${m.bidName}`,
    evidence: d.agreeing.map(a => `${a.bidName}: ${a.sourceTitle} — ${valueOf(a)}${a.resolution.reason ? ` ("${a.resolution.reason}")` : ''} (${a.sourceBy}, ${String(a.sourceAt).slice(0, 10)})`),
    fromBid: { id: m.bidId, name: m.bidName },
    memoryKey: m.key,
  };
}

/** Applies remembered answers to the items still open (after every other
 *  rule): re-validated against the item (the option still exists, the qty
 *  is valid); disagreeing source bids → not applied (the detail says so);
 *  an item / member whose `autoDeclined` holds 'account_memory' is skipped. */
export function applyAccountMemory(items: ReviewItem[], memories: Memory[], account: AccountContext | null, now = new Date().toISOString()): ReviewItem[] {
  if (!account || !memories.length) return items;
  const differLine = (d: string) => ` ${account.ruleName} bids differ: ${d} — not applied.`;
  return items.map(i => {
    if (GROUPS.some(p => i.id.startsWith(p)) && i.groupedTypes) {
      let changed = false;
      const differs: string[] = [];
      const groupedTypes = i.groupedTypes.map(m => {
        if (m.resolution || m.autoDeclined?.includes('account_memory')) return m;
        const d = decide(memories, memberMemoryKey(m));
        if (!d) return m;
        if ('differ' in d) { differs.push(`${m.type}: ${d.differ}`); return m; }
        changed = true;
        return { ...m, resolution: { action: 'not_on_job' as const, reason: `From ${d.memory.bidName}: ${d.memory.resolution.reason ?? 'not on that job'}`, by: memoryBy(d.memory.bidName), at: now, auto: autoOf(d, account) } };
      });
      if (!changed && !differs.length) return i;
      const out: ReviewItem = withGroupResolution({ ...i, groupedTypes, ...(differs.length ? { detail: `${i.detail}${differLine(differs.join('; '))}` } : {}) });
      return out;
    }
    if (i.resolution || i.autoDeclined?.includes('account_memory')) return i;
    const key = itemMemoryKey(i);
    if (!key) return i;
    const d = decide(memories.filter(m => m.key === key), key);
    if (!d) return i;
    if ('differ' in d) return { ...i, detail: `${i.detail}${differLine(d.differ)}` };
    const m = d.memory;
    if (m.kind === 'suggested') {
      // Scope questions: pre-filled only, never answered.
      if (i.suggested || !(i.options ?? []).includes(m.resolution.answer ?? '')) return i;
      return { ...i, suggested: m.resolution.answer!, detail: `${i.detail} Pre-filled from ${m.bidName} (same account, ${account.ruleName}).` };
    }
    const check = validateResolution(i, { action: m.resolution.action, qty: m.resolution.qty, reason: m.resolution.action === 'not_on_job' ? `From ${m.bidName}: ${m.resolution.reason ?? 'not on that job'}` : m.resolution.reason, answer: m.resolution.answer }, null);
    if (!check.ok) return i;
    return { ...i, resolution: { ...check.resolution, by: memoryBy(m.bidName), at: now, auto: autoOf(d, account) } };
  });
}
