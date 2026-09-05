import React from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { Bid, WonJob } from '../../types';
import { PcWorkspace, blankWorkspace } from '../preconstruction/constants';
import PcWorkspaceView from '../preconstruction/PcWorkspace';
import { ELEC_STAGES } from '../pipeline/constants';
import { useUser, useShowToast, useSettings } from '../../contexts/AppContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import OverviewTab from './OverviewTab';
import ActivityTab from './ActivityTab';
import BidCompare from '../preconstruction/BidCompare';
import RecordFiles from '../../components/RecordFiles';

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
  /** Post-review B4 — true once App.tsx's /preconstruction/workspaces fetch
   *  has settled at least once. Without this, "no entry in pcData yet"
   *  couldn't be told apart from "the list is still loading" — a bid that
   *  genuinely does have a saved workspace row could have PcWorkspaceView
   *  mount on a synthetic blankWorkspace() before the real one arrived, and
   *  its autosave would then PUT empty notes/scope/rfis/files over that real
   *  row (a full-row upsert). Defaults to true so every existing caller
   *  (there are currently none that omit it) keeps today's behavior. */
  pcDataLoaded?: boolean;
}

export default function BidHubPage({ bidId, bids, setBids, setWonJobs, pcData, onPcUpdate, onBidUpdated, onNav, pcDataLoaded = true }: Props) {
  const user = useUser();
  const showToast = useShowToast();
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: HubTab = HUB_TABS.some(t => t.key === rawTab) ? (rawTab as HubTab) : 'overview';

  const bid = bids.find(b => b.id === bidId);
  usePageTitle(bid ? bid.name : 'Bid');

  React.useEffect(() => {
    // Only seed a blank workspace once we know for certain there isn't a
    // real one to restore — i.e. the workspaces list has actually settled
    // and simply didn't contain this bid (a genuinely new one).
    if (pcDataLoaded && !pcData[bidId] && bid) {
      onPcUpdate(bidId, blankWorkspace(bidId, bid.name, bid.amount ?? 0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId, bid, pcData[bidId], pcDataLoaded]);

  if (!bid) {
    return (
      <div className="scroll view-enter">
        <div style={{ padding: 64, textAlign: 'center', color: 'var(--text2)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Bid not found</div>
          <button className="btn" onClick={() => onNav('electrical/bids')}>Back to Pipeline</button>
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
          <button className="close-x" onClick={() => onNav('electrical/bids')}>
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
        {/* Task 7 (audit data #16) — rendered once per bid (keyed by bid.id, so it
            unmounts and remounts cleanly when the open bid changes) and toggled
            with `hidden` instead of unmounting on every tab click. Before this,
            PcWorkspaceView's seven GETs and its autosave baseline refired every
            single time the Estimating tab was clicked, not just once per bid.
            Post-review B4 — only mounted once pcData[bid.id] is actually
            populated (never a blankWorkspace() fallback here): mounting on a
            synthetic blank object before a slow /preconstruction/workspaces
            fetch resolves let the autosave PUT empty notes/scope/rfis/files
            over a real row once it caught up. */}
        {pcData[bid.id] ? (
          <div data-testid="hub-tab-estimating" hidden={tab !== 'estimating'}>
            <PcWorkspaceView
              key={bid.id}
              ws={pcData[bid.id]}
              bid={bid}
              embedded
              onUpdate={u => onPcUpdate(bid.id, u)}
              onBack={() => setTab('overview')}
              onConverted={b => { onBidUpdated(b); setTab('overview'); }}
              onBidUpdated={onBidUpdated}
              showToast={showToast}
              userRole={user.role}
              settings={settings}
              onGoFiles={() => setTab('files')}
            />
          </div>
        ) : tab === 'estimating' && (
          <div data-testid="hub-tab-estimating-loading" style={{ padding: 64, textAlign: 'center', color: 'var(--text2)' }}>
            Loading workspace…
          </div>
        )}
        {tab === 'compare' && (
          <div data-testid="hub-tab-compare">
            <BidCompare bidId={bid.id} sqFt={bid.sq_ft} brand={bid.brand} projectType={bid.project_type}/>
          </div>
        )}
        {tab === 'files' && (
          <div data-testid="hub-tab-files">
            <RecordFiles linkedId={bid.id} linkedName={bid.name} div="elec"
              emptyHint="Upload contracts, change orders, invoices, and photos here. Add large plan sets directly in the Drive folder on the Overview tab."/>
          </div>
        )}
        {tab === 'activity' && (
          <div data-testid="hub-tab-activity">
            <ActivityTab bid={bid} onBidUpdated={onBidUpdated}/>
          </div>
        )}
      </div>
    </div>
  );
}
