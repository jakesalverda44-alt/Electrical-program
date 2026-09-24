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
}

/** A CRM-generated file (never an analysis input; the server refuses it
 *  too). Fix round S1 — by the flag only, never the category: a person can
 *  file a real drawing under Proposal / Takeoff / Pre-Bid. */
export function isGeneratedDoc(d: ProjectDoc): boolean {
  return !!d.generated;
}

export type { PcStepKey };
