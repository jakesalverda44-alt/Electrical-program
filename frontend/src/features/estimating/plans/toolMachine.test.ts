// Estimating Phase B, Task 5 — exhaustive tests for the tool interaction
// state machine (toolMachine.ts).
import { describe, it, expect } from 'vitest';
import { initToolState, reduceTool, ToolState } from './toolMachine';

describe('initToolState', () => {
  it('starts on Select with nothing in progress', () => {
    const s = initToolState();
    expect(s.tool).toBe('select');
    expect(s.drawPoints).toEqual([]);
    expect(s.selectedIds).toEqual([]);
    expect(s.scaleFirstPoint).toBeNull();
  });
});

describe('SELECT_TOOL', () => {
  it('switches the active tool', () => {
    const { state } = reduceTool(initToolState(), { type: 'SELECT_TOOL', tool: 'count' });
    expect(state.tool).toBe('count');
  });

  it('abandons an in-progress linear draw when switching tools', () => {
    let s = initToolState();
    s = reduceTool(s, { type: 'SELECT_TOOL', tool: 'linear' }).state;
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 0, y: 0 } }).state;
    expect(s.drawPoints.length).toBe(1);
    s = reduceTool(s, { type: 'SELECT_TOOL', tool: 'count' }).state;
    expect(s.drawPoints).toEqual([]); // never silently committed
  });

  it('abandons an in-progress scale calibration (first point) when switching tools', () => {
    let s = initToolState();
    s = reduceTool(s, { type: 'SELECT_TOOL', tool: 'scale' }).state;
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 1, y: 1 } }).state;
    expect(s.scaleFirstPoint).toEqual({ x: 1, y: 1 });
    s = reduceTool(s, { type: 'SELECT_TOOL', tool: 'select' }).state;
    expect(s.scaleFirstPoint).toBeNull();
  });

  it('clears selection when switching AWAY from Select, preserves it when switching TO Select', () => {
    let s: ToolState = { ...initToolState(), selectedIds: ['a', 'b'] };
    s = reduceTool(s, { type: 'SELECT_TOOL', tool: 'count' }).state;
    expect(s.selectedIds).toEqual([]);

    let s2: ToolState = { ...initToolState(), tool: 'count', selectedIds: [] };
    s2 = reduceTool({ ...s2, selectedIds: ['x'] }, { type: 'SELECT_TOOL', tool: 'select' }).state;
    expect(s2.selectedIds).toEqual(['x']);
  });
});

describe('Count tool — commits immediately on click', () => {
  it('a click produces a commitCount effect with the clicked point', () => {
    const s = reduceTool(initToolState(), { type: 'SELECT_TOOL', tool: 'count' }).state;
    const { effect, state } = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 42, y: 7 } });
    expect(effect).toEqual({ type: 'commitCount', point: { x: 42, y: 7 } });
    expect(state.drawPoints).toEqual([]); // no multi-step draw state for count
  });

  it('stays in the count tool after committing (place several without reselecting the tool)', () => {
    let s = reduceTool(initToolState(), { type: 'SELECT_TOOL', tool: 'count' }).state;
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 1, y: 1 } }).state;
    expect(s.tool).toBe('count');
  });
});

describe('Linear tool — multi-click draw, finish, cancel', () => {
  function inLinear(): ToolState {
    return reduceTool(initToolState(), { type: 'SELECT_TOOL', tool: 'linear' }).state;
  }

  it('each click adds a point and produces no commit effect yet', () => {
    let s = inLinear();
    let r = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 0, y: 0 } });
    expect(r.effect).toEqual({ type: 'none' });
    s = r.state;
    r = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 10, y: 0 } });
    expect(r.effect).toEqual({ type: 'none' });
    expect(r.state.drawPoints).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it('FINISH_LINEAR with >=2 points commits the run and clears drawPoints', () => {
    let s = inLinear();
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 0, y: 0 } }).state;
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 10, y: 0 } }).state;
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 10, y: 10 } }).state;
    const { effect, state } = reduceTool(s, { type: 'FINISH_LINEAR' });
    expect(effect).toEqual({ type: 'commitLinear', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
    expect(state.drawPoints).toEqual([]);
  });

  it('FINISH_LINEAR with fewer than 2 points is a no-op (never commits a degenerate run)', () => {
    let s = inLinear();
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 0, y: 0 } }).state; // only 1 point
    const { effect, state } = reduceTool(s, { type: 'FINISH_LINEAR' });
    expect(effect).toEqual({ type: 'none' });
    expect(state.drawPoints).toEqual([{ x: 0, y: 0 }]); // unchanged, still in progress
  });

  it('FINISH_LINEAR with 0 points (never clicked) is a no-op', () => {
    const { effect } = reduceTool(inLinear(), { type: 'FINISH_LINEAR' });
    expect(effect).toEqual({ type: 'none' });
  });

  it('CANCEL mid-draw abandons the run and drops back to Select', () => {
    let s = inLinear();
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 0, y: 0 } }).state;
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 5, y: 5 } }).state;
    const { state, effect } = reduceTool(s, { type: 'CANCEL' });
    expect(effect).toEqual({ type: 'none' });
    expect(state.tool).toBe('select');
    expect(state.drawPoints).toEqual([]);
  });
});

describe('Scale tool — two-point calibration', () => {
  function inScale(): ToolState {
    return reduceTool(initToolState(), { type: 'SELECT_TOOL', tool: 'scale' }).state;
  }

  it('the first click records scaleFirstPoint with no commit effect', () => {
    const { state, effect } = reduceTool(inScale(), { type: 'POINTER_CLICK', point: { x: 1, y: 2 } });
    expect(effect).toEqual({ type: 'none' });
    expect(state.scaleFirstPoint).toEqual({ x: 1, y: 2 });
  });

  it('the second click commits both points as a pair and resets scaleFirstPoint', () => {
    let s = inScale();
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 1, y: 2 } }).state;
    const { state, effect } = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 9, y: 9 } });
    expect(effect).toEqual({ type: 'commitScalePoints', points: [{ x: 1, y: 2 }, { x: 9, y: 9 }] });
    expect(state.scaleFirstPoint).toBeNull();
  });

  it('CANCEL after the first click abandons calibration and drops back to Select', () => {
    let s = inScale();
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 1, y: 2 } }).state;
    const { state } = reduceTool(s, { type: 'CANCEL' });
    expect(state.tool).toBe('select');
    expect(state.scaleFirstPoint).toBeNull();
  });

  it('a third click after a completed pair starts a FRESH calibration (tool stays in scale mode after commit... ', () => {
    // Actually: per the reducer, a completed pair does not force the tool
    // back to 'select' (only scaleFirstPoint resets) — the next click
    // starts a new first-point capture. Documents the real behavior.
    let s = inScale();
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 0, y: 0 } }).state;
    s = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 1, y: 1 } }).state; // commits
    expect(s.tool).toBe('scale');
    const third = reduceTool(s, { type: 'POINTER_CLICK', point: { x: 5, y: 5 } });
    expect(third.effect).toEqual({ type: 'none' }); // starts a new pair, doesn't commit
    expect(third.state.scaleFirstPoint).toEqual({ x: 5, y: 5 });
  });
});

describe('Select tool — click-to-select, shift-click multi-select, deselect', () => {
  it('a plain canvas click (POINTER_CLICK) clears the selection', () => {
    const withSel: ToolState = { ...initToolState(), selectedIds: ['a'] };
    const { state } = reduceTool(withSel, { type: 'POINTER_CLICK', point: { x: 0, y: 0 } });
    expect(state.selectedIds).toEqual([]);
  });

  it('SELECT_MARKERS replaces the selection by default', () => {
    const withSel: ToolState = { ...initToolState(), selectedIds: ['a'] };
    const { state } = reduceTool(withSel, { type: 'SELECT_MARKERS', ids: ['b'] });
    expect(state.selectedIds).toEqual(['b']);
  });

  it('SELECT_MARKERS with additive:true adds to the selection (shift-click) without duplicates', () => {
    const withSel: ToolState = { ...initToolState(), selectedIds: ['a'] };
    const { state } = reduceTool(withSel, { type: 'SELECT_MARKERS', ids: ['a', 'b'], additive: true });
    expect(state.selectedIds.sort()).toEqual(['a', 'b']);
  });

  it('SELECT_MARKERS is ignored while a non-select tool is active (a click there means something else)', () => {
    const inCount: ToolState = { ...initToolState(), tool: 'count' };
    const { state } = reduceTool(inCount, { type: 'SELECT_MARKERS', ids: ['a'] });
    expect(state.selectedIds).toEqual([]);
  });

  it('CLEAR_SELECTION empties the selection', () => {
    const withSel: ToolState = { ...initToolState(), selectedIds: ['a', 'b'] };
    const { state } = reduceTool(withSel, { type: 'CLEAR_SELECTION' });
    expect(state.selectedIds).toEqual([]);
  });

  it('CANCEL with nothing in progress just clears the selection', () => {
    const withSel: ToolState = { ...initToolState(), selectedIds: ['a'] };
    const { state, effect } = reduceTool(withSel, { type: 'CANCEL' });
    expect(effect).toEqual({ type: 'none' });
    expect(state.selectedIds).toEqual([]);
  });
});
