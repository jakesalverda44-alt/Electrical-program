// @vitest-environment happy-dom
// Estimating Phase B, Task 4 — SheetNavigator.tsx. Task 9 (deferral
// closed) added a SECOND rendering mode (a real `<select>` dropdown at
// 900-1279px) gated on window.matchMedia — happy-dom's own DEFAULT
// matchMedia resolution falls inside that range (roughly a 1024px
// viewport), so every test in this file that exercises the ORIGINAL full
// list needs an explicit desktop-width mock or it would silently start
// hitting the dropdown branch instead. mockWidthMatchMedia is applied in
// beforeEach for the whole file; the dedicated "900-1279px dropdown"
// describe block below overrides it per test.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SheetNavigator, { sheetKey } from './SheetNavigator';
import { SheetRow } from '../types';

function mockWidthMatchMedia(widthPx: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    // Parses BOTH "(min-width: Npx)" and, when present, "(max-width: Mpx)"
    // out of the query and evaluates the actual compound condition —
    // SheetNavigator's own useIsMidViewport query has both.
    const minM = /min-width:\s*(\d+)px/.exec(query);
    const maxM = /max-width:\s*(\d+)px/.exec(query);
    const min = minM ? Number(minM[1]) : null;
    const max = maxM ? Number(maxM[1]) : null;
    const matches = (min == null || widthPx >= min) && (max == null || widthPx <= max);
    return {
      matches, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  });
}

beforeEach(() => mockWidthMatchMedia(1400)); // desktop by default — the full list
afterEach(cleanup);

function sheet(over: Partial<SheetRow>): SheetRow {
  return {
    bid_id: 'bid1', document_id: 'doc-1', page_index: 0, sheet_no: 'E1.1', title: 'Lighting Plan',
    discipline: 'E', kind: 'plan', width_pt: 792, height_pt: 612, rotation: 0,
    origin_x_pt: 0, origin_y_pt: 0, ft_per_pt: null, scale_source: null, scale_label: null, has_text_layer: true,
    suggested_ft_per_pt: null, suggested_label: null, scale_ambiguous: false, half_size: false,
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

describe('SheetNavigator — at-or-under-1279px real dropdown (Task 9, deferral closed; widened by Fix round 1 / S11)', () => {
  it('renders a <select> instead of the listbox/full-list markup at a mid-range width', () => {
    mockWidthMatchMedia(1024);
    setup();
    expect(screen.getByTestId('sheet-nav-select')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    // The full-list branch renders each sheet as its OWN <button
    // data-testid="sheet-...">; the dropdown branch never does.
    expect(screen.queryByTestId(`sheet-${sheetKey('doc-1', 0)}`)).toBeNull();
  });

  it('renders the full list (not the dropdown) just above the range, at 1280px', () => {
    mockWidthMatchMedia(1280);
    setup();
    expect(screen.queryByTestId('sheet-nav-select')).toBeNull();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  // Fix round 1 / S11 — this used to be the OTHER edge of the range (a
  // hard 900px floor, since below it PlansWorkspace's Decision 2
  // view-only mode never rendered SheetNavigator AT ALL, so nothing below
  // 900px could ever reach this component to notice). Now that S11 has
  // PlansWorkspace render SheetNavigator in view-only mode too, this
  // component needs a real mode all the way down to phone widths — the
  // dropdown, same as the rest of the compact range, rather than a full
  // scrollable list column that would never fit a phone screen.
  it('still renders the dropdown at 899px (view-only, phone-width) — no lower bound anymore', () => {
    mockWidthMatchMedia(899);
    setup();
    expect(screen.getByTestId('sheet-nav-select')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('renders the dropdown at a typical phone width (390px)', () => {
    mockWidthMatchMedia(390);
    setup();
    expect(screen.getByTestId('sheet-nav-select')).toBeTruthy();
  });

  it('every sheet appears as an <option>, sorted E-first same as the full list, with the marker count and scanned status folded into its label', () => {
    mockWidthMatchMedia(1024);
    // An explicit currentKey avoids the "Select a sheet…" placeholder
    // option (only shown when nothing is selected yet) from showing up in
    // this list of expected labels — covered on its own further below.
    setup({ currentKey: sheetKey('doc-1', 0), markerCounts: { [sheetKey('doc-1', 0)]: 5 } });
    const select = screen.getByTestId('sheet-nav-select') as HTMLSelectElement;
    const labels = Array.from(select.options).map(o => o.textContent);
    expect(labels).toEqual([
      'E1.1 — Lighting Plan (5 marked)',
      'E2.1 — Power Plan',
      'A1.1 — Floor Plan',
      'M1.1 — Mechanical (scanned)',
    ]);
  });

  it('shows a disabled "Select a sheet…" placeholder option when nothing is selected yet', () => {
    mockWidthMatchMedia(1024);
    setup({ currentKey: null });
    const select = screen.getByTestId('sheet-nav-select') as HTMLSelectElement;
    expect(select.options[0].textContent).toBe('Select a sheet…');
    expect(select.options[0].disabled).toBe(true);
  });

  it('the select\'s value reflects the current sheet', () => {
    mockWidthMatchMedia(1024);
    setup({ currentKey: sheetKey('doc-1', 2) }); // E2.1, index 1 in sorted order
    const select = screen.getByTestId('sheet-nav-select') as HTMLSelectElement;
    expect(select.value).toBe('1');
  });

  it('choosing a different option calls onSelect with that sheet\'s document_id/page_index', () => {
    mockWidthMatchMedia(1024);
    const { onSelect } = setup();
    const select = screen.getByTestId('sheet-nav-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '2' } }); // A1.1 in sorted order
    expect(onSelect).toHaveBeenCalledWith('doc-1', 1);
  });

  it('the discipline filter chips still work and narrow the dropdown\'s own options', () => {
    mockWidthMatchMedia(1024);
    setup({ currentKey: sheetKey('doc-1', 0), disciplineFilter: 'E' });
    const select = screen.getByTestId('sheet-nav-select') as HTMLSelectElement;
    const labels = Array.from(select.options).map(o => o.textContent);
    expect(labels).toEqual(['E1.1 — Lighting Plan', 'E2.1 — Power Plan']);
  });

  it('an empty filter result shows the same message as the full list, not an empty/broken select', () => {
    mockWidthMatchMedia(1024);
    render(
      <SheetNavigator sheets={[]} currentKey={null} onSelect={vi.fn()} disciplineFilter="all" onDisciplineFilterChange={vi.fn()} />
    );
    expect(screen.getByText('No sheets match this filter.')).toBeTruthy();
    expect(screen.queryByTestId('sheet-nav-select')).toBeNull();
  });
});
