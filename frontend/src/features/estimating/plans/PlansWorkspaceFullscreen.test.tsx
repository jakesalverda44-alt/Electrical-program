// @vitest-environment happy-dom
// Full-screen markup mode — the same PlansWorkspace subtree lifted into a
// fixed, window-covering region. PlanViewer is mocked (as in
// PlansWorkspace.test.tsx); this covers the mode's own wiring.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ConfirmProvider } from '../../../components/ConfirmDialog';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) } };
});

let viewerMounts = 0;
vi.mock('./PlanViewer', () => ({
  default: (props: { dispatchTool: (e: unknown) => void; sheet: { sheet_no: string }; suggestedRoutes?: unknown[] }) => {
    React.useEffect(() => { viewerMounts += 1; }, []);
    return (
      <div data-testid="plan-viewer-mock" data-sheet={props.sheet.sheet_no} data-routes={props.suggestedRoutes?.length ?? 0}>
        <button onClick={() => props.dispatchTool({ type: 'POINTER_CLICK', point: { x: 10, y: 10 } })}>Simulate canvas click</button>
      </div>
    );
  },
}));
vi.mock('./sheetTextCache', () => ({ getSheetTextItems: vi.fn().mockResolvedValue([]) }));

function mockMatchMediaWidth(widthPx: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minM = /min-width:\s*(\d+)px/.exec(query);
    const maxM = /max-width:\s*(\d+)px/.exec(query);
    const matches = (!minM || widthPx >= Number(minM[1])) && (!maxM || widthPx <= Number(maxM[1]));
    return { matches, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() };
  });
}

import PlansWorkspace from './PlansWorkspace';
import { EstimateLine, EstimateSettings, SheetRow } from '../types';

const settings: EstimateSettings = {
  labor_rate: 38, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3,
  supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0,
};
const sheet = (over: Partial<SheetRow> = {}): SheetRow => ({
  bid_id: 'bid1', document_id: 'doc-1', page_index: 0, sheet_no: 'E1.1', title: 'Lighting Plan',
  discipline: 'E', kind: 'plan', width_pt: 792, height_pt: 612, rotation: 0,
  origin_x_pt: 0, origin_y_pt: 0, ft_per_pt: 0.01, scale_source: 'calibrated', scale_label: null, has_text_layer: true,
  suggested_ft_per_pt: null, suggested_label: null, scale_ambiguous: false, half_size: false, ...over,
});
const line = (over: Partial<EstimateLine> = {}): EstimateLine =>
  ({ category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', source: 'takeoff', line_key: 'k1', ...over });

let sheets: SheetRow[];
beforeEach(() => {
  viewerMounts = 0;
  sheets = [sheet(), sheet({ page_index: 1, sheet_no: 'E1.2', title: 'Power Plan' })];
  get.mockReset(); post.mockReset(); put.mockReset();
  get.mockImplementation((url: string) => {
    if (url.endsWith('/sheets')) return Promise.resolve({ data: { sheets } });
    if (url.endsWith('/markups')) return Promise.resolve({ data: { markups: [] } });
    if (url.endsWith('/rollup')) return Promise.resolve({ data: { rollup: [] } });
    if (url.endsWith('/library')) return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
    if (url.endsWith('/feeders')) return Promise.resolve({ data: { edges: [{ id: 'PANEL B→RTU-1', from: 'PANEL B', to: 'RTU-1', status: 'estimated', lengthFt: 121, tier: 'suggested', underground: false, route: { documentId: 'doc-1', pageIndex: 0, sheetKey: null, points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] } }] } });
    return Promise.resolve({ data: {} });
  });
  mockMatchMediaWidth(1400);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers(); cleanup(); localStorage.clear();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).requestFullscreen;
  delete (document as unknown as Record<string, unknown>).exitFullscreen;
});

async function setup(props: Partial<React.ComponentProps<typeof PlansWorkspace>> = {}) {
  render(
    <ConfirmProvider>
      <PlansWorkspace
        bidId="bid1" lines={[line()]} settings={settings} dirty={false}
        onApplied={vi.fn()} onSaveDirtyLinesFirst={vi.fn().mockResolvedValue(undefined)} onCreateLine={vi.fn().mockResolvedValue(true)}
        {...props}
      />
    </ConfirmProvider>
  );
  await waitFor(() => expect(screen.getByTestId('plan-viewer-mock')).toBeTruthy());
}
const region = () => screen.queryByRole('region', { name: 'Full-screen plan markup' });

describe('Plans full screen', () => {
  it('the Full screen button enters, Exit leaves, and focus returns to the button', async () => {
    await setup();
    expect(region()).toBeNull();
    const btn = screen.getByTitle('Full screen (F)');
    expect(btn.textContent).toMatch(/Full screen/);
    fireEvent.click(btn);
    const r = region()!;
    expect(r).toBeTruthy();
    expect(r.className).toContain('plan-view-fs');
    await waitFor(() => expect(document.activeElement).toBe(r));
    fireEvent.click(screen.getByRole('button', { name: /Exit full screen/ }));
    expect(region()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTitle('Full screen (F)')));
  });

  it('F toggles (not while typing) and Esc exits', async () => {
    await setup();
    fireEvent.keyDown(window, { key: 'f' });
    expect(region()).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(region()).toBeNull();
    fireEvent.keyDown(window, { key: 'F' });
    expect(region()).toBeTruthy();
    fireEvent.keyDown(window, { key: 'f' });
    expect(region()).toBeNull();
    // typing in a field must not toggle
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'f' });
    expect(region()).toBeNull();
    input.remove();
  });

  it('keeps the same viewer instance (no remount) and all tools still dispatch', async () => {
    await setup();
    expect(viewerMounts).toBe(1);
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    expect(viewerMounts).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Count' }));
    expect(screen.getByRole('button', { name: 'Count' }).className).toContain('active');
    fireEvent.click(screen.getByRole('button', { name: 'Simulate canvas click' }));
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', false);
  });

  it('Esc cancels a half-drawn run first instead of exiting', async () => {
    await setup();
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    fireEvent.click(screen.getByRole('button', { name: 'Linear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simulate canvas click' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(region()).toBeTruthy();
  });

  it('the sheet picker (prev/next + select) switches sheets', async () => {
    await setup();
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    expect(screen.getByTestId('plan-viewer-mock').getAttribute('data-sheet')).toBe('E1.1');
    expect(screen.getByRole('button', { name: 'Previous sheet' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Next sheet' }));
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock').getAttribute('data-sheet')).toBe('E1.2'));
    expect(screen.getByRole('button', { name: 'Next sheet' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sheet' }), { target: { value: 'doc-1:0' } });
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock').getAttribute('data-sheet')).toBe('E1.1'));
  });

  it('the takeoff lines drawer is collapsed by default and its state is remembered', async () => {
    await setup();
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    const toggle = () => screen.getByTestId('plans-fs-items-toggle');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.plan-items-panel')).toBeNull();
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.plan-items-panel')).not.toBeNull();
    expect(localStorage.getItem('est-plans-fs-items')).toBe('1');
    cleanup();
    await setup();
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle());
    expect(localStorage.getItem('est-plans-fs-items')).toBe('0');
  });

  it('gating banners (unsaved estimate, missing scale) still show in full screen', async () => {
    sheets = [sheet({ ft_per_pt: null })];
    await setup({ proposed: true });
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    expect(screen.getByTestId('plan-proposed-banner')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save the estimate' })).toBeTruthy();
    expect(screen.getByTestId('plan-scale-needed-banner')).toBeTruthy();
    expect(region()!.contains(screen.getByTestId('plan-proposed-banner'))).toBe(true);
  });

  it('calls the browser Fullscreen API when present, exits it on leaving, and ignores failures', async () => {
    const request = vi.fn().mockRejectedValue(new Error('denied'));
    const exit = vi.fn().mockResolvedValue(undefined);
    (HTMLElement.prototype as unknown as Record<string, unknown>).requestFullscreen = request;
    (document as unknown as Record<string, unknown>).exitFullscreen = exit;
    await setup();
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    expect(request).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(region()).toBeTruthy(); // rejected request does not undo the in-app mode
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.body });
    fireEvent.click(screen.getByRole('button', { name: /Exit full screen/ }));
    expect(exit).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
  });

  it('works when the Fullscreen API is absent or throws synchronously', async () => {
    (HTMLElement.prototype as unknown as Record<string, unknown>).requestFullscreen = () => { throw new Error('nope'); };
    await setup();
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    expect(region()).toBeTruthy();
  });

  it('leaves the in-app mode when the browser leaves its own fullscreen', async () => {
    await setup();
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    fireEvent(document, new Event('fullscreenchange'));
    expect(region()).toBeNull();
  });
});

describe('C7 — "Suggested feeder routes" layer', () => {
  it('off by default; on, it reads /feeders and hands this sheet\'s routes to the viewer — in full screen too', async () => {
    await setup();
    expect(screen.getByTestId('plan-viewer-mock').getAttribute('data-routes')).toBe('0');
    expect(get.mock.calls.some(c => String(c[0]).endsWith('/feeders'))).toBe(false);
    fireEvent.click(screen.getByTestId('plans-feeder-routes-toggle').querySelector('input')!);
    await waitFor(() => expect(screen.getByTestId('plan-viewer-mock').getAttribute('data-routes')).toBe('1'));
    expect(screen.getByTestId('plans-feeder-routes-toggle').textContent).toContain('(1)');
    fireEvent.click(screen.getByTitle('Full screen (F)'));
    await waitFor(() => expect(region()).toBeTruthy());
    expect(screen.getByTestId('plan-viewer-mock').getAttribute('data-routes')).toBe('1');
  });
});
