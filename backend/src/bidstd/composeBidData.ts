// Phase 3 Task 5.2/5.3 — compose the full BidData from Agent 4's new
// data-only output plus the bid record (pure — no DB access, no I/O), and
// the legacy adapter that keeps pre-Phase-3 proposals rendering.
import { BidData, Bullet, Section, TakeoffCategory } from './bidData';
import { standardScope6, standardTerms, jobNumber, SECTION_HEADERS } from './boilerplate';
import { Agent4Output } from '../ai/agent4Message';

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
}

/** A saved-estimate line item carrying Phase 2's confidence value — the
 *  authoritative source composeBidData prefers over whatever Agent 4 itself
 *  echoed on the matching takeoff item (see bid_estimates.line_items /
 *  frontend/src/types/index.ts's EstimateLineItem). */
export interface SavedConfidenceItem {
  category: string;
  item: string;
  confidence?: string | null;
}

export interface ComposeBidDataOptions {
  /** Injected for deterministic tests; defaults to `new Date()`. */
  now?: Date;
  savedLineItems?: SavedConfidenceItem[];
}

export interface ComposeBidDataResult {
  data: BidData;
  /** True when bidRow.job_number was empty and a new one was generated —
   *  composeBidData is pure and never writes to the DB; the caller persists
   *  this back to bids.job_number on first use. */
  jobNumberGenerated: boolean;
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
  const sheetList = (agent4.sheets || []).join(', ') || '—';
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

  const takeoff: TakeoffCategory[] = (agent4.takeoff ?? []).map(cat => ({
    name: cat.name,
    items: (cat.items ?? []).map(it => {
      const key = `${cat.name}::${it.item ?? ''}`;
      const conf = confLookup.get(key) ?? normalizeConfidence(it.conf);
      return {
        item: it.item ?? '',
        description: it.description ?? '',
        unit: it.unit ?? '',
        qty: it.qty ?? '',
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
    contact: (bidRow.contact || '').trim() || undefined,
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
    terms: standardTerms(planDate),
    alternates: (agent4.alternates ?? []) as Bullet[],
    takeoff_notes: agent4.takeoff_notes ?? [],
  };

  return { data, jobNumberGenerated };
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
