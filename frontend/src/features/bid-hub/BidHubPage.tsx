import React from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { Bid, WonJob } from '../../types';
import { PcWorkspace, blankWorkspace } from '../preconstruction/constants';
import PcWorkspaceView from '../preconstruction/PcWorkspace';
import { ELEC_STAGES } from '../pipeline/constants';
import { useUser, useShowToast, useSettings } from '../../contexts/AppContext';
import OverviewTab from './OverviewTab';
import ActivityTab from './ActivityTab';

export type HubTab = 'overview' | 'estimating' | 'compare' | 'files' | 'activity';

const HUB_TABS: { key: HubTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'estimating', label: 'Estimating' },
  { key: 'compare', label: 'Compare' },
  { key: 'files', label: 'Files' },
  { key: 'activity', label: 'Activity' },
];

interface Props {
  bidId: string;
  bids: Bid[];
  setBids: React.Dispatch<React.SetStateAction<Bid[]>>;
  setWonJobs: React.Dispatch<React.SetStateAction<WonJob[]>>;
  pcData: Record<string, PcWorkspace>;
  onPcUpdate: (bidId: string, ws: PcWorkspace) => void;
  onBidUpdated: (bid: Bid) => void;
  onNav: (v: string, recordId?: string) => void;
}

export default function BidHubPage({ bidId, bids, setBids, setWonJobs, pcData, onPcUpdate, onBidUpdated, onNav }: Props) {
  const user = useUser();
  const showToast = useShowToast();
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: HubTab = HUB_TABS.some(t => t.key === rawTab) ? (rawTab as HubTab) : 'overview';

  const bid = bids.find(b => b.id === bidId);

  React.useEffect(() => {
    if (!pcData[bidId] && bid) {
      onPcUpdate(bidId, blankWorkspace(bidId, bid.name, bid.amount ?? 0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId, bid, pcData[bidId]]);

  if (!bid) {
    return (
      <div className="scroll view-enter">
        <div style={{ padding: 64, textAlign: 'center', color: 'var(--text2)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Bid not found</div>
          <button className="btn" onClick={() => onNav('elec-proposals')}>Back to Pipeline</button>
        </div>
      </div>
    );
  }

  const setTab = (t: HubTab) => setParams({ tab: t }, { replace: true });
  const stageInfo = ELEC_STAGES.find(s => s.key === bid.stage);

  return (
    <div className="scroll view-enter">
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button className="close-x" onClick={() => onNav('elec-proposals')}>
            <Icon name="arrow" size={16} stroke={2} style={{ transform: 'rotate(180deg)' }}/>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{bid.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>{bid.gc} &middot; {bid.loc}</div>
          </div>
          {stageInfo && (
            <span style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
              background: stageInfo.color, color: stageInfo.key === 'due' ? '#11192a' : '#fff',
            }}>
              {stageInfo.label}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexShrink: 0, border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
          {HUB_TABS.map((t, i) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                flex: 1, minHeight: 40, lineHeight: '40px', padding: '0 8px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: 'none', borderRight: i !== HUB_TABS.length - 1 ? '1px solid var(--border2)' : 'none',
                background: tab === t.key ? 'var(--blue)' : 'var(--surface2)',
                color: tab === t.key ? '#fff' : 'var(--text2)', whiteSpace: 'nowrap',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div data-testid="hub-tab-overview">
            <OverviewTab
              bid={bid}
              onBidUpdated={onBidUpdated}
              setBids={setBids}
              setWonJobs={setWonJobs}
              onNav={onNav}
              scope={pcData[bidId]?.scope ?? {}}
              onGoTab={setTab}
            />
          </div>
        )}
        {tab === 'estimating' && (
          <div data-testid="hub-tab-estimating">
            <PcWorkspaceView
              ws={pcData[bid.id] ?? blankWorkspace(bid.id, bid.name, bid.amount ?? 0)}
              bid={bid}
              embedded
              onUpdate={u => onPcUpdate(bid.id, u)}
              onBack={() => setTab('overview')}
              onConverted={b => { onBidUpdated(b); setTab('overview'); }}
              onBidUpdated={onBidUpdated}
              showToast={showToast}
              userRole={user.role}
              settings={settings}
            />
          </div>
        )}
        {tab === 'compare' && <div data-testid="hub-tab-compare">Compare — coming soon</div>}
        {tab === 'files' && <div data-testid="hub-tab-files">Files — coming soon</div>}
        {tab === 'activity' && (
          <div data-testid="hub-tab-activity">
            <ActivityTab bid={bid} onBidUpdated={onBidUpdated}/>
          </div>
        )}
      </div>
    </div>
  );
}
