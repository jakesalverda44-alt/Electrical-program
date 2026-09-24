// Evidence round 5.1 — capture every marker confirm/reject/move/reclass,
// review resolution, crop-check decision and gap-fill acceptance as labeled
// data (client/project-type tagged), for a future accuracy model or eval
// set. Best-effort and non-fatal by design: a logging failure must never
// break the estimator's actual action (the marker save, the review
// resolution, the analysis run) — it's only ever recorded, then warned
// about, never thrown.
import { pool } from '../db/pool';
import { logger } from '../utils/logger';

export type LabeledEventKind = 'marker_update' | 'review_resolution' | 'crop_check' | 'gapfill_accept';

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
        JSON.stringify(input.detail ?? {}), input.by ?? null,
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
