import React from 'react';
import Icon from '../../components/Icon';
import { Bid, Toast } from '../../types';
import { PcWorkspace, blankWorkspace, PC_STEPS } from './constants';
import PcWorkspaceView from './PcWorkspace';

const STEP_ORDER = PC_STEPS.map(s => s.key);

interface Props {
  bids: Bid[];
  pcData: Record<string, PcWorkspace>;
  onPcUpdate: (bidId: string, ws: PcWorkspace) => void;
  onBidUpdated: (bid: Bid) => void;
  showToast: (t: Toast) => void;
}

function money(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + n;
}

export default function PreconstructionPage({ bids, pcData, onPcUpdate, onBidUpdated, showToast }: Props) {
  const [activeBidId, setActiveBidId] = React.useState<string | null>(null);

  const activeBids = bids.filter(b => b.stage === 'due' || b.stage === 'submitted');

  const openWorkspace = (bid: Bid) => {
    if (!pcData[bid.id]) {
      onPcUpdate(bid.id, blankWorkspace(bid.id, bid.name, bid.amount));
    }
    setActiveBidId(bid.id);
  };

  const handleConverted = (updatedBid: Bid) => {
    onBidUpdated(updatedBid);
    setActiveBidId(null);
  };

  if (activeBidId) {
    const bid = bids.find(b => b.id === activeBidId);
    const ws  = pcData[activeBidId];
    if (bid && ws) {
      return (
        <PcWorkspaceView
          ws={ws}
          bid={bid}
          onUpdate={updated => onPcUpdate(bid.id, updated)}
          onBack={() => setActiveBidId(null)}
          onConverted={handleConverted}
          showToast={showToast}
        />
      );
    }
  }

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px' }}>
        <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
            Active Bids
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text3)', marginLeft: 8 }}>· {activeBids.length}</span>
          </div>
        </div>

        {activeBids.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
            No active bids in the pipeline. Add bids from the Electrical Proposals board.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {activeBids.map(bid => {
              const ws = pcData[bid.id];
              const stepIdx = ws ? STEP_ORDER.indexOf(ws.step) : -1;
              const progress = ws ? Math.round(((stepIdx + 1) / STEP_ORDER.length) * 100) : 0;

              return (
                <div key={bid.id} className="panel" style={{ cursor: 'pointer' }} onClick={() => openWorkspace(bid)}>
                  <div style={{ padding: '16px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3 }}>{bid.name}</div>
                      <span style={{
                        fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
                        background: bid.stage === 'submitted' ? 'var(--blue-soft)' : 'var(--amber-soft)',
                        color: bid.stage === 'submitted' ? 'var(--blue)' : 'var(--amber)',
                        textTransform: 'uppercase', flexShrink: 0, marginLeft: 8,
                      }}>
                        {bid.stage}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="building" size={12} stroke={1.8}/>{bid.gc}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="pin" size={12} stroke={1.8}/>{bid.loc}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span className="num" style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)' }}>{money(bid.amount)}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
                        {ws ? `Step: ${ws.step}` : 'Not started'}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: progress + '%', background: 'var(--blue)', borderRadius: 3, transition: 'width .3s' }}/>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, fontWeight: 600 }}>
                      {progress}% complete
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
