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

/** Generated categories never offered as analysis inputs (the server
 *  refuses them too). */
export const GENERATED_DOC_CATEGORIES = ['proposal', 'takeoff', 'prebid_scope', 'prebid_takeoff', 'bid_data'];
export function isGeneratedDoc(d: ProjectDoc): boolean {
  return !!d.generated || GENERATED_DOC_CATEGORIES.includes(d.category);
}

export type { PcStepKey };
