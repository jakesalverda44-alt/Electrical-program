// @vitest-environment happy-dom
// Audit code #6 (High) — the workspace autosave ended in `.catch(() => {})`,
// and it is the ONLY persistence for estimator notes, scope text and RFIs, so a
// dropped connection lost an afternoon of pre-construction work with no
// indication at all.
// Audit data #5 (High) — the results poll is a recursive setTimeout whose
// continuation runs after an `await`; the cleanup cleared only the pending
// timeout, so unmounting mid-flight let the continuation schedule a new timeout
// nothing owned: an un-cancellable request every 3s for the rest of the
// session, with no elapsed cap either.
// Audit data #16 — the autosave effect had no first-run guard, so every open
// wrote a no-op PUT 800ms later.
//
// These use fake timers throughout (the debounce is 800ms and the backoff runs
// to 8s), so element lookups are synchronous `getBy*` after an explicit
// microtask flush rather than `findBy*`/`waitFor`, which stall under them.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace, PcWorkspace } from './constants';
import { Bid } from '../../types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
  id: 'b1', name: 'Circle K #4521', loc: '1234 Main St', gc: 'ABC Construction', due: '', due_days: 0,
  amount: null, sheets: 0, contact: 'gc@example.com', stage: 'due', salesperson_name: '',
};

const RESULTS_URL = `/preconstruction/${bid.id}/results`;
const WORKSPACE_URL = `/preconstruction/${bid.id}/workspace`;
const NOTES_PLACEHOLDER = 'Add notes, reminders, or key info about this bid…';

function mockApi(results: Record<string, unknown> | null = {}) {
  get.mockImplementation((url: string) => {
    if (url === RESULTS_URL) return Promise.resolve({ data: results });
    if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
    if (url === `/preconstruction/${bid.id}/takeoff`) return Promise.resolve({ data: null });
    if (url === `/preconstruction/intelligence/${bid.id}`) return Promise.resolve({ data: null });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

const offline = () => Object.assign(new Error('offline'), { isAxiosError: true, code: 'ERR_NETWORK' });

function Harness() {
  const [ws, setWs] = useState<PcWorkspace>({ ...blankWorkspace('b1', 'Circle K #4521', 0), activeTab: 'overview' });
  return (
    <PcWorkspaceView
      ws={ws}
      bid={bid}
      onUpdate={setWs}
      onBack={() => {}}
      onConverted={() => {}}
      onBidUpdated={() => {}}
      showToast={() => {}}
      embedded
    />
  );
}

/**
 * The app really renders inside `<React.StrictMode>` (main.tsx) and Jake runs
 * the live app under Vite dev, so dev's mount -> unmount -> remount is the
 * environment task 7 has to work in. Review finding B2: it did not.
 */
function StrictHarness() {
  return <React.StrictMode><Harness/></React.StrictMode>;
}

/** Flush pending promise callbacks without moving the clock. */
const flush = () => act(async () => {});
/** Move the clock, then let everything it woke up settle. */
async function tick(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
  await flush();
}

const workspacePuts = () => put.mock.calls.filter(c => c[0] === WORKSPACE_URL);
const resultsGets = () => get.mock.calls.filter(c => c[0] === RESULTS_URL).length;
const saveChip = () => screen.getByTestId('pc-save-state').textContent;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  del.mockReset();
  vi.useFakeTimers();
});

describe('PcWorkspace autosave', () => {
  it('does not write a no-op PUT just for opening the workspace', async () => {
    mockApi();
    render(<Harness/>);

    // Well past the 800ms debounce.
    await tick(3000);

    expect(workspacePuts()).toHaveLength(0);
  });

  it('saves an edit and shows "Saved"', async () => {
    mockApi();
    render(<Harness/>);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(NOTES_PLACEHOLDER), {
      target: { value: 'Panel schedule needs verifying' },
    });
    await tick(900);

    expect(workspacePuts()).toHaveLength(1);
    expect(workspacePuts()[0][1]).toMatchObject({ notes: 'Panel schedule needs verifying' });
    expect(saveChip()).toBe('Saved');
  });

  it('shows the error chip and retries with backoff when the PUT fails', async () => {
    mockApi();
    put.mockRejectedValue(offline());
    render(<Harness/>);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(NOTES_PLACEHOLDER), { target: { value: 'an afternoon of work' } });
    await tick(900);

    expect(workspacePuts()).toHaveLength(1);
    expect(saveChip()).toBe('Not saved — retrying');

    // 2s, then 4s, then 8s — a retry, not a tight loop.
    await tick(1900);
    expect(workspacePuts()).toHaveLength(1);
    await tick(200);
    expect(workspacePuts()).toHaveLength(2);

    await tick(3900);
    expect(workspacePuts()).toHaveLength(2);
    await tick(200);
    expect(workspacePuts()).toHaveLength(3);

    // And it recovers on its own once the server comes back.
    put.mockResolvedValue({ data: {} });
    await tick(8100);
    expect(workspacePuts()).toHaveLength(4);
    expect(saveChip()).toBe('Saved');
  });

  it('a retry sends the current text, not the text that failed', async () => {
    mockApi();
    put.mockRejectedValue(offline());
    render(<Harness/>);
    await flush();

    const notes = screen.getByPlaceholderText(NOTES_PLACEHOLDER);
    fireEvent.change(notes, { target: { value: 'first' } });
    await tick(900);
    expect(workspacePuts()[0][1]).toMatchObject({ notes: 'first' });

    // Typing again while a retry is pending supersedes it.
    fireEvent.change(notes, { target: { value: 'first and second' } });
    await tick(900);

    const last = workspacePuts()[workspacePuts().length - 1][1];
    expect(last).toMatchObject({ notes: 'first and second' });
  });

  it('stops retrying once the workspace is unmounted', async () => {
    mockApi();
    put.mockRejectedValue(offline());
    const { unmount } = render(<Harness/>);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(NOTES_PLACEHOLDER), { target: { value: 'x' } });
    await tick(900);
    expect(workspacePuts()).toHaveLength(1);

    unmount();
    await tick(60_000);

    expect(workspacePuts()).toHaveLength(1);
  });
});

describe('PcWorkspace results poll', () => {
  /** A pipeline that never leaves 'running' — the shape that polled forever. */
  const stuckRunning = () => mockApi({ status: 'running' });

  it('schedules nothing more when the component unmounts mid-flight', async () => {
    // The bug is specifically about unmounting while the poll's `await` is
    // pending: clearing the timeout (which the old cleanup did) does nothing
    // for a continuation that has already been entered, and that continuation
    // scheduled a fresh timeout nothing owned. So the second /results call is
    // held open until after the unmount.
    let releaseSecond!: (v: unknown) => void;
    const second = new Promise(res => { releaseSecond = res; });
    let call = 0;
    get.mockImplementation((url: string) => {
      if (url === RESULTS_URL) {
        call += 1;
        return call === 1 ? Promise.resolve({ data: { status: 'running' } }) : second;
      }
      if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
      if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
      if (url === '/documents') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });
    put.mockResolvedValue({ data: {} });
    post.mockResolvedValue({ data: {} });

    const { unmount } = render(<Harness/>);
    // The reconnect read lands, sees 'running', and starts the loop.
    await flush();
    await tick(3100);
    const callsAtUnmount = resultsGets();
    expect(callsAtUnmount).toBe(2);

    // Unmount with that second request still in flight, then let it resolve.
    unmount();
    releaseSecond({ data: { status: 'running' } });
    // Let the continuation run (this is where it used to schedule an orphan),
    // and only then move the clock far enough for that timeout to fire.
    await flush();
    await tick(30_000);

    expect(resultsGets()).toBe(callsAtUnmount);
  });

  it('stops at the 10-minute deadline and says the analysis timed out', async () => {
    stuckRunning();
    render(<Harness/>);
    await flush();
    await tick(3100);
    expect(screen.queryByTestId('pc-poll-timeout')).toBeNull();

    // Jump past the deadline rather than running 200 real ticks: the loop only
    // reschedules once its await settles, so no ticks are skipped.
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await tick(3100);

    expect(screen.getByTestId('pc-poll-timeout').textContent).toContain('Analysis timed out');

    const callsAtTimeout = resultsGets();
    await tick(60_000);
    expect(resultsGets()).toBe(callsAtTimeout);
  });
});

// Review finding B2 — every assertion above, re-run in the environment the
// plan says the live app actually runs in. Before the fix all four failed:
// `aliveRef` was only ever set false (by the simulated unmount's cleanup) and
// never re-armed, so `saveWorkspace` early-returned forever; and the boolean
// mount guard was consumed by the first mount, so the remount wrote the very
// no-op PUT it existed to prevent.
describe('PcWorkspace autosave under React.StrictMode', () => {
  it('still writes no PUT just for opening the workspace', async () => {
    mockApi();
    render(<StrictHarness/>);

    await tick(3000);

    expect(workspacePuts()).toHaveLength(0);
  });

  it('still reaches "Saved" after a successful save', async () => {
    mockApi();
    render(<StrictHarness/>);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(NOTES_PLACEHOLDER), { target: { value: 'survives the double mount' } });
    await tick(900);

    expect(workspacePuts()).toHaveLength(1);
    expect(workspacePuts()[0][1]).toMatchObject({ notes: 'survives the double mount' });
    expect(saveChip()).toBe('Saved');
  });

  it('still reaches "Not saved — retrying" and still retries after the backoff', async () => {
    mockApi();
    put.mockRejectedValue(offline());
    render(<StrictHarness/>);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(NOTES_PLACEHOLDER), { target: { value: 'an afternoon of work' } });
    await tick(900);

    expect(workspacePuts()).toHaveLength(1);
    expect(saveChip()).toBe('Not saved — retrying');

    // The 2s retry — the one that was never firing.
    await tick(1900);
    expect(workspacePuts()).toHaveLength(1);
    await tick(200);
    expect(workspacePuts()).toHaveLength(2);

    // And it still recovers on its own.
    put.mockResolvedValue({ data: {} });
    await tick(4100);
    expect(saveChip()).toBe('Saved');
  });

  it('reaches saveState "error", which is what arms the unsaved-changes guard', async () => {
    // useUnsavedGuard(pricingDirty || saveState === 'error') was the fallback
    // the struck pricing decision leaned on; a chip stuck on "Saving…" meant it
    // never armed.
    mockApi();
    put.mockRejectedValue(offline());
    render(<StrictHarness/>);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(NOTES_PLACEHOLDER), { target: { value: 'unsaved' } });
    await tick(900);

    expect(saveChip()).toBe('Not saved — retrying');
  });
});
