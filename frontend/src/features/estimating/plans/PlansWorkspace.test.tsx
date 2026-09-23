// @vitest-environment happy-dom
// Estimating Phase B, Task 8 — PlansWorkspace.tsx wiring: sheet selection,
// a tool commit creating a markup draft that autosaves, and the apply flow
// calling apply-markups. PlanViewer itself is mocked (its own pdf.js
// rendering is covered by PlanViewer.test.tsx) so this stays a data-wiring
// test, not a re-test of canvas rendering.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ConfirmProvider } from '../../../components/ConfirmDialog';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) } };
});

vi.mock('./PlanViewer', () => ({
  default: (props: { dispatchTool: (e: unknown) => void; viewOnly?: boolean }) => (
    <div data-testid="plan-viewer-mock" data-view-only={String(!!props.viewOnly)}>
      <button onClick={() => props.dispatchTool({ type: 'POINTER_CLICK', point: { x: 10, y: 10 } })}>
        Simulate canvas click
      </button>
    </div>
  ),
}));

// Task 7 (deferral closed) — sheetTextCache.ts's own pdf.js-loading is
// covered by sheetTextCache.test.ts; here it's mocked so these tests stay
// data-wiring tests (tag matching -> suggested markers -> confirm/reject),
// not a re-test of pdf.js text extraction.
const getSheetTextItems = vi.fn();
vi.mock('./sheetTextCache', () => ({
  getSheetTextItems: (...a: unknown[]) => getSheetTextItems(...a),
}));

function mockMatchMediaWidth(widthPx: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    const threshold = m ? Number(m[1]) : 0;
    return {
      matches: widthPx >= threshold, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  });
}

import PlansWorkspace from './PlansWorkspace';
import { EstimateLine, EstimateSettings, SheetRow } from '../types';

const settings: EstimateSettings = {
  labor_rate: 38, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3,
  supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0,
};

function sheet(over: Partial<SheetRow> = {}): SheetRow {
  return {
    bid_id: 'bid1', document_id: 'doc-1', page_index: 0, sheet_no: 'E1.1', title: 'Lighting Plan',
    discipline: 'E', kind: 'plan', width_pt: 792, height_pt: 612, rotation: 0,
    ft_per_pt: 0.01, scale_source: 'calibrated', scale_label: null, has_text_layer: true,
    ...over,
  };
}
function line(over: Partial<EstimateLine> = {}): EstimateLine {
  return { category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', source: 'takeoff', line_key: 'k1', ...over };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  getSheetTextItems.mockReset();
  getSheetTextItems.mockResolvedValue([]);
  get.mockImplementation((url: string) => {
    if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet()] } });
    if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
    if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
    return Promise.resolve({ data: {} });
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

function setup(props: Partial<React.ComponentProps<typeof PlansWorkspace>> = {}) {
  const onApplied = vi.fn();
  render(
    <ConfirmProvider>
      <PlansWorkspace bidId="bid1" lines={[line()]} settings={settings} onApplied={onApplied} {...props} />
    </ConfirmProvider>
  );
  return { onApplied };
}

describe('PlansWorkspace — sheet list + selection', () => {
  it('fetches and lists sheets, auto-selecting the first one', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('E1.1')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
  });
});

describe('PlansWorkspace — placing a count marker autosaves', () => {
  it('a POINTER_CLICK while the Count tool is active creates a draft and, after the debounce, POSTs a batch', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Count (C)'));
    fireEvent.click(screen.getByText('Simulate canvas click'));

    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/estimating/bid1/markups/batch',
      expect.objectContaining({ creates: [expect.objectContaining({ kind: 'count', document_id: 'doc-1', page_index: 0 })] })
    ));
  });

  it('re-fetches the rollup once the batch is confirmed saved', async () => {
    post.mockResolvedValue({ data: { created: [{ id: 'm1' }], updated: [], deleted: [], skipped: [] } });
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    const rollupCallsBefore = get.mock.calls.filter(c => String(c[0]).endsWith('/rollup')).length;

    fireEvent.click(screen.getByTitle('Count (C)'));
    fireEvent.click(screen.getByText('Simulate canvas click'));
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    await waitFor(() => {
      const rollupCallsAfter = get.mock.calls.filter(c => String(c[0]).endsWith('/rollup')).length;
      expect(rollupCallsAfter).toBeGreaterThan(rollupCallsBefore);
    });
  });
});

describe('PlansWorkspace — apply flow', () => {
  it('applying a line POSTs apply-markups and calls onApplied on success', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet()] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({
        data: { rollup: [{ lineKey: 'k1', markedQty: 24, markerCount: 24, sheets: [], incompatibleCount: 0, missingScaleCount: 0, category: 'Branch Power', description: 'Duplex receptacle', unit: 'EA', currentQty: 10, qtySource: 'takeoff', aiQty: 10 }] },
      });
      return Promise.resolve({ data: {} });
    });
    post.mockResolvedValue({ data: { applied: ['k1'], skipped: [], save: { recap: {}, bidEstimate: {}, lines: [] } } });

    const { onApplied } = setup();
    await waitFor(() => expect(screen.getByText('Apply marked qty')).toBeTruthy());
    fireEvent.click(screen.getByText('Apply marked qty'));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/estimating/bid1/apply-markups', { line_keys: ['k1'] }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  });
});

// Decision 2 — below 900px the viewer is view-only regardless of the
// caller's own viewOnly prop.
describe('PlansWorkspace — responsive view-only (Decision 2)', () => {
  afterEach(() => { window.matchMedia = undefined as never; });

  it('is NOT view-only at a normal desktop width', async () => {
    mockMatchMediaWidth(1400);
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock').dataset.viewOnly).toBe('false'));
  });

  it('forces view-only below the 900px breakpoint even without the prop', async () => {
    mockMatchMediaWidth(700);
    setup();
    // PlanViewer is mocked in this file (its own mobile notice text is its
    // concern, not this wiring test's) — the real signal here is that
    // PlansWorkspace passed viewOnly=true down to it.
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock').dataset.viewOnly).toBe('true'));
  });

  it('the toolbar/items-panel/sheet-navigator chrome is hidden in view-only mode', async () => {
    mockMatchMediaWidth(700);
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect(screen.queryByRole('group', { name: 'Markup tools' })).toBeNull();
  });

  it('an explicit viewOnly prop still applies at a wide viewport', async () => {
    mockMatchMediaWidth(1400);
    setup({ viewOnly: true });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock').dataset.viewOnly).toBe('true'));
  });
});

// Task 7 (deferral closed) — "Suggest markers"/"Find tag on sheets…"/
// confirm-reject wiring. PlanViewer itself is mocked in this file (see the
// header comment), so "a suggested marker is on the sheet" is asserted via
// the SuggestMarkersBar's own "N suggested" indicator, not by inspecting
// SVG markers PlanViewer would normally render.
describe('PlansWorkspace — suggested markers (Task 7, deferral closed)', () => {
  it('"Suggest markers for this sheet" fetches this sheet\'s text, matches a line\'s description-derived tag, and adds ONE suggested marker per match', async () => {
    getSheetTextItems.mockResolvedValue([{ str: 'A1', transform: [1, 0, 0, 1, 50, 50] }]);
    setup({ lines: [line({ description: 'Type A1 duplex receptacle', line_key: 'k1' })] });
    await waitFor(() => expect(screen.getByText('Suggest markers for this sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('Suggest markers for this sheet'));

    await waitFor(() => expect(getSheetTextItems).toHaveBeenCalledWith('bid1', 'doc-1', 0));
    await waitFor(() => expect(screen.getByText(/1 suggested/)).toBeTruthy());
  });

  it('a tag not found in ANY line description produces no suggestion (the text item does not match any candidate tag)', async () => {
    getSheetTextItems.mockResolvedValue([{ str: 'ZZZ9', transform: [1, 0, 0, 1, 50, 50] }]);
    setup({ lines: [line({ description: 'Type A1 duplex receptacle', line_key: 'k1' })] });
    await waitFor(() => expect(screen.getByText('Suggest markers for this sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('Suggest markers for this sheet'));

    await waitFor(() => expect(getSheetTextItems).toHaveBeenCalled());
    expect(screen.queryByText(/suggested$/)).toBeNull();
  });

  it('shows "No text on this sheet" instead of the suggest button, and never fetches text, when the current sheet has no text layer', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet({ has_text_layer: false })] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      return Promise.resolve({ data: {} });
    });
    setup();
    await waitFor(() => expect(screen.getByText('No text on this sheet — nothing to search for tags here.')).toBeTruthy());
    expect(screen.queryByText('Suggest markers for this sheet')).toBeNull();
    expect(getSheetTextItems).not.toHaveBeenCalled();
  });

  it('"Confirm all on this sheet" flips every suggested marker on the CURRENT sheet to confirmed, then autosaves it', async () => {
    getSheetTextItems.mockResolvedValue([{ str: 'A1', transform: [1, 0, 0, 1, 50, 50] }]);
    post.mockResolvedValue({ data: { created: [{ id: 'm1' }], updated: [], deleted: [], skipped: [] } });
    setup({ lines: [line({ description: 'Type A1 duplex receptacle', line_key: 'k1' })] });
    await waitFor(() => expect(screen.getByText('Suggest markers for this sheet')).toBeTruthy());
    fireEvent.click(screen.getByText('Suggest markers for this sheet'));
    await waitFor(() => expect(screen.getByText(/1 suggested/)).toBeTruthy());

    fireEvent.click(screen.getByText('Confirm all on this sheet'));
    expect(screen.queryByText(/1 suggested/)).toBeNull(); // no longer suggested — the bar's pending indicator clears

    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/estimating/bid1/markups/batch',
      expect.objectContaining({ creates: [expect.objectContaining({ status: 'confirmed' })] })
    ));
  });

  it('"Reject all" removes every suggested marker on the sheet — nothing is ever autosaved as confirmed', async () => {
    getSheetTextItems.mockResolvedValue([{ str: 'A1', transform: [1, 0, 0, 1, 50, 50] }]);
    setup({ lines: [line({ description: 'Type A1 duplex receptacle', line_key: 'k1' })] });
    await waitFor(() => expect(screen.getByText('Suggest markers for this sheet')).toBeTruthy());
    fireEvent.click(screen.getByText('Suggest markers for this sheet'));
    await waitFor(() => expect(screen.getByText(/1 suggested/)).toBeTruthy());

    fireEvent.click(screen.getByText('Reject all'));
    expect(screen.queryByText(/suggested/)).toBeNull();

    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    expect(post).not.toHaveBeenCalledWith('/estimating/bid1/markups/batch', expect.anything());
  });

  it('per-line "Suggest markers" (from ItemsPanel) assigns the found marker to THAT line explicitly, even if another line\'s description could also claim the tag', async () => {
    getSheetTextItems.mockResolvedValue([{ str: 'A1', transform: [1, 0, 0, 1, 50, 50] }]);
    post.mockResolvedValue({ data: { created: [{ id: 'm1' }], updated: [], deleted: [], skipped: [] } });
    // Two lines both mention "A1" in their description — the ambiguity
    // index (used by "Suggest markers for this sheet") would leave this
    // unassigned, but clicking the per-LINE button must assign it to the
    // exact line clicked, not fall back to that ambiguity policy.
    setup({ lines: [
      line({ line_key: 'k1', description: 'Type A1 duplex receptacle' }),
      line({ line_key: 'k2', description: 'Type A1 emergency variant' }),
    ] });
    await waitFor(() => expect(screen.getAllByText('Suggest markers').length).toBe(2));

    fireEvent.click(screen.getAllByText('Suggest markers')[1]); // the k2 row

    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/estimating/bid1/markups/batch',
      expect.objectContaining({ creates: [expect.objectContaining({ line_key: 'k2', status: 'suggested' })] })
    ));
  });

  it('"Find tag on sheets…" searches every text-layer sheet and lists matches; jumping to a result suggests that tag there, unassigned', async () => {
    const sheetB = sheet({ document_id: 'doc-2', page_index: 0, sheet_no: 'E1.2', title: 'Power Plan' });
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet(), sheetB] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      return Promise.resolve({ data: {} });
    });
    getSheetTextItems.mockImplementation((_bid: string, documentId: string) =>
      Promise.resolve(documentId === 'doc-2' ? [{ str: 'Z9', transform: [1, 0, 0, 1, 20, 20] }] : []));
    setup();
    await waitFor(() => expect(screen.getByText('Find tag on sheets…')).toBeTruthy());
    fireEvent.click(screen.getByText('Find tag on sheets…'));
    fireEvent.change(screen.getByLabelText('Tag to find'), { target: { value: 'Z9' } });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => expect(screen.getByText(/E1.2 Power Plan \(1\)/)).toBeTruthy());
    fireEvent.click(screen.getByText(/E1.2 Power Plan \(1\)/));

    // Jumping navigates to doc-2's sheet AND places an (unassigned)
    // suggested marker there for the searched tag.
    await waitFor(() => expect(screen.getByText(/1 suggested/)).toBeTruthy());
  });
});

// Task 9 — keyboard shortcut help.
describe('PlansWorkspace — keyboard shortcut help ("?")', () => {
  it('opens via the "?" toolbar button', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Keyboard shortcuts'));
    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy();
    expect(screen.getByText('Select / Pan tool')).toBeTruthy();
  });

  it('opens via the "?" key', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByText('Count tool')).toBeTruthy();
  });
});
