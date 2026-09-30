import { memo, useState, useMemo, useId, useRef, useEffect } from 'react';
import Icon from '../../../components/Icon';
import { Toast } from '../../../types';
import { PcWorkspace, SCOPE_SECS } from '../constants';
import { buildScopeFromPrebid, PrebidSection } from '../prebidScope';
import { AiResults, SetWorkspace } from './shared';
import { buildScopeFromAgent2, scopeTextKey } from './parsing';

interface ScopeTabProps {
  ws: PcWorkspace;
  set: SetWorkspace;
  aiResults: AiResults;
  prebidSections: PrebidSection[];
  showToast: (t: Toast) => void;
  analysisRunning?: boolean;
}

/** Sections that are no longer the AI's text: dropped from `ai`, and their
 *  re-check flag cleared (the estimator has touched them). */
function withoutAi(ws: PcWorkspace, keys: string[]): PcWorkspace['scopeMeta'] {
  const ai = { ...(ws.scopeMeta?.ai ?? {}) };
  for (const k of keys) delete ai[k];
  // Round 1 — spread first: scopeMeta also carries the RFI step's flags.
  return { ...(ws.scopeMeta ?? {}), ai, recheck: (ws.scopeMeta?.recheck ?? []).filter(k => !keys.includes(k)) };
}


/** UI cleanup round 1 — one "Fill from…" menu in place of two buttons. Keyboard:
 *  opening focuses the first enabled item; Up/Down move; Escape closes and
 *  refocuses the trigger; Tab closes; a click outside closes. */
function FillFromMenu({ prebidCount, hasAi, analysisRunning, onPrebid, onAi }: {
  prebidCount: number; hasAi: boolean; analysisRunning?: boolean; onPrebid: () => void; onAi: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = [
    { id: 'scope-fill-prebid', label: 'Pre-bid package', enabled: prebidCount > 0, run: onPrebid,
      sub: prebidCount > 0 ? 'Replaces the sections the pre-bid covers. Other sections are kept.' : 'No pre-bid package on this bid yet' },
    { id: 'scope-fill-ai', label: 'AI takeoff', enabled: hasAi, run: onAi,
      sub: hasAi ? 'Replaces the sections the AI takeoff wrote. Other sections are kept.' : (analysisRunning ? 'The takeoff is still running' : 'Finish the Takeoff step first') },
  ];
  const itemEls = () => Array.from(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  useEffect(() => {
    if (!open) return;
    itemEls()[0]?.focus();
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) triggerRef.current?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.key === 'Tab') { close(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const els = itemEls();
      if (!els.length) return;
      const i = els.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % els.length : (i <= 0 ? els.length - 1 : i - 1);
      els[next].focus();
    }
  };
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onKeyDown={onKeyDown}>
      <button ref={triggerRef} type="button" className="btn ghost" data-testid="scope-fill-menu-button"
        aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
        onClick={() => setOpen(o => !o)} style={{ fontSize: 13, color: 'var(--blue)' }}>
        Fill from… <Icon name="chevron-down" size={13} stroke={2}/>
      </button>
      {open && (
        <div role="menu" id={menuId} data-testid="scope-fill-menu" className="scope-fill-menu">
          {items.map(it => (
            <button key={it.id} type="button" role="menuitem" className="scope-fill-item" data-testid={it.id}
              disabled={!it.enabled} onClick={() => { it.run(); close(true); }}>
              <span>{it.label}</span>
              <span className="scope-fill-sub">{it.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeTab({ ws, set, aiResults, prebidSections, showToast, analysisRunning }: ScopeTabProps) {
  const agent2Scope = aiResults?.agent2_output as string | undefined;
  // Round 1 — empty sections collapse to a "+ Add" row; a section with text is never hidden.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [justOpened, setJustOpened] = useState<string | null>(null);
  const hasText = (id: string) => !!(ws.scope[id] ?? '').trim();
  const expanded = (id: string) => hasText(id) || openIds.has(id);
  const anyText = SCOPE_SECS.some(s => hasText(s.id));
  // Same union rerunPlan uses, so it also covers bids from before scope_meta existed.
  const aiText = useMemo<Record<string, string>>(
    () => ({ ...buildScopeFromAgent2(agent2Scope), ...(ws.scopeMeta?.ai ?? {}) }),
    [agent2Scope, ws.scopeMeta?.ai],
  );
  const isAiDraft = (id: string) => hasText(id) && aiText[id] != null && scopeTextKey(aiText[id]) === scopeTextKey(ws.scope[id] ?? '');
  const importScope = () => {
    const scopeFill = buildScopeFromAgent2(agent2Scope);
    if (!Object.keys(scopeFill).length) {
      showToast({ variant: 'info', title: 'Nothing to import', sub: 'No scope sections found in the AI takeoff output' });
      return;
    }
    // Fix round S4 — these sections are AI-written until someone edits them.
    set({
      scope: { ...ws.scope, ...scopeFill },
      scopeMeta: { ...(ws.scopeMeta ?? {}), ai: { ...(ws.scopeMeta?.ai ?? {}), ...scopeFill }, recheck: (ws.scopeMeta?.recheck ?? []).filter(k => !(k in scopeFill)) },
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
  const hasSources = prebidSections.length > 0 || !!agent2Scope;
  const emptyHint = hasSources
    ? 'Use “Fill from…” to bring in the pre-bid package or the AI takeoff, or add a section by hand below.'
    : analysisRunning
      ? 'The AI takeoff is still running. When it finishes it fills in any empty sections here.'
      : 'No pre-bid package or finished AI takeoff yet. Add a section by hand below, or finish the Takeoff step first.';
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 14 }}>
        <FillFromMenu prebidCount={prebidSections.length} hasAi={!!agent2Scope} analysisRunning={analysisRunning}
          onPrebid={importPrebid} onAi={importScope}/>
      </div>
      {!anyText && (
        <div className="scope-empty" data-testid="scope-empty">
          <strong>Nothing imported yet</strong>
          <span>{emptyHint}</span>
        </div>
      )}
      {SCOPE_SECS.map(sec => !expanded(sec.id) ? (
        <button key={sec.id} type="button" className="scope-add-row" data-testid={`scope-add-${sec.id}`}
          onClick={() => { setOpenIds(p => new Set(p).add(sec.id)); setJustOpened(sec.id); }}>
          <span className="scope-add-letter">{sec.id}</span>+ Add {sec.label}
        </button>
      ) : (
        <div key={sec.id} className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">
              <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)', fontSize: 11, fontWeight: 800 }}>
                {sec.id}
              </span>
              {sec.label}
            </span>
            {isAiDraft(sec.id) && (
              <span data-testid={`scope-ai-draft-${sec.id}`} title="Written by the AI takeoff and not edited yet — read it over before it goes on the proposal"
                style={{ fontSize: 10, fontWeight: 800, color: 'var(--blue)', border: '1px solid var(--blue)', borderRadius: 4, padding: '1px 5px' }}>
                AI draft
              </span>
            )}
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
              autoFocus={justOpened === sec.id}
              onChange={e => {
                // Keep it open even if the estimator clears it while typing.
                setOpenIds(p => (p.has(sec.id) ? p : new Set(p).add(sec.id)));
                set({
                  scope: { ...ws.scope, [sec.id]: e.target.value },
                  // An edit clears the re-check flag; the AI record stays, so
                  // the section only counts as AI while it still matches it.
                  scopeMeta: { ...(ws.scopeMeta ?? {}), ai: ws.scopeMeta?.ai ?? {}, recheck: (ws.scopeMeta?.recheck ?? []).filter(k => k !== sec.id) },
                });
              }}
              data-testid={`scope-text-${sec.id}`}
              placeholder={`Scope notes for ${sec.label}…`}/>
          </div>
        </div>
      ))}
    </div>
  );
}

export default memo(ScopeTab);
