// The workspace chrome: the step tracker, the tab strip + autosave chip, and
// the small colored pill the analysis and pricing views share.
import React, { memo } from 'react';
import Icon from '../../../components/Icon';
import { PC_STEPS, PC_TABS, PcStepKey, PcTabKey } from '../constants';
import { STEP_ORDER, SaveState } from './shared';

// Small colored pill — lifted to module scope (Task 5) so the Pricing tab's
// FIRM/APPROX/VERIFY confidence chips reuse the exact styling the Agent 2
// structured view already uses for its own confidence badges.
export function pill(label: string, color: string) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11,
      fontWeight: 700, background: color + '22', color }}>
      {label}
    </span>
  );
}


// memo: the tracker only moves when the step does, so it sits out every
// keystroke in the tab below it.
export const StepTracker = memo(function StepTracker({ current }: { current: PcStepKey }) {
  const idx = STEP_ORDER.indexOf(current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', paddingBottom: 2 }}>
      {PC_STEPS.map((s, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <React.Fragment key={s.key}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 72 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                background: done ? 'var(--green)' : active ? 'var(--blue)' : 'var(--surface2)',
                color:      done ? '#fff'         : active ? '#fff'        : 'var(--text3)',
                border:     active ? '2px solid var(--blue)' : 'none',
              }}>
                {done ? <Icon name="check" size={13} stroke={2.5}/> : s.short}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: active ? 'var(--text)' : done ? 'var(--green)' : 'var(--text3)', textAlign: 'center', maxWidth: 64 }}>
                {s.label}
              </div>
            </div>
            {i < PC_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < idx ? 'var(--green)' : 'var(--surface2)', minWidth: 16, marginBottom: 18 }}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
});

interface TabStripProps {
  activeTab: PcTabKey;
  onSelect: (key: PcTabKey) => void;
  saveState: SaveState;
}

// memo: unchanged for every edit that is not a tab switch or an autosave
// transition, which is most of them.
export const TabStrip = memo(function TabStrip({ activeTab, onSelect, saveState }: TabStripProps) {
  return (
    <div className="pc-tabs" style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', overflowX: 'auto', alignItems: 'center' }}>
      {PC_TABS.map(t => (
        <button key={t.key} onClick={() => onSelect(t.key as PcTabKey)} style={{
          border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700,
          padding: '10px 14px', background: 'transparent',
          color: activeTab === t.key ? 'var(--text)' : 'var(--text3)',
          borderBottom: activeTab === t.key ? '2px solid var(--blue)' : '2px solid transparent',
          whiteSpace: 'nowrap',
        }}>
          {t.label}
        </button>
      ))}
      {/* Autosave is invisible when it works and used to be invisible when it
          didn't. This is the only signal the estimator gets. */}
      <span data-testid="pc-save-state" style={{ marginLeft: 'auto', paddingLeft: 12, whiteSpace: 'nowrap',
        fontSize: 11.5, fontWeight: 700,
        color: saveState === 'error' ? 'var(--red)' : 'var(--text3)' }}>
        {saveState === 'saving' ? 'Saving…'
          : saveState === 'saved' ? 'Saved'
          : saveState === 'error' ? 'Not saved — retrying'
          : ''}
      </span>
    </div>
  );
});
