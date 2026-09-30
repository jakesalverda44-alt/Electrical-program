// @vitest-environment happy-dom
// UI cleanup round 1 — the RFI step's status banners and "No RFIs" button.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RfisTab from './RfisTab';
import { blankWorkspace, PcWorkspace } from '../constants';

afterEach(cleanup);

function setup(over: { rfis?: PcWorkspace['rfis']; aiResults?: Record<string, unknown> | null } & Partial<React.ComponentProps<typeof RfisTab>> = {}) {
  const { rfis = [], aiResults = { agent2_output: '{}' }, ...rest } = over;
  const props = {
    ws: { ...blankWorkspace('b1', 'Bid', 0), rfis },
    aiResults: aiResults as never,
    newRfi: '', setNewRfi: vi.fn(), rfiSubmitting: false,
    addRfi: vi.fn(), importRfisFromAnalysis: vi.fn(), submitOpenRfis: vi.fn(), editRfi: vi.fn(),
    analysisRunning: false, pendingAiRfiCount: 0, noRfis: false, setNoRfis: vi.fn(), onGoTakeoff: vi.fn(),
    ...rest,
  };
  render(<RfisTab {...props}/>);
  return props;
}

const draft = { id: 'r1', question: 'Q?', submitted: false, answer: '' };

describe('RfisTab banners', () => {
  it('running: shows the running banner and no No-RFIs button', () => {
    setup({ analysisRunning: true });
    expect(screen.getByTestId('rfi-status-running').textContent).toBe('RFIs will appear when the takeoff finishes.');
    expect(screen.queryByTestId('rfi-no-rfis')).toBeNull();
  });

  it('running wins over suggested', () => {
    setup({ analysisRunning: true, pendingAiRfiCount: 3 });
    expect(screen.getByTestId('rfi-status-running')).toBeTruthy();
    expect(screen.queryByTestId('rfi-status-suggested')).toBeNull();
  });

  it('no takeoff yet: the link goes to the Takeoff step', () => {
    const p = setup({ aiResults: null });
    expect(screen.getByTestId('rfi-status-no-takeoff')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rfi-go-takeoff'));
    expect(p.onGoTakeoff).toHaveBeenCalled();
  });

  it('suggested (plural): imports on click', () => {
    const p = setup({ pendingAiRfiCount: 3 });
    expect(screen.getByTestId('rfi-status-suggested').textContent).toContain('The AI suggested 3 RFIs — review & import');
    expect(screen.getByTestId('rfi-import-suggested').textContent).toBe('Import 3 RFIs');
    fireEvent.click(screen.getByTestId('rfi-import-suggested'));
    expect(p.importRfisFromAnalysis).toHaveBeenCalled();
  });

  it('suggested (singular)', () => {
    setup({ pendingAiRfiCount: 1 });
    expect(screen.getByTestId('rfi-status-suggested').textContent).toContain('The AI suggested 1 RFI — review & import');
    expect(screen.getByTestId('rfi-import-suggested').textContent).toBe('Import 1 RFI');
  });

  it('none: Undo clears the flag and the No-RFIs button is hidden', () => {
    const p = setup({ noRfis: true });
    expect(screen.getByTestId('rfi-status-none').textContent).toContain('Marked “No RFIs” for this bid.');
    expect(screen.queryByTestId('rfi-no-rfis')).toBeNull();
    fireEvent.click(screen.getByTestId('rfi-no-rfis-undo'));
    expect(p.setNoRfis).toHaveBeenCalledWith(false);
  });
});

describe('RfisTab "No RFIs" button', () => {
  it('no drafts, empty list: marks No RFIs', () => {
    const p = setup();
    const b = screen.getByTestId('rfi-no-rfis');
    expect(b.textContent).toBe('No RFIs for this bid');
    fireEvent.click(b);
    expect(p.setNoRfis).toHaveBeenCalledWith(true);
  });

  it('no drafts but submitted RFIs: label switches', () => {
    setup({ rfis: [{ ...draft, submitted: true }] });
    expect(screen.getByTestId('rfi-no-rfis').textContent).toBe('No more RFIs');
  });

  it('hidden while a draft exists', () => {
    setup({ rfis: [draft] });
    expect(screen.queryByTestId('rfi-no-rfis')).toBeNull();
  });

  it('Import from AI analysis stays disabled without a takeoff', () => {
    setup({ aiResults: null });
    expect(screen.getByText('Import from AI analysis').closest('button')!.hasAttribute('disabled')).toBe(true);
  });
});
