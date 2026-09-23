// Estimating Phase B, Task 5 — the toolbar's interaction state machine:
// Select/Pan (V), Count (C), Linear (L), Scale (S), and what a click/Enter/
// Esc does in each. Pure: takes the current state + an event, returns the
// next state (plus any "commit" the caller should perform — e.g. "create
// this markup now") — no DOM, no React, no pdf.js. PlanViewer.tsx wires
// pointer events to dispatch() and interprets Effect results.

export type ToolId = 'select' | 'count' | 'linear' | 'scale';

export interface PdfPoint {
  x: number;
  y: number;
}

export interface ToolState {
  tool: ToolId;
  /** Linear tool: points placed so far for the run currently being drawn
   *  (empty when not mid-draw). Cleared on commit or cancel. */
  drawPoints: PdfPoint[];
  /** Select tool: currently selected markup ids. */
  selectedIds: string[];
  /** Scale tool: the first of the two calibration clicks, waiting for the
   *  second. Null before the first click and after a commit/cancel. */
  scaleFirstPoint: PdfPoint | null;
}

export function initToolState(): ToolState {
  return { tool: 'select', drawPoints: [], selectedIds: [], scaleFirstPoint: null };
}

export type ToolEvent =
  | { type: 'SELECT_TOOL'; tool: ToolId }
  | { type: 'POINTER_CLICK'; point: PdfPoint }
  | { type: 'FINISH_LINEAR' } // double-click or Enter
  | { type: 'CANCEL' } // Esc
  | { type: 'SELECT_MARKERS'; ids: string[]; additive?: boolean } // click / shift-click in Select
  | { type: 'CLEAR_SELECTION' };

/** What the caller should actually DO in response to a transition — the
 *  state machine only tracks in-progress interaction; committing a markup
 *  or a calibration is the caller's job (it needs geometry/scale info this
 *  pure module doesn't have). */
export type ToolEffect =
  | { type: 'none' }
  | { type: 'commitCount'; point: PdfPoint }
  | { type: 'commitLinear'; points: PdfPoint[] }
  | { type: 'commitScalePoints'; points: [PdfPoint, PdfPoint] };

export interface ToolTransition {
  state: ToolState;
  effect: ToolEffect;
}

const NO_EFFECT: ToolEffect = { type: 'none' };

/** A linear run needs at least 2 points to be a real run — FINISH_LINEAR
 *  (double-click/Enter) with fewer than 2 points placed is a no-op, not a
 *  degenerate zero-length commit (the estimator meant to draw something
 *  and either hasn't yet or double-clicked by accident). */
const MIN_LINEAR_POINTS = 2;

export function reduceTool(state: ToolState, event: ToolEvent): ToolTransition {
  switch (event.type) {
    case 'SELECT_TOOL': {
      // Switching tools abandons any in-progress draw/calibration — never
      // silently commits a half-finished linear run or calibration.
      const next: ToolState = { tool: event.tool, drawPoints: [], selectedIds: event.tool === 'select' ? state.selectedIds : [], scaleFirstPoint: null };
      return { state: next, effect: NO_EFFECT };
    }

    case 'POINTER_CLICK': {
      if (state.tool === 'count') {
        // Count commits immediately on click — no multi-step draw state.
        return { state: { ...state, drawPoints: [] }, effect: { type: 'commitCount', point: event.point } };
      }
      if (state.tool === 'linear') {
        const drawPoints = [...state.drawPoints, event.point];
        return { state: { ...state, drawPoints }, effect: NO_EFFECT };
      }
      if (state.tool === 'scale') {
        if (!state.scaleFirstPoint) {
          return { state: { ...state, scaleFirstPoint: event.point }, effect: NO_EFFECT };
        }
        // Second click completes the pair; the tool resets to select ready
        // for the next action (calibration is a one-shot action, not a
        // mode you stay in — matches the plan's "click two points, enter a
        // known length" one popover flow).
        const points: [PdfPoint, PdfPoint] = [state.scaleFirstPoint, event.point];
        return { state: { ...state, scaleFirstPoint: null }, effect: { type: 'commitScalePoints', points } };
      }
      // Select tool: a plain canvas click (not on a marker — that's
      // SELECT_MARKERS) clears the selection.
      return { state: { ...state, selectedIds: [] }, effect: NO_EFFECT };
    }

    case 'FINISH_LINEAR': {
      if (state.tool !== 'linear' || state.drawPoints.length < MIN_LINEAR_POINTS) {
        return { state, effect: NO_EFFECT };
      }
      const points = state.drawPoints;
      return { state: { ...state, drawPoints: [] }, effect: { type: 'commitLinear', points } };
    }

    case 'CANCEL': {
      // Esc abandons an in-progress linear draw or scale calibration
      // without committing anything, and drops back to Select (matches
      // the plan's toolbar spec: "Esc cancels").
      if (state.drawPoints.length > 0 || state.scaleFirstPoint) {
        return { state: { tool: 'select', drawPoints: [], selectedIds: state.selectedIds, scaleFirstPoint: null }, effect: NO_EFFECT };
      }
      // Nothing in progress: Esc just clears the current selection.
      return { state: { ...state, selectedIds: [] }, effect: NO_EFFECT };
    }

    case 'SELECT_MARKERS': {
      if (state.tool !== 'select') return { state, effect: NO_EFFECT };
      const selectedIds = event.additive
        ? Array.from(new Set([...state.selectedIds, ...event.ids]))
        : event.ids;
      return { state: { ...state, selectedIds }, effect: NO_EFFECT };
    }

    case 'CLEAR_SELECTION':
      return { state: { ...state, selectedIds: [] }, effect: NO_EFFECT };

    default:
      return { state, effect: NO_EFFECT };
  }
}
