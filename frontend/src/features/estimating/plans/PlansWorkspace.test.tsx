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
  default: (props: {
    dispatchTool: (e: unknown) => void; viewOnly?: boolean;
    markups: { id: string }[]; onSelectMarker: (id: string, additive: boolean) => void;
  }) => (
    <div data-testid="plan-viewer-mock" data-view-only={String(!!props.viewOnly)}>
      <button onClick={() => props.dispatchTool({ type: 'POINTER_CLICK', point: { x: 10, y: 10 } })}>
        Simulate canvas click
      </button>
      {/* Fix round 1 / B8 — a SECOND point (a real linear run needs two
          distinct clicks before FINISH_LINEAR is even a no-op-vs-commit
          question — see toolMachine.ts's MIN_LINEAR_POINTS) plus the
          double-click/Enter that actually commits it. */}
      <button onClick={() => props.dispatchTool({ type: 'POINTER_CLICK', point: { x: 40, y: 10 } })}>
        Simulate second canvas click
      </button>
      <button onClick={() => props.dispatchTool({ type: 'FINISH_LINEAR' })}>
        Simulate finish linear run
      </button>
      {/* Task 6 (deferral closed) — exposes each current-sheet marker's
          (unpredictable, server/crypto-generated) id as its own button so
          tests can select a REAL marker without guessing/mocking
          crypto.randomUUID's call order. */}
      {props.markups.map(m => (
        <button key={m.id} onClick={() => props.onSelectMarker(m.id, false)}>
          Select marker {m.id}
        </button>
      ))}
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

// Task 9 (deferral closed): SheetNavigator's own 900-1279px dropdown query
// has a max-width component too — this now parses BOTH bounds (previously
// only min-width, which happened to be enough before SheetNavigator had a
// SECOND width-gated rendering mode to accidentally trip).
function mockMatchMediaWidth(widthPx: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
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
    origin_x_pt: 0, origin_y_pt: 0, ft_per_pt: 0.01, scale_source: 'calibrated', scale_label: null, has_text_layer: true,
    suggested_ft_per_pt: null, suggested_label: null, scale_ambiguous: false, half_size: false,
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
    // Task 6 (deferral closed) — NewLineFromMarkupModal's library search
    // is mounted (though gated closed) throughout every PlansWorkspace
    // test, so this needs a well-formed empty Library, not the generic
    // `{}` fallback below (which would crash its candidates useMemo on
    // `library.assemblies.filter`).
    if (url.endsWith('/library')) return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
    return Promise.resolve({ data: {} });
  });
  // Desktop by default — SheetNavigator's own 900-1279px dropdown mode
  // (Task 9, deferral closed) would otherwise trip on happy-dom's DEFAULT
  // matchMedia resolution, which falls inside that range. The "responsive
  // view-only" describe block below overrides this per test as needed.
  mockMatchMediaWidth(1400);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

function setup(props: Partial<React.ComponentProps<typeof PlansWorkspace>> = {}) {
  const onApplied = props.onApplied ?? vi.fn();
  // Fix round 1 / B1 — PlansWorkspace no longer PUTs a new line itself;
  // the caller (PcWorkspaceView, via estimatingBid.setLines + save) does.
  // Defaults to a working create so every EXISTING test (written before
  // B1) that never cared about this plumbing keeps passing unchanged.
  // `props.onCreateLine ?? ...` (not just spreading `{...props}` after a
  // separately-returned local default) so a caller that overrides it gets
  // back the SAME mock reference that's actually wired to the component.
  const onCreateLine = props.onCreateLine ?? vi.fn().mockResolvedValue(true);
  const onSaveDirtyLinesFirst = props.onSaveDirtyLinesFirst ?? vi.fn().mockResolvedValue(undefined);
  render(
    <ConfirmProvider>
      <PlansWorkspace
        bidId="bid1" lines={[line()]} settings={settings} dirty={false}
        {...props}
        onApplied={onApplied} onSaveDirtyLinesFirst={onSaveDirtyLinesFirst} onCreateLine={onCreateLine}
      />
    </ConfirmProvider>
  );
  return { onApplied, onCreateLine, onSaveDirtyLinesFirst };
}

describe('PlansWorkspace — sheet list + selection', () => {
  it('fetches and lists sheets, auto-selecting the first one', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('E1.1')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
  });

  // Fix round 1 / S13 — a stale ?sheet= deep link (another bid's sheet, or
  // one since deleted/re-indexed) used to leave the viewer permanently
  // blank ("No plan sheets found for this bid yet") even though this
  // bid's sheets loaded fine — the old guard treated `currentKey` being
  // SET (regardless of whether it matched anything real) as "already
  // resolved, nothing to default".
  it('a stale/unknown initialSheetKey falls back to the first real sheet, with a toast', async () => {
    const showToast = vi.fn();
    setup({ initialSheetKey: 'doc-does-not-exist:0', showToast });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect(screen.queryByText('No plan sheets found for this bid yet.')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'info', title: 'That sheet is no longer available',
    }));
  });

  it('a VALID initialSheetKey is honored as-is, with no fallback toast', async () => {
    const showToast = vi.fn();
    setup({ initialSheetKey: 'doc-1:0', showToast }); // matches the default sheet() fixture
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect(showToast).not.toHaveBeenCalled();
  });
});

// Fix round 1 / B3(d) — the reviewer's exact F1 scenario: opening Plans on
// a bid with 2 EXISTING markups must not re-POST them as brand-new creates.
describe('PlansWorkspace — opening with existing markups does not re-save them (B3(d))', () => {
  it('hydrating 2 existing markups sends NO autosave batch, even well past the debounce', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet()] } });
      if (url.endsWith('/markups')) return Promise.resolve({
        data: {
          markups: [
            { id: 'm1', bidId: 'bid1', documentId: 'doc-1', pageIndex: 0, lineKey: null, kind: 'count', points: [{ x: 10, y: 10 }], drops: 0, dropFt: null, slackPct: null, status: 'confirmed', label: null },
            { id: 'm2', bidId: 'bid1', documentId: 'doc-1', pageIndex: 0, lineKey: null, kind: 'count', points: [{ x: 20, y: 20 }], drops: 0, dropFt: null, slackPct: null, status: 'confirmed', label: null },
          ],
        },
      });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      if (url.endsWith('/library')) return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
      return Promise.resolve({ data: {} });
    });
    setup();
    await waitFor(() => expect(screen.getAllByText(/^Select marker /)).toHaveLength(2)); // both hydrated onto the mock viewer

    await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); await Promise.resolve(); });
    expect(post).not.toHaveBeenCalledWith('/estimating/bid1/markups/batch', expect.anything());
    // idle (reset(), never diffed as dirty) — not "Unsaved changes" or an error.
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.queryByText('Could not save — Retry')).toBeNull();
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

  // Fix round 1 / B1 — onApplied now receives the save transaction's own
  // {lines, recap} directly (apply-markups' response already has them),
  // so the caller can install them without a broken reload().
  it('onApplied is called with the save transaction\'s own {lines, recap} from the apply-markups response', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet()] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({
        data: { rollup: [{ lineKey: 'k1', markedQty: 24, markerCount: 24, sheets: [], incompatibleCount: 0, missingScaleCount: 0, category: 'Branch Power', description: 'Duplex receptacle', unit: 'EA', currentQty: 10, qtySource: 'takeoff', aiQty: 10 }] },
      });
      return Promise.resolve({ data: {} });
    });
    const savedLines = [line({ qty: 24, qty_source: 'markup' })];
    const savedRecap = { totals: { grandTotal: 999 } };
    post.mockResolvedValue({ data: { applied: ['k1'], skipped: [], save: { recap: savedRecap, bidEstimate: {}, lines: savedLines } } });

    const { onApplied } = setup();
    await waitFor(() => expect(screen.getByText('Apply marked qty')).toBeTruthy());
    fireEvent.click(screen.getByText('Apply marked qty'));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith({ recap: savedRecap, bidEstimate: {}, lines: savedLines }));
  });

  // Fix round 1 / B1 — same "never silently overwrite" rule as New line
  // from markup: Apply must not install a fresh {lines, recap} snapshot
  // over unsaved Labor & Pricing work without asking first.
  it('when Labor & Pricing has unsaved edits (dirty=true), Apply prompts to save first', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet()] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({
        data: { rollup: [{ lineKey: 'k1', markedQty: 24, markerCount: 24, sheets: [], incompatibleCount: 0, missingScaleCount: 0, category: 'Branch Power', description: 'Duplex receptacle', unit: 'EA', currentQty: 10, qtySource: 'takeoff', aiQty: 10 }] },
      });
      return Promise.resolve({ data: {} });
    });
    post.mockResolvedValue({ data: { applied: ['k1'], skipped: [], save: { recap: {}, bidEstimate: {}, lines: [] } } });

    const { onSaveDirtyLinesFirst } = setup({ dirty: true });
    await waitFor(() => expect(screen.getByText('Apply marked qty')).toBeTruthy());
    fireEvent.click(screen.getByText('Apply marked qty'));

    await waitFor(() => expect(screen.getByText('Save Labor & Pricing changes first?')).toBeTruthy());
    expect(post).not.toHaveBeenCalledWith('/estimating/bid1/apply-markups', expect.anything());

    fireEvent.click(screen.getByText('Save and continue'));
    await waitFor(() => expect(onSaveDirtyLinesFirst).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/estimating/bid1/apply-markups', { line_keys: ['k1'] }));
  });
});

// Fix round 1 / B2 — a proposed (never-saved) estimate: markers can't
// survive against a "proposed-N" placeholder line_key, so Count/Linear
// are disabled and a banner offers a one-click save.
describe('PlansWorkspace — proposed (never-saved) estimate (Fix round 1 / B2)', () => {
  it('shows the "save the estimate" banner, and Count/Linear are disabled with a reason', async () => {
    setup({ proposed: true });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());

    expect(screen.getByTestId('plan-proposed-banner')).toBeTruthy();
    expect(screen.getByText(/save it to start marking up plans/)).toBeTruthy();

    const disabledButtons = screen.getAllByTitle('Save the estimate first to start marking up plans');
    expect(disabledButtons.map(b => b.textContent).sort()).toEqual(['Count', 'Linear']);
    for (const btn of disabledButtons) expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('the banner is absent, and Count/Linear are enabled, once the estimate is saved (proposed=false)', async () => {
    setup({ proposed: false });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());

    expect(screen.queryByTestId('plan-proposed-banner')).toBeNull();
    expect((screen.getByTitle('Count (C)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking "Save the estimate" calls onSaveDirtyLinesFirst (the same estimatingBid.save action) and shows a success toast', async () => {
    const showToast = vi.fn();
    const { onSaveDirtyLinesFirst } = setup({ proposed: true, showToast });
    await waitFor(() => expect(screen.getByTestId('plan-proposed-banner')).toBeTruthy());

    fireEvent.click(screen.getByText('Save the estimate'));

    await waitFor(() => expect(onSaveDirtyLinesFirst).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Estimate saved' })));
  });

  it('a save failure shows an error toast, not a silent no-op', async () => {
    const showToast = vi.fn();
    const onSaveDirtyLinesFirst = vi.fn().mockRejectedValue(new Error('network'));
    setup({ proposed: true, showToast, onSaveDirtyLinesFirst });
    await waitFor(() => expect(screen.getByTestId('plan-proposed-banner')).toBeTruthy());

    fireEvent.click(screen.getByText('Save the estimate'));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'Could not save the estimate' })));
  });

  it('Delete/Undo/Redo and the Select tool stay usable while proposed — only Count/Linear are gated', async () => {
    setup({ proposed: true });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());

    expect((screen.getByTitle('Select (V)') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTitle('Undo (⌘Z)') as HTMLButtonElement).disabled).toBe(true); // nothing to undo yet — unrelated to proposed gating
  });
});

// Fix round 1 / B7 — the title-block scale is a suggestion needing one
// click to confirm (never auto-applied); Linear is disabled until the
// sheet has a confirmed scale; a page with multiple distinct scales
// offers no suggestion at all; a per-document half-size toggle.
describe('PlansWorkspace — scale suggestion, Linear gating, and half-size (Fix round 1 / B7)', () => {
  it('the suggestion banner\'s "Confirm" PUTs the suggested scale with source "titleblock"', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({
        data: { sheets: [sheet({ ft_per_pt: null, scale_source: null, scale_label: null, suggested_ft_per_pt: 0.111111, suggested_label: `1/8" = 1'-0"` })] },
      });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      return Promise.resolve({ data: {} });
    });
    put.mockResolvedValue({ data: { ok: true } });
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-scale-suggestion-banner')).toBeTruthy());
    expect(screen.getByText(/Suggested scale \(from the title block\): 1\/8" = 1'-0"/)).toBeTruthy();

    fireEvent.click(screen.getByText('Confirm'));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/bid1/sheets/doc-1/0/scale', {
      ft_per_pt: 0.111111, source: 'titleblock', label: `1/8" = 1'-0"`,
    }));
  });

  it('shows "Multiple scales on this sheet — calibrate" (and NO suggestion banner) when scale_ambiguous is true', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({
        data: { sheets: [sheet({ ft_per_pt: null, scale_source: null, scale_label: null, scale_ambiguous: true, suggested_ft_per_pt: null, suggested_label: null })] },
      });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      return Promise.resolve({ data: {} });
    });
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-scale-ambiguous-banner')).toBeTruthy());
    expect(screen.getByText('Multiple scales on this sheet — calibrate.')).toBeTruthy();
    expect(screen.queryByTestId('plan-scale-suggestion-banner')).toBeNull();
  });

  it('shows neither banner once the sheet has a confirmed scale', async () => {
    setup(); // default sheet() fixture already has ft_per_pt: 0.01 (confirmed)
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect(screen.queryByTestId('plan-scale-suggestion-banner')).toBeNull();
    expect(screen.queryByTestId('plan-scale-ambiguous-banner')).toBeNull();
  });

  it('Linear is disabled with a reason when the sheet has no confirmed scale', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet({ ft_per_pt: null, scale_source: null, scale_label: null })] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      return Promise.resolve({ data: {} });
    });
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    const linearBtn = screen.getByTitle('This sheet has no confirmed scale yet — calibrate, or confirm the suggested scale below');
    expect(linearBtn.textContent).toBe('Linear');
    expect((linearBtn as HTMLButtonElement).disabled).toBe(true);
    // Count is NOT gated by scale — only by B2's proposed-estimate rule.
    expect((screen.getByTitle('Count (C)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Linear is enabled once the sheet has a confirmed scale', async () => {
    setup(); // default sheet() fixture has ft_per_pt: 0.01
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect((screen.getByTitle('Linear (L)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the "Half-size set?" toggle PUTs the opposite of the current half_size value', async () => {
    put.mockResolvedValue({ data: { ok: true } });
    setup({ }); // default sheet() has half_size: false
    await waitFor(() => expect(screen.getByLabelText('Half-size set?')).toBeTruthy());
    expect((screen.getByLabelText('Half-size set?') as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByLabelText('Half-size set?'));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/bid1/sheets/doc-1/half-size', { half_size: true }));
  });

  it('the toggle reflects an already-half-size sheet as checked', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet({ half_size: true })] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      return Promise.resolve({ data: {} });
    });
    setup();
    await waitFor(() => expect((screen.getByLabelText('Half-size set?') as HTMLInputElement).checked).toBe(true));
  });
});

// Fix round 1 / S8 — Count is disabled while an LF/C/M line is active
// (never contributes to that line's rollup), and Linear is disabled
// while an EA line is active — only when a REAL line is selected;
// drawing "unassigned" is always allowed either way.
describe('PlansWorkspace — Count/Linear gated by the active line\'s unit (Fix round 1 / S8)', () => {
  it('Count is disabled with a reason when the active line is LF', async () => {
    setup({ lines: [line({ line_key: 'k1', unit: 'LF' })], initialLineKey: 'k1' });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    const countBtn = screen.getByTitle("The active line's unit is LF — use Linear, not Count");
    expect(countBtn.textContent).toBe('Count');
    expect((countBtn as HTMLButtonElement).disabled).toBe(true);
    // Linear stays enabled (default sheet() fixture has a confirmed scale).
    expect((screen.getByTitle('Linear (L)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Linear is disabled with a reason when the active line is EA', async () => {
    setup({ lines: [line({ line_key: 'k1', unit: 'EA' })], initialLineKey: 'k1' });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    const linearBtn = screen.getByTitle("The active line's unit is EA — use Count, not Linear");
    expect(linearBtn.textContent).toBe('Linear');
    expect((linearBtn as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('Count (C)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('neither tool is gated when no line is active (drawing unassigned is always allowed)', async () => {
    setup({ lines: [line({ line_key: 'k1', unit: 'LF' })] }); // no initialLineKey
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect((screen.getByTitle('Count (C)') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTitle('Linear (L)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the missing-scale reason still takes priority over the unit-mismatch reason for Linear', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet({ ft_per_pt: null, scale_source: null, scale_label: null })] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      return Promise.resolve({ data: {} });
    });
    setup({ lines: [line({ line_key: 'k1', unit: 'EA' })], initialLineKey: 'k1' });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    const linearBtn = screen.getByTitle('This sheet has no confirmed scale yet — calibrate, or confirm the suggested scale below');
    expect(linearBtn.textContent).toBe('Linear');
  });
});

// Fix round 1 / B8 — the drops/slack popover: build it (it was never
// built before this round despite Decision 7's own ask), stamp the
// app-wide defaults onto every new run, open it the instant the run
// finishes, and let it be reopened later for an already-selected run.
describe('PlansWorkspace — drops/slack popover (Fix round 1 / B8)', () => {
  function drawLinearRun() {
    fireEvent.click(screen.getByTitle('Linear (L)'));
    fireEvent.click(screen.getByText('Simulate canvas click'));
    fireEvent.click(screen.getByText('Simulate second canvas click'));
    fireEvent.click(screen.getByText('Simulate finish linear run'));
  }

  it('finishing a linear run stamps the app-wide defaults and opens the popover automatically', async () => {
    setup({ defaultDropFt: 12, defaultSlackPct: 8 });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());

    drawLinearRun();

    await waitFor(() => expect(screen.getByLabelText('Feet per drop:')).toBeTruthy());
    expect((screen.getByLabelText('Feet per drop:') as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText('Slack (%):') as HTMLInputElement).value).toBe('8');
  });

  it('falls back to 10/10 when defaultDropFt/defaultSlackPct are omitted', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());

    drawLinearRun();

    await waitFor(() => expect(screen.getByLabelText('Feet per drop:')).toBeTruthy());
    expect((screen.getByLabelText('Feet per drop:') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('Slack (%):') as HTMLInputElement).value).toBe('10');
  });

  it('a count marker never opens the popover', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Count (C)'));
    fireEvent.click(screen.getByText('Simulate canvas click'));
    expect(screen.queryByLabelText('Drops (count):')).toBeNull();
  });

  it('editing a field updates the marker\'s value, and "Done" closes the popover', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    drawLinearRun();
    await waitFor(() => expect(screen.getByLabelText('Drops (count):')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Drops (count):'), { target: { value: '4' } });
    expect((screen.getByLabelText('Drops (count):') as HTMLInputElement).value).toBe('4');

    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByLabelText('Drops (count):')).toBeNull();
  });

  it('"Edit drops/slack" is disabled with no selection', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect((screen.getByText('Edit drops/slack') as HTMLButtonElement).disabled).toBe(true);
  });

  it('selecting a single linear marker enables "Edit drops/slack", which reopens the popover for it', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    drawLinearRun();
    await waitFor(() => expect(screen.getByLabelText('Drops (count):')).toBeTruthy());
    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByLabelText('Drops (count):')).toBeNull();

    fireEvent.click(screen.getByTitle('Select (V)'));
    fireEvent.click(screen.getByText(/^Select marker /));

    expect((screen.getByText('Edit drops/slack') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Edit drops/slack'));
    await waitFor(() => expect(screen.getByLabelText('Drops (count):')).toBeTruthy());
  });

  it('a count marker does not enable "Edit drops/slack" even when selected', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Count (C)'));
    fireEvent.click(screen.getByText('Simulate canvas click'));
    fireEvent.click(screen.getByTitle('Select (V)'));
    fireEvent.click(screen.getByText(/^Select marker /));
    expect((screen.getByText('Edit drops/slack') as HTMLButtonElement).disabled).toBe(true);
  });
});

// Fix round 1 / B9 — indexing runs as a background job now; GET /sheets
// returns whatever's already done plus each document's status, and the
// client polls (never blocking the initial render on a full index).
describe('PlansWorkspace — background sheet indexing status (Fix round 1 / B9)', () => {
  function mockSheetsSequence(responses: { sheets: SheetRow[]; statuses: Record<string, string> }[]) {
    let call = 0;
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) {
        const data = responses[Math.min(call, responses.length - 1)];
        call++;
        return Promise.resolve({ data });
      }
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      if (url.endsWith('/library')) return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
      return Promise.resolve({ data: {} });
    });
  }

  it('shows an "indexing" banner while a document is pending/indexing, and it clears once every document reaches "done" (via the poll loop)', async () => {
    mockSheetsSequence([
      { sheets: [], statuses: { 'doc-1': 'indexing' } },
      { sheets: [sheet()], statuses: { 'doc-1': 'done' } },
    ]);
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-sheets-indexing-banner')).toBeTruthy());
    expect(screen.queryByTestId('plan-sheets-failed-banner')).toBeNull();

    // The poll loop's own 2s interval — advance past it so the next GET
    // (this test's second mocked response, status 'done') lands.
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve(); await Promise.resolve(); });

    await waitFor(() => expect(screen.queryByTestId('plan-sheets-indexing-banner')).toBeNull());
    expect(screen.getByText('E1.1')).toBeTruthy();
  });

  it('shows a "failed" banner for a failed document, and never auto-polls to retry it on its own', async () => {
    mockSheetsSequence([{ sheets: [], statuses: { 'doc-1': 'failed' } }]);
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-sheets-failed-banner')).toBeTruthy());
    // 'failed' is terminal (not pending/indexing) — no polling banner, and
    // no reason for the poll-interval effect to be running at all.
    expect(screen.queryByTestId('plan-sheets-indexing-banner')).toBeNull();
  });

  it('no banners at all once every document is already "done" on the first response', async () => {
    setup(); // default beforeEach mock has no `statuses` field at all
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect(screen.queryByTestId('plan-sheets-indexing-banner')).toBeNull();
    expect(screen.queryByTestId('plan-sheets-failed-banner')).toBeNull();
  });

  it('"Refresh sheets" sends an explicit refresh=1 request', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    get.mockClear();

    fireEvent.click(screen.getByText('Refresh sheets'));

    await waitFor(() => expect(get).toHaveBeenCalledWith(
      '/estimating/bid1/sheets',
      expect.objectContaining({ params: { refresh: 1 } })
    ));
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

  // Fix round 1 / S2 — "Confirm all" now reports what it did (exact
  // proximity/dedup-against-a-hand-placed-marker cases are covered
  // exhaustively at the pure-function level in
  // suggestedMarkerFlow.test.ts; this just proves PlansWorkspace actually
  // wires confirmAllOnSheet's counts into a toast, not the old
  // fire-and-forget "flip everything, say nothing" behavior).
  it('"Confirm all on this sheet" shows a toast reporting how many were confirmed', async () => {
    getSheetTextItems.mockResolvedValue([{ str: 'A1', transform: [1, 0, 0, 1, 50, 50] }]);
    const showToast = vi.fn();
    setup({ lines: [line({ description: 'Type A1 duplex receptacle', line_key: 'k1' })], showToast });
    await waitFor(() => expect(screen.getByText('Suggest markers for this sheet')).toBeTruthy());
    fireEvent.click(screen.getByText('Suggest markers for this sheet'));
    await waitFor(() => expect(screen.getByText(/1 suggested/)).toBeTruthy());

    fireEvent.click(screen.getByText('Confirm all on this sheet'));
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '1 confirmed', sub: undefined }));
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

  // Fix round 1 / B3(b) — the reviewer's exact F2 scenario: click "Suggest
  // markers for this sheet" (a full-PDF text-layer fetch), then keep
  // drawing while it loads. Before the fix, suggestTagsOnSheet's `mutate`
  // spread its new drafts onto the `history.present` its closure captured
  // BEFORE the await — discarding the manually-drawn marker the instant
  // the suggestions landed (1 marker where 2 were expected).
  it('a marker drawn WHILE "Suggest markers for this sheet" is still loading text survives — never overwritten by the stale pre-await snapshot', async () => {
    let resolveGetItems!: (items: { str: string; transform: number[] }[]) => void;
    getSheetTextItems.mockImplementation(() => new Promise(res => { resolveGetItems = res; }));
    setup({ lines: [line({ description: 'Type A1 duplex receptacle', line_key: 'k1' })] });
    await waitFor(() => expect(screen.getByText('Suggest markers for this sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('Suggest markers for this sheet'));
    await waitFor(() => expect(getSheetTextItems).toHaveBeenCalled()); // in flight, not yet resolved

    // The estimator keeps counting while the text loads.
    fireEvent.click(screen.getByTitle('Count (C)'));
    fireEvent.click(screen.getByText('Simulate canvas click'));
    await waitFor(() => expect(screen.getAllByText(/^Select marker /)).toHaveLength(1)); // the manual marker exists NOW

    // The text finally arrives and the suggestion lands.
    await act(async () => { resolveGetItems([{ str: 'A1', transform: [1, 0, 0, 1, 50, 50] }]); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText(/1 suggested/)).toBeTruthy()); // the suggestion landed too

    // BOTH markers exist — the manual one was never discarded.
    expect(screen.getAllByText(/^Select marker /)).toHaveLength(2);
  });
});

// Task 6 (deferral closed) — "New line from markup" (the Phase A
// resolver's own library-search pattern, reused), reassigning selected
// markers to a different line, and the unassigned-markers bucket.
describe('PlansWorkspace — "New line from markup" and reassign selected markers (Task 6, deferral closed)', () => {
  /** Places one confirmed count marker (via the mocked PlanViewer's
   *  "Simulate canvas click", with the Count tool active), then switches
   *  to Select and clicks that marker's own "Select marker <id>" button
   *  (SELECT_MARKERS only takes effect while tool==='select' —
   *  toolMachine.ts's own rule) so it becomes the Toolbar's selection. */
  async function placeAndSelectOneMarker() {
    fireEvent.click(screen.getByTitle('Count (C)'));
    fireEvent.click(screen.getByText('Simulate canvas click'));
    await waitFor(() => expect(screen.getByText(/^Select marker /)).toBeTruthy());
    fireEvent.click(screen.getByTitle('Select (V)'));
    fireEvent.click(screen.getByText(/^Select marker /));
  }

  it('"New line from markup"/"Reassign to line…" are disabled with nothing selected, and enabled once a marker is selected', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect((screen.getByText('New line from markup') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Reassign to line…') as HTMLButtonElement).disabled).toBe(true);

    await placeAndSelectOneMarker();

    expect((screen.getByText('New line from markup') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText('Reassign to line…') as HTMLButtonElement).disabled).toBe(false);
  });

  // Fix round 1 / B1 — creating a line now goes through the caller's own
  // onCreateLine (live estimatingBid.setLines + save), never a direct PUT
  // of a `lines` snapshot PlansWorkspace itself doesn't own.
  it('creating a manual line from the selection calls onCreateLine with the new line, then reassigns the selected marker to it (verified via the next autosave batch)', async () => {
    post.mockResolvedValue({ data: { created: [], updated: [], deleted: [], skipped: [] } });
    const { onApplied, onCreateLine } = setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    await placeAndSelectOneMarker();

    fireEvent.click(screen.getByText('New line from markup'));
    fireEvent.change(screen.getByTestId('nlfm-description'), { target: { value: 'Custom manual item' } });
    fireEvent.change(screen.getByTestId('nlfm-manual-material'), { target: { value: '42' } });
    fireEvent.click(screen.getByTestId('nlfm-keep-manual'));

    await waitFor(() => expect(onCreateLine).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Custom manual item', source: 'manual', material_unit_override: 42, unit: 'EA',
    })));
    expect(put).not.toHaveBeenCalled(); // PlansWorkspace itself never PUTs
    expect(onApplied).not.toHaveBeenCalled(); // onApplied is Apply-flow-only now — onCreateLine is the line-creation channel
    expect(screen.queryByTestId('nlfm-description')).toBeNull(); // the modal closed on success

    // The marker was reassigned to the brand-new line's key (not left
    // unassigned) — the next autosave batch carries that as its line_key.
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/estimating/bid1/markups/batch',
      expect.objectContaining({ creates: [expect.objectContaining({ line_key: expect.any(String) })] })
    ));
  });

  it('when onCreateLine reports failure (returns false), the modal stays open and shows an error toast, and no marker is reassigned', async () => {
    const { onCreateLine } = setup({ onCreateLine: vi.fn().mockResolvedValue(false) });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    await placeAndSelectOneMarker();

    fireEvent.click(screen.getByText('New line from markup'));
    fireEvent.change(screen.getByTestId('nlfm-description'), { target: { value: 'Custom manual item' } });
    fireEvent.change(screen.getByTestId('nlfm-manual-material'), { target: { value: '42' } });
    fireEvent.click(screen.getByTestId('nlfm-keep-manual'));

    await waitFor(() => expect(onCreateLine).toHaveBeenCalled());
    expect(screen.getByTestId('nlfm-description')).toBeTruthy(); // modal still open — the create failed
  });

  // Fix round 1 / B1 — never silently overwrite unsaved Labor & Pricing
  // work: both Apply and "New line from markup" must ask first when dirty.
  it('when Labor & Pricing has unsaved edits (dirty=true), creating a line prompts to save first', async () => {
    const { onCreateLine, onSaveDirtyLinesFirst } = setup({ dirty: true });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    await placeAndSelectOneMarker();

    fireEvent.click(screen.getByText('New line from markup'));
    fireEvent.change(screen.getByTestId('nlfm-description'), { target: { value: 'Custom manual item' } });
    fireEvent.change(screen.getByTestId('nlfm-manual-material'), { target: { value: '42' } });
    fireEvent.click(screen.getByTestId('nlfm-keep-manual'));

    await waitFor(() => expect(screen.getByText('Save Labor & Pricing changes first?')).toBeTruthy());
    expect(onCreateLine).not.toHaveBeenCalled(); // not yet — waiting on the confirm

    fireEvent.click(screen.getByText('Save and continue'));
    await waitFor(() => expect(onSaveDirtyLinesFirst).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCreateLine).toHaveBeenCalledTimes(1));
  });

  it('declining the "save first" prompt cancels the create — onCreateLine is never called', async () => {
    const { onCreateLine } = setup({ dirty: true });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    await placeAndSelectOneMarker();

    fireEvent.click(screen.getByText('New line from markup'));
    fireEvent.change(screen.getByTestId('nlfm-description'), { target: { value: 'Custom manual item' } });
    fireEvent.change(screen.getByTestId('nlfm-manual-material'), { target: { value: '42' } });
    fireEvent.click(screen.getByTestId('nlfm-keep-manual'));

    await waitFor(() => expect(screen.getByText('Save Labor & Pricing changes first?')).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel'));

    expect(onCreateLine).not.toHaveBeenCalled();
    expect(screen.getByTestId('nlfm-description')).toBeTruthy(); // modal still open
  });

  it('when Labor & Pricing is NOT dirty, creating a line proceeds immediately with no prompt', async () => {
    const { onCreateLine, onSaveDirtyLinesFirst } = setup({ dirty: false });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    await placeAndSelectOneMarker();

    fireEvent.click(screen.getByText('New line from markup'));
    fireEvent.change(screen.getByTestId('nlfm-description'), { target: { value: 'Custom manual item' } });
    fireEvent.change(screen.getByTestId('nlfm-manual-material'), { target: { value: '42' } });
    fireEvent.click(screen.getByTestId('nlfm-keep-manual'));

    await waitFor(() => expect(onCreateLine).toHaveBeenCalledTimes(1));
    expect(onSaveDirtyLinesFirst).not.toHaveBeenCalled();
    expect(screen.queryByText('Save Labor & Pricing changes first?')).toBeNull();
  });

  it('"Reassign to line…" moves the selected marker onto a different EXISTING line', async () => {
    post.mockResolvedValue({ data: { created: [{ id: 'm1' }], updated: [], deleted: [], skipped: [] } });
    setup({ lines: [line({ line_key: 'k1' }), line({ line_key: 'k2', description: 'Type A1 troffer' })] });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    await placeAndSelectOneMarker();

    fireEvent.click(screen.getByText('Reassign to line…'));
    fireEvent.click(screen.getByTestId('ram-line-k2'));
    expect(screen.queryByTestId('ram-search')).toBeNull(); // the modal closed

    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/estimating/bid1/markups/batch',
      expect.objectContaining({ creates: [expect.objectContaining({ line_key: 'k2' })] })
    ));
  });

  it('"Reassign to line…" -> "Unassign" clears the marker\'s line_key', async () => {
    post.mockResolvedValue({ data: { created: [{ id: 'm1' }], updated: [], deleted: [], skipped: [] } });
    setup({ initialLineKey: 'k1' }); // markers placed while a line is active start assigned to it
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    await placeAndSelectOneMarker();

    fireEvent.click(screen.getByText('Reassign to line…'));
    fireEvent.click(screen.getByTestId('ram-unassign'));

    await waitFor(() => expect(screen.getByText('Unassigned markers (1)')).toBeTruthy());
  });

  it('a confirmed marker with no line assigned shows up in the "Unassigned markers" bucket', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Count (C)'));
    fireEvent.click(screen.getByText('Simulate canvas click'));
    await waitFor(() => expect(screen.getByText('Unassigned markers (1)')).toBeTruthy());
  });
});

function markupWire(over: Partial<import('../types').MarkupWire> = {}): import('../types').MarkupWire {
  return {
    id: 'm1', bidId: 'bid1', documentId: 'doc-1', pageIndex: 0, lineKey: null, kind: 'count',
    points: [{ x: 10, y: 10 }], drops: 0, dropFt: null, slackPct: null, status: 'confirmed', label: null,
    createdBy: null, createdAt: '', updatedAt: '', deletedAt: null,
    ...over,
  };
}

// Fix round 1 / S6 — a marker's lineKey can go "dead" (the line it pointed
// at was excluded, or no longer exists at all) without the marker ever
// being reassigned. Before this fix such a marker was invisible: not in
// the unassigned bucket (it still HAS a lineKey), and not represented
// anywhere live. It's now treated as unassigned exactly like a marker with
// no lineKey at all.
describe('PlansWorkspace — dead lineKey markers are treated as unassigned (Fix round 1 / S6)', () => {
  it('a marker assigned to an EXCLUDED line shows in the unassigned bucket', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet()] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [markupWire({ lineKey: 'k1' })] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      if (url.endsWith('/library')) return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
      return Promise.resolve({ data: {} });
    });
    setup({ lines: [line({ line_key: 'k1', excluded: true })] });
    await waitFor(() => expect(screen.getByTestId('unassigned-markers-bucket')).toBeTruthy());
    expect(screen.getByText('Unassigned markers (1)')).toBeTruthy();
  });

  it('a marker assigned to a line_key that no longer exists in `lines` at all also shows as unassigned', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet()] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [markupWire({ lineKey: 'ghost-key' })] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      if (url.endsWith('/library')) return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
      return Promise.resolve({ data: {} });
    });
    setup({ lines: [line({ line_key: 'k1' })] }); // only k1 is real — ghost-key belongs to nothing
    await waitFor(() => expect(screen.getByTestId('unassigned-markers-bucket')).toBeTruthy());
  });

  it('a marker assigned to a LIVE, non-excluded line is NOT shown as unassigned', async () => {
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet()] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [markupWire({ lineKey: 'k1' })] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      if (url.endsWith('/library')) return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
      return Promise.resolve({ data: {} });
    });
    setup({ lines: [line({ line_key: 'k1' })] });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
    expect(screen.queryByTestId('unassigned-markers-bucket')).toBeNull();
  });
});

// Fix round 1 / S12 — ItemsPanel's own "Jump to source sheet" button was
// already fully built but PlansWorkspace never actually passed
// onJumpToSource, so it silently never rendered.
describe('PlansWorkspace — "Jump to source sheet" (Fix round 1 / S12)', () => {
  it('clicking it switches to the sheet of that line\'s marker', async () => {
    const sheetB = sheet({ document_id: 'doc-2', page_index: 0, sheet_no: 'E1.2', title: 'Power Plan' });
    get.mockImplementation((url: string) => {
      if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets: [sheet(), sheetB] } });
      if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [markupWire({ lineKey: 'k1', documentId: 'doc-2', pageIndex: 0 })] } });
      if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
      if (url.endsWith('/library')) return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
      return Promise.resolve({ data: {} });
    });
    const onSheetKeyChange = vi.fn();
    setup({ lines: [line({ line_key: 'k1' })], onSheetKeyChange });
    await waitFor(() => expect(screen.getByText('Jump to source sheet')).toBeTruthy());
    onSheetKeyChange.mockClear(); // clear the initial "default to first sheet" call

    fireEvent.click(screen.getByText('Jump to source sheet'));

    await waitFor(() => expect(onSheetKeyChange).toHaveBeenCalledWith(expect.stringContaining('doc-2')));
  });

  it('shows an error toast for a line with no markup on the plans at all', async () => {
    const showToast = vi.fn();
    setup({ lines: [line({ line_key: 'k1' })], showToast });
    await waitFor(() => expect(screen.getByText('Jump to source sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('Jump to source sheet'));

    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No markup found for this line' }));
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
