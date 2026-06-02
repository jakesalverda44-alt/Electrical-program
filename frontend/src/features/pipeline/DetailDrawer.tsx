import React from 'react';
import Icon from '../../components/Icon';
import { Bid } from '../../types';
import { ELEC_STAGES, ElecStageKey } from './constants';

function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }

interface Props {
  bid: Bid;
  pendingLost: boolean;
  onStage: (stage: ElecStageKey) => void;
  onCancelLost: () => void;
  onClose: () => void;
  onOpenPreconstruction: (id: string) => void;
}

export default function DetailDrawer({ bid, pendingLost, onStage, onCancelLost, onClose, onOpenPreconstruction }: Props) {
  const isTerminal = bid.stage === 'awarded' || bid.stage === 'lost';

  return (
    <div className="drawer-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-hdr">
          <div>
            <div className="drawer-eyebrow">Electrical Bid</div>
            <div className="drawer-title">{bid.name}</div>
          </div>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>

        <div className="drawer-body">
          <div className="dtl-amt">{moneyFull(Number(bid.amount))}</div>

          <div className="dtl-stage-label">Stage</div>
          <div className="dtl-stages">
            {ELEC_STAGES.map(s => {
              const isActive = bid.stage === s.key;
              const isLost = s.key === 'lost';
              return (
                <button
                  key={s.key}
                  className={'dtl-stage' + (isActive ? ' on' : '')}
                  style={isActive ? {
                    background: s.color,
                    borderColor: s.color,
                    color: s.key === 'due' ? '#11192a' : '#fff',
                  } : undefined}
                  onClick={() => onStage(s.key)}
                  title={isLost && !isActive ? 'Mark as lost (requires confirmation)' : undefined}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Lost confirmation inline */}
          {pendingLost && (
            <div className="lost-confirm">
              <Icon name="x" size={14} stroke={2}/>
              <span>Mark this bid as lost?</span>
              <button className="btn ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={onCancelLost}>Cancel</button>
              <button className="btn" style={{ height: 28, fontSize: 12, padding: '0 10px', background: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => onStage('lost')}>Confirm Lost</button>
            </div>
          )}

          <div className="dtl-section">
            <div className="dtl-row"><span className="dtl-k">General Contractor</span><span className="dtl-v">{bid.gc}</span></div>
            <div className="dtl-row"><span className="dtl-k">Location</span><span className="dtl-v">{bid.loc}</span></div>
            <div className="dtl-row"><span className="dtl-k">Bid amount</span><span className="dtl-v num">{moneyFull(Number(bid.amount))}</span></div>
            <div className="dtl-row"><span className="dtl-k">Due</span><span className="dtl-v">{bid.due}</span></div>
            <div className="dtl-row"><span className="dtl-k">Drawing sheets</span><span className="dtl-v">{bid.sheets}</span></div>
            <div className="dtl-row"><span className="dtl-k">Contact</span><span className="dtl-v">{bid.contact}</span></div>
            <div className="dtl-row"><span className="dtl-k">Salesperson</span><span className="dtl-v">{bid.salesperson_name}</span></div>
          </div>

          {!isTerminal && (
            <button
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'center', color: 'var(--blue)', marginTop: 4 }}
              onClick={() => { onClose(); onOpenPreconstruction(bid.id); }}
            >
              <Icon name="sparkle" size={14} stroke={2}/>Open in Preconstruction
            </button>
          )}


        </div>
      </div>
    </div>
  );
}
