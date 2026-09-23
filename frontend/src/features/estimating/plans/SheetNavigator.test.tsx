// @vitest-environment happy-dom
// Estimating Phase B, Task 4 — SheetNavigator.tsx.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SheetNavigator, { sheetKey } from './SheetNavigator';
import { SheetRow } from '../types';

afterEach(cleanup);

function sheet(over: Partial<SheetRow>): SheetRow {
  return {
    bid_id: 'bid1', document_id: 'doc-1', page_index: 0, sheet_no: 'E1.1', title: 'Lighting Plan',
    discipline: 'E', kind: 'plan', width_pt: 792, height_pt: 612, rotation: 0,
    ft_per_pt: null, scale_source: null, scale_label: null, has_text_layer: true,
    ...over,
  };
}

const sheets: SheetRow[] = [
  sheet({ document_id: 'doc-1', page_index: 0, sheet_no: 'E1.1', title: 'Lighting Plan', discipline: 'E' }),
  sheet({ document_id: 'doc-1', page_index: 1, sheet_no: 'A1.1', title: 'Floor Plan', discipline: 'A' }),
  sheet({ document_id: 'doc-1', page_index: 2, sheet_no: 'E2.1', title: 'Power Plan', discipline: 'E' }),
  sheet({ document_id: 'doc-1', page_index: 3, sheet_no: 'M1.1', title: 'Mechanical', discipline: 'M', has_text_layer: false }),
];

function setup(over: Partial<React.ComponentProps<typeof SheetNavigator>> = {}) {
  const onSelect = vi.fn();
  const onFilterChange = vi.fn();
  render(
    <SheetNavigator
      sheets={sheets}
      currentKey={null}
      onSelect={onSelect}
      disciplineFilter="all"
      onDisciplineFilterChange={onFilterChange}
      {...over}
    />
  );
  return { onSelect, onFilterChange };
}

describe('SheetNavigator — listing and E-first sort', () => {
  it('lists every sheet with its sheet_no and title', () => {
    setup();
    expect(screen.getByText('E1.1')).toBeTruthy();
    expect(screen.getByText('Lighting Plan')).toBeTruthy();
    expect(screen.getByText('A1.1')).toBeTruthy();
  });

  it('sorts Electrical sheets first, then A/M/P/other, alphanumeric within a discipline', () => {
    setup();
    const items = screen.getAllByRole('option');
    const nos = items.map(el => el.querySelector('.plan-sheet-nav-no')!.textContent);
    expect(nos).toEqual(['E1.1', 'E2.1', 'A1.1', 'M1.1']);
  });

  it('shows a "Scanned" badge for a sheet with no text layer', () => {
    setup();
    expect(screen.getByText('Scanned')).toBeTruthy();
  });

  it('shows an em-dash for a missing sheet number and a placeholder for a missing title', () => {
    render(
      <SheetNavigator
        sheets={[sheet({ sheet_no: '', title: '' })]}
        currentKey={null}
        onSelect={vi.fn()}
        disciplineFilter="all"
        onDisciplineFilterChange={vi.fn()}
      />
    );
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('(untitled sheet)')).toBeTruthy();
  });
});

describe('SheetNavigator — discipline filter', () => {
  it('offers a chip only for disciplines actually present', () => {
    setup();
    expect(screen.getByText('E')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.queryByText('P')).toBeNull(); // no P sheets in the fixture
  });

  it('clicking a discipline chip calls onDisciplineFilterChange', () => {
    const { onFilterChange } = setup();
    fireEvent.click(screen.getByText('E'));
    expect(onFilterChange).toHaveBeenCalledWith('E');
  });

  it('filtering to a discipline hides sheets outside it', () => {
    render(
      <SheetNavigator sheets={sheets} currentKey={null} onSelect={vi.fn()} disciplineFilter="E" onDisciplineFilterChange={vi.fn()} />
    );
    expect(screen.getByText('E1.1')).toBeTruthy();
    expect(screen.queryByText('A1.1')).toBeNull();
  });

  it('an empty filter result shows a message instead of a blank list', () => {
    render(
      <SheetNavigator sheets={[]} currentKey={null} onSelect={vi.fn()} disciplineFilter="all" onDisciplineFilterChange={vi.fn()} />
    );
    expect(screen.getByText('No sheets match this filter.')).toBeTruthy();
  });
});

describe('SheetNavigator — current highlight and selection', () => {
  it('marks the current sheet aria-selected', () => {
    setup({ currentKey: sheetKey('doc-1', 2) });
    const current = screen.getByTestId(`sheet-${sheetKey('doc-1', 2)}`);
    expect(current.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking a sheet calls onSelect with its document_id/page_index', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByTestId(`sheet-${sheetKey('doc-1', 1)}`));
    expect(onSelect).toHaveBeenCalledWith('doc-1', 1);
  });

  it('renders a marker count badge when provided', () => {
    setup({ markerCounts: { [sheetKey('doc-1', 0)]: 12 } });
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('renders no count badge when the count is 0 or absent', () => {
    setup({ markerCounts: { [sheetKey('doc-1', 0)]: 0 } });
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('SheetNavigator — keyboard navigation', () => {
  it('ArrowDown selects the next sheet in sorted order', () => {
    const { onSelect } = setup({ currentKey: sheetKey('doc-1', 0) }); // E1.1
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('doc-1', 2); // E2.1 is next in sorted order
  });

  it('ArrowUp selects the previous sheet', () => {
    const { onSelect } = setup({ currentKey: sheetKey('doc-1', 2) }); // E2.1
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' });
    expect(onSelect).toHaveBeenCalledWith('doc-1', 0); // E1.1
  });

  it('ArrowDown with nothing selected yet selects the first sheet', () => {
    const { onSelect } = setup({ currentKey: null });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('doc-1', 0);
  });

  it('ArrowUp at the top of the list is a no-op (stays clamped, does not call onSelect with an invalid sheet)', () => {
    const { onSelect } = setup({ currentKey: sheetKey('doc-1', 0) });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' });
    expect(onSelect).toHaveBeenCalledWith('doc-1', 0); // clamps to the first, doesn't go out of bounds
  });

  it('ArrowDown at the bottom of the list clamps to the last sheet', () => {
    const { onSelect } = setup({ currentKey: sheetKey('doc-1', 3) }); // M1.1, last in sorted order
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('doc-1', 3);
  });
});
