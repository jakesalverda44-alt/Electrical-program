import React from 'react';
import { Gen, WonJob } from '../../types';
import HubTabs from './HubTabs';
import { GEN_HUB_TABS, GenHubTab } from './constants';
import LeadsPage from '../leads/LeadsPage';
import GenPipelinePage from '../gen-pipeline/GenPipelinePage';
import GenProjectsPage from '../gen-projects/GenProjectsPage';

interface Props {
  tab: GenHubTab;
  recordId: string | null;
  onSelectTab: (key: GenHubTab) => void;
  onClearParam: () => void;
  onNav: (v: string) => void;
  gens: Gen[];
  setGens: (fn: (prev: Gen[]) => Gen[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  flashId: string | null;
  onOpenBuilder: () => void;
  onEditGen: (gen: Gen) => void;
  onConverted: (gen: Gen) => void;
}

export default function GeneratorsHubPage({
  tab, recordId, onSelectTab, onClearParam, onNav,
  gens, setGens, setWonJobs, flashId, onOpenBuilder, onEditGen, onConverted,
}: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <HubTabs
        tabs={GEN_HUB_TABS}
        active={tab}
        accent="amber"
        onSelect={key => onSelectTab(key as GenHubTab)}
      />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'overview' && (
          <div className="scroll view-enter" style={{ padding: 32 }}>Overview — coming in Task 5</div>
        )}
        {tab === 'leads' && (
          <LeadsPage
            onNav={onNav}
            openLeadId={recordId}
            onClearParam={onClearParam}
            onEditGen={onEditGen}
            onConverted={onConverted}
          />
        )}
        {tab === 'pipeline' && (
          <GenPipelinePage
            gens={gens} setGens={setGens}
            setWonJobs={setWonJobs}
            onOpenBuilder={onOpenBuilder}
            onEditGen={onEditGen}
            flashId={flashId}
            openId={recordId}
            onClearParam={onClearParam}
            onNav={onNav}
          />
        )}
        {tab === 'jobs' && (
          <GenProjectsPage
            gens={gens} setGens={setGens} setWonJobs={setWonJobs}
            openId={recordId}
            onClearParam={onClearParam}
          />
        )}
      </div>
    </div>
  );
}
