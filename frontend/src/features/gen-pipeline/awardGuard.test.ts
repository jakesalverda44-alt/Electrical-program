// @vitest-environment happy-dom
//
// Awarding a signed proposal must go through countersigning. Countersigning books the
// won job, earns commission, creates the project and supersedes the group's other
// options — so every route to "awarded" has to pass the signature and its warning, not
// just the button we happened to fix last.
//
// These lock the guard that the board's drag-and-drop relies on. The board arrow and the
// drawer's stage button are covered by their own components; this is the one that would
// otherwise silently reopen if nextStageMap or guardMove were edited.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGenPipeline } from './useGenPipeline';
import { Gen } from '../../types';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

function setup(gens: Gen[]) {
  const showToast = vi.fn();
  const setGens = vi.fn();
  const { result } = renderHook(() => useGenPipeline({
    gens, setGens, setWonJobs: vi.fn(), showToast,
  } as unknown as Parameters<typeof useGenPipeline>[0]));
  return { result, showToast, setGens };
}

const base = { id: 'g1', customer: 'Jane', amount: 15000 } as unknown as Gen;

describe('awarding a signed proposal', () => {
  it('is blocked, with a pointer to countersigning, when dragged onto Awarded', () => {
    const gen = { ...base, stage: 'signed', signed_at: '2026-08-04T12:00:00Z' } as Gen;
    const { result, showToast, setGens } = setup([gen]);

    result.current.moveToStage('g1', 'awarded');

    expect(showToast).toHaveBeenCalled();
    expect(showToast.mock.calls[0][0].title).toMatch(/Countersign/i);
    // Nothing may move — the guard has to stop the optimistic update too.
    expect(setGens).not.toHaveBeenCalled();
  });

  it('is allowed once the contract is already executed', () => {
    const gen = {
      ...base, stage: 'signed',
      signed_at: '2026-08-04T12:00:00Z', countersigned_at: '2026-08-04T13:00:00Z',
    } as Gen;
    const { result, showToast } = setup([gen]);

    result.current.moveToStage('g1', 'awarded');

    const blocked = showToast.mock.calls.some(c => /Countersign/i.test(c[0].title));
    expect(blocked).toBe(false);
  });

  it('still lets a paper deal that was never e-signed go straight to Awarded', () => {
    const gen = { ...base, stage: 'sent', signed_at: null } as unknown as Gen;
    const { result, showToast } = setup([gen]);

    result.current.moveToStage('g1', 'awarded');

    const blocked = showToast.mock.calls.some(c => /Countersign/i.test(c[0].title));
    expect(blocked).toBe(false);
  });

  it('keeps blocking a manual move into Signed with no signature on file', () => {
    const gen = { ...base, stage: 'sent', signed_at: null } as unknown as Gen;
    const { result, showToast } = setup([gen]);

    result.current.moveToStage('g1', 'signed');

    expect(showToast.mock.calls[0][0].title).toMatch(/Signed is automatic/i);
  });
});

describe('the advance arrow', () => {
  it('no longer maps signed straight to awarded', () => {
    // advance() on a signed card must do nothing now; the board routes it to the
    // countersign confirmation instead of moving the stage behind the rep's back.
    const gen = { ...base, stage: 'signed', signed_at: '2026-08-04T12:00:00Z' } as Gen;
    const { result, setGens, showToast } = setup([gen]);

    result.current.advance('g1');

    expect(setGens).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('still advances building to sent', () => {
    const gen = { ...base, stage: 'building' } as Gen;
    const { result, setGens } = setup([gen]);

    result.current.advance('g1');

    expect(setGens).toHaveBeenCalled();
  });
});
