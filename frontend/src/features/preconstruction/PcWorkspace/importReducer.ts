// The "Import Finished Bid" panel's state. Six `useState`s in the pre-split
// PcWorkspace.tsx (audit code #10: "collapse the ~12 importX states into one
// useReducer"); the transitions are exactly the ones the old setters made, in
// the same order, so the panel behaves identically.

export interface ImportPreview {
  amount: string;
  projectType: string;
  brand: string;
  sqFt: string;
  scopeText: string;
  scopeOfWork?: Record<string, string[]>;
  takeoff?: { categories: { name: string; itemCount: number; totals: Record<string, number> }[]; itemCount: number } | null;
}

export interface ImportState {
  /** Reading the uploaded files on the server ("Read Files"). */
  busy: boolean;
  /** Writing the confirmed preview back to the bid card ("Save to Bid Card"). */
  saving: boolean;
  bidFile: File | null;
  takeoffFile: File | null;
  breakdownFile: File | null;
  preview: ImportPreview | null;
}

export type ImportSlot = 'bid' | 'takeoff' | 'breakdown';

export type ImportAction =
  | { type: 'pickFile'; slot: ImportSlot; file: File | null }
  | { type: 'readStart' }
  | { type: 'readSuccess'; preview: ImportPreview }
  | { type: 'readSettled' }
  | { type: 'editPreview'; patch: Partial<ImportPreview> }
  | { type: 'saveStart' }
  | { type: 'saveSettled' }
  /** Cancel, and the successful save: drops the preview and all three files. */
  | { type: 'clear' };

export const initialImportState: ImportState = {
  busy: false,
  saving: false,
  bidFile: null,
  takeoffFile: null,
  breakdownFile: null,
  preview: null,
};

const SLOT_KEY: Record<ImportSlot, 'bidFile' | 'takeoffFile' | 'breakdownFile'> = {
  bid: 'bidFile',
  takeoff: 'takeoffFile',
  breakdown: 'breakdownFile',
};

export function importReducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case 'pickFile':
      return { ...state, [SLOT_KEY[action.slot]]: action.file };
    case 'readStart':
      return { ...state, busy: true };
    case 'readSuccess':
      return { ...state, preview: action.preview };
    case 'readSettled':
      return { ...state, busy: false };
    case 'editPreview':
      // Mirrors `setImportPreview(p => p && { ...p, x })` — a patch with no
      // preview on screen is a no-op, never a resurrection.
      return state.preview ? { ...state, preview: { ...state.preview, ...action.patch } } : state;
    case 'saveStart':
      return { ...state, saving: true };
    case 'saveSettled':
      return { ...state, saving: false };
    case 'clear':
      return { ...state, preview: null, bidFile: null, takeoffFile: null, breakdownFile: null };
    default:
      return state;
  }
}
