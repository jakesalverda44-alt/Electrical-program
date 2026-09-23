// @vitest-environment happy-dom
// Estimating Phase B, Task 6 — ItemsPanel.tsx: statuses, apply flow
// payload/confirm contents.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ConfirmProvider } from '../../../components/ConfirmDialog';
import ItemsPanel from './ItemsPanel';
import { EstimateLine, RollupEntry } from '../types';

afterEach(cleanup);

function line(over: Partial<EstimateLine> = {}): EstimateLine {
  return { category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', source: 'takeoff', line_key: 'k1', ...over };
}
function rollup(over: Partial<RollupEntry> = {}): RollupEntry {
  return {
    lineKey: 'k1', markedQty: null, markerCount: 0, sheets: [], incompatibleCount: 0, missingScaleCount: 0,
    category: 'Branch Power', description: 'Duplex receptacle', unit: 'EA', currentQty: 10, qtySource: 'takeoff', aiQty: 10,
    ...over,
  };
}

function setup(props: Partial<React.ComponentProps<typeof ItemsPanel>> = {}) {
  const onApplyLines = vi.fn().mockResolvedValue(undefined);
  const onSelectLine = vi.fn();
  const onToggle = vi.fn();
  render(
    <ConfirmProvider>
      <ItemsPanel
        lines={[line()]}
        rollup={[rollup()]}
        activeLineKey={null}
        onSelectLine={onSelectLine}
        onApplyLines={onApplyLines}
        showOnlyActiveLine={false}
        onToggleShowOnlyActiveLine={onToggle}
        {...props}
      />
    </ConfirmProvider>
  );
  return { onApplyLines, onSelectLine, onToggle };
}

describe('ItemsPanel — statuses and grouping', () => {
  it('groups lines under their category header', () => {
    setup();
    expect(screen.getByText('Branch Power')).toBeTruthy();
  });

  it('shows "Not marked" when the line has no rollup entry', () => {
    setup({ rollup: [] });
    expect(screen.getByText('Not marked')).toBeTruthy();
  });

  it('shows "Matches" when markedQty equals current qty', () => {
    setup({ rollup: [rollup({ markedQty: 10 })] });
    expect(screen.getByText('Matches')).toBeTruthy();
  });

  it('shows "Differs" when markedQty differs from current qty, with an Apply button', () => {
    setup({ rollup: [rollup({ markedQty: 24 })] });
    expect(screen.getByText('Differs')).toBeTruthy();
    expect(screen.getByText('Apply marked qty')).toBeTruthy();
  });

  it('shows "Applied" when the line\'s qty_source is markup, with no Apply button', () => {
    setup({ lines: [line({ qty_source: 'markup' })], rollup: [rollup({ markedQty: 10 })] });
    expect(screen.getByText('Applied')).toBeTruthy();
    expect(screen.queryByText('Apply marked qty')).toBeNull();
  });

  it('shows AI/marked/current qty values', () => {
    setup({ rollup: [rollup({ aiQty: 10, markedQty: 24 })] });
    expect(screen.getByText('AI 10')).toBeTruthy();
    expect(screen.getByText('Marked 24')).toBeTruthy();
    expect(screen.getByText(/Current 10/)).toBeTruthy();
  });

  it('shows a "Marked on N sheets" note when the rollup has sheet contributions', () => {
    setup({ rollup: [rollup({ markedQty: 24, sheets: [{ documentId: 'd1', pageIndex: 0, markerCount: 24 }] })] });
    expect(screen.getByText('Marked on 1 sheet')).toBeTruthy();
  });

  // Fix round 1 / B6 — the reviewer's exact failure scenario: 20 applied,
  // 6 more fixtures found and marked later (26 total) — the row must NOT
  // stay stuck reading "Applied" with no way to re-apply the new count.
  it('shows "Changed since applied", WITH an Apply button, when a markup-applied line\'s rollup has since diverged from its qty', () => {
    setup({ lines: [line({ qty: 20, qty_source: 'markup' })], rollup: [rollup({ markedQty: 26 })] });
    expect(screen.getByText('Changed since applied')).toBeTruthy();
    expect(screen.getByText('Apply marked qty')).toBeTruthy();
    expect(screen.queryByText('Applied')).toBeNull();
  });

  it('"Apply all that differ" counts a changed_since_applied line, not just a never-applied "differs" one', () => {
    setup({ lines: [line({ qty: 20, qty_source: 'markup' })], rollup: [rollup({ markedQty: 26 })] });
    expect(screen.getByText('Apply all that differ (1)')).toBeTruthy();
  });

  it('per-line Apply on a changed_since_applied line sends its own line_key, same as any other unapplied line', async () => {
    const { onApplyLines } = setup({ lines: [line({ qty: 20, qty_source: 'markup' })], rollup: [rollup({ markedQty: 26 })] });
    fireEvent.click(screen.getByText('Apply marked qty'));
    await waitFor(() => expect(onApplyLines).toHaveBeenCalledWith(['k1']));
  });
});

describe('ItemsPanel — selection and show-only-active-line', () => {
  it('clicking a row calls onSelectLine with its line_key', () => {
    const { onSelectLine } = setup();
    fireEvent.click(screen.getByTestId('line-k1'));
    expect(onSelectLine).toHaveBeenCalledWith('k1');
  });

  it('marks the active line with the "active" class', () => {
    setup({ activeLineKey: 'k1' });
    expect(screen.getByTestId('line-k1').className).toContain('active');
  });

  it('hides non-active lines when showOnlyActiveLine is true', () => {
    setup({
      lines: [line({ line_key: 'k1', description: 'Line A' }), line({ line_key: 'k2', description: 'Line B' })],
      rollup: [rollup({ lineKey: 'k1' }), rollup({ lineKey: 'k2' })],
      activeLineKey: 'k1',
      showOnlyActiveLine: true,
    });
    expect(screen.getByText('Line A')).toBeTruthy();
    expect(screen.queryByText('Line B')).toBeNull();
  });

  it('toggling the checkbox calls onToggleShowOnlyActiveLine', () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByLabelText('Show only this line'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('ItemsPanel — apply flow', () => {
  it('per-line "Apply marked qty" calls onApplyLines with just that line_key', async () => {
    const { onApplyLines } = setup({ rollup: [rollup({ markedQty: 24 })] });
    fireEvent.click(screen.getByText('Apply marked qty'));
    await waitFor(() => expect(onApplyLines).toHaveBeenCalledWith(['k1']));
  });

  it('"Apply all that differ" is disabled when nothing differs', () => {
    setup({ rollup: [rollup({ markedQty: 10 })] }); // matches, not differs
    const btn = screen.getByText('Apply all that differ') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('"Apply all that differ" opens a confirm dialog listing each change old -> new', async () => {
    setup({
      lines: [line({ line_key: 'k1', description: 'Duplex receptacle', qty: 10 })],
      rollup: [rollup({ lineKey: 'k1', markedQty: 24 })],
    });
    fireEvent.click(screen.getByText('Apply all that differ (1)'));
    await waitFor(() => expect(screen.getByText(/Duplex receptacle: 10 → 24 EA/)).toBeTruthy());
  });

  it('confirming "Apply all that differ" calls onApplyLines with every differing line_key', async () => {
    const { onApplyLines } = setup({
      lines: [
        line({ line_key: 'k1', description: 'Line A', qty: 10 }),
        line({ line_key: 'k2', description: 'Line B', qty: 5, category: 'Grounding' }),
      ],
      rollup: [
        rollup({ lineKey: 'k1', markedQty: 24 }),
        rollup({ lineKey: 'k2', markedQty: 8, category: 'Grounding', description: 'Line B' }),
      ],
    });
    fireEvent.click(screen.getByText(/Apply all that differ/));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    fireEvent.click(screen.getByText('Apply', { selector: 'button.btn:not(.ghost)' }));
    await waitFor(() => expect(onApplyLines).toHaveBeenCalledWith(expect.arrayContaining(['k1', 'k2'])));
  });

  it('cancelling the confirm dialog does not call onApplyLines', async () => {
    const { onApplyLines } = setup({ rollup: [rollup({ markedQty: 24 })] });
    fireEvent.click(screen.getByText('Apply all that differ (1)'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel'));
    expect(onApplyLines).not.toHaveBeenCalled();
  });

  it('includes the $ impact preview in the confirm body when previewPriceImpact resolves', async () => {
    const previewPriceImpact = vi.fn().mockResolvedValue(1234.5);
    setup({ rollup: [rollup({ markedQty: 24 })], previewPriceImpact });
    fireEvent.click(screen.getByText('Apply all that differ (1)'));
    await waitFor(() => expect(screen.getByText(/\$1,234\.50 to the estimate/)).toBeTruthy());
  });
});

describe('ItemsPanel — "Suggest markers" per line (Task 7, deferral closed)', () => {
  it('is hidden entirely when onSuggestMarkersForLine is not provided', () => {
    setup();
    expect(screen.queryByText('Suggest markers')).toBeNull();
  });

  it('shows a "Suggest markers" button per line with a line_key, and calls back with that line', () => {
    const onSuggestMarkersForLine = vi.fn();
    setup({ onSuggestMarkersForLine });
    fireEvent.click(screen.getByText('Suggest markers'));
    expect(onSuggestMarkersForLine).toHaveBeenCalledWith(line());
  });

  it('is hidden for a line with no line_key (nothing to attach a suggestion to yet)', () => {
    const onSuggestMarkersForLine = vi.fn();
    setup({ lines: [line({ line_key: undefined })], onSuggestMarkersForLine });
    expect(screen.queryByText('Suggest markers')).toBeNull();
  });

  it('clicking it does not also select the line (stopPropagation, same as the other row actions)', () => {
    const onSuggestMarkersForLine = vi.fn();
    const onSelectLine = vi.fn();
    setup({ onSuggestMarkersForLine, onSelectLine });
    fireEvent.click(screen.getByText('Suggest markers'));
    expect(onSelectLine).not.toHaveBeenCalled();
  });
});

describe('ItemsPanel — unassigned-markers bucket (Task 6, deferral closed)', () => {
  it('is absent when unassignedMarkers is omitted or empty', () => {
    setup();
    expect(screen.queryByTestId('unassigned-markers-bucket')).toBeNull();
    setup({ unassignedMarkers: [] });
    expect(screen.queryByTestId('unassigned-markers-bucket')).toBeNull();
  });

  it('shows the total unassigned count in the header, and each sheet as its own row', () => {
    setup({ unassignedMarkers: [
      { sheetKey: 'doc-1:0', label: 'E1.1 Lighting Plan', count: 2 },
      { sheetKey: 'doc-1:1', label: 'E1.2 Power Plan', count: 1 },
    ] });
    expect(screen.getByText('Unassigned markers (3)')).toBeTruthy();
    expect(screen.getByText('E1.1 Lighting Plan')).toBeTruthy();
    expect(screen.getByText('2 unassigned')).toBeTruthy();
    expect(screen.getByText('E1.2 Power Plan')).toBeTruthy();
  });

  it('"Jump to sheet" calls onJumpToUnassigned with that sheet\'s key', () => {
    const onJumpToUnassigned = vi.fn();
    setup({
      unassignedMarkers: [{ sheetKey: 'doc-1:0', label: 'E1.1 Lighting Plan', count: 2 }],
      onJumpToUnassigned,
    });
    fireEvent.click(screen.getByText('Jump to sheet'));
    expect(onJumpToUnassigned).toHaveBeenCalledWith('doc-1:0');
  });
});
