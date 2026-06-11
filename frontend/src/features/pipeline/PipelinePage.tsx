import React, { useState } from 'react';
import { Bid, Gen, WonJob } from '../../types';
import ElecPipelinePage from './ElecPipelinePage';
import GenPipelinePage from '../gen-pipeline/GenPipelinePage';

interface Props {
  bids: Bid[];
  setBids: (fn: (prev: Bid[]) => Bid[]) => void;
  gens: Gen[];
  setGens: (fn: (prev: Gen[]) => Gen[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  onOpenPreconstruction: (id: string) => void;
  onOpenBuilder: () => void;
  onEditGen: (gen: Gen) => void;
  flashId: string | null;
  openAddBid?: boolean;
  onAddBidHandled?: () => void;
  initialGc?: string;
  defaultTab?: 'generator' | 'electrical';
  // Deep-link record id (from global search): opens that proposal's drawer on the active tab.
  openId?: string | null;
  onClearParam?: () => void;
  onNav?: (v: string) => void;
}

export default function PipelinePage({
  bids, setBids, gens, setGens, setWonJobs,
  onOpenPreconstruction, onOpenBuilder, onEditGen,
  flashId, openAddBid, onAddBidHandled, initialGc,
  defaultTab = 'generator', openId, onClearParam, onNav,
}: Props) {
  const [tab, setTab] = useState<'generator' | 'electrical'>(defaultTab);

  const tabBtn = (id: 'generator' | 'electrical', label: string, isAmber: boolean) => {
    const active = tab === id;
    const activeColor = isAmber ? 'var(--amber)' : 'var(--blue)';
    return (
      <button
        key={id}
        onClick={() => setTab(id)}
        style={{
          padding: '8px 18px',
          border: 'none',
          borderBottom: active ? `2px solid ${activeColor}` : '2px solid transparent',
          background: 'transparent',
          fontWeight: active ? 800 : 600,
          fontSize: 13,
          color: active ? activeColor : 'var(--text3)',
          cursor: 'pointer',
          transition: 'color .15s',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 4, padding: '0 16px', borderBottom: '1px solid var(--border)' }}>
        {tabBtn('generator', 'Generator', true)}
        {tabBtn('electrical', 'Electrical', false)}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'generator' ? (
          <GenPipelinePage
            gens={gens} setGens={setGens}
            setWonJobs={setWonJobs}
            onOpenBuilder={onOpenBuilder}
            onEditGen={onEditGen}
            flashId={flashId}
            openId={tab === 'generator' ? openId : null}
            onClearParam={onClearParam}
            onNav={onNav}
          />
        ) : (
          <ElecPipelinePage
            bids={bids} setBids={setBids}
            setWonJobs={setWonJobs}
            onOpenPreconstruction={onOpenPreconstruction}
            flashId={flashId}
            openAddBid={openAddBid}
            onAddBidHandled={onAddBidHandled}
            initialGc={initialGc}
            openId={tab === 'electrical' ? openId : null}
            onClearParam={onClearParam}
          />
        )}
      </div>
    </div>
  );
}
