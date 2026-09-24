// @vitest-environment happy-dom
// Next round A3 — the Sheet Check panel and its automatic check.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, renderHook } from '@testing-library/react';

const post = vi.fn();
const get = vi.fn();
const put = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } };
});

import SheetCheckPanel from './SheetCheckPanel';
import { runButtonLabel, useSheetCheck, type SheetCheckData } from './useSheetCheck';

afterEach(cleanup);
beforeEach(() => { post.mockReset(); get.mockReset(); put.mockReset(); });

const DATA: SheetCheckData = {
  status: 'complete',
  pages: [
    { key: 's#6', file: 'set.pdf', page: 6, sheetNo: 'E-7', title: 'ELECTRICAL DETAILS', discipline: 'electrical', cls: 'detail', hasTextLayer: true, role: 'analysis', reason: 'electrical sheet' },
    { key: 's#7', file: 'set.pdf', page: 7, sheetNo: 'PH0.1', title: 'PHOTOMETRIC SITE PLAN', discipline: 'civil', cls: 'plan', hasTextLayer: true, role: 'reference', reason: 'referenced by E-7 note 3', referencedBy: ['E-7 note 3'] },
    { key: 's#2', file: 'set.pdf', page: 2, sheetNo: 'A-1.1', title: 'FLOOR PLAN', discipline: 'architectural', cls: 'plan', hasTextLayer: true, role: 'excluded', reason: 'architectural sheet' },
  ],
  missing: [
    { id: 'sheet:M1', kind: 'sheet', label: 'M-1', notProvidedText: 'Sheet M-1 not provided at time of bid', referencedBy: [{ fromLabel: 'E-7 "ELECTRICAL DETAILS"', note: 'note 4', context: 'SEE M-1 FOR RTU ELECTRICAL DATA.', source: 'regex' }] },
  ],
  unskippedMissing: 1,
  unclassifiedFiles: [],
  otherFiles: [],
  error: null,
  checkedAt: '2026-09-24T00:00:00Z',
};

function setup(data: SheetCheckData | null = DATA) {
  const onUpdate = vi.fn(async () => true);
  const onRunAnalysis = vi.fn();
  const onUpload = vi.fn();
  render(<SheetCheckPanel data={data} error={null} canRun onUpdate={onUpdate} onRecheck={vi.fn()} onUpload={onUpload} onRunAnalysis={onRunAnalysis} analysisRunning={false}/>);
  return { onUpdate, onRunAnalysis, onUpload };
}

describe('runButtonLabel', () => {
  it('reads "Run without N sheets" while referenced sheets are missing', () => {
    expect(runButtonLabel(0)).toBe('Run AI Analysis');
    expect(runButtonLabel(1)).toBe('Run without 1 sheet');
    expect(runButtonLabel(3)).toBe('Run without 3 sheets');
  });
});

describe('SheetCheckPanel', () => {
  it('Included shows reference sheets with where they were referenced from', () => {
    setup();
    const inc = screen.getByTestId('sheet-check-included');
    expect(inc.textContent).toContain('PH0.1 — PHOTOMETRIC SITE PLAN');
    expect(inc.textContent).toContain('reference');
    expect(inc.textContent).toContain('referenced by E-7 note 3');
    expect(inc.textContent).not.toContain('A-1.1');
  });

  it('Needed but missing: Upload opens the picker; Skip needs a 10-character reason', async () => {
    const { onUpdate, onUpload } = setup();
    expect(screen.getByTestId('missing-sheet:M1').textContent).toContain('referenced by E-7 "ELECTRICAL DETAILS" note 4');
    fireEvent.click(screen.getByTestId('missing-upload-sheet:M1'));
    expect(onUpload).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('missing-skip-sheet:M1'));
    fireEvent.change(screen.getByTestId('skip-sheet:M1-reason'), { target: { value: 'short' } });
    expect((screen.getByTestId('skip-sheet:M1-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('skip-sheet:M1-reason'), { target: { value: 'Mechanical set not issued for bid' } });
    fireEvent.click(screen.getByTestId('skip-sheet:M1-confirm'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ action: 'skip', refId: 'sheet:M1', reason: 'Mechanical set not issued for bid' }));
  });

  it('Left out: force a page in with a reason', async () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByText(/Show left out \(1\)/));
    fireEvent.click(screen.getByTestId('force-in-s#2'));
    fireEvent.change(screen.getByTestId('in-s#2-reason'), { target: { value: 'Receptacle layout lives here' } });
    fireEvent.click(screen.getByTestId('in-s#2-confirm'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ action: 'include', pageKey: 's#2', reason: 'Receptacle layout lives here' }));
  });

  it('the run shortcut says "Run without 1 sheet"', () => {
    const { onRunAnalysis } = setup();
    const btn = screen.getByTestId('sheet-check-run');
    expect(btn.textContent).toBe('Run without 1 sheet');
    fireEvent.click(btn);
    expect(onRunAnalysis).toHaveBeenCalled();
  });
});

describe('useSheetCheck — automatic', () => {
  it('loads the stored check, runs a new one when the inputs change (debounced), polls until done', async () => {
    vi.useFakeTimers();
    try {
      get.mockResolvedValueOnce({ data: { ...DATA, status: 'complete' } });
      const buildForm = vi.fn(() => new FormData());
      const { result, rerender } = renderHook(({ k }) => useSheetCheck({ bidId: 'b1', inputKey: k, buildForm, canRun: true }), { initialProps: { k: 'a' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(get).toHaveBeenCalledWith('/preconstruction/b1/sheet-check');
      expect(post).not.toHaveBeenCalled(); // never on first load
      post.mockResolvedValueOnce({ data: { ...DATA, status: 'running' } });
      get.mockResolvedValueOnce({ data: { ...DATA, status: 'running' } }).mockResolvedValueOnce({ data: { ...DATA, status: 'complete', unskippedMissing: 0 } });
      rerender({ k: 'a|b' });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      rerender({ k: 'a|b|c' }); // a second change inside the debounce: one run
      await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][0]).toBe('/preconstruction/b1/sheet-check/run');
      await act(async () => { await vi.advanceTimersByTimeAsync(3200); });
      expect(result.current.data?.status).toBe('complete');
      expect(result.current.data?.unskippedMissing).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no run without permission or without inputs', async () => {
    get.mockResolvedValue({ data: null });
    const { rerender } = renderHook(({ k, can }) => useSheetCheck({ bidId: 'b1', inputKey: k, buildForm: () => new FormData(), canRun: can }), { initialProps: { k: 'a', can: false } });
    rerender({ k: 'b', can: false });
    rerender({ k: '', can: true });
    await new Promise(r => setTimeout(r, 1400));
    expect(post).not.toHaveBeenCalled();
  });
});
