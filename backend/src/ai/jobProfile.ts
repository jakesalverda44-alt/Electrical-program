// Bid Overview: Plans Upload + Job Profile — categorize a bid from its plans.
//
// Job profile fix round (review 1755e62). The first version ran regexes over
// every page of every file and filled whatever matched first; on the real
// Kissimmee set that filled the landscape architect, the civil cover date, a
// sentence fragment as the engineer and fuel=true. This version:
//
//   1. PAGE SELECTION (pure, selectProfilePages): the sheet check's classified
//      inventory picks ONLY the cover sheet(s), a code / area data sheet when
//      one is identified, and the electrical sheets' title blocks — from the
//      current plan set only (currentSetPages: a sheet printed in two uploads
//      is read from the newest / highest revision; spec books never).
//   2. EXTRACTION: ONE small structured model call (setting
//      ai_job_profile_model, default Sonnet 5) over those pages' text, with a
//      title-block / cover image crop only for a selected page that has no
//      text layer. Every field comes back as {value, sheet, quote, confidence}.
//   3. VALIDATION (code, ai/jobProfileValidators.ts): each field is grounded
//      (the quote is really on that page) and checked by its own rules. The
//      regexes there only ever REJECT or down-rank a model value; nothing is
//      ever filled from a regex.
//
// The card-update rules (estimating/jobProfileCardRules.ts) then auto-fill an
// empty card field only from a validated, high-confidence value; everything
// else is a suggestion.
import type Anthropic from '@anthropic-ai/sdk';
import { normalizeSheetId } from './sheetRefs';
import { sanitizeForPrompt } from './sanitizeForPrompt';
import { callWithRetry } from './retry';
import { assertNotTruncated } from './stopReason';
import { usageCost } from '../eval/takeoffEval';
import {
  checkAddress, checkArchitect, checkBrand, checkBuildType, checkEngineer, checkOwner, checkPlanDate, checkPrototype,
  checkSqFt, checkStoreNumber, checkSystem, minConfidence, otherBrandsInContext, SYSTEM_KEYS,
  type Checked, type Confidence, type KnownBrand, type ModelAddress, type ModelField, type ModelSystem,
  type ProfileSource, type SourceWhy, type SystemEvidence, type SystemKey,
} from './jobProfileValidators';

export type { Confidence, ProfileSource, SystemEvidence, SystemKey, KnownBrand } from './jobProfileValidators';

export type ProfileFieldKey =
  | 'project_type' | 'brand' | 'store_number' | 'prototype' | 'loc' | 'sq_ft'
  | 'plan_date' | 'owner_name' | 'architect' | 'engineer' | 'build_type' | 'name';

export interface FieldEvidence<T = unknown> {
  value: T;
  /** The sheet the value was read from ("E-1", "C0.1"). */
  sheet: string | null;
  /** The exact text it was read from — never invented (grounded). */
  quote: string | null;
  confidence: Confidence;
  /** Every code validator passed. The card is auto-filled only when this is
   *  true AND confidence is 'high'. */
  validated: boolean;
  /** Why it is only a suggestion (validator notes, disagreements). */
  notes?: string[];
  /** sq_ft only: building | gross | net. */
  label?: string;
}

export interface RejectedValue { field: string; value: unknown; sheet: string | null; quote: string | null; reason: string }

export interface ProfilePageRef { sheet: string; file: string; page: number; why: SourceWhy; vision?: boolean }

export interface JobProfile {
  /** 'undetermined' — nothing readable (a scanned set the vision fallback
   *  could not read, or no cover / electrical sheet at all): no fills. */
  status: 'complete' | 'undetermined';
  undeterminedReason?: string;
  fields: Partial<Record<ProfileFieldKey, FieldEvidence>>;
  rejected: RejectedValue[];
  systems: Record<SystemKey, SystemEvidence>;
  usedVision: boolean;
  pagesUsed: ProfilePageRef[];
}

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  cstore_fuel: 'C-Store w/ Fuel', car_wash: 'Car Wash', self_storage: 'Self-Storage', office: 'Office',
  warehouse: 'Warehouse', restaurant: 'Restaurant', medical: 'Medical', retail: 'Retail', other: 'Other',
};

/** A page has a usable text layer from this many characters (sheetCheck's
 *  TEXT_LAYER_MIN_CHARS). */
export const TEXT_LAYER_MIN_CHARS = 50;
export const DEFAULT_JOB_PROFILE_MODEL = 'claude-sonnet-5';

// ── 1. Page selection (pure) ────────────────────────────────────────────────

/** One page of the sheet check's inventory, with its document's metadata. */
export interface InventoryPage {
  documentId?: string;
  file: string;
  sha: string;
  page: number;
  sheetNo: string;
  title: string;
  discipline: string;
  /** The document's upload time (ISO) — newest wins. */
  uploadedAt?: string | null;
  textChars?: number;
}

const SPEC_RE = /\bSPECIFICATIONS?\b|\bPROJECT\s+MANUAL\b|\bSPEC\s+BOOK\b/i;

/** "REV 2", "Rev.3", "R2" in a file name. */
export function revisionOf(name: string): number | null {
  const m = /\bREV(?:ISION)?\.?\s*[-_#]?\s*(\d{1,3})\b/i.exec(name) ?? /(?:^|[\s_-])R(\d{1,2})(?:[\s_.-]|$)/i.exec(name);
  return m ? Number(m[1]) : null;
}

/** S7 — only the current plan set. A sheet number printed in more than one
 *  upload is read from ONE of them: the higher explicit revision when both
 *  files carry one, else the newest upload. Older copies never outvote it. */
export function currentSetPages(pages: InventoryPage[]): InventoryPage[] {
  const rank = (p: InventoryPage) => ({ rev: revisionOf(p.file), at: p.uploadedAt ? Date.parse(p.uploadedAt) : 0 });
  const better = (a: InventoryPage, b: InventoryPage): boolean => {
    const ra = rank(a); const rb = rank(b);
    if (ra.rev != null && rb.rev != null && ra.rev !== rb.rev) return ra.rev > rb.rev;
    if (ra.at !== rb.at) return ra.at > rb.at;
    return (a.documentId ?? a.file) > (b.documentId ?? b.file);
  };
  const bySheet = new Map<string, InventoryPage>();
  for (const p of pages) {
    const id = normalizeSheetId(p.sheetNo ?? '');
    if (!id) continue;
    const cur = bySheet.get(id);
    if (!cur || better(p, cur)) bySheet.set(id, p);
  }
  return pages.filter(p => {
    if (SPEC_RE.test(p.title ?? '') || SPEC_RE.test(p.file)) return false;
    const id = normalizeSheetId(p.sheetNo ?? '');
    return !id || bySheet.get(id) === p;
  });
}

export interface SelectedPage extends InventoryPage { why: SourceWhy }

const COVER_TITLE_RE = /\b(COVER|TITLE)\s*(SHEET|PAGE)\b/i;
const CODE_AREA_TITLE_RE = /\bCODE\s*(ANALYSIS|SUMMARY|DATA|REVIEW|COMPLIANCE|PLAN)\b|\b(AREA|SITE|PROJECT|BUILDING)\s*(DATA|INFORMATION|INFO|SUMMARY|TABULATION|CALCULATIONS?)\b|\bLIFE\s*SAFETY\b/i;
const CODE_AREA_TEXT_RE = /\b(SITE\s+DATA|BUILDING\s+(INFORMATION|DATA)|PROJECT\s+DATA|CODE\s+(ANALYSIS|SUMMARY)|BUILDING\s+AREA|GROSS\s+(BUILDING|FLOOR)\s+AREA|AREA\s+(SUMMARY|CALCULATIONS?|TABULATION))\b/gi;
export const MAX_COVER_PAGES = 3;
export const MAX_CODE_AREA_PAGES = 2;
export const MAX_ELECTRICAL_PAGES = 8;

function isElectricalPage(p: InventoryPage): boolean {
  return p.discipline === 'electrical' || (p.discipline === 'unknown' && /^E/i.test(normalizeSheetId(p.sheetNo ?? '') ?? ''));
}

/** Decision 1 of the fix round: covers, a code / area data sheet if
 *  identified, the electrical sheets' title blocks — nothing else. A file the
 *  classifier could not place at all contributes its first page as a cover. */
export function selectProfilePages(pagesIn: InventoryPage[], textOf: (p: InventoryPage) => string): SelectedPage[] {
  const pages = currentSetPages(pagesIn);
  const order = (a: InventoryPage, b: InventoryPage) =>
    (Date.parse(b.uploadedAt ?? '') || 0) - (Date.parse(a.uploadedAt ?? '') || 0) || a.file.localeCompare(b.file) || a.page - b.page;
  const sorted = [...pages].sort(order);
  const out: SelectedPage[] = [];
  const taken = new Set<InventoryPage>();
  const take = (p: InventoryPage, why: SourceWhy) => { taken.add(p); out.push({ ...p, why }); };

  const covers = sorted.filter(p => p.discipline === 'cover' || COVER_TITLE_RE.test(p.title ?? ''));
  for (const p of covers.slice(0, MAX_COVER_PAGES)) take(p, 'cover');

  const codeCandidates = sorted.filter(p => !taken.has(p) && !isElectricalPage(p));
  const byTitle = codeCandidates.filter(p => CODE_AREA_TITLE_RE.test(p.title ?? ''));
  const byText = codeCandidates
    .filter(p => !byTitle.includes(p))
    .map(p => ({ p, hits: (textOf(p).match(CODE_AREA_TEXT_RE) ?? []).length }))
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map(x => x.p);
  for (const p of [...byTitle, ...byText].slice(0, MAX_CODE_AREA_PAGES)) take(p, 'code_area');

  const electrical = sorted.filter(p => !taken.has(p) && isElectricalPage(p))
    .sort((a, b) => (a.sheetNo ?? '').localeCompare(b.sheetNo ?? '', undefined, { numeric: true }));
  for (const p of electrical.slice(0, MAX_ELECTRICAL_PAGES)) take(p, 'electrical');

  if (!out.length) {
    // Nothing classified (no inventory): the first page of each file.
    const firsts = new Map<string, InventoryPage>();
    for (const p of sorted) if (!firsts.has(p.sha)) firsts.set(p.sha, p);
    for (const p of [...firsts.values()].slice(0, MAX_COVER_PAGES)) take(p, 'cover');
  }
  return out;
}

// ── 2. Prompt text (pure) ───────────────────────────────────────────────────

/** An electrical sheet's title block, from its layout text: a page with
 *  little text IS its title block (Kissimmee's E-sheets are ~600 chars); a
 *  busy page gives its right 25% strip (the same strip titleBlockCropRect
 *  renders for the classifier — pdftotext keeps columns by position), plus
 *  its bottom lines when the strip alone is thin. */
export const TITLE_BLOCK_WHOLE_PAGE_CHARS = 3000;
export function titleBlockText(text: string): string {
  const t = String(text ?? '');
  if (t.length <= TITLE_BLOCK_WHOLE_PAGE_CHARS) return t;
  const lines = t.split(/\r?\n/);
  const width = Math.max(...lines.map(l => l.length));
  const from = Math.floor(width * 0.75);
  const strip = lines.map(l => l.slice(from)).join('\n');
  if (compactLayoutText(strip).length >= 300) return strip;
  return `${strip}\n${lines.slice(-12).join('\n')}`;
}

export interface PreparedInput {
  /** What the validators check against (original layout text). */
  sources: ProfileSource[];
  /** What the model is shown (compacted text), in order. */
  promptPages: PromptPage[];
  /** Selected pages with no text layer — the vision fallback's crops. */
  needsImage: SelectedPage[];
  pagesUsed: ProfilePageRef[];
  /** No selected page had a text layer. */
  noText: boolean;
}

export function sheetLabelFor(p: InventoryPage, all: InventoryPage[]): string {
  const base = (p.sheetNo ?? '').trim();
  if (!base) return `${p.file} p${p.page}`;
  const dup = all.filter(q => (q.sheetNo ?? '').trim() === base).length > 1;
  return dup ? `${base} (${p.file} p${p.page})` : base;
}

export function prepareProfileInput(selected: SelectedPage[], textOf: (p: InventoryPage) => string): PreparedInput {
  const sources: ProfileSource[] = [];
  const promptPages: PromptPage[] = [];
  const needsImage: SelectedPage[] = [];
  const pagesUsed: ProfilePageRef[] = [];
  for (const p of selected) {
    const sheet = sheetLabelFor(p, selected);
    const full = textOf(p) ?? '';
    const text = p.why === 'electrical' ? titleBlockText(full) : full;
    if (full.replace(/\s+/g, '').length < TEXT_LAYER_MIN_CHARS) {
      needsImage.push(p);
      pagesUsed.push({ sheet, file: p.file, page: p.page, why: p.why, vision: true });
      continue;
    }
    sources.push({ sheet, why: p.why, text, file: p.file, page: p.page });
    promptPages.push({ sheet, why: p.why, text: promptTextFor(p.why, text) });
    pagesUsed.push({ sheet, file: p.file, page: p.page, why: p.why });
  }
  return { sources, promptPages, needsImage, pagesUsed, noText: sources.length === 0 };
}


/** Layout text, compacted for the prompt: blank lines dropped, runs of 3+
 *  spaces (pdftotext's column gaps) shown as " | ". */
export function compactLayoutText(text: string): string {
  return String(text ?? '').split(/\r?\n/).map(l => l.replace(/\s+$/, '').replace(/^\s+/, '').replace(/\s{3,}/g, ' | '))
    .filter(l => l.replace(/[|\s]/g, '').length > 0).join('\n');
}

/** Code / area pages: only the lines around a labeled data block. */
export function dataBlockExcerpt(text: string, around = 8, cap = 6000): string {
  const lines = String(text ?? '').split(/\r?\n/);
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    CODE_AREA_TEXT_RE.lastIndex = 0;
    if (CODE_AREA_TEXT_RE.test(l) || /\b(BLDG\.?|BUILDING|FLOOR)\s+AREA\b|\bUNDER\s+ROOF\b|\bOCCUPANCY\b|\bCONSTRUCTION\s+TYPE\b/i.test(l)) {
      for (let k = Math.max(0, i - around); k <= Math.min(lines.length - 1, i + around); k++) keep.add(k);
    }
  });
  if (!keep.size) return compactLayoutText(text).slice(0, cap);
  const kept = [...keep].sort((a, b) => a - b).map(i => lines[i]).join('\n');
  return compactLayoutText(kept).slice(0, cap);
}

export const PAGE_TEXT_CAPS: Record<SourceWhy, number> = { cover: 16000, code_area: 6000, electrical: 3000 };

export function promptTextFor(why: SourceWhy, text: string): string {
  if (why === 'code_area') return dataBlockExcerpt(text, 8, PAGE_TEXT_CAPS.code_area);
  return compactLayoutText(text).slice(0, PAGE_TEXT_CAPS[why]);
}

export const JOB_PROFILE_SYSTEM = `You read the cover sheet(s), code / area data sheets and electrical title blocks of a commercial construction plan set and return the job profile as JSON.

Rules:
- Read ONLY what is printed. Every field you return must carry the sheet label it came from (exactly as given in the "=== SHEET ... ===" header) and an exact, verbatim quote copied from that sheet's text (a short span, one block — not a whole page). If a field is not printed, return an empty value with confidence "none".
- The text is pdftotext layout output: " | " separates unrelated blocks printed side by side on one line. Never join text across a " | ".
- brand: the chain / client the project is FOR (from the cover or title-block project name or owner) — never a consultant, never a person, never a neighbouring or adjacent business mentioned in a note. List any other brand names you see in other_brands.
- store_number: only a number printed as "STORE #", "STORE NO." or "STORE NUMBER".
- prototype: only a value labeled PROTOTYPE / PROTO, or a brand's prototype code printed in the title blocks. Never a panel name.
- site_address: the project / site address (the cover's project block), never an engineer's, architect's or consultant's office address.
- building_sf: only a value labeled building area / gross building area / floor area / under roof. label = "building", "gross building", "floor", "net", "site" or "other".
- plan_date: the electrical sheets' issue date. kind = "issue" or "revision".
- engineer: the engineer of record printed in the electrical title block (a person or firm).
- architect: the architect of record — never the landscape architect, civil or structural engineer.
- owner: the owner / developer.
- build_type: "new", "remodel" or "tenant" ONLY when the scope says so explicitly (new building, renovation, remodel, tenant improvement, existing to remain). A spec index line or an N/A line is not evidence. Otherwise empty.
- systems: for each of fuel, site_lighting, fire_alarm, generator, ev: "yes" only with a quote from an electrical sheet that shows it, "no" only when a sheet says it is not provided, else "unknown".
- confidence: "high" when the value is printed plainly in the right block, "medium" when you had to choose between candidates, "low" when unsure.`;

const FIELD_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['value', 'sheet', 'quote', 'confidence'],
  properties: {
    value: { type: 'string' }, sheet: { type: 'string' }, quote: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
  },
} as const;
const withExtra = (extra: Record<string, unknown>, req: string[]) => ({
  ...FIELD_SCHEMA, required: [...FIELD_SCHEMA.required, ...req], properties: { ...FIELD_SCHEMA.properties, ...extra },
});
const SYSTEM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['present', 'sheet', 'quote'],
  properties: { present: { type: 'string', enum: ['yes', 'no', 'unknown'] }, sheet: { type: 'string' }, quote: { type: 'string' } },
} as const;

/** The structured-output schema (output_config.format). */
export const JOB_PROFILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['brand', 'project_name', 'project_type', 'store_number', 'prototype', 'site_address', 'building_sf', 'plan_date',
    'owner', 'architect', 'engineer', 'build_type', 'other_brands', 'systems'],
  properties: {
    brand: FIELD_SCHEMA, project_name: FIELD_SCHEMA, store_number: FIELD_SCHEMA, prototype: FIELD_SCHEMA,
    owner: FIELD_SCHEMA, architect: FIELD_SCHEMA, engineer: FIELD_SCHEMA, build_type: FIELD_SCHEMA,
    project_type: withExtra({ value: { type: 'string', enum: ['', ...Object.keys(PROJECT_TYPE_LABELS)] } }, []),
    site_address: {
      type: 'object', additionalProperties: false, required: ['street', 'city', 'state', 'zip', 'sheet', 'quote', 'confidence'],
      properties: {
        street: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, zip: { type: 'string' },
        sheet: { type: 'string' }, quote: { type: 'string' }, confidence: FIELD_SCHEMA.properties.confidence,
      },
    },
    building_sf: withExtra({ label: { type: 'string', enum: ['', 'building', 'gross building', 'floor', 'net', 'site', 'other'] } }, ['label']),
    plan_date: withExtra({ kind: { type: 'string', enum: ['', 'issue', 'revision'] } }, ['kind']),
    other_brands: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['value', 'sheet', 'quote'], properties: { value: { type: 'string' }, sheet: { type: 'string' }, quote: { type: 'string' } } },
    },
    systems: {
      type: 'object', additionalProperties: false, required: SYSTEM_KEYS as unknown as string[],
      properties: Object.fromEntries(SYSTEM_KEYS.map(k => [k, SYSTEM_SCHEMA])),
    },
  },
} as const;

export interface PromptPage { sheet: string; why: SourceWhy; text: string; image?: Buffer }

const WHY_LABEL: Record<SourceWhy, string> = { cover: 'cover sheet', code_area: 'code / area data (excerpt)', electrical: 'electrical sheet title block' };

export function buildUserContent(pages: PromptPage[]): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
  for (const p of pages) {
    const head = `=== SHEET ${sanitizeForPrompt(p.sheet)} (${WHY_LABEL[p.why]}) ===`;
    if (p.image) {
      content.push({ type: 'text', text: `${head}\n(no text layer — image of the ${p.why === 'electrical' ? 'title block' : 'sheet'} follows)` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.image.toString('base64') } });
    } else {
      content.push({ type: 'text', text: `${head}\n${sanitizeForPrompt(p.text)}` });
    }
  }
  content.push({ type: 'text', text: 'Return the job profile JSON only.' });
  return content;
}

// ── 3. The model call ───────────────────────────────────────────────────────

export interface ModelReply {
  brand?: ModelField; project_name?: ModelField; project_type?: ModelField; store_number?: ModelField; prototype?: ModelField;
  site_address?: ModelAddress; building_sf?: ModelField & { label?: string }; plan_date?: ModelField & { kind?: string };
  owner?: ModelField; architect?: ModelField; engineer?: ModelField; build_type?: ModelField;
  other_brands?: Array<{ value: string; sheet: string; quote: string }>;
  systems?: Partial<Record<SystemKey, ModelSystem>>;
}

export const JOB_PROFILE_MAX_TOKENS = 8000;

/** Models that take neither `effort` nor adaptive thinking. */
function isLegacyModel(model: string): boolean {
  return /haiku-4-5|sonnet-4-5|sonnet-4-6|opus-4-5|opus-4-6/.test(model);
}

export interface ModelCallResult { reply: ModelReply | null; usage: { input_tokens: number; output_tokens: number }; raw: string }

/** One structured call. The reply is parsed tolerantly (JSON text, fenced or
 *  bare) and an unparseable reply is null — the caller treats that like a
 *  set nothing could be read from. */
export async function callJobProfileModel(client: Anthropic, model: string, pages: PromptPage[]): Promise<ModelCallResult> {
  const params = {
    model,
    max_tokens: JOB_PROFILE_MAX_TOKENS,
    system: [{ type: 'text' as const, text: JOB_PROFILE_SYSTEM, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: buildUserContent(pages) }],
    output_config: {
      ...(isLegacyModel(model) ? {} : { effort: 'low' as const }),
      format: { type: 'json_schema' as const, schema: JOB_PROFILE_SCHEMA as unknown as Record<string, unknown> },
    },
  };
  const resp = await callWithRetry(() => client.messages.stream(params).finalMessage());
  assertNotTruncated(resp, 'Job profile reader', JOB_PROFILE_MAX_TOKENS);
  const raw = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
  return {
    reply: parseModelReply(raw),
    usage: { input_tokens: resp.usage?.input_tokens ?? 0, output_tokens: resp.usage?.output_tokens ?? 0 },
    raw,
  };
}

export function parseModelReply(raw: string): ModelReply | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(body.slice(start, end + 1));
    return v && typeof v === 'object' ? v as ModelReply : null;
  } catch { return null; }
}

/** Cents for one call at list price (null for an unknown model). */
export function jobProfileCostCents(usage: { input_tokens: number; output_tokens: number } | null, model: string): number {
  const dollars = usageCost(usage, model) ?? usageCost(usage, DEFAULT_JOB_PROFILE_MODEL) ?? 0;
  return Math.round(dollars * 100 * 10000) / 10000;
}

// ── 4. Assemble the profile (pure) ──────────────────────────────────────────

function present(f: { value?: string; confidence?: string } | undefined | null): f is ModelField {
  return !!f && typeof f.value === 'string' && f.value.trim() !== '' && f.confidence !== 'none';
}

function conf(c: unknown): Confidence {
  return c === 'high' || c === 'medium' || c === 'low' ? c : 'low';
}

function titleOf(v: string): string {
  return v.trim();
}

export interface AssembleInput {
  reply: ModelReply | null;
  sources: ProfileSource[];
  brands: KnownBrand[];
  usedVision: boolean;
  pagesUsed: ProfilePageRef[];
  /** No selected page had a text layer (a scanned set). */
  noText: boolean;
}

function emptySystems(): Record<SystemKey, SystemEvidence> {
  return Object.fromEntries(SYSTEM_KEYS.map(k => [k, { value: null, sheet: null, quote: null }])) as Record<SystemKey, SystemEvidence>;
}

export function undetermined(reason: string, pagesUsed: ProfilePageRef[] = [], usedVision = false): JobProfile {
  return { status: 'undetermined', undeterminedReason: reason, fields: {}, rejected: [], systems: emptySystems(), usedVision, pagesUsed };
}

/** The model's reply + the code validators -> the profile. */
export function assembleJobProfile(input: AssembleInput): JobProfile {
  const { reply, sources, brands } = input;
  if (!reply) {
    return undetermined(input.noText ? 'The plans have no text layer and the sheet images could not be read.' : 'The plans could not be read.', input.pagesUsed, input.usedVision);
  }
  const fields: Partial<Record<ProfileFieldKey, FieldEvidence>> = {};
  const rejected: RejectedValue[] = [];

  const put = <T>(key: ProfileFieldKey, f: ModelField, c: Checked<T>, map: (v: T) => unknown = v => v, extra: Partial<FieldEvidence> = {}) => {
    if (!c.ok) {
      rejected.push({ field: key, value: f.value, sheet: f.sheet || null, quote: f.quote || null, reason: c.notes.join('; ') || 'failed a check' });
      return;
    }
    const cap = c.cap ?? 'high';
    const confidence = minConfidence(conf(f.confidence), cap);
    fields[key] = {
      value: map(c.value as T), sheet: f.sheet || null, quote: f.quote || null, confidence,
      validated: cap === 'high', ...(c.notes.length ? { notes: c.notes } : {}), ...extra,
    };
  };

  // Brand first: the prototype and project type depend on it.
  let brandName: string | null = null;
  let brandType: string | undefined;
  if (present(reply.brand)) {
    const c = checkBrand(reply.brand, sources, brands);
    put('brand', reply.brand, c, v => v.name);
    if (c.ok && c.value) { brandName = c.value.name; brandType = c.value.projectType; }
  }
  // Other brands the model saw in a project context make the brand a choice.
  if (fields.brand && brandName) {
    const others = otherBrandsInContext(reply.other_brands ?? [], sources, brands, brandName);
    if (others.length) {
      const b = fields.brand;
      fields.brand = { ...b, confidence: 'low', validated: false, notes: [...(b.notes ?? []), `the plans also name ${others.join(', ')} — pick the brand`] };
    }
  }

  if (brandType && fields.brand) {
    const b = fields.brand;
    fields.project_type = { value: brandType, sheet: b.sheet, quote: b.quote, confidence: b.confidence, validated: b.validated, notes: ['from the brand'] };
  } else if (present(reply.project_type) && PROJECT_TYPE_LABELS[reply.project_type.value]) {
    const f = reply.project_type;
    const grounded = sources.some(s => normalizeText(s.text).includes(normalizeText(f.quote)) && normalizeText(f.quote).length >= 3);
    if (grounded) {
      fields.project_type = { value: f.value, sheet: f.sheet || null, quote: f.quote || null, confidence: minConfidence(conf(f.confidence), 'medium'), validated: false, notes: ['inferred from the plans, not from a known brand'] };
    } else {
      rejected.push({ field: 'project_type', value: f.value, sheet: f.sheet || null, quote: f.quote || null, reason: 'the quoted text is not on any sheet that was read' });
    }
  }

  if (present(reply.store_number)) put('store_number', reply.store_number, checkStoreNumber(reply.store_number, sources));
  if (present(reply.prototype)) put('prototype', reply.prototype, checkPrototype(reply.prototype, sources, brandName));

  let city: string | null = null;
  let state: string | null = null;
  const a = reply.site_address;
  if (a && typeof a.street === 'string' && a.street.trim() && a.confidence !== 'none') {
    const f: ModelField = { value: a.street, sheet: a.sheet, quote: a.quote, confidence: conf(a.confidence) };
    const c = checkAddress(a, sources);
    put('loc', f, c, v => v.loc);
    if (c.ok && c.value) { city = c.value.city; state = c.value.state; }
  }

  if (present(reply.building_sf)) {
    const c = checkSqFt(reply.building_sf, sources);
    put('sq_ft', reply.building_sf, c, v => v.value, c.ok && c.value ? { label: c.value.label } : {});
  }
  if (present(reply.plan_date)) put('plan_date', reply.plan_date, checkPlanDate(reply.plan_date, sources));
  if (present(reply.owner)) put('owner_name', reply.owner, checkOwner(reply.owner, sources), v => titleOf(v));
  if (present(reply.architect)) put('architect', reply.architect, checkArchitect(reply.architect, sources));
  if (present(reply.engineer)) put('engineer', reply.engineer, checkEngineer(reply.engineer, sources));
  if (present(reply.build_type)) put('build_type', reply.build_type, checkBuildType(reply.build_type, sources));

  // Suggested name (always a suggestion, never a fill): brand + store +
  // city/state, else the project name or the project type's LABEL (S11).
  if (city && state) {
    const store = fields.store_number?.value;
    const typeLabel = fields.project_type ? PROJECT_TYPE_LABELS[String(fields.project_type.value)] : null;
    const projectName = present(reply.project_name) && sources.some(s => normalizeText(s.text).includes(normalizeText(reply.project_name!.quote)))
      ? reply.project_name.value.trim() : null;
    const head = brandName && store ? `${brandName} #${store}` : brandName ?? projectName ?? typeLabel;
    if (head) {
      fields.name = { value: `${head} – ${city}, ${state}`, sheet: fields.loc?.sheet ?? null, quote: null, confidence: 'medium', validated: false };
    }
  }

  const systems = emptySystems();
  for (const k of SYSTEM_KEYS) systems[k] = checkSystem(k, reply.systems?.[k], sources);

  const readable = Object.keys(fields).length > 0 || SYSTEM_KEYS.some(k => systems[k].value !== null);
  if (!readable && input.noText) {
    return { ...undetermined('The plans have no text layer and the sheet images could not be read.', input.pagesUsed, input.usedVision), rejected };
  }
  return { status: 'complete', fields, rejected, systems, usedVision: input.usedVision, pagesUsed: input.pagesUsed };
}

function normalizeText(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[|⋯]/g, ' ').replace(/\s+/g, ' ').trim();
}
