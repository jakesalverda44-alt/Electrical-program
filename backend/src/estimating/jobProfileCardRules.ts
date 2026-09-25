// Bid Overview: Plans Upload + Job Profile (2026-09-24 plan) — Decision 4,
// the card-update rules. Pure: takes the bid's CURRENT card fields and a
// JobProfile (backend/src/ai/jobProfile.ts) and decides, per field, whether
// the plans should auto-fill the card, only suggest a change, or say nothing
// — never touches the database or a request. The route (jobProfileRoutes.ts)
// is the only place that actually writes a fill or an accepted suggestion,
// and it logs every one (writeAudit) — this module just says what to do.
//
// The three rules that must never be bent:
//   1. An empty card field is auto-filled.
//   2. A filled card field that DIFFERS from the plans becomes a suggestion
//      — never a silent overwrite.
//   3. `gc` is never touched (not even a key this module looks at), and
//      `name` is ALWAYS suggestion-only, even when the card's name is blank.
import type { JobProfile, FieldEvidence, ProfileFieldKey } from '../ai/jobProfile';

export type BidProfileFieldKey = Exclude<ProfileFieldKey, never>;

export interface CurrentBidFields {
  project_type?: string | null;
  brand?: string | null;
  store_number?: string | null;
  prototype?: string | null;
  loc?: string | null;
  sq_ft?: number | string | null;
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
  /** "Plans say 7,381 SF — card says 7,000. Update?" */
  message: string;
}

export interface CardUpdatePlan {
  fills: FieldFill[];
  suggestions: FieldSuggestion[];
}

/** name is always suggestion-only — decisions §4: "Bid name is only ever
 *  suggested, never auto-renamed." gc is not in ProfileFieldKey at all
 *  (jobProfile.ts never extracts it) — this set is a second line of defense
 *  should a caller ever add one. */
const SUGGEST_ONLY: ReadonlySet<string> = new Set(['name']);
const NEVER_TOUCHED: ReadonlySet<string> = new Set(['gc']);

const FIELD_LABELS: Record<BidProfileFieldKey, string> = {
  project_type: 'project type', brand: 'brand', store_number: 'store number',
  prototype: 'prototype', loc: 'location', sq_ft: 'SF', plan_date: 'plan date',
  owner_name: 'owner', architect: 'architect', engineer: 'engineer',
  build_type: 'build type', name: 'name',
};

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function normalizedEqual(field: BidProfileFieldKey, a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  if (field === 'sq_ft') return Number(a) === Number(b);
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

function displayDate(v: unknown): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${m}/${d}/${y}`;
  }
  return String(v);
}

/** Decision 4's own worked example is the sq_ft shape exactly: "Plans say
 *  7,381 SF — card says 7,000. Update?" — every other field follows the
 *  same "plans say X — card says Y" shape with its label spelled out, since
 *  a bare value alone (e.g. two people's names) would otherwise read as
 *  ambiguous about which side is which. */
function buildMessage(field: BidProfileFieldKey, current: unknown, suggested: unknown): string {
  if (field === 'sq_ft') {
    const fmt = (v: unknown) => typeof v === 'number' ? v.toLocaleString() : String(v);
    return `Plans say ${fmt(suggested)} SF — card says ${fmt(current)}. Update?`;
  }
  if (field === 'plan_date') {
    return `Plans say ${displayDate(suggested)} — card says ${displayDate(current)} (${FIELD_LABELS[field]}). Update?`;
  }
  return `Plans say "${suggested}" — card says "${current}" (${FIELD_LABELS[field]}). Update?`;
}

/** The pure decision function. `current` must include every field the
 *  profile might touch (a bid row, mapped to this shape) plus `name` (always
 *  present on a bid). */
export function computeCardUpdates(current: CurrentBidFields, profile: JobProfile): CardUpdatePlan {
  const fills: FieldFill[] = [];
  const suggestions: FieldSuggestion[] = [];

  for (const [rawKey, evidence] of Object.entries(profile.fields)) {
    const key = rawKey as BidProfileFieldKey;
    if (NEVER_TOUCHED.has(key)) continue;
    const ev = evidence as FieldEvidence;
    const currentValue = (current as Record<string, unknown>)[key];

    if (SUGGEST_ONLY.has(key)) {
      if (!normalizedEqual(key, currentValue, ev.value)) {
        suggestions.push({
          field: key, currentValue, suggestedValue: ev.value, sheet: ev.sheet, quote: ev.quote,
          message: `Plans suggest naming this bid "${ev.value}". Rename?`,
        });
      }
      continue;
    }

    if (isEmpty(currentValue)) {
      fills.push({
        field: key, value: ev.value, sheet: ev.sheet, quote: ev.quote,
        reasonTag: `from plans${ev.sheet ? ` (sheet ${ev.sheet})` : ''}`,
      });
    } else if (!normalizedEqual(key, currentValue, ev.value)) {
      suggestions.push({
        field: key, currentValue, suggestedValue: ev.value, sheet: ev.sheet, quote: ev.quote,
        message: buildMessage(key, currentValue, ev.value),
      });
    }
    // Equal — the card already agrees with the plans; nothing to do or log.
  }

  return { fills, suggestions };
}
