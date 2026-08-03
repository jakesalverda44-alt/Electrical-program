import React from 'react';
import { Bid, WonJob } from '../../types';
import HubTabs from './HubTabs';
import { ELEC_HUB_TABS, ElecHubTab } from './constants';
import ElecOverviewTab from './ElecOverviewTab';
import IntakeInboxPage from '../intake/IntakeInboxPage';
import ElecPipelinePage from '../pipeline/ElecPipelinePage';
import ElecProjectsPage from '../elec-projects/ElecProjectsPage';

interface Props {
  tab: ElecHubTab;
  recordId: string | null;
  onSelectTab: (key: ElecHubTab) => void;
  onClearParam: () => void;
  bids: Bid[];
  setBids: (fn: (prev: Bid[]) => Bid[]) => void;
  wonJobs: WonJob[];
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  onOpenBid: (id: string, tab?: string) => void;
  flashId: string | null;
  openAddBid?: boolean;
  onAddBidHandled?: () => void;
  initialGc?: string;
  onBidAccepted: (bid: Bid) => void;
  onUnreadChange: (count: number) => void;
}

export default function ElectricalHubPage({
  tab, recordId, onSelectTab, onClearParam,
  bids, setBids, wonJobs, setWonJobs, onOpenBid, flashId,
  openAddBid, onAddBidHandled, initialGc,
  onBidAccepted, onUnreadChange,
}: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <HubTabs
        tabs={ELEC_HUB_TABS}
        active={tab}
        accent="blue"
        onSelect={key => onSelectTab(key as ElecHubTab)}
      />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'overview' && (
          <ElecOverviewTab bids={bids} wonJobs={wonJobs} onSelectTab={onSelectTab}/>
        )}
        {tab === 'intake' && (
          <IntakeInboxPage
            onBidAccepted={onBidAccepted}
            onUnreadChange={onUnreadChange}
          />
        )}
        {tab === 'bids' && (
          <ElecPipelinePage
            bids={bids} setBids={setBids}
            setWonJobs={setWonJobs}
            onOpenBid={onOpenBid}
            flashId={flashId}
            openAddBid={openAddBid}
            onAddBidHandled={onAddBidHandled}
            initialGc={initialGc}
            openId={recordId}
            onClearParam={onClearParam}
          />
        )}
        {tab === 'projects' && (
          <ElecProjectsPage
            bids={bids} setBids={setBids} setWonJobs={setWonJobs}
            openId={recordId}
            onClearParam={onClearParam}
          />
        )}
      </div>
    </div>
  );
}
