import { memo } from 'react';
import Icon from '../../../components/Icon';
import { PcWorkspace } from '../constants';
import { moneyFull } from '../../../lib/money';
import { STEP_ORDER, SetWorkspace, TakeoffOnFile } from './shared';
import ImportPanel, { ImportPanelProps } from './ImportPanel';

interface OverviewTabProps {
  ws: PcWorkspace;
  set: SetWorkspace;
  advanceStep: () => void;
  takeoffOnFile: TakeoffOnFile | null;
  openTakeoffCat: string | null;
  setOpenTakeoffCat: (cat: string | null) => void;
  importPanel: ImportPanelProps;
}

function OverviewTab({ ws, set, advanceStep, takeoffOnFile, openTakeoffCat, setOpenTakeoffCat, importPanel }: OverviewTabProps) {
  return (
    <div style={{ padding: '20px 24px' }}>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)', padding: 0, marginBottom: 20 }}>
        {[
          { label: 'Est. Contract Value', val: moneyFull(ws.amount), tone: 'green' },
          { label: 'Step Progress',        val: `${STEP_ORDER.indexOf(ws.step) + 1} / ${STEP_ORDER.length}`, tone: 'blue'  },
          { label: 'RFIs Open',            val: String(ws.rfis.filter(r => !r.submitted).length), tone: 'amber' },
        ].map(s => (
          <div className="stat" key={s.label}>
            <div className="stat-top"><span className="stat-label">{s.label}</span></div>
            <div className="stat-val num">{s.val}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="panel-hdr"><span className="panel-title">Workspace Notes</span></div>
        <div style={{ padding: 16 }}>
          <textarea style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', height: 140, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            value={ws.notes} onChange={e => set({ notes: e.target.value })} placeholder="Add notes, reminders, or key info about this bid…"/>
        </div>
      </div>
      <ImportPanel {...importPanel}/>
      {takeoffOnFile && takeoffOnFile.item_count > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-hdr">
            <span className="panel-title">Quantity Takeoff on File</span>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
              {takeoffOnFile.item_count} items
              {takeoffOnFile.source_file ? ` · ${takeoffOnFile.source_file}` : ''}
            </span>
          </div>
          <div style={{ padding: '4px 0' }}>
            {takeoffOnFile.categories.map(c => {
              const open = openTakeoffCat === c.name;
              const items = takeoffOnFile.line_items.filter(l => l.category === c.name);
              return (
                <div key={c.name}>
                  <div onClick={() => setOpenTakeoffCat(open ? null : c.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border2)' }}>
                    <Icon name="chevron-down" size={12} stroke={2.4}
                      style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .12s' }}/>
                    <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{c.name}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 600 }}>
                      {Object.entries(c.totals).sort((a, b) => b[1] - a[1]).map(([u, q]) => `${q.toLocaleString()} ${u}`).join(' · ')}
                      {' · '}{c.itemCount} items
                    </span>
                  </div>
                  {open && (
                    <div style={{ padding: '8px 16px 10px 36px', background: 'var(--surface2, rgba(0,0,0,.03))' }}>
                      {items.map((l, i) => (
                        <div key={i} style={{ fontSize: 11.5, marginBottom: 4, lineHeight: 1.45 }}>
                          <b>{l.qty ?? '—'} {l.unit}</b> — {l.description}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
        <button className="btn" onClick={advanceStep} disabled={ws.step === 'submitted'} style={{ fontSize: 13 }}>
          Advance to Next Step <Icon name="arrow" size={14} stroke={2.2}/>
        </button>
      </div>
    </div>
  );
}

export default memo(OverviewTab);
