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
  default: (props: { dispatchTool: (e: unknown) => void }) => (
    <div data-testid="plan-viewer-mock">
      <button onClick={() => props.dispatchTool({ type: 'POINTER_CLICK', point: { x: 10, y: 10 } })}>
        Simulate canvas click
      </button>
    </div>
  ),
}));

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
