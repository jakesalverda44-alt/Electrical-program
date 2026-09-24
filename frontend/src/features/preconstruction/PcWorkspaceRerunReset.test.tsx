// @vitest-environment happy-dom
// Re-run reset + Stop analysis (docs/superpowers/plans/2026-09-24-rerun-reset-report.md).
//
// - "Re-run Analysis" confirms with exactly what is cleared and kept, the
//   server resets atomically with the new run, and every panel shows the
//   fresh state without a page reload (RFIs, Labor & Pricing lines, the
//   autosave payload, results).
// - "Stop analysis": the red button next to the progress bar, the confirm,
//   then "Stopped" with Re-run enabled; live progress replaces the fixed
//   time estimates; Agent 4 and the pre-bid draft can be stopped too.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import BidTab from './PcWorkspace/BidTab';
import PrebidPackagePanel from './PcWorkspace/PrebidPackagePanel';
import { blankWorkspace, PcWorkspace } from './constants';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import { Bid } from '../../types';
import { DEFAULT_SETTINGS, EMPTY_RECAP, type EstimateLine } from '../estimating/types';
import { rerunPlan, RerunConfirmBody } from './PcWorkspace/rerunReset';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset(); });

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const bid: Bid = {
  id: 'b1', name: 'AutoZone #10077', loc: 'Kissimmee, FL', gc: 'Summit GC', due: '', due_days: 0, amount: 23173,
  sheets: 0, contact: 'gc@example.com', stage: 'due', salesperson_name: '',
};

const RFIS: PcWorkspace['rfis'] = [
  { id: '1790000000000.11', question: 'AI: confirm Type A count?', submitted: false, answer: '', origin: 'ai' },
  { id: '1790000000000.22', question: 'AI: already drafted to the GC', submitted: true, answer: '', origin: 'ai' },
  { id: '1790000000003', question: 'Jake: who furnishes the poles?', submitted: false, answer: '', origin: 'manual' },
];

const line = (o: Partial<EstimateLine>): EstimateLine => ({
  category: 'Lighting', description: 'x', qty: 1, unit: 'EA', source: 'takeoff', excluded: false, qty_overridden: false, ...o,
});
const LINES_BEFORE: EstimateLine[] = [
  line({ id: 'l1', line_key: 'k1', description: 'Type B downlight', takeoff_key: 'Lighting||5.2', qty: 12 }),
  line({ id: 'l2', line_key: 'k2', description: 'Type A 2x4 LED troffer', takeoff_key: 'Lighting||5.1', qty: 43, qty_overridden: true, qty_source: 'markup' }),
  line({ id: 'l3', line_key: 'k3', description: 'Generator hookup allowance', source: 'manual', material_unit_override: 1500 }),
];
const LINES_AFTER: EstimateLine[] = [
  { ...LINES_BEFORE[1], recheck_run_id: 'run-2' },
  LINES_BEFORE[2],
];

const DOCS = [
  { id: 'd-plan', name: '1.0 - AZ FULL SET.pdf', display_name: '1.0 - AZ FULL SET.pdf', category: 'plans', file_type: 'application/pdf', generated: false, superseded_at: null },
  { id: 'd-prop', name: 'Proposal - AutoZone.pdf', display_name: 'Proposal - AutoZone.pdf', category: 'proposal', file_type: 'application/pdf', generated: true, superseded_at: null },
];

const RESET = {
  runId: 'run-2', previousRunId: 'run-1',
  cleared: { takeoffLines: 1, suggestedMarkers: 4, aiRfis: 1, supersededDocuments: 1, reviewItems: 3, savedEstimate: true, bidAmount: true },
  kept: { manualLines: 1, recheckLines: 1, confirmedMarkers: 2, unassignedMarkers: 0, rfis: 2 },
  rfis: [RFIS[1], RFIS[2]],
};

function mockApi(opts: { results?: Record<string, unknown> | null; resultsAfterStop?: Record<string, unknown> } = {}) {
  let estimatingCalls = 0;
  let stopped = false;
  get.mockImplementation((url: string) => {
    if (url === `/preconstruction/${bid.id}/results`) {
      return Promise.resolve({ data: stopped && opts.resultsAfterStop ? opts.resultsAfterStop : opts.results ?? null });
    }
    if (url === `/estimating/${bid.id}`) {
      estimatingCalls++;
      const lines = estimatingCalls === 1 ? LINES_BEFORE : LINES_AFTER;
      return Promise.resolve({ data: { lines, settings: DEFAULT_SETTINGS, recap: EMPTY_RECAP, proposed: false, savedGrandTotal: estimatingCalls === 1 ? 23173 : null } });
    }
    if (url === '/documents') return Promise.resolve({ data: DOCS });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockImplementation((url: string) => {
    if (url === '/preconstruction/analyze') return Promise.resolve({ data: { status: 'running', totalFiles: 1, runId: 'run-2', reset: RESET, excludedInputs: [] } });
    if (url === `/estimating/${bid.id}/price`) return Promise.resolve({ data: { recap: EMPTY_RECAP } });
    if (url === `/preconstruction/${bid.id}/stop-analysis`) { stopped = true; return Promise.resolve({ data: { message: 'Stopped by Jake', stopped: { analysis: true, agent4: true, draft: true }, aborted: 1 } }); }
    return Promise.resolve({ data: {} });
  });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
  return { estimatingCalls: () => estimatingCalls };
}

function Harness({ initial }: { initial: Partial<PcWorkspace> }) {
  const [ws, setWs] = useState<PcWorkspace>({ ...blankWorkspace('b1', bid.name, 0), ...initial });
  return (
    <ConfirmProvider>
      <PcWorkspaceView ws={ws} bid={bid} onUpdate={setWs} onBack={() => {}} onConverted={() => {}}
        onBidUpdated={() => {}} showToast={() => {}} embedded />
    </ConfirmProvider>
  );
}

const dialog = () => screen.getByRole('alertdialog');

describe('Re-run Analysis — confirm lists what is cleared and kept; every panel refreshes without a reload', () => {
  it('clears server-side with the run and shows the fresh state in RFIs and Labor & Pricing', async () => {
    const api = mockApi({ results: { status: 'complete', run_id: 'run-1', agent1_output: '{}', agent2_output: '{}', agent3_output: '{}', review_status: 'clear', review_items: [] } });
    render(<Harness initial={{ activeTab: 'files', aiDone: true, rfis: RFIS, scope: { service: '800A' } }}/>);

    // Documents step: pick the plan set; the generated proposal can't be picked.
    const planBox = await screen.findByTestId('project-doc-checkbox-d-plan') as HTMLInputElement;
    const propBox = screen.getByTestId('project-doc-checkbox-d-prop') as HTMLInputElement;
    expect(propBox.disabled).toBe(true);
    expect(screen.getByTestId('project-doc-generated-d-prop').textContent).toBe('Generated');
    fireEvent.click(planBox);
    await waitFor(() => expect(api.estimatingCalls()).toBe(1));

    fireEvent.click(screen.getAllByTestId('est-step-takeoff')[0]);
    fireEvent.click(await screen.findByTestId('rerun-analysis'));

    // The confirm lists exactly what goes and what stays.
    const body = await screen.findByTestId('rerun-confirm-body');
    const clears = within(body).getByTestId('rerun-clears').textContent!;
    const keeps = within(body).getByTestId('rerun-keeps').textContent!;
    expect(clears).toContain('1 AI-imported RFI not yet sent or answered');
    expect(clears).toContain("1 takeoff line in Labor & Pricing you haven't edited");
    expect(clears).toContain('The saved estimate and the bid amount ($23,173)');
    expect(clears).toContain('marked superseded (never deleted)');
    expect(clears).toContain('AI-suggested markers');
    expect(keeps).toContain('1 manual line and 1 takeoff line you edited — flagged “From previous run — re-check”');
    expect(keeps).toContain('2 RFIs you typed, sent or answered');
    expect(keeps).toContain('scope list');
    expect(keeps).toContain('Account rules and pricing settings');
    expect(post).not.toHaveBeenCalledWith('/preconstruction/analyze', expect.anything(), expect.anything());

    fireEvent.click(within(dialog()).getByText('Clear and re-run'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/analyze', expect.any(FormData), expect.anything()));
    const fd = post.mock.calls.find(c => c[0] === '/preconstruction/analyze')![1] as FormData;
    expect(fd.getAll('document_ids')).toEqual(['d-plan']);

    // Labor & Pricing re-hydrated from the server (no reload).
    await waitFor(() => expect(api.estimatingCalls()).toBe(2));

    // The autosave persists the server's RFIs (the cleared AI one is gone).
    await waitFor(() => {
      const puts = put.mock.calls.filter(c => c[0] === `/preconstruction/${bid.id}/workspace`); const last = puts[puts.length - 1];
      expect(last).toBeTruthy();
      expect((last![1] as { rfis: Array<{ question: string }> }).rfis.map(r => r.question)).toEqual([
        'AI: already drafted to the GC', 'Jake: who furnishes the poles?',
      ]);
      expect((last![1] as { scope: object }).scope).toEqual({});
    }, { timeout: 3000 });

    // RFIs panel shows the fresh list.
    fireEvent.click(screen.getAllByTestId('est-step-scope')[0]);
    await screen.findByDisplayValue('Jake: who furnishes the poles?');
    expect(screen.queryByDisplayValue('AI: confirm Type A count?')).toBeNull();

    // Labor & Pricing: the kept line is flagged and can be marked checked.
    fireEvent.click(screen.getAllByTestId('est-step-pricing')[0]);
    expect(await screen.findByTestId('lp-recheck-banner')).toBeTruthy();
    expect(screen.getByTestId('lp-recheck-badge-0').textContent).toContain('From previous run — re-check');
    expect(screen.queryByText('Type B downlight')).toBeNull();
    fireEvent.click(screen.getByTestId('lp-recheck-done-0'));
    await waitFor(() => expect(screen.queryByTestId('lp-recheck-badge-0')).toBeNull());
  });

  it('re-run defaults to the last run\'s inputs: those documents are pre-ticked (generated / missing ones skipped) and stay editable', async () => {
    mockApi({ results: { status: 'complete', run_id: 'run-1', agent2_output: '{}', input_document_ids: ['d-plan', 'd-prop', 'd-gone'] } });
    render(<Harness initial={{ activeTab: 'files', aiDone: true, rfis: RFIS }}/>);
    const planBox = await screen.findByTestId('project-doc-checkbox-d-plan') as HTMLInputElement;
    await waitFor(() => expect(planBox.checked).toBe(true));
    expect((screen.getByTestId('project-doc-checkbox-d-prop') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('1 selected')).toBeTruthy();
    // Editable: untick and tick again — the pre-selection does not come back on its own.
    fireEvent.click(planBox);
    await waitFor(() => expect(planBox.checked).toBe(false));
    fireEvent.click(planBox);
    await waitFor(() => expect(planBox.checked).toBe(true));

    fireEvent.click(screen.getAllByTestId('est-step-takeoff')[0]);
    fireEvent.click(await screen.findByTestId('rerun-analysis'));
    await screen.findByTestId('rerun-confirm-body');
    fireEvent.click(within(dialog()).getByText('Clear and re-run'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/analyze', expect.any(FormData), expect.anything()));
    const fd = post.mock.calls.find(c => c[0] === '/preconstruction/analyze')![1] as FormData;
    expect(fd.getAll('document_ids')).toEqual(['d-plan']);
  });

  it('an unticked pre-selection stays unticked', async () => {
    mockApi({ results: { status: 'complete', run_id: 'run-1', agent2_output: '{}', input_document_ids: ['d-plan'] } });
    render(<Harness initial={{ activeTab: 'files', aiDone: true }}/>);
    const planBox = await screen.findByTestId('project-doc-checkbox-d-plan') as HTMLInputElement;
    await waitFor(() => expect(planBox.checked).toBe(true));
    fireEvent.click(planBox);
    await waitFor(() => expect(planBox.checked).toBe(false));
    await new Promise(r => setTimeout(r, 50));
    expect(planBox.checked).toBe(false);
  });

  it('cancelling the confirm changes nothing', async () => {
    mockApi({ results: { status: 'complete', run_id: 'run-1', agent2_output: '{}' } });
    render(<Harness initial={{ activeTab: 'takeoff', aiDone: true, rfis: RFIS }}/>);
    fireEvent.click(await screen.findByTestId('rerun-analysis'));
    await screen.findByTestId('rerun-confirm-body');
    fireEvent.click(within(dialog()).getByText('Cancel'));
    await waitFor(() => expect(screen.queryByTestId('rerun-confirm-body')).toBeNull());
    expect(post).not.toHaveBeenCalledWith('/preconstruction/analyze', expect.anything(), expect.anything());
  });
});

describe('rerunPlan — mirrors the server rules for the dialog', () => {
  it('counts AI RFIs nobody acted on, untouched takeoff lines, touched and manual lines', () => {
    const plan = rerunPlan({ rfis: RFIS, lines: LINES_BEFORE, savedGrandTotal: 23173, bidAmount: 23173, pricingDirty: true });
    expect(plan).toEqual({ aiRfis: 1, keptRfis: 2, clearedLines: 1, keptTouchedLines: 1, manualLines: 1, amount: 23173, amountCleared: true, scopeCleared: 0, scopeKept: 0, pricingDirty: true, markupUnsaved: false });
    // A pre-migration RFI (no origin) with the import's id shape counts as AI.
    const legacy = rerunPlan({ rfis: [{ id: '1.5', question: 'q', submitted: false, answer: '' }], lines: [], savedGrandTotal: null, bidAmount: null, pricingDirty: false });
    expect(legacy.aiRfis).toBe(1);
  });
});

describe('Stop analysis — button states', () => {
  const baseWs = (o: Partial<PcWorkspace> = {}): PcWorkspace => ({ ...blankWorkspace('b1', bid.name, 0), ...o });

  it('while running: red Stop button next to the progress bar with the live progress label', () => {
    const stop = vi.fn();
    render(<BidTab ws={baseWs({ aiRunning: true, aiLog: ['Agent 1 of 3: reading plans & extracting drawing data…'] })} set={() => {}}
      aiResults={{ status: 'running' }} runAI={() => {}} resumeAI={() => {}} rerunAI={() => {}}
      progress={{ stage: 'agent1', label: 'Agent 1: batch 3 of 14', step: 3, of: 14 }} stopAnalysis={stop} />);
    expect(screen.getByTestId('ai-progress-label').textContent).toBe('Agent 1: batch 3 of 14');
    const btn = screen.getByTestId('stop-analysis');
    expect(btn.textContent).toBe('Stop analysis');
    fireEvent.click(btn);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('rerun-analysis')).toBeNull();
    expect(screen.queryByText(/1–2 min/)).toBeNull();
  });

  it('while stopping: the button is disabled', () => {
    render(<BidTab ws={baseWs({ aiRunning: true })} set={() => {}} aiResults={{ status: 'running' }} runAI={() => {}}
      resumeAI={() => {}} rerunAI={() => {}} stopAnalysis={() => {}} stopping />);
    expect((screen.getByTestId('stop-analysis') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('stop-analysis').textContent).toBe('Stopping…');
  });

  it('after a stop: "Stopped", no Stop button, Re-run enabled', () => {
    const rerun = vi.fn();
    render(<BidTab ws={baseWs({ aiRunning: false })} set={() => {}} aiResults={{ status: 'cancelled', raw_response: 'Stopped by Jake' }}
      runAI={() => {}} resumeAI={() => {}} rerunAI={rerun} stopAnalysis={() => {}} />);
    expect(screen.getByTestId('ai-stopped').textContent).toContain('Stopped — Stopped by Jake');
    expect(screen.queryByTestId('stop-analysis')).toBeNull();
    const run = screen.getByTestId('run-ai-takeoff') as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(run.textContent).toContain('Stopped');
    const re = screen.getByTestId('rerun-analysis') as HTMLButtonElement;
    expect(re.disabled).toBe(false);
    fireEvent.click(re);
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it('end to end: confirm, POST stop-analysis, then Stopped with Re-run', async () => {
    mockApi({
      results: { status: 'agent2_running', run_id: 'run-2', progress: { stage: 'counting', label: 'Counting sheet 2 of 5', step: 2, of: 5 } },
      resultsAfterStop: { status: 'cancelled', run_id: 'run-2', raw_response: 'Stopped by Jake' },
    });
    render(<Harness initial={{ activeTab: 'takeoff' }}/>);
    expect((await screen.findByTestId('ai-progress-label')).textContent).toBe('Counting sheet 2 of 5');
    fireEvent.click(screen.getByTestId('stop-analysis'));
    expect(within(dialog()).getByText("Stops the AI run; you'll need to re-run. Tokens already used are still billed.")).toBeTruthy();
    fireEvent.click(within(dialog()).getByText('Stop'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/stop-analysis`, { what: 'analysis' }));
    expect(await screen.findByTestId('ai-stopped')).toBeTruthy();
    expect(screen.queryByTestId('stop-analysis')).toBeNull();
    expect((screen.getByTestId('rerun-analysis') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Agent 4: a Stop button while the proposal generates, then "stopped"', async () => {
    mockApi({
      results: { status: 'complete', run_id: 'run-2', agent2_output: '{}', review_status: 'clear', agent4_status: 'running' },
      resultsAfterStop: { status: 'complete', run_id: 'run-2', agent2_output: '{}', review_status: 'clear', agent4_status: 'cancelled', agent4_error: 'Stopped by Jake' },
    });
    render(<Harness initial={{ activeTab: 'proposal', aiDone: true }}/>);
    fireEvent.click(await screen.findByTestId('stop-agent4'));
    fireEvent.click(within(dialog()).getByText('Stop'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/stop-analysis`, { what: 'agent4' }));
    expect((await screen.findByTestId('agent4-stopped')).textContent).toContain('Stopped by Jake');
    expect(screen.queryByTestId('stop-agent4')).toBeNull();
  });

  it('pre-bid draft: Stop while composing; afterwards "stopped" and Compose again', () => {
    const stopDraft = vi.fn();
    const props = {
      bid, setAiResults: () => {}, generatePrebidPackage: () => {}, prebidBusy: false, prebidResult: null,
      downloadFiledDocument: () => {}, emailPrebidToChris: () => {}, chrisDraftBusy: false, chrisDraftLink: null, showToast: () => {},
    };
    const { unmount } = render(<PrebidPackagePanel {...props} aiResults={{ status: 'complete', review_status: 'clear', draft_status: 'running', run_id: 'r' }} stopDraft={stopDraft}/>);
    fireEvent.click(screen.getByTestId('stop-draft'));
    expect(stopDraft).toHaveBeenCalledTimes(1);
    unmount();
    render(<PrebidPackagePanel {...props} aiResults={{ status: 'complete', review_status: 'clear', draft_status: 'cancelled', draft_error: 'Stopped by Jake', run_id: 'r' }} stopDraft={stopDraft}/>);
    expect(screen.getByTestId('prebid-draft-stopped').textContent).toContain('Stopped by Jake');
    expect(screen.queryByTestId('stop-draft')).toBeNull();
    expect(screen.getByText('Compose the draft again')).toBeTruthy();
  });
});


// ── Fix round (review 2026-09-24) ───────────────────────────────────────────

describe('fix round B2 — the confirm shows the actual bid amount, cleared only when it is the estimate', () => {
  const base = { rfis: [], lines: [], pricingDirty: false };
  it('a typed amount that differs from the estimate is listed as kept', () => {
    const plan = rerunPlan({ ...base, savedGrandTotal: 23173, bidAmount: 25000 });
    expect(plan).toMatchObject({ amount: 25000, amountCleared: false });
    render(<RerunConfirmBody plan={plan}/>);
    expect(screen.getByTestId('rerun-amount-kept').textContent).toContain('$25,000');
    expect(screen.getByTestId('rerun-amount-cleared').textContent).not.toContain('$');
  });
  it('an amount equal to the estimate (or the Agent 4 price) to the cent is listed as cleared', () => {
    expect(rerunPlan({ ...base, savedGrandTotal: 23173.45, bidAmount: 23173.45 }).amountCleared).toBe(true);
    expect(rerunPlan({ ...base, savedGrandTotal: 23173.45, bidAmount: 23173.46 }).amountCleared).toBe(false);
    const plan = rerunPlan({ ...base, savedGrandTotal: null, agent4Price: 81485.6, bidAmount: 81485.6 });
    render(<RerunConfirmBody plan={plan}/>);
    expect(screen.getByTestId('rerun-amount-cleared').textContent).toContain('bid amount ($81,486) that came from it');
    expect(screen.queryByTestId('rerun-amount-kept')).toBeNull();
  });
  it('S6 — the confirm warns about plan markup still saving', () => {
    render(<RerunConfirmBody plan={rerunPlan({ ...base, savedGrandTotal: null, bidAmount: null, markupUnsaved: true })}/>);
    expect(screen.getByTestId('rerun-markup-warning')).toBeTruthy();
  });
});

describe('fix round S4 / S5 / S1 / S3 in the workspace', () => {
  it('S4 — the reset installs the kept scope sections, flagged; editing one clears its flag', async () => {
    mockApi({ results: { status: 'complete', run_id: 'run-1', agent2_output: '{}' } });
    post.mockImplementation((url: string) => {
      if (url === '/preconstruction/analyze') {
        return Promise.resolve({ data: { status: 'running', totalFiles: 1, runId: 'run-2', excludedInputs: [], reset: {
          ...RESET, scope: { B: 'Jake typed branch power' }, scopeMeta: { ai: {}, recheck: ['B'] }, scopeCleared: ['A'],
        } } });
      }
      if (url === `/estimating/${bid.id}/price`) return Promise.resolve({ data: { recap: EMPTY_RECAP } });
      return Promise.resolve({ data: {} });
    });
    render(<Harness initial={{ activeTab: 'files', aiDone: true, rfis: RFIS,
      scope: { A: 'AI service text', B: 'Jake typed branch power' }, scopeMeta: { ai: { A: 'AI service text' } } }}/>);
    fireEvent.click(await screen.findByTestId('project-doc-checkbox-d-plan'));
    fireEvent.click(screen.getAllByTestId('est-step-takeoff')[0]);
    fireEvent.click(await screen.findByTestId('rerun-analysis'));
    const body = await screen.findByTestId('rerun-confirm-body');
    expect(within(body).getByTestId('rerun-clears').textContent).toContain('1 Scope of Work section the AI filled');
    expect(within(body).getByTestId('rerun-keeps').textContent).toContain('1 Scope of Work section you typed or edited');
    fireEvent.click(within(dialog()).getByText('Clear and re-run'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/analyze', expect.any(FormData), expect.anything()));
    fireEvent.click(screen.getAllByTestId('est-step-scope')[0]);
    expect(await screen.findByTestId('scope-recheck-B')).toBeTruthy();
    expect((screen.getByTestId('scope-text-A') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByTestId('scope-text-B'), { target: { value: 'Jake typed branch power (checked)' } });
    await waitFor(() => expect(screen.queryByTestId('scope-recheck-B')).toBeNull());
  });

  it('S5 — editing an imported AI RFI makes it the estimator\'s own (origin manual)', async () => {
    mockApi({ results: { status: 'complete', run_id: 'run-1', agent2_output: '{}' } });
    render(<Harness initial={{ activeTab: 'rfis', rfis: RFIS }}/>);
    const input = await screen.findByTestId('rfi-question-1790000000000.11');
    fireEvent.change(input, { target: { value: 'Confirm the Type A count on E-2.1 and E-2.2?' } });
    await waitFor(() => {
      const puts = put.mock.calls.filter(c => c[0] === `/preconstruction/${bid.id}/workspace`);
      const last = puts[puts.length - 1];
      expect(last).toBeTruthy();
      const r = (last![1] as { rfis: Array<{ id: string; question: string; origin: string }> }).rfis.find(x => x.id === '1790000000000.11')!;
      expect(r).toMatchObject({ question: 'Confirm the Type A count on E-2.1 and E-2.2?', origin: 'manual' });
    }, { timeout: 3000 });
    // A sent RFI is not editable.
    expect(screen.queryByTestId('rfi-question-1790000000000.22')).toBeNull();
  });

  it('S1 — a person\'s file under the Proposal category is selectable; only generated files are locked', async () => {
    mockApi({ results: null });
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: [
        { id: 'd-user', name: 'GC sketch.pdf', display_name: 'GC sketch.pdf', category: 'proposal', file_type: 'application/pdf', generated: false },
        DOCS[1],
      ] });
      return Promise.resolve({ data: null });
    });
    render(<Harness initial={{ activeTab: 'files' }}/>);
    const user = await screen.findByTestId('project-doc-checkbox-d-user') as HTMLInputElement;
    expect(user.disabled).toBe(false);
    expect(screen.queryByTestId('project-doc-generated-d-user')).toBeNull();
    expect((screen.getByTestId('project-doc-checkbox-d-prop') as HTMLInputElement).disabled).toBe(true);
  });

  it('S3 — a stop that arrives after the run finished: no "Stopped", the run is left to complete', async () => {
    mockApi({ results: { status: 'agent3_running', run_id: 'run-2', progress: { stage: 'agent3', label: 'Agent 3 of 3: QA review & risk assessment', step: 1, of: 1 } } });
    post.mockImplementation((url: string) => {
      if (url === `/preconstruction/${bid.id}/stop-analysis`) {
        return Promise.reject({ response: { status: 409, data: { error: 'The analysis has already finished — nothing to stop.', alreadyFinished: true } } });
      }
      return Promise.resolve({ data: {} });
    });
    render(<Harness initial={{ activeTab: 'takeoff' }}/>);
    fireEvent.click(await screen.findByTestId('stop-analysis'));
    fireEvent.click(within(dialog()).getByText('Stop'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/stop-analysis`, { what: 'analysis' }));
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByTestId('ai-stopped')).toBeNull();
    expect(screen.getByTestId('stop-analysis')).toBeTruthy(); // still running as far as the UI knows; the poller applies "complete"
  });
});
