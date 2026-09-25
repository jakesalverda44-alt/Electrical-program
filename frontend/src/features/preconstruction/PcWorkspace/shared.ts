// Types and constants shared by the workspace parent and its tab components.
import { PcStepKey, PcWorkspace } from '../constants';

export const STEP_ORDER: PcStepKey[] = ['intake','takeoff','scope','estimate','review','proposal','submitted'];

/** The parent's workspace patcher, handed to every tab that edits `ws`. */
export type SetWorkspace = (
  patchOrFn: Partial<PcWorkspace> | ((prev: PcWorkspace) => Partial<PcWorkspace>),
) => void;

/** The `/preconstruction/:bidId/results` row, as loosely typed as it is stored. */
export type AiResults = Record<string, unknown> | null;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface TakeoffOnFile {
  categories: { name: string; itemCount: number; totals: Record<string, number> }[];
  line_items: { category: string; description: string; unit: string; qty: number | null }[];
  item_count: number;
  source_file: string | null;
}

export interface ProjectDoc {
  id: string; name: string; display_name: string; category: string; file_type: string;
  /** Re-run reset — the CRM generated this file (never an analysis input). */
  generated?: boolean;
  /** Re-run reset — a later analysis run superseded this generated file. */
  superseded_at?: string | null;
  /** Bid Overview plans upload + job profile — a PDF's page count, computed
   *  once at upload time. Null for a non-PDF or a pre-existing row. */
  page_count?: number | null;
}

/** A CRM-generated file (never an analysis input; the server refuses it
 *  too). Fix round S1 — by the flag only, never the category: a person can
 *  file a real drawing under Proposal / Takeoff / Pre-Bid. */
export function isGeneratedDoc(d: ProjectDoc): boolean {
  return !!d.generated;
}

/** Job profile fix round S6 — a document the analysis can read: a PDF /
 *  image, or a .zip of them (the server unpacks it exactly like a raw zip
 *  upload); never a CRM-generated or superseded file. */
export function isAnalysisInputDoc(d: ProjectDoc): boolean {
  if (isGeneratedDoc(d) || d.superseded_at) return false;
  const t = (d.file_type || '').toLowerCase();
  const n = (d.name || '').toLowerCase();
  return t === 'application/pdf' || t.startsWith('image/') || t === 'application/zip' || t === 'application/x-zip-compressed'
    || /\.(pdf|jpe?g|png|zip)$/.test(n);
}

/** The bid's current plan set (review S5 / N3): analysis inputs filed as plans. */
export function isCurrentPlanDoc(d: ProjectDoc): boolean {
  return d.category === 'plans' && isAnalysisInputDoc(d);
}

/** Review S5 — the Run AI message when nothing is selected. BidTab shows a
 *  link to the Overview under it (uploading plans lives there). */
export const NO_PLANS_SELECTED_MSG = '✗ No plan files selected. Add the plans on the bid Overview (Plans & Job Profile), or tick them under Plan Files.';

export type { PcStepKey };
