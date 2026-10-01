// @vitest-environment happy-dom
// UI cleanup round 1 — Scope step: collapsed empty sections, AI draft tag,
// "Fill from…" menu, scopeMeta keys never dropped.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ScopeTab from './ScopeTab';
import { blankWorkspace, PcWorkspace } from '../constants';
import type { PrebidSection } from '../prebidScope';
import type { SetWorkspace } from './shared';

afterEach(cleanup);

const AGENT2 = JSON.stringify({ scopeOfWork: { A_ServiceDistribution: ['Furnish 200A service'], B_BranchPower: ['Branch circuits'] } });
const PREBID: PrebidSection[] = [{ id: 'p1', title: 'Service & Distribution', items: ['Pre-bid service item'] }];

function Harness({ initial = {}, agent2, prebid = [], running, patches }: {
  initial?: Partial<PcWorkspace>; agent2?: string; prebid?: PrebidSection[]; running?: boolean; patches?: Array<Partial<PcWorkspace>>;
}) {
  const [ws, setWs] = useState<PcWorkspace>({ ...blankWorkspace('b1', 'Bid', 0), ...initial });
  const set: SetWorkspace = patchOrFn => {
    const patch = typeof patchOrFn === 'function' ? patchOrFn(ws) : patchOrFn;
    patches?.push(patch);
    setWs(prev => ({ ...prev, ...patch }));
  };
  return <ScopeTab ws={ws} set={set} aiResults={(agent2 ? { agent2_output: agent2 } : null) as never}
    prebidSections={prebid} showToast={vi.fn()} analysisRunning={running}/>;
}

describe('ScopeTab — collapsed sections', () => {
  it('all empty with no sources: empty state, 7 add rows, no textareas', () => {
    render(<Harness/>);
    expect(screen.getByTestId('scope-empty').textContent).toContain('Nothing imported yet');
    expect(document.querySelectorAll('[data-testid^="scope-add-"]')).toHaveLength(7);
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('a section with text is shown, never collapsed', () => {
    render(<Harness initial={{ scope: { A: 'service text' } }}/>);
    expect(screen.getByTestId('scope-text-A')).toBeTruthy();
    expect(screen.queryByTestId('scope-add-A')).toBeNull();
    expect(screen.queryByTestId('scope-empty')).toBeNull();
  });

  it('whitespace-only text counts as empty', () => {
    render(<Harness initial={{ scope: { A: '   \n ' } }}/>);
    expect(screen.getByTestId('scope-add-A')).toBeTruthy();
  });

  it('adding opens + focuses the section, and clearing it while typing keeps it visible', () => {
    render(<Harness/>);
    fireEvent.click(screen.getByTestId('scope-add-C'));
    const ta = screen.getByTestId('scope-text-C') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    fireEvent.change(ta, { target: { value: 'lighting' } });
    fireEvent.change(screen.getByTestId('scope-text-C'), { target: { value: '' } });
    expect(screen.getByTestId('scope-text-C')).toBeTruthy();
  });

  it('empty-state hint reflects running vs no sources vs sources', () => {
    const { unmount } = render(<Harness running/>);
    expect(screen.getByTestId('scope-empty').textContent).toContain('still running');
    unmount();
    render(<Harness agent2={AGENT2}/>);
    expect(screen.getByTestId('scope-empty').textContent).toContain('Fill from…');
  });
});

describe('ScopeTab — AI draft tag', () => {
  it('shows while the text matches scopeMeta.ai and clears on edit', () => {
    render(<Harness initial={{ scope: { A: 'AI text' }, scopeMeta: { ai: { A: 'AI text' } } }}/>);
    expect(screen.getByTestId('scope-ai-draft-A')).toBeTruthy();
    fireEvent.change(screen.getByTestId('scope-text-A'), { target: { value: 'AI text, edited by Jake' } });
    expect(screen.queryByTestId('scope-ai-draft-A')).toBeNull();
  });

  it('falls back to the agent2 output when scopeMeta.ai is empty', () => {
    render(<Harness agent2={AGENT2} initial={{ scope: { A: 'Furnish 200A service' }, scopeMeta: { ai: {}, recheck: [] } }}/>);
    expect(screen.getByTestId('scope-ai-draft-A')).toBeTruthy();
  });

  it('never tags pre-bid text', () => {
    render(<Harness initial={{ scope: { A: '• Pre-bid service item' }, scopeMeta: { ai: {} } }}/>);
    expect(screen.queryByTestId('scope-ai-draft-A')).toBeNull();
  });
});

describe('ScopeTab — Fill from… menu', () => {
  it('toggles aria-expanded', () => {
    render(<Harness/>);
    const btn = screen.getByTestId('scope-fill-menu-button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('with no sources both items are disabled with the right sub-lines', () => {
    const { unmount } = render(<Harness/>);
    fireEvent.click(screen.getByTestId('scope-fill-menu-button'));
    expect((screen.getByTestId('scope-fill-prebid') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('scope-fill-prebid').textContent).toContain('No pre-bid package on this bid yet');
    expect(screen.getByTestId('scope-fill-ai').textContent).toContain('Finish the Takeoff step first');
    unmount();
    render(<Harness running/>);
    fireEvent.click(screen.getByTestId('scope-fill-menu-button'));
    expect(screen.getByTestId('scope-fill-ai').textContent).toContain('The takeoff is still running');
  });

  it('choosing the pre-bid item fills A and closes the menu', () => {
    render(<Harness prebid={PREBID}/>);
    fireEvent.click(screen.getByTestId('scope-fill-menu-button'));
    fireEvent.click(screen.getByTestId('scope-fill-prebid'));
    expect((screen.getByTestId('scope-text-A') as HTMLTextAreaElement).value).toContain('Pre-bid service item');
    expect(screen.queryByTestId('scope-fill-menu')).toBeNull();
  });

  it('Escape closes and focuses the trigger', () => {
    render(<Harness prebid={PREBID}/>);
    const btn = screen.getByTestId('scope-fill-menu-button');
    fireEvent.click(btn);
    fireEvent.keyDown(screen.getByTestId('scope-fill-prebid'), { key: 'Escape' });
    expect(screen.queryByTestId('scope-fill-menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('opening focuses the first enabled item and ArrowDown wraps between enabled items', () => {
    render(<Harness prebid={PREBID} agent2={AGENT2}/>);
    fireEvent.click(screen.getByTestId('scope-fill-menu-button'));
    expect(document.activeElement).toBe(screen.getByTestId('scope-fill-prebid'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('scope-fill-ai'));
  });

  it('a click outside closes it', () => {
    render(<Harness/>);
    fireEvent.click(screen.getByTestId('scope-fill-menu-button'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('scope-fill-menu')).toBeNull();
  });
});

describe('ScopeTab — scopeMeta keys are preserved by every writer', () => {
  it('typing and both imports keep noRfis and aiRfisImported', () => {
    const patches: Array<Partial<PcWorkspace>> = [];
    render(<Harness patches={patches} agent2={AGENT2} prebid={PREBID}
      initial={{ scopeMeta: { ai: {}, recheck: [], noRfis: true, aiRfisImported: true } }}/>);
    fireEvent.click(screen.getByTestId('scope-add-D'));
    fireEvent.change(screen.getByTestId('scope-text-D'), { target: { value: 'typed' } });
    fireEvent.click(screen.getByTestId('scope-fill-menu-button'));
    fireEvent.click(screen.getByTestId('scope-fill-ai'));
    fireEvent.click(screen.getByTestId('scope-fill-menu-button'));
    fireEvent.click(screen.getByTestId('scope-fill-prebid'));
    expect(patches).toHaveLength(3);
    for (const p of patches) {
      expect(p.scopeMeta?.noRfis).toBe(true);
      expect(p.scopeMeta?.aiRfisImported).toBe(true);
    }
  });
});
