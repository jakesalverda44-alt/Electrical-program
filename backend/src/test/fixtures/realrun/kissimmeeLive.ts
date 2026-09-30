// Real-run fix round — the REAL live Opus 5.5 run of AutoZone #10077
// Kissimmee (2026-09-24), exported read-only from that run's stored JSON
// (see the JSON's _note). Loaded with fs (the backend tsconfig has no
// resolveJsonModule). Nothing in it is transcribed or synthetic.
import fs from 'fs';
import path from 'path';
import type { InventoryPage } from '../../../ai/countSheets';
import type { CountTarget } from '../../../ai/countTargets';
import type { CountMark, CountResultSheet } from '../../../ai/countingStage';
import type { ScheduleTable } from '../../../ai/evidence/schedules';
import type { TypicalPackage, TypicalExpansion } from '../../../ai/evidence/typicals';

export interface LiveReviewItem { id: string; kind: string; group?: string; blocking?: boolean; title: string; detail: string; category?: string; typeKey?: string }

export interface KissimmeeLiveRun {
  agent1: Record<string, unknown>;
  inventory: InventoryPage[];
  countResult: {
    model: string;
    targets: CountTarget[];
    marks: CountMark[];
    sheets: Array<Partial<CountResultSheet> & Pick<CountResultSheet, 'key' | 'file' | 'page' | 'label'>>;
    types: Array<{ key: string; type: string; status: string; count: number; category: string; reason?: string; mergedInto?: string }>;
    removedRows: unknown[];
    evidence: {
      model: string;
      usage: { input_tokens: number; output_tokens: number };
      calls: number;
      pages: Array<{ key: string; label: string; source: string; viewports: number; hasTextLayer: boolean; note?: string }>;
      tables: ScheduleTable[];
      typicals: TypicalPackage[];
      expansions: TypicalExpansion[];
      unmappedTypical: unknown[];
      panelsUnread: string[];
      scheduleOwned: string[];
      families: unknown[];
    };
  };
  reviewItems: LiveReviewItem[];
}

export const LIVE_PLAN_FILE = '1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf';
export const LIVE_SPEC_FILE = '2.0 - Kissimmee FL10077 FULL SPEC.pdf';

let cache: KissimmeeLiveRun | null = null;
let cache0928: KissimmeeLiveRun | null = null;
/** A fresh deep copy every call (tests mutate what they get). */
export function loadKissimmeeLive(): KissimmeeLiveRun {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(__dirname, 'kissimmee-live-2026-09-24.json'), 'utf8')) as KissimmeeLiveRun;
  return JSON.parse(JSON.stringify(cache)) as KissimmeeLiveRun;
}

/** Typical-expansion fix — the live run of 2026-09-28 (one "PP-1..6"
 *  equipment row for all six power poles; the #9 legend's five pole types
 *  each multiplied by all six). Same shape; a fresh deep copy every call. */
export function loadKissimmeeLive0928(): KissimmeeLiveRun {
  if (!cache0928) cache0928 = JSON.parse(fs.readFileSync(path.join(__dirname, 'kissimmee-live-2026-09-28.json'), 'utf8')) as KissimmeeLiveRun;
  return JSON.parse(JSON.stringify(cache0928)) as KissimmeeLiveRun;
}

/** The live review items that blocked (blocking !== false). */
export function liveBlocking(run: KissimmeeLiveRun): LiveReviewItem[] {
  return run.reviewItems.filter(i => i.blocking !== false);
}

/** Accuracy round Task 0 — the 2026-09-30 live run (see live0930.ts). */
export { loadKissimmeeLive0930 } from './live0930';
