// @vitest-environment happy-dom
// UI cleanup round 2B, Task 0 — payload freeze. Each driver clicks through the
// Labor & Pricing UI exactly as an estimator would and captures ONE outgoing
// request. payloadCases.ts holds the exact JSON.stringify body of each, recorded
// from the code BEFORE the round-2B restructure. Later tasks may add steps to a
// driver (e.g. open a card first) but never edit an expected value.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => api.get(...a), post: (...a: unknown[]) => api.post(...a), put: (...a: unknown[]) => api.put(...a), patch: (...a: unknown[]) => api.patch(...a), delete: (...a: unknown[]) => api.delete(...a) } };
});

import { LaborPricingStep } from '../LaborPricingStep';
import { AccubidPricingPanel } from '../AccubidPricingPanel';
import { useEstimatingBid } from '../useEstimatingBid';
import { ConfirmProvider } from '../../../components/ConfirmDialog';
import {
  DEFAULT_SETTINGS, DEFAULT_ACCUBID_SETTINGS, EMPTY_RECAP, EMPTY_ACCUBID_RECAP,
  type EstimateLine, type EstimateSettings, type Library, type PricingRecap, type AccubidBidResponse, type DuplicatePair,
} from '../types';
import type { FeedersResponse } from '../FeedersPanel';
import { CASES } from './payloadCases';

// ── fixtures ────────────────────────────────────────────────────────────────
const K = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const LIBRARY: Library = {
  items: [
    { id: 'i1', code: 'DEV-DUP', name: 'Duplex receptacle', category: 'Branch Power', unit: 'EA', material_cost: 6, material_price_date: null, labor_hours: 0.35, aliases: [], source: 'seed', active: true },
    { id: 'i2', code: 'LTG-TROF', name: 'Troffer 2x4', category: 'Lighting', unit: 'EA', material_cost: 80, material_price_date: null, labor_hours: 0.6, aliases: [], source: 'seed', active: true },
  ],
  assemblies: [{ id: 'a1', code: 'ASM-DUPLEX', name: 'Duplex circuit', category: 'Branch Power', unit: 'EA', aliases: [], source: 'seed', active: true, components: [] }],
  factors: [
    { id: 'f-h1', code: 'HEIGHT-10-14', label: 'Height 10-14', pct: 10, group_key: 'height', active: true },
    { id: 'f-h2', code: 'HEIGHT-14-20', label: 'Height 14-20', pct: 20, group_key: 'height', active: true },
    { id: 'f-h3', code: 'HEIGHT-20-PLUS', label: 'Height 20+', pct: 35, group_key: 'height', active: true },
    { id: 'f-occ', code: 'OCCUPIED', label: 'Occupied building', pct: 15, group_key: 'occupied', active: true },
    { id: 'f-ms', code: 'MULTI-STORY', label: 'Multi-story', pct: 3, group_key: 'multistory', active: true },
  ],
};

const FEEDER1_KEY = 'Feeders (allowance)||Feeder — PANEL B → RTU-1: 3/4" EMT';
const FEEDER2_KEY = 'Feeders (allowance)||Feeder — XFMR → MDP: 3/4" EMT';
const LINES: EstimateLine[] = [
  { id: 'l1', line_key: K(1), category: 'Branch Power', description: 'Duplex', qty: 10, unit: 'EA', item_id: 'i1', takeoff_key: 'Branch Power||Duplex', source: 'takeoff' },
  { id: 'l2', line_key: K(2), category: 'Branch Power', description: 'Some unmatched thing', qty: 3, unit: 'EA', takeoff_key: 'Branch Power||Some unmatched thing', source: 'takeoff' },
  { id: 'l3', line_key: K(3), category: 'Lighting', description: 'Type A troffer', qty: 8, unit: 'EA', item_id: 'i2', match_confidence: 'confirm', match_source: 'auto', takeoff_key: 'Lighting||Type A troffer', source: 'takeoff' },
  { id: 'l4', line_key: K(4), category: 'Branch Power', description: 'Old duplex', qty: 4, unit: 'EA', item_id: 'i1', recheck_run_id: 'r1', takeoff_key: 'Branch Power||Old duplex', source: 'takeoff' },
  { id: 'l5', line_key: K(5), category: 'Feeders (allowance)', description: 'Feeder — PANEL B → RTU-1: 3/4" EMT', qty: 0, unit: 'LF', item_id: 'i1', takeoff_key: FEEDER1_KEY, source: 'takeoff' },
  { id: 'l6', line_key: K(6), category: 'Feeders (allowance)', description: 'Feeder — XFMR → MDP: 3/4" EMT', qty: 0, unit: 'LF', item_id: 'i1', takeoff_key: FEEDER2_KEY, source: 'takeoff' },
];
const L7: EstimateLine = { id: 'l7', line_key: K(7), category: 'Branch Power', description: 'Duplex (new takeoff line)', qty: 10, unit: 'EA', item_id: 'i1', takeoff_key: 'Branch Power||Duplex receptacle', source: 'takeoff' };

function priced(l: EstimateLine, unresolved = false): PricingRecap['lines'][number] {
  return { id: l.id!, category: l.category, description: l.description, qty: l.qty, unit: l.unit, materialUnit: 6, materialExt: 6 * l.qty, hoursUnit: 0.35, hoursExt: 0.35 * l.qty, laborExt: 14 * l.qty, confidence: null, excluded: false, directShare: 20 * l.qty, matchConfidence: null, unresolved };
}
const RECAP: PricingRecap = {
  ...EMPTY_RECAP,
  lines: LINES.map(l => priced(l, l.id === 'l2')),
  categories: [{ category: 'Branch Power', material: 100, hours: 5, labor: 200, subtotal: 300 }],
};

const SETTINGS: EstimateSettings = { ...DEFAULT_SETTINGS, pricing_mode: 'phase_a' };
const ESTIMATE = { lines: LINES, settings: SETTINGS, recap: RECAP, proposed: false, savedGrandTotal: null, duplicates: [] as DuplicatePair[] };
const DUP: DuplicatePair = { keptKey: K(1), keptDescription: 'Duplex', keptQty: 10, newKey: K(7), newDescription: 'Duplex (new takeoff line)', newQty: 10, category: 'Branch Power', unit: 'EA' };
const ESTIMATE_DUP = { ...ESTIMATE, lines: [...LINES, L7], recap: { ...RECAP, lines: [...RECAP.lines, priced(L7)] }, duplicates: [DUP] };

const FEEDERS: FeedersResponse = {
  priced: true, stage: null, calibration: false, slackPct: 10,
  edges: [
    {
      id: 'e1', from: 'PANEL B', to: 'RTU-1', kind: 'feeder', spec: '4#1|3/4" EMT', status: 'estimated', lengthFt: 52, tier: 'suggested', underground: false, sets: 1,
      math: '40 ft run + 6 ft makeup + 10 ft vertical', holds: [], quotes: [],
      endpoints: [{ node: 'PANEL B', located: true, documentId: 'd1', pageIndex: 0 }, { node: 'RTU-1', located: true, documentId: 'd1', pageIndex: 0 }],
      route: { documentId: 'd1', pageIndex: 0, sheetKey: 'E1.1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }] },
      quantities: { conduitFt: 52, conductors: [] }, verticalFt: 10, makeupFt: 6,
    },
    {
      id: 'e2', from: 'XFMR', to: 'MDP', kind: 'feeder', spec: null, status: 'estimated', lengthFt: 80, tier: 'suggested', underground: false, sets: 1,
      math: 'Cross-sheet estimate 80 ft', holds: [], quotes: [],
      endpoints: [{ node: 'XFMR', located: false }, { node: 'MDP', located: false }],
      route: null, quantities: { conduitFt: 80, conductors: [] }, verticalFt: null, makeupFt: null,
    },
  ],
  taps: [], skipped: [], scales: [], summary: { suggested: 2, confirmed: 0, holds: 0 },
};

const ACCUBID: AccubidBidResponse = {
  recap: { ...EMPTY_ACCUBID_RECAP, sellingPrice: 100000, blocksSend: true, budgetPendingQuotes: [{ id: 'q1', description: 'Lighting package', amount: 5000, taxPct: 0, markupPct: 18, status: 'budget_pending', vendor: null, sort: 0 }] },
  settings: DEFAULT_ACCUBID_SETTINGS, totalHours: 100,
  quotes: [
    { id: 'q1', description: 'Lighting package', amount: 5000, taxPct: 0, markupPct: 18, status: 'budget_pending', vendor: null, sort: 0 },
    { id: 'q2', description: 'Switchgear', amount: 4500, taxPct: 0, markupPct: 18, status: 'firm', vendor: null, sort: 1 },
  ],
  costLines: [
    { id: 'eq1', kind: 'equipment', description: 'Scissor lift', amount: 1000, taxPct: 0, sort: 0 },
    { id: 'ge1', kind: 'general_expense', description: 'Permits', amount: 500, taxPct: 0, sort: 0 },
  ],
  alternates: [{ id: 'alt1', kind: 'deduct', description: 'if existing fixtures stay', amount: 800, auto: false, sourceRule: null, sort: 0 }],
  fixturePackageQuestion: { quoteIds: ['q1', 'q2'], fixtureMaterial: 3000, message: 'A vendor quote may be the fixture package.' },
  defaultOptIns: ['equipment'],
};

// ── harness ─────────────────────────────────────────────────────────────────
let estimate: typeof ESTIMATE;
let uuidN = 0;

function StepHarness() {
  const eb = useEstimatingBid('b1');
  if (eb.loading) return null;
  return (
    <ConfirmProvider>
      <LaborPricingStep bidId="b1" lines={eb.lines} settings={eb.settings} recap={eb.recap} saving={eb.saving}
        syncing={eb.syncing} saveError={eb.saveError} dirty={eb.dirty} duplicates={eb.duplicates} setLines={eb.setLines}
        setSettings={eb.setSettings} save={eb.save} syncTakeoff={eb.syncTakeoff} />
    </ConfirmProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  for (const f of Object.values(api)) f.mockReset();
  estimate = ESTIMATE;
  uuidN = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation((() => `uuid-${++uuidN}`) as unknown as typeof crypto.randomUUID);
  api.get.mockImplementation(async (url: string) => {
    if (url === '/estimating/library') return { data: LIBRARY };
    if (url === '/estimating/b1') return { data: estimate };
    if (url === '/estimating/b1/feeders') return { data: FEEDERS };
    if (url === '/estimating/b1/accubid') return { data: ACCUBID };
    throw new Error(`unrouted GET ${url}`);
  });
  api.post.mockImplementation(async (url: string) => {
    if (url === '/estimating/b1/price') return { data: { recap: RECAP } };
    if (url === '/estimating/b1/sync-takeoff') return { data: { added: 0, updated: 0, vanished: 0, lines: LINES, recap: RECAP, duplicates: [] } };
    if (url === '/estimating/b1/apply-markups') return { data: { skipped: [], save: { lines: LINES, recap: RECAP } } };
    return { data: {} };
  });
  api.put.mockImplementation(async (url: string) => (url === '/estimating/b1' ? { data: { recap: RECAP } } : { data: ACCUBID }));
  api.patch.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Method = 'put' | 'post' | 'patch' | 'delete';
interface Call { method: Method; url: string; args: unknown[] }
const callsTo = (method: Method, url: string): Call[] =>
  (api[method].mock.calls as unknown[][]).filter(c => c[0] === url).map(c => ({ method, url, args: c.slice(1) }));
const nth = async (method: Method, url: string, n: number): Promise<Call> => {
  await waitFor(() => expect(callsTo(method, url).length).toBeGreaterThanOrEqual(n + 1), { timeout: 3000 });
  return callsTo(method, url)[n];
};

const num = (el: HTMLElement, v: string | number) => fireEvent.change(el, { target: { value: String(v) } });
const click = (id: string) => fireEvent.click(screen.getByTestId(id));
const field = (rowId: string, f: string) => screen.getByTestId(rowId).querySelector<HTMLInputElement>(`[data-field="${f}"]`)!;

async function mountStep(est: typeof ESTIMATE = estimate) {
  estimate = est;
  render(<StepHarness />);
  await screen.findByTestId('lp-row-0');
}
async function mountAccubid() {
  render(<AccubidPricingPanel bidId="b1" />);
  await screen.findByTestId('accubid-quotes');
}
const savePut = async () => { click('lp-save-button'); return nth('put', '/estimating/b1', 0); };

async function fixtureNo(n: number): Promise<Call> {
  await mountAccubid();
  click('accubid-fixture-package-no');
  return nth('put', `/estimating/b1/accubid/quotes/q${n + 1}`, 0);
}
async function adopt(n: number): Promise<Call> {
  await mountStep();
  await screen.findByTestId('lp-feeder-adopt-e1');
  click('lp-feeder-adopt-e1');
  return n === 0 ? nth('post', '/estimating/b1/markups/batch', 0) : nth('post', '/estimating/b1/apply-markups', 0);
}

// ── drivers: one per CASES key ──────────────────────────────────────────────
const DRIVERS: Record<string, () => Promise<Call>> = {
  saveUntouched: async () => { await mountStep(); return savePut(); },
  saveFactors: async () => {
    await mountStep();
    click('lp-factor-HEIGHT-14-20'); click('lp-factor-OCCUPIED'); click('lp-factor-HEIGHT-20-PLUS');
    num(screen.getByTestId('lp-floors-above-2'), 3);
    click('lp-factor-MULTI-STORY');
    return savePut();
  },
  saveQuickRates: async () => {
    await mountStep();
    num(screen.getByLabelText('Labor rate ($/hr)'), 85);
    num(screen.getByLabelText('Crew size'), 4);
    num(screen.getByLabelText('Material tax %'), 8.5);
    num(screen.getByLabelText('Consumables %'), 2.5);
    num(screen.getByLabelText('Small tools %'), 3.5);
    num(screen.getByLabelText('Supervision %'), 5);
    num(screen.getByLabelText('Overhead %'), 12);
    num(screen.getByLabelText('Profit %'), 22);
    num(screen.getByLabelText('Profit %'), '');
    return savePut();
  },
  saveLineEdits: async () => {
    await mountStep();
    num(field('lp-row-0', 'qty'), 12);
    num(field('lp-row-0', 'material_unit_override'), 7.5);
    num(field('lp-row-0', 'labor_hours_override'), 0.4);
    const reset = field('lp-row-0', 'labor_hours_override').parentElement!.querySelector('button')!;
    expect(reset.textContent).toBe('reset');
    fireEvent.click(reset);
    click('lp-exclude-3');
    return savePut();
  },
  saveManualLine: async () => {
    await mountStep();
    click('lp-add-manual');
    fireEvent.change(field('lp-row-6', 'description'), { target: { value: 'Owner allowance' } });
    num(field('lp-row-6', 'qty'), 2);
    fireEvent.change(screen.getByTestId('lp-evidence-note-6'), { target: { value: 'Owner allowance per spec 26 05 00' } });
    return savePut();
  },
  saveDeleteUndo: async () => {
    await mountStep();
    click('lp-add-manual'); click('lp-delete-6'); click('lp-undo-delete');
    await screen.findByTestId('lp-row-6');
    return savePut();
  },
  saveConfirmMatch: async () => { await mountStep(); click('lp-confirm-match-btn-2'); return savePut(); },
  saveRecheckDone: async () => { await mountStep(); click('lp-recheck-done-3'); return savePut(); },
  saveResolverPick: async () => {
    await mountStep();
    click('lp-resolve-1');
    fireEvent.click(await screen.findByTestId('lp-resolver-candidate-i1'));
    return savePut();
  },
  saveResolverManual: async () => {
    await mountStep();
    click('lp-resolve-1');
    num(await screen.findByTestId('lp-resolver-manual-material'), 15);
    click('lp-resolver-keep-manual');
    return savePut();
  },
  saveFeederTypeLength: async () => {
    await mountStep();
    num(await screen.findByTestId('lp-feeder-length-e1'), 60);
    click('lp-feeder-length-set-e1');
    return savePut();
  },
  saveFeederConfirmLength: async () => {
    await mountStep();
    fireEvent.click(await screen.findByTestId('lp-feeder-confirm-e2'));
    return savePut();
  },
  saveDupKeepBoth: async () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-10-01T12:00:00.000Z');
    await mountStep(ESTIMATE_DUP);
    fireEvent.change(await screen.findByTestId('lp-dup-reason'), { target: { value: 'Two separate rooms with their own outlets' } });
    click('lp-dup-keep-both');
    return savePut();
  },
  saveDupRemoveNew: async () => { await mountStep(ESTIMATE_DUP); fireEvent.click(await screen.findByTestId('lp-dup-remove-new')); return savePut(); },
  switchToAccubid: async () => {
    await mountStep();
    click('lp-switch-pricing-mode');
    fireEvent.click(await screen.findByText('Confirm'));
    return nth('put', '/estimating/b1', 0);
  },
  syncNoBody: async () => { await mountStep(); click('lp-sync-button'); return nth('post', '/estimating/b1/sync-takeoff', 0); },
  livePrice: async () => {
    await mountStep();
    num(field('lp-row-0', 'qty'), 11);
    await waitFor(() => {
      const all = callsTo('post', '/estimating/b1/price');
      const last = all[all.length - 1];
      expect(JSON.stringify(last?.args[0])).toContain('"qty":11');
    }, { timeout: 3000 });
    const all = callsTo('post', '/estimating/b1/price');
    return all[all.length - 1];
  },
  feederAdoptBatch: () => adopt(0),
  feederAdoptApply: () => adopt(1),
  calibrationOn: async () => {
    await mountStep();
    fireEvent.click(await screen.findByTestId('lp-calibration-checkbox'));
    return nth('patch', '/bids/b1', 0);
  },
  acbSettings: async () => {
    await mountAccubid();
    fireEvent.change(screen.getByTestId('accubid-shift'), { target: { value: 'night' } });
    num(screen.getByLabelText('Night journeyman $/hr'), 42);
    num(screen.getByLabelText('Labor overhead %'), 45);
    click('accubid-save-settings');
    return nth('put', '/estimating/b1/accubid/settings', 0);
  },
  acbAddQuote: async () => {
    await mountAccubid();
    const q = within(screen.getByTestId('accubid-quotes'));
    fireEvent.change(q.getByPlaceholderText('Switchgear'), { target: { value: 'Gear' } });
    num(q.getByPlaceholderText('0.00'), 4500);
    click('accubid-add-quote');
    return nth('post', '/estimating/b1/accubid/quotes', 0);
  },
  acbQuoteFirm: async () => {
    await mountAccubid();
    fireEvent.change(screen.getByTestId('accubid-quote-q1').querySelector('select')!, { target: { value: 'firm' } });
    return nth('put', '/estimating/b1/accubid/quotes/q1', 0);
  },
  acbQuoteFixtureFlag: async () => {
    await mountAccubid();
    click('accubid-quote-fixture-package-q2');
    return nth('put', '/estimating/b1/accubid/quotes/q2', 0);
  },
  acbRemoveQuote: async () => {
    await mountAccubid();
    fireEvent.click(within(screen.getByTestId('accubid-quote-q2')).getByText('Remove'));
    return nth('delete', '/estimating/b1/accubid/quotes/q2', 0);
  },
  acbFixtureYes: async () => {
    await mountAccubid();
    click('accubid-fixture-package-yes');
    return nth('put', '/estimating/b1/accubid/quotes/q1', 0);
  },
  acbFixturePickSecond: async () => {
    await mountAccubid();
    fireEvent.change(screen.getByTestId('accubid-fixture-package-pick'), { target: { value: 'q2' } });
    click('accubid-fixture-package-yes');
    return nth('put', '/estimating/b1/accubid/quotes/q2', 0);
  },
  acbFixtureNo1: () => fixtureNo(0),
  acbFixtureNo2: () => fixtureNo(1),
  acbAddEquipment: async () => {
    await mountAccubid();
    const s = within(screen.getByTestId('accubid-costlines-equipment'));
    fireEvent.change(s.getByPlaceholderText('Scissor lift'), { target: { value: 'Boom lift' } });
    num(s.getByPlaceholderText('0.00'), 750);
    fireEvent.click(s.getByText('Add', { selector: 'button' }));
    return nth('post', '/estimating/b1/accubid/cost-lines', 0);
  },
  acbAddGe: async () => {
    await mountAccubid();
    const s = within(screen.getByTestId('accubid-costlines-general_expense'));
    fireEvent.change(s.getByPlaceholderText('Permits'), { target: { value: 'Dumpster' } });
    num(s.getByPlaceholderText('0.00'), 300);
    fireEvent.click(s.getByText('Add', { selector: 'button' }));
    return nth('post', '/estimating/b1/accubid/cost-lines', 0);
  },
  acbCostAmount: async () => {
    await mountAccubid();
    const input = screen.getByTestId('accubid-costline-amount-eq1');
    num(input, 1250);
    fireEvent.blur(input);
    return nth('put', '/estimating/b1/accubid/cost-lines/eq1', 0);
  },
  acbRemoveCostLine: async () => {
    await mountAccubid();
    fireEvent.click(within(screen.getByTestId('accubid-costline-ge1')).getByText('Remove'));
    return nth('delete', '/estimating/b1/accubid/cost-lines/ge1', 0);
  },
  acbUseDefault: async () => {
    await mountAccubid();
    click('accubid-use-default-equipment');
    return nth('post', '/estimating/b1/accubid/cost-lines/use-defaults', 0);
  },
  acbAddAlternate: async () => {
    await mountAccubid();
    const s = within(screen.getByTestId('accubid-alternates'));
    fireEvent.change(screen.getByTestId('accubid-alternates').querySelector('select')!, { target: { value: 'add' } });
    fireEvent.change(s.getByPlaceholderText('if existing office fixtures stay'), { target: { value: 'add a generator' } });
    num(s.getByPlaceholderText('0.00'), 9000);
    click('accubid-add-alternate');
    return nth('post', '/estimating/b1/accubid/alternates', 0);
  },
  acbRemoveAlternate: async () => {
    await mountAccubid();
    fireEvent.click(within(screen.getByTestId('accubid-alternate-alt1')).getByText('Remove'));
    return nth('delete', '/estimating/b1/accubid/alternates/alt1', 0);
  },
  acbFixtureYesViaStep: async () => {
    await mountStep({ ...ESTIMATE, settings: { ...SETTINGS, pricing_mode: 'accubid' } });
    fireEvent.click(await screen.findByTestId('accubid-fixture-package-yes'));
    return nth('put', '/estimating/b1/accubid/quotes/q1', 0);
  },
};

describe('payload freeze', () => {
  it('has a driver for every case and a case for every driver', () => {
    expect(Object.keys(DRIVERS).sort()).toEqual(Object.keys(CASES).sort());
  });

  for (const key of Object.keys(DRIVERS)) {
    it(key, async () => {
      const call = await DRIVERS[key]();
      const want = CASES[key];
      expect(want, `no CASES entry for ${key}`).toBeTruthy();
      expect(call.method).toBe(want.method);
      expect(call.url).toBe(want.url);
      if (want.body === null) {
        expect(call.args.length).toBe(0);
      } else {
        expect(JSON.stringify(call.args[0])).toBe(want.body);
        expect(call.args[0]).toStrictEqual(JSON.parse(want.body));
      }
    });
  }

  it('acbFixtureYesViaStep sends exactly what the standalone panel sends', () => {
    expect(CASES.acbFixtureYesViaStep).toEqual(CASES.acbFixtureYes);
  });
});
