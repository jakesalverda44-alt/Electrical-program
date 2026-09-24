// Evidence round 5.1 — capture every marker confirm/reject/move/reclass,
// review resolution, crop-check decision and gap-fill acceptance as labeled
// data (client/project-type tagged), for a future accuracy model or eval
// set. Best-effort and non-fatal by design: a logging failure must never
// break the estimator's actual action (the marker save, the review
// resolution, the analysis run) — it's only ever recorded, then warned
// about, never thrown.
import { pool } from '../db/pool';
import { logger } from '../utils/logger';

// Fix round (N6) — 'gapfill_suggested' is the MODEL's own decision (crop
// check accept/reclass, logged at counting-stage time, `by` always null);
// 'gapfill_accept' is the ESTIMATOR's later confirmation of that suggested
// marker (logged from the markup-confirm path, `by` the estimator's name)
// — the two are never conflated, so a labeled-data consumer can always tell
// a human label from a model one by `created_by`, not just by kind.
export type LabeledEventKind = 'marker_update' | 'review_resolution' | 'crop_check' | 'gapfill_suggested' | 'gapfill_accept';

const MAX_DETAIL_STRING = 500;

/** N6 — cap every string value a caller puts in `detail`, so a runaway
 *  model note or answer text never grows the table unbounded. */
function capDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail ?? {})) out[k] = typeof v === 'string' ? v.slice(0, MAX_DETAIL_STRING) : v;
  return out;
}

export interface LabeledEventInput {
  bidId: string;
  runId?: string | null;
  kind: LabeledEventKind;
  typeKey?: string | null;
  sheetKey?: string | null;
  client?: string | null;
  projectType?: string | null;
  /** A pointer to the crop the decision was made on (sheet + rect), never
   *  image bytes — this table is metadata, not a media store. */
  cropRef?: { sheetKey: string; rectIn?: { left: number; top: number; width: number; height: number } } | null;
  detail?: Record<string, unknown>;
  by?: string | null;
}

export async function logLabeledEvent(input: LabeledEventInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO takeoff_labeled_events (bid_id, run_id, event_kind, type_key, sheet_key, client, project_type, crop_ref, detail, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.bidId, input.runId ?? null, input.kind, input.typeKey ?? null, input.sheetKey ?? null,
        input.client ?? null, input.projectType ?? null,
        input.cropRef ? JSON.stringify(input.cropRef) : null,
        JSON.stringify(capDetail(input.detail)), input.by ?? null,
      ]
    );
  } catch (err) {
    logger.warn({ err, bidId: input.bidId, kind: input.kind }, '[labeledEvents] could not log a labeled event (non-fatal)');
  }
}

/** Best-effort, several at once (e.g. every gap-fill candidate decision
 *  from one run) — failures are per-row, never lose the rest of the batch. */
export async function logLabeledEvents(inputs: LabeledEventInput[]): Promise<void> {
  await Promise.all(inputs.map(i => logLabeledEvent(i)));
}
