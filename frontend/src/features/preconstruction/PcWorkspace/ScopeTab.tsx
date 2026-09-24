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

/** Sections that are no longer the AI's text: dropped from `ai`, and their
 *  re-check flag cleared (the estimator has touched them). */
function withoutAi(ws: PcWorkspace, keys: string[]): PcWorkspace['scopeMeta'] {
  const ai = { ...(ws.scopeMeta?.ai ?? {}) };
  for (const k of keys) delete ai[k];
  return { ai, recheck: (ws.scopeMeta?.recheck ?? []).filter(k => !keys.includes(k)) };
}

function ScopeTab({ ws, set, aiResults, prebidSections, showToast }: ScopeTabProps) {
  const agent2Scope = aiResults?.agent2_output as string | undefined;
  const importScope = () => {
    const scopeFill = buildScopeFromAgent2(agent2Scope);
    if (!Object.keys(scopeFill).length) {
      showToast({ variant: 'info', title: 'Nothing to import', sub: 'No scope sections found in the AI takeoff output' });
      return;
    }
    // Fix round S4 — these sections are AI-written until someone edits them.
    set({
      scope: { ...ws.scope, ...scopeFill },
      scopeMeta: { ai: { ...(ws.scopeMeta?.ai ?? {}), ...scopeFill }, recheck: (ws.scopeMeta?.recheck ?? []).filter(k => !(k in scopeFill)) },
    });
    showToast({ title: 'Scope imported', sub: 'Filled from the AI takeoff — review and edit as needed' });
  };
  const importPrebid = () => {
    const fill = buildScopeFromPrebid(prebidSections);
    if (!Object.keys(fill).length) {
      showToast({ variant: 'info', title: 'Nothing to import', sub: 'No scope sections found in the pre-bid package' });
      return;
    }
    set({ scope: { ...ws.scope, ...fill }, scopeMeta: withoutAi(ws, Object.keys(fill)) });
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
            {(ws.scopeMeta?.recheck ?? []).includes(sec.id) && (
              <span data-testid={`scope-recheck-${sec.id}`} title="Kept through the re-run because it was typed or edited — check it against the new analysis"
                style={{ fontSize: 10, fontWeight: 800, color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4, padding: '1px 5px' }}>
                From previous run — re-check
              </span>
            )}
          </div>
          <div style={{ padding: '10px 16px' }}>
            <textarea style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', height: 76, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              value={ws.scope[sec.id] ?? ''}
              onChange={e => set({
                scope: { ...ws.scope, [sec.id]: e.target.value },
                // An edit clears the re-check flag; the AI record stays, so
                // the section only counts as AI while it still matches it.
                scopeMeta: { ai: ws.scopeMeta?.ai ?? {}, recheck: (ws.scopeMeta?.recheck ?? []).filter(k => k !== sec.id) },
              })}
              data-testid={`scope-text-${sec.id}`}
              placeholder={`Scope notes for ${sec.label}…`}/>
          </div>
        </div>
      ))}
    </div>
  );
}

export default memo(ScopeTab);
