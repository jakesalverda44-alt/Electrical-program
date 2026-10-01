// @vitest-environment happy-dom
// UI round 1 — the chips are gone: groups, search, collapsible groups, spec/other pages tucked away.
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
import SheetNavigator, { sheetKey, groupSheets, defaultSheet, sheetMatches } from './SheetNavigator';
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

const SPEC_DOC = '2.0 - Kissimmee FL10077 FULL SPEC.pdf';
const documentNames = { 'doc-1': 'plans.pdf', 'doc-2': SPEC_DOC };
const sheets: SheetRow[] = [
  sheet({ document_id: 'doc-1', page_index: 0, sheet_no: 'E1.1', title: 'Lighting Plan', discipline: 'E' }),
  sheet({ document_id: 'doc-1', page_index: 1, sheet_no: 'A1.1', title: 'Floor Plan', discipline: 'A' }),
  sheet({ document_id: 'doc-1', page_index: 2, sheet_no: 'E2.1', title: 'Power Plan', discipline: 'E' }),
  sheet({ document_id: 'doc-1', page_index: 3, sheet_no: 'M1.1', title: 'Mechanical', discipline: 'M', has_text_layer: false }),
  sheet({ document_id: 'doc-2', page_index: 4, sheet_no: '', title: 'Page 5', discipline: 'other', page_group: 'spec' }),
  sheet({ document_id: 'doc-2', page_index: 7, sheet_no: '', title: 'Page 8', discipline: 'other', page_group: 'other' }),
];

function setup(over: Partial<React.ComponentProps<typeof SheetNavigator>> = {}) {
  const onSelect = vi.fn();
  render(<SheetNavigator sheets={sheets} currentKey={null} onSelect={onSelect} documentNames={documentNames} {...over} />);
  return { onSelect };
}

describe('groupSheets / defaultSheet / sheetMatches (pure)', () => {
  it('orders groups E, A, M, spec, other with the labels from the plan', () => {
    const g = groupSheets(sheets, documentNames);
    expect(g.map(x => x.id)).toEqual(['E', 'A', 'M', 'spec:doc-2', 'other:doc-2']);
    expect(g.map(x => x.label)).toEqual([
      'Electrical (E)', 'Architectural (A)', 'Mechanical (M)',
      `Spec book — ${SPEC_DOC}`, `Pages without a sheet number — ${SPEC_DOC}`,
    ]);
    expect(g[0].sheets.map(x => x.sheet_no)).toEqual(['E1.1', 'E2.1']);
  });

  it('defaultSheet is E-1 even when a spec page comes first in API order', () => {
    const shuffled = [sheets[4], sheets[0], sheets[1]];
    expect(defaultSheet(shuffled)?.sheet_no).toBe('E1.1');
    expect(defaultSheet([sheets[4]])?.page_group).toBe('spec'); // no drawings at all: first sheet
  });

  it('sheetMatches ignores case, spaces and hyphens in the sheet number', () => {
    const e1 = sheet({ sheet_no: 'E-1', title: 'Power Plan' });
    expect(sheetMatches(e1, 'e1')).toBe(true);
    expect(sheetMatches(e1, 'E 1')).toBe(true);
    expect(sheetMatches(e1, 'POWER')).toBe(true);
    expect(sheetMatches(e1, 'lighting')).toBe(false);
  });
});

describe('SheetNavigator — groups', () => {
  it('expands E by default and collapses A, spec and other; group headers show labels and counts', () => {
    setup();
    expect(screen.getByTestId('sheet-group-E').getAttribute('aria-expanded')).toBe('true');
    for (const id of ['A', 'M', 'spec:doc-2', 'other:doc-2']) {
      expect(screen.getByTestId(`sheet-group-${id}`).getAttribute('aria-expanded')).toBe('false');
    }
    const spec = screen.getByTestId('sheet-group-spec:doc-2');
    expect(spec.textContent).toContain(`Spec book — ${SPEC_DOC}`);
    expect(spec.textContent).toContain('1');
    expect(screen.getByText('E1.1')).toBeTruthy();
    expect(screen.queryByText('A1.1')).toBeNull();
  });

  it('clicking a collapsed group opens it and shows spec pages as p.N', () => {
    setup();
    fireEvent.click(screen.getByTestId('sheet-group-spec:doc-2'));
    expect(screen.getByTestId('sheet-group-spec:doc-2').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('p.5')).toBeTruthy();
  });

  it('sorts Electrical sheets within their group alphanumerically', () => {
    setup();
    const nos = Array.from(document.querySelectorAll('.plan-sheet-nav-no')).map(el => el.textContent);
    expect(nos).toEqual(['E1.1', 'E2.1']);
  });

  it('shows a "Scanned" badge for a sheet with no text layer', () => {
    setup();
    fireEvent.click(screen.getByTestId('sheet-group-M'));
    expect(screen.getByText('Scanned')).toBeTruthy();
  });

  it('shows an em-dash for a missing sheet number and a placeholder for a missing title', () => {
    render(<SheetNavigator sheets={[sheet({ sheet_no: '', title: '' })]} currentKey={null} onSelect={vi.fn()} documentNames={{}} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('(untitled sheet)')).toBeTruthy();
  });

  it('a current sheet in a collapsed group auto-expands that group', () => {
    setup({ currentKey: sheetKey('doc-1', 1) }); // A1.1
    expect(screen.getByTestId('sheet-group-A').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('A1.1')).toBeTruthy();
  });

  it('shows the document name under a sheet number that appears in two documents', () => {
    const dup = [
      sheet({ document_id: 'doc-1', page_index: 0, sheet_no: 'E1.1' }),
      sheet({ document_id: 'doc-3', page_index: 0, sheet_no: 'E1.1' }),
    ];
    render(<SheetNavigator sheets={dup} currentKey={null} onSelect={vi.fn()} documentNames={{ 'doc-1': 'plans.pdf', 'doc-3': 'plans (1).pdf' }} />);
    expect(document.querySelectorAll('.plan-sheet-nav-doc')).toHaveLength(2);
    expect(screen.getByText('plans (1).pdf')).toBeTruthy();
  });
});

describe('SheetNavigator — search', () => {
  it('"e1" shows only E-1 and expands matching groups', () => {
    setup();
    fireEvent.change(screen.getByTestId('sheet-nav-search'), { target: { value: 'e1' } });
    expect(screen.getByText('E1.1')).toBeTruthy();
    expect(screen.queryByText('E2.1')).toBeNull();
    expect(screen.queryByText('A1.1')).toBeNull();
  });

  it('matches by title, reaching into a collapsed group', () => {
    setup();
    fireEvent.change(screen.getByTestId('sheet-nav-search'), { target: { value: 'floor' } });
    expect(screen.getByText('A1.1')).toBeTruthy();
  });

  it('no match shows the empty text', () => {
    setup();
    fireEvent.change(screen.getByTestId('sheet-nav-search'), { target: { value: 'zzz' } });
    expect(screen.getByText('No sheets match “zzz”.')).toBeTruthy();
  });
});

describe('SheetNavigator — current highlight and selection', () => {
  it('marks the current sheet aria-current', () => {
    setup({ currentKey: sheetKey('doc-1', 2) });
    expect(screen.getByTestId(`sheet-${sheetKey('doc-1', 2)}`).getAttribute('aria-current')).toBe('true');
  });

  it('clicking a sheet calls onSelect with its document_id/page_index', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByTestId(`sheet-${sheetKey('doc-1', 2)}`));
    expect(onSelect).toHaveBeenCalledWith('doc-1', 2);
  });

  it('renders a marker count badge when provided, none when 0', () => {
    setup({ markerCounts: { [sheetKey('doc-1', 0)]: 12, [sheetKey('doc-1', 2)]: 0 } });
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('SheetNavigator — keyboard navigation (visible items only)', () => {
  it('ArrowDown selects the next sheet in the open group', () => {
    const { onSelect } = setup({ currentKey: sheetKey('doc-1', 0) });
    fireEvent.keyDown(screen.getByRole('navigation'), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('doc-1', 2);
  });

  it('ArrowDown from the last visible sheet stays put, skipping collapsed groups', () => {
    const { onSelect } = setup({ currentKey: sheetKey('doc-1', 2) });
    fireEvent.keyDown(screen.getByRole('navigation'), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('doc-1', 2);
  });

  it('ArrowUp selects the previous sheet; ArrowDown with nothing selected picks the first', () => {
    const a = setup({ currentKey: sheetKey('doc-1', 2) });
    fireEvent.keyDown(screen.getByRole('navigation'), { key: 'ArrowUp' });
    expect(a.onSelect).toHaveBeenCalledWith('doc-1', 0);
    cleanup();
    const b = setup({ currentKey: null });
    fireEvent.keyDown(screen.getByRole('navigation'), { key: 'ArrowDown' });
    expect(b.onSelect).toHaveBeenCalledWith('doc-1', 0);
  });
});

describe('SheetNavigator — at-or-under-1279px real dropdown (Task 9, deferral closed; widened by Fix round 1 / S11)', () => {
  it('renders a <select> instead of the grouped list at a mid-range width', () => {
    mockWidthMatchMedia(1024);
    setup();
    expect(screen.getByTestId('sheet-nav-select')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByTestId(`sheet-${sheetKey('doc-1', 0)}`)).toBeNull();
  });

  it('renders the grouped list (not the dropdown) just above the range, at 1280px', () => {
    mockWidthMatchMedia(1280);
    setup();
    expect(screen.queryByTestId('sheet-nav-select')).toBeNull();
    expect(screen.getByRole('navigation')).toBeTruthy();
  });

  it('still renders the dropdown at 899px and at a phone width (no lower bound)', () => {
    mockWidthMatchMedia(899);
    setup();
    expect(screen.getByTestId('sheet-nav-select')).toBeTruthy();
    cleanup();
    mockWidthMatchMedia(390);
    setup();
    expect(screen.getByTestId('sheet-nav-select')).toBeTruthy();
  });

  it('has one <optgroup> per group, in order, with p.N labels for spec and other pages', () => {
    mockWidthMatchMedia(1024);
    setup({ currentKey: sheetKey('doc-1', 0), markerCounts: { [sheetKey('doc-1', 0)]: 5 } });
    const select = screen.getByTestId('sheet-nav-select') as HTMLSelectElement;
    const groupLabels = Array.from(select.querySelectorAll('optgroup')).map(g => g.label);
    expect(groupLabels).toEqual([
      'Electrical (E)', 'Architectural (A)', 'Mechanical (M)',
      `Spec book — ${SPEC_DOC}`, `Pages without a sheet number — ${SPEC_DOC}`,
    ]);
    expect(Array.from(select.options).map(o => o.textContent)).toEqual([
      'E1.1 — Lighting Plan (5 marked)',
      'E2.1 — Power Plan',
      'A1.1 — Floor Plan',
      'M1.1 — Mechanical (scanned)',
      'p.5 — Page 5',
      'p.8 — Page 8',
    ]);
  });

  it('shows a disabled "Select a sheet…" placeholder option when nothing is selected yet', () => {
    mockWidthMatchMedia(1024);
    setup({ currentKey: null });
    const select = screen.getByTestId('sheet-nav-select') as HTMLSelectElement;
    expect(select.options[0].textContent).toBe('Select a sheet…');
    expect(select.options[0].disabled).toBe(true);
  });

  it('the select\'s value reflects the current sheet, and choosing an option calls onSelect', () => {
    mockWidthMatchMedia(1024);
    const { onSelect } = setup({ currentKey: sheetKey('doc-1', 2) });
    const select = screen.getByTestId('sheet-nav-select') as HTMLSelectElement;
    expect(select.value).toBe('1'); // E2.1 is the second option
    fireEvent.change(select, { target: { value: '2' } }); // A1.1
    expect(onSelect).toHaveBeenCalledWith('doc-1', 1);
  });

  it('an empty list shows a message, not an empty select', () => {
    mockWidthMatchMedia(1024);
    render(<SheetNavigator sheets={[]} currentKey={null} onSelect={vi.fn()} documentNames={{}} />);
    expect(screen.getByText('No sheets yet.')).toBeTruthy();
    expect(screen.queryByTestId('sheet-nav-select')).toBeNull();
  });
});
