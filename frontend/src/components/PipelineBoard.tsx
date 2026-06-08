import React, { useState } from 'react';
import { moneyShort } from '../lib/money';

// Shared kanban board scaffolding for the electrical and generator pipelines:
// stage columns, drag-and-drop, column header + total, empty states, and the
// draggable card shell. The card interior is domain-specific and supplied via
// the `renderCard` render prop; the first-column "add" action via
// `renderEmptyAction`.

export interface PipelineStage { key: string; label: string; color: string }

interface PipelineBoardProps<T> {
  stages: readonly PipelineStage[];
  items: T[];
  getId: (item: T) => string;
  getStage: (item: T) => string;
  getAmount: (item: T) => number;
  applyFilter?: (list: T[]) => T[];
  flashId: string | null;
  onMoveToStage: (id: string, stageKey: string) => void;
  onOpenDetail: (item: T) => void;
  /** Optional content for an empty column (e.g. a "New Bid" button on the
   *  first stage). Return null to fall back to the drag hint. */
  renderEmptyAction?: (stageKey: string) => React.ReactNode;
  /** Domain-specific card interior, rendered inside the draggable shell. */
  renderCard: (item: T, stage: PipelineStage) => React.ReactNode;
}

export default function PipelineBoard<T>({
  stages, items, getId, getStage, getAmount, applyFilter,
  flashId, onMoveToStage, onOpenDetail, renderEmptyAction, renderCard,
}: PipelineBoardProps<T>) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const sum = (list: T[]) => list.reduce((s, i) => s + Number(getAmount(i)), 0);

  const onDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) { /* ignore */ }
  };
  const onDrop = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    const id = dragId || e.dataTransfer.getData('text/plain');
    if (id) onMoveToStage(id, stageKey);
    setDragId(null);
    setOverCol(null);
  };

  return (
    <div className="board" style={{ gridTemplateColumns: `repeat(${stages.length}, 1fr)` }}>
      {stages.map(st => {
        const allInCol = items.filter(i => getStage(i) === st.key);
        const visible  = applyFilter ? applyFilter(allInCol) : allInCol;
        const isOver   = overCol === st.key;

        return (
          <div
            key={st.key}
            className={'col' + (isOver ? ' drag-over' : '')}
            onDragOver={e => { e.preventDefault(); if (overCol !== st.key) setOverCol(st.key); }}
            onDragLeave={e => { if (e.currentTarget === e.target) setOverCol(null); }}
            onDrop={e => onDrop(e, st.key)}
          >
            <div className="col-hdr">
              <span className="col-title">
                <span className="dot" style={{ background: st.color }}/>
                {st.label}
                <span className="col-cnt">{allInCol.length}</span>
              </span>
              <span className="col-total num">{moneyShort(sum(allInCol))}</span>
            </div>

            <div className="col-body">
              {/* Empty state */}
              {allInCol.length === 0 && (
                <div className="col-empty">
                  {renderEmptyAction?.(st.key) ?? (isOver ? 'Drop here' : 'Drag a card here')}
                </div>
              )}

              {/* Filter empty state */}
              {allInCol.length > 0 && visible.length === 0 && (
                <div className="col-empty" style={{ color: 'var(--text3)', fontSize: 12 }}>
                  No matches for this filter
                </div>
              )}

              {visible.map(item => {
                const id = getId(item);
                return (
                  <div
                    key={id}
                    className={'bcard' + (flashId === id ? ' flash' : '') + (dragId === id ? ' dragging' : '')}
                    draggable
                    onDragStart={e => onDragStart(e, id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => onOpenDetail(item)}
                  >
                    <span className="bcard-accent" style={{ background: st.color }}/>
                    {renderCard(item, st)}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
