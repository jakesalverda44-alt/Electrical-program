// @vitest-environment happy-dom
// Accuracy round C7 — the feeder cards and the calibration checkbox.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) } };
});

import { FeedersPanel, feederConduitLine, type FeedersResponse } from './FeedersPanel';
import type { EstimateLine } from './types';

const DOC = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
function resp(over: Partial<FeedersResponse> = {}): FeedersResponse {
  return {
    priced: true, stage: 'due', calibration: false, slackPct: 10,
    edges: [
      { id: 'PANEL B→RTU-1', from: 'PANEL B', to: 'RTU-1', kind: 'equipment', spec: '3/4"|3#6+1#10G', status: 'estimated', lengthFt: 121, tier: 'suggested', underground: false,
        math: 'PANEL B (E-1, pinned by the estimator ("Panel B")) → RTU-1 …: Manhattan 843 pt × 0.1111 ft/pt = 93.6 ft … = 121 ft', holds: [], quotes: [],
        endpoints: [{ node: 'PANEL B', located: true, documentId: DOC, pageIndex: 48 }, { node: 'RTU-1', located: true, documentId: DOC, pageIndex: 48 }],
        route: { documentId: DOC, pageIndex: 48, sheetKey: 'x', points: [{ x: 1278, y: 1266 }, { x: 1104, y: 1266 }, { x: 1104, y: 1560 }] },
        quantities: { conduitFt: 121, conductors: [{ size: '6', ground: false, count: 3, ft: 363 }] }, verticalFt: 10, makeupFt: 6 },
      { id: 'XFMR→METER', from: 'XFMR', to: 'METER', kind: 'service_lateral', spec: '2"×2|8#3/0', status: 'hold', lengthFt: null, tier: null, underground: false,
        math: 'needs: METER location — Pin METER on the Plans view', holds: ['needs: METER location — Pin METER on the Plans view'], quotes: [],
        endpoints: [{ node: 'XFMR', located: true, documentId: DOC, pageIndex: 14 }, { node: 'METER', located: false, hold: 'Pin METER on the Plans view' }],
        route: null, quantities: null, verticalFt: null, makeupFt: null },
    ],
    taps: [], skipped: [], scales: [], summary: { suggested: 1, confirmed: 0, holds: 1 },
    ...over,
  };
}
const line = (over: Partial<EstimateLine> = {}): EstimateLine => ({ id: 'l1', line_key: KEY, category: 'Feeders (allowance)', description: '3/4" EMT (incl. couplings/straps)', qty: 121, unit: 'LF', source: 'takeoff', takeoff_key: 'Feeders (allowance)||Feeder — PANEL B → RTU-1: 3/4" EMT', ...over } as EstimateLine);

afterEach(cleanup);
beforeEach(() => { get.mockReset(); post.mockReset(); patch.mockReset(); });

describe('C7 — FeedersPanel', () => {
  it('finds the conduit line of a feeder (not its wire lines)', () => {
    const lines = [line({ id: 'w', takeoff_key: 'Feeders (allowance)||Feeder — PANEL B → RTU-1: #6 wire (3 per run)' }), line()];
    expect(feederConduitLine(lines, { from: 'PANEL B', to: 'RTU-1' })?.idx).toBe(1);
  });

  it('one card per feeder with the math and status; holds say what is missing; pin + show on plans', async () => {
    get.mockResolvedValue({ data: resp() });
    const onShowOnPlans = vi.fn();
    const showToast = vi.fn();
    render(<FeedersPanel bidId="b1" lines={[line()]} setLines={vi.fn()} onShowOnPlans={onShowOnPlans} showToast={showToast} />);
    await waitFor(() => expect(screen.getByTestId('lp-feeders')).toBeTruthy());
    expect(screen.getByTestId('lp-feeders-summary').textContent).toMatch(/1 length suggested \(confirm\), 1 need a location/);
    expect(screen.getByTestId('lp-feeder-status-PANEL B→RTU-1').textContent).toBe('121 ft · suggested — confirm');
    expect(screen.getByTestId('lp-feeder-math-PANEL B→RTU-1').textContent).toMatch(/Manhattan 843 pt × 0\.1111 ft\/pt/);
    expect(screen.getByTestId('lp-feeder-status-XFMR→METER').textContent).toBe('needs: METER location — Pin METER on the Plans view');
    fireEvent.click(screen.getByTestId('lp-feeder-pin-XFMR→METER-METER'));
    expect(onShowOnPlans).toHaveBeenCalledWith(`${DOC}:14`);
    expect(showToast.mock.calls[0][0].sub).toMatch(/name the marker "METER"/);
    fireEvent.click(screen.getByTestId('lp-feeder-show-PANEL B→RTU-1'));
    expect(onShowOnPlans).toHaveBeenLastCalledWith(`${DOC}:48`);
  });

  it('Adopt as run: a confirmed linear markup on the conduit line (drops 2 × (vertical + makeup)/2, default slack), then applied', async () => {
    get.mockResolvedValue({ data: resp() });
    post.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: { applied: [KEY], skipped: [], save: { lines: [], recap: {} } } });
    const onApplied = vi.fn();
    render(<FeedersPanel bidId="b1" lines={[line()]} setLines={vi.fn()} onApplied={onApplied} />);
    await waitFor(() => screen.getByTestId('lp-feeder-adopt-PANEL B→RTU-1'));
    fireEvent.click(screen.getByTestId('lp-feeder-adopt-PANEL B→RTU-1'));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/estimating/b1/markups/batch');
    expect(body.creates[0]).toMatchObject({ document_id: DOC, page_index: 48, line_key: KEY, kind: 'linear', drops: 2, drop_ft: 8, slack_pct: 10 });
    expect(body.creates[0].points).toHaveLength(3);
    expect(post.mock.calls[1]).toEqual(['/estimating/b1/apply-markups', { line_keys: [KEY] }]);
  });

  it('Adopt waits for a saved estimate; Type length sets the conduit qty as the estimator\'s own', async () => {
    get.mockResolvedValue({ data: resp() });
    const setLines = vi.fn();
    render(<FeedersPanel bidId="b1" lines={[line()]} setLines={setLines} dirty />);
    await waitFor(() => screen.getByTestId('lp-feeder-adopt-PANEL B→RTU-1'));
    expect((screen.getByTestId('lp-feeder-adopt-PANEL B→RTU-1') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('lp-feeder-length-PANEL B→RTU-1'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('lp-feeder-length-set-PANEL B→RTU-1'));
    const next = setLines.mock.calls[0][0]([line()]);
    expect(next[0]).toMatchObject({ qty: 90, qty_overridden: true, qty_source: 'manual' });
    expect(next[0].evidence_note).toMatch(/^Typed feeder run 90 ft for PANEL B → RTU-1/);
  });

  it('B4 — parallel sets: a held (2)4#3/0 lateral types 60 ft as 120 conduit-ft (wire follows at 8 x 60); Adopt is off for 2 sets', async () => {
    const lateral = resp().edges[1];
    const meterWireway = { ...resp().edges[0], id: 'METER→WIREWAY', from: 'METER', to: 'WIREWAY', kind: 'feeder', sets: 2, spec: '2"×2|8#3/0', quantities: { conduitFt: 120, conductors: [{ size: '3/0', ground: false, count: 8, ft: 480 }] } };
    get.mockResolvedValue({ data: resp({ edges: [{ ...lateral, sets: 2 }, meterWireway] }) });
    const setLines = vi.fn();
    const l1 = line({ takeoff_key: 'Feeders (allowance)||MEASURE FEEDER — 2" conduit ×2 (parallel sets), 8#3/0 — XFMR → METER' });
    const lm = line({ id: 'lm', takeoff_key: 'Feeders (allowance)||Feeder — METER → WIREWAY: 2" EMT' });
    render(<FeedersPanel bidId="b1" lines={[l1, lm]} setLines={setLines} />);
    await waitFor(() => screen.getByTestId('lp-feeder-length-XFMR→METER'));
    fireEvent.change(screen.getByTestId('lp-feeder-length-XFMR→METER'), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('lp-feeder-length-set-XFMR→METER'));
    const next = setLines.mock.calls[0][0]([l1, lm]);
    expect(next[0]).toMatchObject({ qty: 120, qty_overridden: true });
    expect(next[0].evidence_note).toMatch(/× 2 parallel sets/);
    const adopt = screen.getByTestId('lp-feeder-adopt-METER→WIREWAY') as HTMLButtonElement;
    expect(adopt.disabled).toBe(true);
    expect(adopt.title).toMatch(/2 parallel sets.*halve the conduit and wire/);
    fireEvent.click(adopt);
    expect(post).not.toHaveBeenCalled();
  });

  it('the calibration checkbox PATCHes the bid with the plain copy shown', async () => {
    get.mockResolvedValue({ data: resp({ edges: [] }) });
    patch.mockResolvedValue({ data: {} });
    render(<FeedersPanel bidId="b1" lines={[]} setLines={vi.fn()} />);
    await waitFor(() => screen.getByTestId('lp-calibration'));
    expect(screen.getByTestId('lp-calibration').textContent).toContain('Calibration job — always add the automatic allowance, default and feeder lines, whatever the stage. Use for test jobs.');
    fireEvent.click(screen.getByTestId('lp-calibration-checkbox'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/bids/b1', { calibration: true }));
  });
});
