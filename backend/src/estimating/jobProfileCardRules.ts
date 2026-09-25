// Bid Overview: Plans Upload + Job Profile — Decision 4, the card-update
// rules. Pure: takes the bid's CURRENT card fields and a JobProfile
// (backend/src/ai/jobProfile.ts) and decides, per field, whether the plans
// auto-fill the card, only suggest a change, or say nothing. The route
// (routes/jobProfile.ts via services/jobProfileRun.ts) is the only place
// that writes a fill or an accepted suggestion, and it logs every one.
//
// The rules (job profile fix round, review 1755e62):
//   1. An EMPTY card field is auto-filled only from a value the code
//      validators passed AND the model read with high confidence. Any other
//      value — even for an empty field — is a suggestion.
//   2. A filled card field that DIFFERS from the plans is a suggestion —
//      never a silent overwrite.
//   3. `gc` is never touched, and `name` is ALWAYS suggestion-only.
//   4. A value a person cleared after it was auto-filled is "rejected": it is
//      never auto-filled (or re-suggested) again (review S2).
//   5. An undetermined profile (a scanned set nothing could read) changes
//      nothing.
import type { JobProfile, FieldEvidence, ProfileFieldKey } from '../ai/jobProfile';

export type BidProfileFieldKey = ProfileFieldKey;

export interface CurrentBidFields {
  project_type?: string | null;
  brand?: string | null;
  store_number?: string | null;
  prototype?: string | null;
  loc?: string | null;
  sq_ft?: number | string | null;
  /** ISO YYYY-MM-DD (the route reads it with to_char — review B3). */
  plan_date?: string | null;
  owner_name?: string | null;
  architect?: string | null;
  engineer?: string | null;
  build_type?: string | null;
  name: string;
}

export interface FieldFill {
  field: BidProfileFieldKey;
  value: unknown;
  sheet: string | null;
  quote: string | null;
  /** What gets logged next to the field — "from plans (sheet E-1)". */
  reasonTag: string;
}

export interface FieldSuggestion {
  field: BidProfileFieldKey;
  currentValue: unknown;
  suggestedValue: unknown;
  sheet: string | null;
  quote: string | null;
  confidence: string;
  notes?: string[];
  /** "Plans say 7,381 SF — card says 7,000. Update?" */
  message: string;
}

export interface CardUpdatePlan {
  fills: FieldFill[];
  suggestions: FieldSuggestion[];
}

/** One auto-fill, remembered so a later clear is seen as a rejection. */
export interface FillRecord {
  value: unknown;
  at: string;
  sheet: string | null;
  status: 'filled' | 'rejected' | 'edited';
  /** Values a person cleared after they were auto-filled. */
  rejectedValues?: unknown[];
}

const SUGGEST_ONLY: ReadonlySet<string> = new Set(['name']);
const NEVER_TOUCHED: ReadonlySet<string> = new Set(['gc']);

const FIELD_LABELS: Record<BidProfileFieldKey, string> = {
  project_type: 'project type', brand: 'brand', store_number: 'store number',
  prototype: 'prototype', loc: 'location', sq_ft: 'SF', plan_date: 'plan date',
  owner_name: 'owner', architect: 'architect', engineer: 'engineer',
  build_type: 'build type', name: 'name',
};

// "—" is this codebase's placeholder for "blank" (bids.ts defaults loc to it).
export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || v.trim() === '—'));
}

export function normalizedEqual(field: string, a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  if (field === 'sq_ft') return Number(a) === Number(b);
  if (field === 'plan_date') return String(a).slice(0, 10) === String(b).slice(0, 10);
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return String(a) === String(b);
}

function displayDate(v: unknown): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split('-');
    return `${m}/${d}/${y}`;
  }
  return String(v);
}

function buildMessage(field: BidProfileFieldKey, current: unknown, suggested: unknown): string {
  const empty = isEmpty(current);
  if (field === 'sq_ft') {
    const fmt = (v: unknown) => Number(v).toLocaleString('en-US');
    return empty ? `Plans say ${fmt(suggested)} SF. Use it?` : `Plans say ${fmt(suggested)} SF — card says ${fmt(current)}. Update?`;
  }
  const show = (v: unknown) => field === 'plan_date' ? displayDate(v) : `"${v}"`;
  return empty
    ? `Plans say ${show(suggested)} (${FIELD_LABELS[field]}). Use it?`
    : `Plans say ${show(suggested)} — card says ${show(current)} (${FIELD_LABELS[field]}). Update?`;
}

/** S2 — before a run: a field this module auto-filled that is now empty was
 *  cleared by a person (rejected); one that now holds something else was
 *  edited. Pure; returns the updated records. */
export function reconcileFills(fills: Record<string, FillRecord>, current: CurrentBidFields): Record<string, FillRecord> {
  const out: Record<string, FillRecord> = {};
  for (const [field, rec] of Object.entries(fills ?? {})) {
    const cur = (current as unknown as Record<string, unknown>)[field];
    if (rec.status === 'filled' && isEmpty(cur)) {
      out[field] = { ...rec, status: 'rejected', rejectedValues: [...(rec.rejectedValues ?? []), rec.value] };
    } else if (rec.status === 'filled' && !normalizedEqual(field, cur, rec.value)) {
      out[field] = { ...rec, status: 'edited' };
    } else {
      out[field] = rec;
    }
  }
  return out;
}

export function isRejected(field: string, value: unknown, fills: Record<string, FillRecord>): boolean {
  return (fills?.[field]?.rejectedValues ?? []).some(v => normalizedEqual(field, v, value));
}

/** The pure decision function. */
export function computeCardUpdates(current: CurrentBidFields, profile: JobProfile, fills: Record<string, FillRecord> = {}): CardUpdatePlan {
  const out: CardUpdatePlan = { fills: [], suggestions: [] };
  if (profile.status !== 'complete') return out;

  for (const [rawKey, evidence] of Object.entries(profile.fields)) {
    const key = rawKey as BidProfileFieldKey;
    if (NEVER_TOUCHED.has(key)) continue;
    const ev = evidence as FieldEvidence;
    const currentValue = (current as unknown as Record<string, unknown>)[key];
    const suggest = (message: string) => out.suggestions.push({
      field: key, currentValue, suggestedValue: ev.value, sheet: ev.sheet, quote: ev.quote,
      confidence: ev.confidence, ...(ev.notes?.length ? { notes: ev.notes } : {}), message,
    });

    if (SUGGEST_ONLY.has(key)) {
      if (!normalizedEqual(key, currentValue, ev.value)) suggest(`Plans suggest naming this bid "${ev.value}". Rename?`);
      continue;
    }
    if (normalizedEqual(key, currentValue, ev.value)) continue; // the card already agrees
    if (isEmpty(currentValue)) {
      if (isRejected(key, ev.value, fills)) continue; // a person cleared this value before
      if (ev.validated && ev.confidence === 'high') {
        out.fills.push({
          field: key, value: ev.value, sheet: ev.sheet, quote: ev.quote,
          reasonTag: `from plans${ev.sheet ? ` (sheet ${ev.sheet})` : ''}`,
        });
      } else {
        suggest(buildMessage(key, currentValue, ev.value));
      }
      continue;
    }
    suggest(buildMessage(key, currentValue, ev.value));
  }
  return out;
}

export interface StoredSuggestion {
  value: unknown; sheet: string | null; quote: string | null;
  /** accepted — applied to the card; ignored — dismissed; overridden — the
   *  person accepted it and later typed something else over it (review N5):
   *  the same plans value is not suggested again; a NEW plans value is. */
  status: 'pending' | 'accepted' | 'ignored' | 'overridden';
  at: string; by: string | null;
  confidence?: string; notes?: string[]; message?: string;
}

/** Re-run behavior (Decision 6 + review N5). A suggestion the person ignored
 *  for the SAME value stays hidden; one they accepted and then retyped over
 *  is 'overridden' (their own value wins; the same plans value is not
 *  re-suggested); a changed plans value is pending again. Suggestions whose
 *  field the plans and card now agree on disappear. */
export function mergeSuggestions(
  fresh: FieldSuggestion[], previous: Record<string, StoredSuggestion> | null | undefined, now = new Date().toISOString(),
): Record<string, StoredSuggestion> {
  const out: Record<string, StoredSuggestion> = {};
  for (const s of fresh) {
    const prior = previous?.[s.field];
    const same = prior && normalizedEqual(s.field, prior.value, s.suggestedValue);
    const base = { value: s.suggestedValue, sheet: s.sheet, quote: s.quote, confidence: s.confidence, ...(s.notes ? { notes: s.notes } : {}), message: s.message };
    if (same && prior.status === 'accepted') out[s.field] = { ...prior, ...base, status: 'overridden' };
    else if (same && prior.status !== 'pending') out[s.field] = { ...prior, ...base };
    else if (same) out[s.field] = { ...prior, ...base };
    else out[s.field] = { ...base, status: 'pending', at: now, by: null };
  }
  return out;
}
