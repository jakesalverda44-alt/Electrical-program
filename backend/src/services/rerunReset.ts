// Re-run reset. Jake: "when we re-run the analysis it should clear out all
// the old outputs." B5 (fix round 1) already cleared takeoff_results' own
// agent outputs on every /analyze; everything the previous run fed into
// (priced lines, the saved estimate and bids.amount, AI markers, AI RFIs,
// the filed proposal / pre-bid files) survived it. beginAnalysisRun() runs
// this in the SAME transaction that mints the new run id, so a re-run is
// either fully reset or not started at all.
//
// CLEARED (AI-derived): takeoff_results' analysis fields, counts, review
// items and answers, account-term snapshot, draft and Agent 4 output;
// suggested AI markers; AI-imported RFIs nobody acted on; takeoff lines the
// estimator never touched; bid_estimates and the bids.amount taken from it
// (or from Agent 4's price); the workspace scope sections, confirmed service
// and ai_done / proposal_generated. Filed proposal / pre-bid files are
// flagged superseded (never deleted).
//
// KEPT (the estimator's work): documents they uploaded, confirmed markers,
// manual lines, takeoff lines they touched (flagged "from previous run —
// re-check" and re-bound by the next sync-takeoff), workspace notes, typed
// RFIs, the scope list and overrides, account rules, est_bid_settings and
// the fixture types they entered for counting (manual_count_targets).
import type { PoolClient } from 'pg';

/** Every document category the CRM generates from an analysis. */
export const GENERATED_OUTPUT_CATEGORIES = ['proposal', 'takeoff', 'prebid_scope', 'prebid_takeoff', 'bid_data'] as const;

export interface WorkspaceRfi {
  id: string;
  question: string;
  submitted?: boolean;
  answer?: string;
  origin?: 'ai' | 'manual';
  [k: string]: unknown;
}

export interface RerunResetSummary {
  runId: string;
  previousRunId: string | null;
  cleared: {
    takeoffLines: number;
    suggestedMarkers: number;
    aiRfis: number;
    supersededDocuments: number;
    reviewItems: number;
    savedEstimate: boolean;
    bidAmount: boolean;
  };
  amount: { before: number | null; kept: boolean };
  kept: {
    manualLines: number;
    recheckLines: number;
    confirmedMarkers: number;
    unassignedMarkers: number;
    rfis: number;
  };
  /** The workspace RFIs after the reset — the client installs these so its
   *  autosave can't PUT the cleared ones back. */
  rfis: WorkspaceRfi[];
  /** Fix round S4 — the Scope of Work after the reset (kept sections) and its
   *  meta (which sections to re-check), installed the same way. */
  scope: Record<string, string>;
  scopeMeta: ScopeMeta;
  scopeCleared: string[];
}

/** An RFI's origin. RFIs from before migration 121 carry none: the AI import
 *  is the only writer whose id contains a '.' (Date.now() + Math.random()),
 *  and a question Agent 2 asked is AI too. */
export function rfiIsAi(r: WorkspaceRfi, agent2Questions: Set<string>): boolean {
  if (r.origin === 'ai') return true;
  if (r.origin === 'manual') return false;
  return String(r.id ?? '').includes('.') || agent2Questions.has(normQuestion(r.question));
}

/** An AI RFI is cleared only while nobody acted on it: one already drafted
 *  to the GC or answered is a record of that conversation, and stays. */
export function rfiSurvivesRerun(r: WorkspaceRfi, agent2Questions: Set<string>): boolean {
  if (!rfiIsAi(r, agent2Questions)) return true;
  return !!r.submitted || !!String(r.answer ?? '').trim();
}

function normQuestion(q: unknown): string {
  return String(q ?? '').trim().toLowerCase();
}

function agent2RfiQuestions(agent2Output: string | null | undefined): Set<string> {
  if (!agent2Output) return new Set();
  try {
    const t = agent2Output.trim();
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const c = fenced ? fenced[1].trim() : t;
    const start = c.indexOf('{');
    const parsed = JSON.parse(start >= 0 ? c.slice(start) : c) as { rfis?: Array<{ question?: unknown }> };
    return new Set((parsed.rfis ?? []).map(r => normQuestion(r.question)).filter(Boolean));
  } catch {
    return new Set();
  }
}

export interface ScopeMeta {
  /** The text the AI wrote into each section (Agent 2 auto-fill / import). */
  ai?: Record<string, string>;
  /** Sections kept through a re-run: "from previous run — re-check". */
  recheck?: string[];
}

/** Fix round S4 — the Scope of Work sections Agent 2's JSON produced, keyed
 *  like the Scope tab (mirrors the frontend's scopeSectionsFrom mapping).
 *  Only the fallback for sections filled before scope_meta existed. */
export function agent2ScopeSections(agent2Output: string | null | undefined): Record<string, string> {
  if (!agent2Output) return {};
  try {
    const t = agent2Output.trim();
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const c = fenced ? fenced[1].trim() : t;
    const start = c.indexOf('{');
    const sow = (JSON.parse(start >= 0 ? c.slice(start) : c) as { scopeOfWork?: Record<string, string[]> }).scopeOfWork;
    if (!sow) return {};
    const join = (a?: string[]) => (a ?? []).join('\n');
    const out: Record<string, string> = {
      A: join(sow.A_ServiceDistribution), B: join(sow.B_BranchPower), C: join(sow.C_LightingControls),
      D: join(sow.E_LowVoltage), F: join(sow.D_SiteLightingUnderground), G: join(sow.F_Coordination),
    };
    for (const k of Object.keys(out)) if (!out[k].trim()) delete out[k];
    return out;
  } catch {
    return {};
  }
}

/** Letters and digits only, lowercased — bullets, markdown and spacing
 *  never make an untouched AI section look "edited". */
const scopeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Fix round S4 — a re-run clears a Scope of Work section only while it is
 *  still exactly what the AI wrote; typed, edited, pre-bid- or import-filled
 *  sections are kept and flagged for re-check. */
export function resetScope(scope: Record<string, string>, meta: ScopeMeta, agent2Output: string | null | undefined): { scope: Record<string, string>; meta: ScopeMeta; cleared: string[] } {
  const aiText: Record<string, string> = { ...agent2ScopeSections(agent2Output), ...(meta.ai ?? {}) };
  const kept: Record<string, string> = {};
  const cleared: string[] = [];
  for (const [k, text] of Object.entries(scope ?? {})) {
    if (typeof text !== 'string' || !text.trim()) continue;
    if (aiText[k] != null && scopeKey(aiText[k]) === scopeKey(text)) cleared.push(k);
    else kept[k] = text;
  }
  return { scope: kept, meta: { ai: {}, recheck: Object.keys(kept) }, cleared };
}

/** SQL predicate: a takeoff line the estimator touched. */
export const TOUCHED_TAKEOFF_LINE_SQL = `(
  qty_overridden = true
  OR material_unit_override IS NOT NULL
  OR labor_hours_override IS NOT NULL
  OR qty_source IN ('markup', 'manual')
  OR coalesce(match_source, '') = 'manual'
  OR (excluded = true AND sync_excluded = false)
)`;

/**
 * Resets everything the previous analysis produced. Must run inside the
 * caller's transaction, AFTER takeoff_results holds the new run id (the
 * caller locks that row first, which serializes concurrent re-runs).
 * `previousAgent2` is the previous run's Agent 2 output, read before it was
 * cleared, so pre-migration RFIs can still be matched against it.
 */
export async function resetForRerun(
  c: PoolClient, bidId: string, runId: string,
  previous: { runId: string | null; agent2Output: string | null; agent4Price: unknown; reviewItems: unknown },
): Promise<RerunResetSummary> {
  // ── Priced lines ─────────────────────────────────────────────────────────
  const deleted = await c.query<{ line_key: string }>(
    `DELETE FROM est_bid_lines WHERE bid_id = $1 AND source = 'takeoff' AND NOT ${TOUCHED_TAKEOFF_LINE_SQL} RETURNING line_key`,
    [bidId]
  );
  const recheck = await c.query(
    `UPDATE est_bid_lines SET recheck_run_id = $2, recheck_reason = NULL, updated_at = now()
      WHERE bid_id = $1 AND source = 'takeoff' AND ${TOUCHED_TAKEOFF_LINE_SQL}`,
    [bidId, runId]
  );
  const manual = await c.query(`SELECT count(*)::int AS n FROM est_bid_lines WHERE bid_id = $1 AND source = 'manual'`, [bidId]);

  // ── Markers ──────────────────────────────────────────────────────────────
  // Suggested AI markers go (soft delete, like every other marker delete).
  // A confirmed marker is the estimator's; if it pointed at a line that was
  // just cleared it moves to the unassigned bucket rather than dangling.
  const markers = await c.query(
    `UPDATE est_markups SET deleted_at = now(), updated_at = now()
      WHERE bid_id = $1 AND source IN ('ai_count', 'gap_fill') AND status = 'suggested' AND deleted_at IS NULL`,
    [bidId]
  );
  const deletedKeys = deleted.rows.map(r => r.line_key);
  const unassigned = deletedKeys.length
    ? await c.query(
      `UPDATE est_markups SET line_key = NULL, updated_at = now()
        WHERE bid_id = $1 AND deleted_at IS NULL AND line_key = ANY($2::uuid[])`,
      [bidId, deletedKeys]
    )
    : { rowCount: 0 };
  const confirmed = await c.query(
    `SELECT count(*)::int AS n FROM est_markups WHERE bid_id = $1 AND status = 'confirmed' AND deleted_at IS NULL`, [bidId]
  );

  // ── Saved estimate + bids.amount ─────────────────────────────────────────
  // Fix round B2 — bids.amount is cleared ONLY when it equals, to the cent,
  // the saved estimate's grand total or the Agent 4 price being cleared: it
  // came from the pipeline. A typed (or since-changed) amount is kept.
  const est = await c.query<{ grand_total: string | null }>('DELETE FROM bid_estimates WHERE bid_id = $1 RETURNING grand_total', [bidId]);
  const savedEstimate = (est.rowCount ?? 0) > 0;
  const cents = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
  const derived = new Set([cents(est.rows[0]?.grand_total), cents(previous.agent4Price)].filter((v): v is number => v != null));
  const { rows: bidRows } = await c.query('SELECT amount FROM bids WHERE id = $1 FOR UPDATE', [bidId]);
  const amountBefore = bidRows[0]?.amount != null ? Number(bidRows[0].amount) : null;
  let bidAmount = false;
  if (amountBefore != null && derived.has(cents(amountBefore)!)) {
    await c.query('UPDATE bids SET amount = NULL WHERE id = $1', [bidId]);
    bidAmount = true;
  }

  // ── Workspace: AI RFIs, scope sections, confirmed service ───────────────
  const { rows: wsRows } = await c.query('SELECT rfis, scope, scope_meta FROM bid_workspaces WHERE bid_id = $1 FOR UPDATE', [bidId]);
  const before = Array.isArray(wsRows[0]?.rfis) ? (wsRows[0].rfis as WorkspaceRfi[]) : [];
  const questions = agent2RfiQuestions(previous.agent2Output);
  const rfis = before
    .filter(r => rfiSurvivesRerun(r, questions))
    .map(r => ({ ...r, origin: r.origin ?? (rfiIsAi(r, questions) ? 'ai' : 'manual') }) as WorkspaceRfi);
  const scopeReset = resetScope(
    (wsRows[0]?.scope as Record<string, string> | null) ?? {},
    (wsRows[0]?.scope_meta as ScopeMeta | null) ?? {},
    previous.agent2Output,
  );
  if (wsRows.length) {
    await c.query(
      `UPDATE bid_workspaces SET rfis = $2::jsonb, scope = $3::jsonb, scope_meta = $4::jsonb, confirmed_service = NULL,
              ai_done = false, proposal_generated = false, updated_at = now()
        WHERE bid_id = $1`,
      [bidId, JSON.stringify(rfis), JSON.stringify(scopeReset.scope), JSON.stringify(scopeReset.meta)]
    );
  }

  // ── Filed GC / pre-bid documents: superseded, never deleted ─────────────
  const docs = await c.query(
    `UPDATE documents SET superseded_at = now(), superseded_by_run_id = $2
      WHERE linked_id = $1::text AND deleted_at IS NULL AND superseded_at IS NULL
        AND generated = true AND category = ANY($3::text[])`,
    [bidId, runId, GENERATED_OUTPUT_CATEGORIES as unknown as string[]]
  );

  return {
    runId,
    previousRunId: previous.runId,
    cleared: {
      takeoffLines: deleted.rowCount ?? 0,
      suggestedMarkers: markers.rowCount ?? 0,
      aiRfis: before.length - rfis.length,
      supersededDocuments: docs.rowCount ?? 0,
      reviewItems: Array.isArray(previous.reviewItems) ? previous.reviewItems.length : 0,
      savedEstimate,
      bidAmount,
    },
    /** Fix round B2 — the bids.amount before the reset and whether it stayed. */
    amount: { before: amountBefore, kept: amountBefore != null && !bidAmount },
    kept: {
      manualLines: (manual.rows[0]?.n as number) ?? 0,
      recheckLines: recheck.rowCount ?? 0,
      confirmedMarkers: (confirmed.rows[0]?.n as number) ?? 0,
      unassignedMarkers: unassigned.rowCount ?? 0,
      rfis: rfis.length,
    },
    rfis,
    scope: scopeReset.scope,
    scopeMeta: scopeReset.meta,
    scopeCleared: scopeReset.cleared,
  };
}
