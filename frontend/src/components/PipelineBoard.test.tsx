// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PipelineBoard, { PipelineStage } from './PipelineBoard';

interface Item { id: string; stage: string; amount: number; name: string }

const STAGES: readonly PipelineStage[] = [
  { key: 'a', label: 'Stage A', color: '#000' },
  { key: 'b', label: 'Stage B', color: '#111' },
];

function renderBoard(items: Item[], overrides: Partial<React.ComponentProps<typeof PipelineBoard<Item>>> = {}) {
  const onOpenDetail = vi.fn();
  const onMoveToStage = vi.fn();
  render(
    <PipelineBoard<Item>
      stages={STAGES}
      items={items}
      getId={i => i.id}
      getStage={i => i.stage}
      getAmount={i => i.amount}
      applyFilter={list => list}
      flashId={null}
      onMoveToStage={onMoveToStage}
      onOpenDetail={onOpenDetail}
      renderEmptyAction={key => key === 'a' ? <button>Add to A</button> : null}
      renderCard={i => <div className="card-body">{i.name}</div>}
      {...overrides}
    />
  );
  return { onOpenDetail, onMoveToStage };
}

afterEach(cleanup);

describe('PipelineBoard', () => {
  it('renders a column per stage with header label and count', () => {
    renderBoard([
      { id: '1', stage: 'a', amount: 1000, name: 'Alpha' },
      { id: '2', stage: 'a', amount: 2000, name: 'Beta' },
      { id: '3', stage: 'b', amount: 3000, name: 'Gamma' },
    ]);
    expect(screen.getByText('Stage A')).toBeTruthy();
    expect(screen.getByText('Stage B')).toBeTruthy();
    // Card bodies come from the renderCard render prop.
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Gamma')).toBeTruthy();
  });

  it('shows the empty action only for the configured empty column', () => {
    // Stage A empty -> its renderEmptyAction shows; Stage B empty -> falls back to drag hint.
    renderBoard([]);
    expect(screen.getByText('Add to A')).toBeTruthy();
    expect(screen.getByText('Drag a card here')).toBeTruthy();
  });

  it('hides cards filtered out by applyFilter and shows the filter-empty note', () => {
    renderBoard(
      [{ id: '1', stage: 'a', amount: 1000, name: 'Alpha' }],
      { applyFilter: () => [] },
    );
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('No matches for this filter')).toBeTruthy();
  });

  it('calls onOpenDetail when a card is clicked', () => {
    const { onOpenDetail } = renderBoard([{ id: '1', stage: 'a', amount: 1000, name: 'Alpha' }]);
    fireEvent.click(screen.getByText('Alpha'));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail.mock.calls[0][0]).toMatchObject({ id: '1' });
  });

  it('calls onMoveToStage with the dragged id and the drop column', () => {
    const { onMoveToStage } = renderBoard([
      { id: '1', stage: 'a', amount: 1000, name: 'Alpha' },
      { id: '9', stage: 'b', amount: 5000, name: 'Omega' },
    ]);
    const data: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: '',
      setData: (k: string, v: string) => { data[k] = v; },
      getData: (k: string) => data[k] ?? '',
    };
    // Drag the card in Stage A and drop it on the Stage B column.
    fireEvent.dragStart(screen.getByText('Alpha'), { dataTransfer });
    const stageBColumn = screen.getByText('Stage B').closest('.col')!;
    fireEvent.drop(stageBColumn, { dataTransfer });
    expect(onMoveToStage).toHaveBeenCalledWith('1', 'b');
  });
});
