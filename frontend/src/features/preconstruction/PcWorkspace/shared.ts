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

export interface ProjectDoc { id: string; name: string; display_name: string; category: string; file_type: string; }

export type { PcStepKey };
