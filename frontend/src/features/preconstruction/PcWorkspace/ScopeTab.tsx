import { memo } from 'react';
import Icon from '../../../components/Icon';
import { Toast } from '../../../types';
import { PcWorkspace, SCOPE_SECS } from '../constants';
import { buildScopeFromPrebid, PrebidSection } from '../prebidScope';
import { AiResults, SetWorkspace } from './shared';
import { buildScopeFromAgent2 } from './parsing';

interface ScopeTabProps {
  ws: PcWorkspace;
  set: SetWorkspace;
  aiResults: AiResults;
  prebidSections: PrebidSection[];
  showToast: (t: Toast) => void;
}

function ScopeTab({ ws, set, aiResults, prebidSections, showToast }: ScopeTabProps) {
  const agent2Scope = aiResults?.agent2_output as string | undefined;
  const importScope = () => {
    const scopeFill = buildScopeFromAgent2(agent2Scope);
    if (!Object.keys(scopeFill).length) {
      showToast({ variant: 'info', title: 'Nothing to import', sub: 'No scope sections found in the AI takeoff output' });
      return;
    }
    set({ scope: { ...ws.scope, ...scopeFill } });
    showToast({ title: 'Scope imported', sub: 'Filled from the AI takeoff — review and edit as needed' });
  };
  const importPrebid = () => {
    const fill = buildScopeFromPrebid(prebidSections);
    if (!Object.keys(fill).length) {
      showToast({ variant: 'info', title: 'Nothing to import', sub: 'No scope sections found in the pre-bid package' });
      return;
    }
    set({ scope: { ...ws.scope, ...fill } });
    showToast({ title: 'Scope imported', sub: 'Filled from the pre-bid package — review and edit as needed' });
  };
  return (
    <div style={{ padding: '20px 24px' }}>
      {(agent2Scope || prebidSections.length > 0) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 14 }}>
          {prebidSections.length > 0 && (
            <button className="btn ghost" onClick={importPrebid} style={{ fontSize: 13, color: 'var(--blue)' }}
              title="Fill these sections from the Cowork pre-bid scope. Existing text in sections the pre-bid doesn't cover is kept.">
              <Icon name="spark" size={14} stroke={1.9}/> Import from Pre-Bid
            </button>
          )}
          {agent2Scope && (
            <button className="btn ghost" onClick={importScope} style={{ fontSize: 13, color: 'var(--blue)' }}
              title="Fill these sections from the completed AI takeoff (Agent 2). Existing text in sections the AI didn't produce is kept.">
              <Icon name="spark" size={14} stroke={1.9}/> Import from AI Takeoff
            </button>
          )}
        </div>
      )}
      {SCOPE_SECS.map(sec => (
        <div key={sec.id} className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">
              <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)', fontSize: 11, fontWeight: 800 }}>
                {sec.id}
              </span>
              {sec.label}
            </span>
          </div>
          <div style={{ padding: '10px 16px' }}>
            <textarea style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', height: 76, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              value={ws.scope[sec.id] ?? ''} onChange={e => set({ scope: { ...ws.scope, [sec.id]: e.target.value } })}
              placeholder={`Scope notes for ${sec.label}…`}/>
          </div>
        </div>
      ))}
    </div>
  );
}

export default memo(ScopeTab);
