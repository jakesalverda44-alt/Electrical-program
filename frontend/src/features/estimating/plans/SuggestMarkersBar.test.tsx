// @vitest-environment happy-dom
// Estimating Phase B, Task 7 (deferral closed) — SuggestMarkersBar.tsx.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import SuggestMarkersBar, { SuggestMarkersBarProps } from './SuggestMarkersBar';

afterEach(cleanup);

function baseProps(over: Partial<SuggestMarkersBarProps> = {}): SuggestMarkersBarProps {
  return {
    hasTextLayer: true,
    busy: false,
    suggestedCountOnSheet: 0,
    onSuggestForSheet: vi.fn(),
    onConfirmAllOnSheet: vi.fn(),
    onRejectAllOnSheet: vi.fn(),
    onFindTag: vi.fn(),
    findTagResults: null,
    findTagBusy: false,
    onJumpToFindTagResult: vi.fn(),
    ...over,
  };
}

describe('SuggestMarkersBar', () => {
  it('shows the "no text on this sheet" notice instead of the suggest button when hasTextLayer is false', () => {
    const { getByText, queryByText } = render(<SuggestMarkersBar {...baseProps({ hasTextLayer: false })} />);
    expect(getByText('No text on this sheet — nothing to search for tags here.')).toBeTruthy();
    expect(queryByText('Suggest markers for this sheet')).toBeNull();
  });

  it('clicking "Suggest markers for this sheet" calls onSuggestForSheet', () => {
    const onSuggestForSheet = vi.fn();
    const { getByText } = render(<SuggestMarkersBar {...baseProps({ onSuggestForSheet })} />);
    fireEvent.click(getByText('Suggest markers for this sheet'));
    expect(onSuggestForSheet).toHaveBeenCalled();
  });

  it('the suggest button is disabled while busy, and shows a busy label', () => {
    const { getByText } = render(<SuggestMarkersBar {...baseProps({ busy: true })} />);
    const btn = getByText('Suggesting…') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows the pending-suggested count and Confirm all/Reject all only when there ARE suggested markers on the sheet', () => {
    const { queryByText, rerender } = render(<SuggestMarkersBar {...baseProps({ suggestedCountOnSheet: 0 })} />);
    expect(queryByText('Confirm all on this sheet')).toBeNull();
    rerender(<SuggestMarkersBar {...baseProps({ suggestedCountOnSheet: 3 })} />);
    expect(queryByText(/3 suggested/)).toBeTruthy();
    expect(queryByText('Confirm all on this sheet')).toBeTruthy();
    expect(queryByText('Reject all')).toBeTruthy();
  });

  it('Confirm all / Reject all call their respective callbacks', () => {
    const onConfirmAllOnSheet = vi.fn();
    const onRejectAllOnSheet = vi.fn();
    const { getByText } = render(<SuggestMarkersBar {...baseProps({ suggestedCountOnSheet: 2, onConfirmAllOnSheet, onRejectAllOnSheet })} />);
    fireEvent.click(getByText('Confirm all on this sheet'));
    fireEvent.click(getByText('Reject all'));
    expect(onConfirmAllOnSheet).toHaveBeenCalled();
    expect(onRejectAllOnSheet).toHaveBeenCalled();
  });

  it('"Find tag on sheets…" toggles a search box; typing a tag and clicking Search calls onFindTag', () => {
    const onFindTag = vi.fn();
    const { getByText, getByLabelText } = render(<SuggestMarkersBar {...baseProps({ onFindTag })} />);
    fireEvent.click(getByText('Find tag on sheets…'));
    const input = getByLabelText('Tag to find');
    fireEvent.change(input, { target: { value: 'A1' } });
    fireEvent.click(getByText('Search'));
    expect(onFindTag).toHaveBeenCalledWith('A1');
  });

  it('pressing Enter in the tag input also searches', () => {
    const onFindTag = vi.fn();
    const { getByText, getByLabelText } = render(<SuggestMarkersBar {...baseProps({ onFindTag })} />);
    fireEvent.click(getByText('Find tag on sheets…'));
    const input = getByLabelText('Tag to find');
    fireEvent.change(input, { target: { value: 'A1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onFindTag).toHaveBeenCalledWith('A1');
  });

  it('the Search button is disabled for a blank/whitespace-only tag', () => {
    const { getByText, getByLabelText } = render(<SuggestMarkersBar {...baseProps()} />);
    fireEvent.click(getByText('Find tag on sheets…'));
    const input = getByLabelText('Tag to find');
    fireEvent.change(input, { target: { value: '   ' } });
    expect((getByText('Search') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows "No sheets matched." for an empty (but non-null) results array', () => {
    const { getByText } = render(<SuggestMarkersBar {...baseProps({ findTagResults: [] })} />);
    fireEvent.click(getByText('Find tag on sheets…'));
    expect(getByText('No sheets matched.')).toBeTruthy();
  });

  it('renders each result with its label/count, and clicking one jumps to it', () => {
    const onJumpToFindTagResult = vi.fn();
    const results = [{ sheetKey: 'doc-1:0', label: 'E1.1', count: 2 }, { sheetKey: 'doc-1:1', label: 'E1.2', count: 1 }];
    const { getByText } = render(<SuggestMarkersBar {...baseProps({ findTagResults: results, onJumpToFindTagResult })} />);
    fireEvent.click(getByText('Find tag on sheets…'));
    fireEvent.click(getByText('E1.1 (2)'));
    expect(onJumpToFindTagResult).toHaveBeenCalledWith('doc-1:0');
  });

  it('does not show results before any search has run (findTagResults === null)', () => {
    const { getByText, queryByText } = render(<SuggestMarkersBar {...baseProps({ findTagResults: null })} />);
    fireEvent.click(getByText('Find tag on sheets…'));
    expect(queryByText('No sheets matched.')).toBeNull();
  });
});
