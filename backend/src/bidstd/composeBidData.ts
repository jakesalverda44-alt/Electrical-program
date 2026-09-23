// Phase 3 Task 5.2/5.3 — compose the full BidData from Agent 4's new
// data-only output plus the bid record (pure — no DB access, no I/O), and
// the legacy adapter that keeps pre-Phase-3 proposals rendering.
import { BidData, Bullet, Section, TakeoffCategory } from './bidData';
import { standardScope6, standardTerms, jobNumber, SECTION_HEADERS } from './boilerplate';
import { Agent4Output } from '../ai/agent4Message';
import { unitFamily } from '../estimating/mapper';

// ── composeBidData ──────────────────────────────────────────────────────────

/** The subset of the `bids` row composeBidData needs. Field names match the
 *  DB columns directly so a caller can spread a query row straight in. */
export interface ComposeBidRow {
  name?: string | null;
  loc?: string | null;
  gc?: string | null;
  contact?: string | null;
  sq_ft?: number | string | null;
  job_number?: string | null;
  /** Takeoff accuracy Task 13 — for the Cowork "Re:  AutoZone Store #10077" line. */
  brand?: string | null;
}

/** Task 13 — "Sheets E-1 through E-7 and the civil/photometric set (Sheet
 *  PH0.1)": the electrical sheets (a run when they're consecutive) plus the
 *  photometric / civil sheets, never every A/S/M/P sheet in the set. */
export function formatSheetCitation(sheets: string[]): string {
  const clean = [...new Set(sheets.map(s => s.trim()).filter(Boolean))];
  const elec = clean.filter(s => /^E[\s-]?\d/i.test(s));
  const other = clean.filter(s => /^(PH|C|CE|CS|CU)[\s-]?\d/i.test(s));
  const num = (s: string) => Number(/(\d+(?:\.\d+)?)/.exec(s)?.[1] ?? NaN);
  elec.sort((a, b) => num(a) - num(b));
  let elecText = '';
  if (elec.length) {
    const ints = elec.map(num);
    const consecutive = elec.length >= 3 && ints.every((n, i) => Number.isInteger(n) && (i === 0 || n === ints[i - 1] + 1));
    elecText = consecutive ? `${elec[0]} through ${elec[elec.length - 1]}` : elec.join(', ');
  }
  const otherText = other.length ? `the civil/photometric set (Sheet${other.length > 1 ? 's' : ''} ${other.join(', ')})` : '';
  if (!elecText && !otherText) return clean.join(', ') || '—';
  if (elecText && otherText) return `${elecText} and ${otherText}`;
  return elecText || otherText;
}

/** Task 13 — "AutoZone Store #10077" when the bid has a brand and a store
 *  number; otherwise the bid name. */
export function reLineFor(name: string, brand?: string | null): string {
  const store = /#\s*(\d{3,6})\b/.exec(name)?.[1];
  const b = (brand || '').trim();
  return b && store ? `${b} Store #${store}` : name;
}

/** Task 13 — a contact field holding "Name <email>" / "email" splits into the
 *  Attn line and the email line. */
export function splitContact(contact: string): { name?: string; email?: string } {
  const email = /[^\s<>(),;]+@[^\s<>(),;]+\.[a-z]{2,}/i.exec(contact)?.[0];
  const name = (email ? contact.replace(email, '') : contact).replace(/[<>()]/g, ' ').replace(/[\s,;:—-]+$/g, '').replace(/^[\s,;:—-]+/g, '').replace(/\s+/g, ' ').trim();
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) };
}

/** A saved-estimate line item carrying Phase 2's confidence value — the
 *  authoritative source composeBidData prefers over whatever Agent 4 itself
 *  echoed on the matching takeoff item (see bid_estimates.line_items /
 *  frontend/src/types/index.ts's EstimateLineItem).
 *
 *  Phase B, Task 3 — also carries qty/unit/qty_source. When qty_source is
 *  'markup' (an estimator confirmed this quantity on the plans and applied
 *  it — Decision 4), composeBidData prefers the SAVED qty/unit over Agent
 *  4's own echoed values too, the same way it already prefers the saved
 *  confidence. Every "takeoff output" this data feeds (the GC-facing
 *  takeoff xlsx, the pre-bid package xlsx, and the takeoff table embedded
 *  in the proposal doc itself) all read data.takeoff, which is built here —
 *  fixing it once, here, is what keeps the GC sheet and the priced estimate
 *  from disagreeing (see routes/preconstruction.ts's renderTakeoffXlsx
 *  callers, both of which consume composeCurrentBidData's output). A
 *  qty_source of 'takeoff' or 'manual' still defers to Agent 4's own echo —
 *  only a Plan-Viewer-confirmed quantity is authoritative enough to
 *  override what the AI itself wrote for the GC-facing takeoff. */
export interface SavedConfidenceItem {
  category: string;
  item: string;
  confidence?: string | null;
  qty?: number | null;
  unit?: string | null;
  qty_source?: string | null;
  /** Fix round 1 / B5 — `bidEstimate.ts`'s own takeoff_key: `${category}||
   *  ${item}` for the first occurrence of a duplicate category+item pair,
   *  `::1`/`::2`/... for later ones (dedupeTakeoffKeys). Lets composeBidData
   *  tell TWO saved lines with the identical category+item apart, and match
   *  each to its own occurrence in Agent 4's takeoff array by position —
   *  see the qty-matching block below and its own comment. Absent on a
   *  manual line (no originating takeoff row) or on data saved before this
   *  field existed; both fall back to ordinal 0 (the pre-fix, single-
   *  occurrence-only behavior). */
  takeoff_key?: string | null;
}

export interface ComposeBidDataOptions {
  /** Injected for deterministic tests; defaults to `new Date()`. */
  now?: Date;
  savedLineItems?: SavedConfidenceItem[];
  /** Takeoff accuracy Task 8 — TERMS bullet 4 per the job's account rule. */
  lightingTermsBullet?: string;
}

export interface ComposeBidDataResult {
  data: BidData;
  /** True when bidRow.job_number was empty and a new one was generated —
   *  composeBidData is pure and never writes to the DB; the caller persists
   *  this back to bids.job_number on first use. */
  jobNumberGenerated: boolean;
  /** Fix round 1 / B5 — `category::item` keys where Agent 4's own takeoff
   *  array has a DIFFERENT number of rows sharing that key than the saved
   *  estimate does, and at least one of the saved rows is markup-confirmed.
   *  Positional (occurrence-order) matching can't be trusted here — no qty
   *  was overridden for ANY row under these keys, rather than risk
   *  assigning a confirmed quantity to the wrong physical run. Fix round 2
   *  / R2-S4(a) — now wired all the way through composeCurrentBidData and
   *  GET /:bidId/proposal-preview into the Review step's pre-send
   *  checklist and BidSummary (see PcWorkspaceView.tsx). */
  ambiguousQtyKeys: string[];
}

/** Agent 1/2's VERIFIED/ASSUMED/NOT SHOWN, or an already-playbook value,
 *  mapped to FIRM/APPROX/VERIFY — mirrors (but does not import; different
 *  runtime) frontend/src/features/preconstruction/confidence.ts's
 *  confidenceToPlaybook, so both keep the same vocabulary intentionally. */
function normalizeConfidence(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  switch (upper) {
    case 'VERIFIED': return 'FIRM';
    case 'ASSUMED': return 'APPROX';
    case 'NOT SHOWN': return 'VERIFY';
    case 'FIRM':
    case 'APPROX':
    case 'VERIFY':
      return upper;
    default:
      return undefined;
  }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function slug(s: string | undefined | null): string {
  const cleaned = (s || '').replace(/[^a-z0-9]+/gi, '');
  return cleaned || 'Project';
}

const SECTION_LETTER_RE = /^\s*([A-F])\./;

/** Map an Agent-4-supplied section title onto the canonical boilerplate
 *  header whenever it recognizably starts with "A." .. "F." — defends
 *  against the model slightly misformatting a header it was told to copy
 *  verbatim; falls back to whatever title it wrote when unrecognized. */
function canonicalSectionTitle(title: string): string {
  const m = SECTION_LETTER_RE.exec(title || '');
  const letter = m?.[1] as 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | undefined;
  return letter ? SECTION_HEADERS[letter] : title;
}

/**
 * Compose a full BidData from Agent 4's new-shape output and the bid row.
 * Pure — precedence (bid row + validated price win over Agent 4's echo),
 * job-number generate-once, confidence normalization, and the
 * allowances_bullets/fixture_types -> Section D/C folding all happen here,
 * deterministically, so Agent 4 never has to hand-format a fixed template.
 */
export function composeBidData(
  bidRow: ComposeBidRow,
  agent4: Agent4Output,
  totalPrice: string,
  opts: ComposeBidDataOptions = {},
): ComposeBidDataResult {
  const now = opts.now ?? new Date();

  const existingJobNumber = (bidRow.job_number || '').trim();
  const jobNumberGenerated = !existingJobNumber;
  const jobNo = existingJobNumber || jobNumber(now);

  const planDate = (agent4.plan_date || '').trim() || '—';
  const sheetList = formatSheetCitation(agent4.sheets || []);
  const gcName = (bidRow.gc || '').trim() || '—';
  const projectName = (bidRow.name || '').trim() || '—';
  const projectAddress = (bidRow.loc || '').trim();

  // Confidence: prefer the saved estimate's authoritative value; fall back
  // to whatever Agent 4 itself carried on the item.
  const confLookup = new Map<string, string>();
  for (const li of opts.savedLineItems ?? []) {
    const normalized = normalizeConfidence(li.confidence);
    if (normalized) confLookup.set(`${li.category}::${li.item}`, normalized);
  }

  // Fix round 1 / B5 — a Plan-Viewer-confirmed qty (qty_source='markup')
  // overrides Agent 4's own echoed qty/unit for the matching takeoff item,
  // so the GC-facing takeoff xlsx and the priced estimate never disagree
  // once an estimator has applied a marked quantity. The OLD version keyed
  // this purely on `${category}::${item}` — real takeoffs legitimately
  // repeat the same category+item id across multiple rows (a re-split, or
  // the same fixture type on two floors), and the last SAVED row sharing a
  // key silently overwrote every Agent 4 row sharing it, even ones that
  // were never marked/applied at all.
  //
  // Fix: match each Agent 4 occurrence of a key to the SAME-ORDINAL saved
  // line for that key (both ultimately derive from the same underlying
  // takeoff rows, in the same order — bidEstimate.ts's dedupeTakeoffKeys
  // suffixes duplicates `::1`, `::2`... in original-row order; Agent 4's
  // own takeoff array preserves the source rows' order the same way).
  // Only override the occurrences that are individually markup-confirmed;
  // a sibling occurrence that was never marked keeps Agent 4's own echo —
  // see the reviewer's own two-row example (composeBidData.test.ts).
  const savedGroups = new Map<string, { qty: number | null; unit: string | null; qtySource: string | null; ordinal: number }[]>();
  for (const li of opts.savedLineItems ?? []) {
    const key = `${li.category}::${li.item}`;
    const list = savedGroups.get(key) ?? [];
    list.push({
      qty: typeof li.qty === 'number' && Number.isFinite(li.qty) ? li.qty : null,
      unit: li.unit ?? null,
      qtySource: li.qty_source ?? null,
      ordinal: takeoffKeyOrdinal(li.takeoff_key),
    });
    savedGroups.set(key, list);
  }
  for (const list of savedGroups.values()) list.sort((a, b) => a.ordinal - b.ordinal);

  const agent4KeyCounts = new Map<string, number>();
  for (const cat of agent4.takeoff ?? []) {
    for (const it of cat.items ?? []) {
      const key = `${cat.name}::${it.item ?? ''}`;
      agent4KeyCounts.set(key, (agent4KeyCounts.get(key) ?? 0) + 1);
    }
  }

  const ambiguousQtyKeys = new Set<string>();
  for (const [key, list] of savedGroups) {
    const hasMarkupEntry = list.some(e => e.qtySource === 'markup');
    if (hasMarkupEntry && list.length !== (agent4KeyCounts.get(key) ?? 0)) {
      ambiguousQtyKeys.add(key);
    }
  }
  if (ambiguousQtyKeys.size > 0) {
    // "log it" (the fix's own wording) — this is a data-integrity signal
    // worth an operator's attention even though nothing crashes. Fix round
    // 2 / R2-S4(a) — this used to be the ONLY place this ever surfaced;
    // routes/preconstruction.ts's composeCurrentBidData now also returns
    // ambiguousQtyKeys on its ok:true result, and GET
    // /:bidId/proposal-preview includes it in the response body, so the
    // frontend can show it as a real pre-send warning (BidSummary + the
    // Review step's checklist) instead of only ever reaching server logs.
    // eslint-disable-next-line no-console
    console.warn(
      `composeBidData: ${ambiguousQtyKeys.size} category::item key(s) have a mismatched Agent 4 vs. saved-estimate occurrence count and were left un-overridden: ${Array.from(ambiguousQtyKeys).join(', ')}`
    );
  }

  const occurrenceSoFar = new Map<string, number>();
  const takeoff: TakeoffCategory[] = (agent4.takeoff ?? []).map(cat => ({
    name: cat.name,
    items: (cat.items ?? []).map(it => {
      const key = `${cat.name}::${it.item ?? ''}`;
      const conf = confLookup.get(key) ?? normalizeConfidence(it.conf);

      const n = occurrenceSoFar.get(key) ?? 0;
      occurrenceSoFar.set(key, n + 1);
      const savedEntry = ambiguousQtyKeys.has(key) ? undefined : savedGroups.get(key)?.[n];
      // Fix round 2 / R2-S4(b) — est_bid_lines.qty on ANY linear-family line
      // (LF, C or M) is always a RAW FEET count (markupMath.ts's rollupLines,
      // B4's own fix); the unit itself (C/M) is only ever a PRICING
      // denomination, applied by pricing.ts's UNIT_DIVISOR, never a display
      // divisor. Emitting savedEntry.unit as-is here used to hand the GC
      // takeoff `{qty: 1234, unit: 'C'}` for a markup-applied C-priced line —
      // meaning 1,234 raw feet, but a GC reads "1234 C" as 123,400 feet (C =
      // hundreds). The saved qty is already in feet, so the takeoff must
      // always LABEL a linear-family override as 'LF' — never echo the
      // internal C/M pricing unit into GC-facing output. An EA override is
      // unaffected (EA's display and pricing unit are always the same).
      const confirmedQty = savedEntry && savedEntry.qtySource === 'markup' && savedEntry.qty != null
        ? { qty: savedEntry.qty, unit: unitFamily(savedEntry.unit ?? '') === 'LINEAR' ? 'LF' : savedEntry.unit }
        : null;

      return {
        item: it.item ?? '',
        description: it.description ?? '',
        unit: confirmedQty?.unit ?? it.unit ?? '',
        qty: confirmedQty ? confirmedQty.qty : (it.qty ?? ''),
        source: it.source ?? '',
        ...(conf ? { conf } : {}),
        ...(it.furnish_by ? { furnish_by: it.furnish_by } : {}),
      };
    }),
  }));

  // Copy each bullets array (never mutate the caller's Agent4Output) — the
  // fixture_types/allowances_bullets folding below pushes onto these.
  const sections: Section[] = (agent4.sections ?? []).map(s => ({
    title: canonicalSectionTitle(s.title || ''),
    bullets: [...(s.bullets ?? [])] as Bullet[],
  }));

  // Section C's fixed 3rd bullet, built deterministically from fixture_types
  // rather than trusting AI-formatted prose for a simple joined list.
  const fixtureTypes = agent4.fixture_types ?? [];
  if (fixtureTypes.length) {
    const bullet = `Fixture types per schedule: ${fixtureTypes.join(', ')}.`;
    const c = sections.find(s => s.title === SECTION_HEADERS.C);
    if (c) c.bullets.push(bullet);
    else sections.push({ title: SECTION_HEADERS.C, bullets: [bullet] });
  }

  // Section D's per-allowance bullets, already-formatted strings from
  // Agent 4, appended after whatever site/conduit-spec bullets it wrote.
  const allowancesBullets = agent4.allowances_bullets ?? [];
  if (allowancesBullets.length) {
    const d = sections.find(s => s.title === SECTION_HEADERS.D);
    if (d) d.bullets.push(...allowancesBullets);
    else sections.push({ title: SECTION_HEADERS.D, bullets: [...allowancesBullets] });
  }

  const sqFtNum = bidRow.sq_ft != null && bidRow.sq_ft !== '' ? Number(bidRow.sq_ft) : NaN;
  const buildingArea = Number.isFinite(sqFtNum) && sqFtNum > 0
    ? `${sqFtNum.toLocaleString('en-US')} SF (bid record)`
    : undefined;

  const data: BidData = {
    project_slug: slug(projectName),
    location_slug: slug(projectAddress.split(',')[0] || 'FL'),
    date: formatDate(now),
    client: gcName,
    contact: splitContact(bidRow.contact || '').name,
    email: splitContact(bidRow.contact || '').email,
    re_line: reLineFor(projectName, bidRow.brand),
    project_name: projectName,
    project_address: projectAddress,
    job_number: jobNo,
    plan_date: planDate,
    building_area: buildingArea,
    total_price: totalPrice,
    scope: standardScope6(planDate, sheetList, gcName),
    sections,
    exclusions: (agent4.exclusions ?? []) as Bullet[],
    takeoff,
    terms: standardTerms(planDate, { lightingBullet: opts.lightingTermsBullet }),
    alternates: (agent4.alternates ?? []) as Bullet[],
    takeoff_notes: agent4.takeoff_notes ?? [],
  };

  return { data, jobNumberGenerated, ambiguousQtyKeys: Array.from(ambiguousQtyKeys) };
}

/** `${category}||${item}` (unsuffixed = ordinal 0) or `${category}||${item}
 *  ::N` (ordinal N) — the exact suffix convention bidEstimate.ts's own
 *  dedupeTakeoffKeys() produces. Missing/malformed input (a manual line
 *  with no originating takeoff row, or data saved before takeoff_key was
 *  carried through this far) defaults to ordinal 0 — the single-occurrence
 *  case, which is also correct behavior when there's truly only one row. */
function takeoffKeyOrdinal(takeoffKey: string | null | undefined): number {
  if (!takeoffKey) return 0;
  const m = /::(\d+)$/.exec(takeoffKey);
  return m ? Number(m[1]) : 0;
}

// ── legacyProposalToBidData ─────────────────────────────────────────────────
// Pre-Phase-3 Agent 4 output contract (backend/src/utils/proposalDocx.ts's
// ProposalJSON) — maps it onto Partial<BidData> so an already-generated
// proposal (agent4_output written before this migration) still renders/
// downloads without re-running Agent 4. This is the ONE adapter; proposalDocx
// .ts's buildProposalDocx imports and uses it rather than keeping its own copy.

export interface LegacyScopeOfWork {
  standard6Bullets?: string[];
  A_ServiceDistribution?: string[];
  B_BranchPower?: string[];
  C_LightingControls?: string[];
  D_SiteLightingUnderground?: string[];
  E_LowVoltage?: string[];
  F_Coordination?: string[];
}

export interface LegacyProposalJSON {
  date?: string;
  gcName?: string;
  gcContact?: string;
  gcEmail?: string;
  projectName?: string;
  projectAddress?: string;
  jobNumber?: string;
  drawingDate?: string;
  sheets?: string[];
  scopeOfWork?: LegacyScopeOfWork;
  exclusions?: string[];
  /** Old-shape priced allowances (pre-Phase-3 Agent 4 could emit these
   *  directly rather than Section D bullets) — FIX-2: folded into Section D
   *  bullets below in the standard's own phrasing so a re-downloaded legacy
   *  proposal doesn't silently lose its priced ALLOWANCES content. */
  allowances?: Array<{ item?: string; footage?: number | string; unit?: string; notes?: string }>;
  takeoff?: Array<{ category?: string; item?: string; description?: string; unit?: string; qty?: number; sourceNotes?: string }>;
  terms?: string[];
  totalPrice?: string;
}

// Claude occasionally returns array items as objects instead of strings —
// flatten any such value to a readable string.
function toStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return [o.item, o.text, o.description, o.question, o.risks, o.risk, o.note]
      .filter(Boolean).map(String).join(' — ') || JSON.stringify(v);
  }
  return String(v ?? '');
}

function legacyFormatDate(v: unknown): string {
  const today = new Date();
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const s = toStr(v).trim();
  if (!s) return fmt(today);
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return isNaN(parsed.getTime()) ? fmt(today) : fmt(parsed);
}

const LEGACY_SECTION_MAP: [keyof LegacyScopeOfWork, string][] = [
  ['A_ServiceDistribution', SECTION_HEADERS.A],
  ['B_BranchPower', SECTION_HEADERS.B],
  ['C_LightingControls', SECTION_HEADERS.C],
  ['D_SiteLightingUnderground', SECTION_HEADERS.D],
  ['E_LowVoltage', SECTION_HEADERS.E],
  ['F_Coordination', SECTION_HEADERS.F],
];

// FIX-2 — old-shape allowances (`{item, footage, unit, notes}`) never had a
// bullet-string form the way the new contract's allowances_bullets[] does;
// format them in the standard's own phrasing so a legacy proposal's priced
// ALLOWANCES content survives into the rendered Section D rather than being
// silently dropped on a re-download.
function formatLegacyAllowanceBullet(a: { item?: string; footage?: number | string; unit?: string; notes?: string }): string {
  const item = toStr(a.item).trim();
  const footage = toStr(a.footage).trim();
  const unit = toStr(a.unit).trim();
  const notes = toStr(a.notes).trim();
  const isLf = !unit || unit.toUpperCase() === 'LF';
  const qty = footage || '0';
  const base = isLf
    ? `${qty}' allowance — ${item}`
    : `${qty} ${unit} allowance — ${item}`;
  return notes ? `${base} (${notes})` : base;
}

/**
 * Maps the pre-Phase-3 ProposalJSON shape onto Partial<BidData>. Deliberately
 * NOT required to satisfy validateBidData or the verify gate (an old
 * proposal was never subject to either) — only to render through the same
 * renderBidDocx without throwing, preserving what was actually generated.
 */
export function legacyProposalToBidData(old: LegacyProposalJSON): Partial<BidData> {
  const projectName = toStr(old.projectName) || '—';
  const projectAddress = toStr(old.projectAddress);
  const client = toStr(old.gcName) || '—';

  const sow = old.scopeOfWork ?? {};
  const sections: Section[] = LEGACY_SECTION_MAP
    .map(([key, title]) => ({
      title,
      bullets: (sow[key] ?? []).map(toStr).filter(b => b.trim().length > 0),
    }))
    .filter(s => s.bullets.length > 0);

  // FIX-2 — fold old-shape allowances into Section D, appending to whatever
  // bullets D already has (creating the section if it was empty/absent).
  const allowanceBullets = (old.allowances ?? [])
    .map(formatLegacyAllowanceBullet)
    .filter(b => b.trim().length > 0);
  if (allowanceBullets.length) {
    const d = sections.find(s => s.title === SECTION_HEADERS.D);
    if (d) d.bullets.push(...allowanceBullets);
    else sections.push({ title: SECTION_HEADERS.D, bullets: allowanceBullets });
  }

  const takeoffByCategory = new Map<string, TakeoffCategory>();
  for (const t of old.takeoff ?? []) {
    const name = toStr(t.category) || 'Uncategorized';
    if (!takeoffByCategory.has(name)) takeoffByCategory.set(name, { name, items: [] });
    takeoffByCategory.get(name)!.items.push({
      item: toStr(t.item),
      description: toStr(t.description),
      unit: toStr(t.unit),
      qty: t.qty ?? '',
      source: toStr(t.sourceNotes),
    });
  }

  return {
    project_slug: slug(projectName),
    location_slug: slug(projectAddress.split(',')[1] || projectAddress.split(',')[0] || 'FL'),
    date: legacyFormatDate(old.date),
    client,
    contact: toStr(old.gcContact) || undefined,
    email: toStr(old.gcEmail) || undefined,
    project_name: projectName,
    project_address: projectAddress,
    job_number: toStr(old.jobNumber),
    plan_date: toStr(old.drawingDate) || undefined,
    total_price: toStr(old.totalPrice),
    scope: (sow.standard6Bullets ?? []).map(toStr),
    sections,
    exclusions: (old.exclusions ?? []).map(toStr),
    takeoff: [...takeoffByCategory.values()],
    terms: (old.terms ?? []).map(toStr),
  };
}
