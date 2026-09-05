import React, { memo, useRef } from 'react';
import Icon from '../../../components/Icon';
import { PROJECT_TYPES } from '../constants';
import { ImportAction, ImportState } from './importReducer';

export interface ImportPanelProps {
  state: ImportState;
  dispatch: React.Dispatch<ImportAction>;
  readImportFiles: () => void;
  saveImportedBid: () => void;
}

// The "Import Finished Bid" panel on the Overview tab. Its six pieces of state
// (three files, a busy flag, the editable preview, a saving flag) used to be six
// `useState`s in the 3,175-line parent; they are one reducer now (audit code #10).
function ImportPanel({ state, dispatch, readImportFiles, saveImportedBid }: ImportPanelProps) {
  const { busy: importBusy, saving: savingImport, bidFile: importBidFile,
    takeoffFile: importTakeoffFile, breakdownFile: importBreakdownFile, preview: importPreview } = state;
  const importFileRef = useRef<HTMLInputElement>(null);
  const importTakeoffRef = useRef<HTMLInputElement>(null);
  const importBreakdownRef = useRef<HTMLInputElement>(null);
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-hdr">
        <span className="panel-title">Import Finished Bid</span>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>No AI &middot; reads your proposal doc directly</span>
      </div>
      <div style={{ padding: 16 }}>
        {!importPreview ? (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--text3)', margin: '0 0 10px' }}>
              Already built this bid outside the AI pipeline? Upload the finished proposal and its takeoff
              together to pull the contract amount, scope of work, and square footage straight into this bid card.
            </p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>Bid Document (.docx / .pdf) — required</div>
                <input ref={importFileRef} type="file" accept=".docx,.pdf" style={{ display: 'none' }}
                  onChange={e => dispatch({ type: 'pickFile', slot: 'bid', file: e.target.files?.[0] ?? null })}/>
                <button className="btn ghost" disabled={importBusy} onClick={() => importFileRef.current?.click()} style={{ fontSize: 13 }}>
                  {importBidFile ? importBidFile.name : 'Choose Bid Document'} <Icon name="cloudup" size={14} stroke={2.2}/>
                </button>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>Takeoff Spreadsheet (.xlsx) — sq ft + scope</div>
                <input ref={importTakeoffRef} type="file" accept=".xlsx" style={{ display: 'none' }}
                  onChange={e => dispatch({ type: 'pickFile', slot: 'takeoff', file: e.target.files?.[0] ?? null })}/>
                <button className="btn ghost" disabled={importBusy} onClick={() => importTakeoffRef.current?.click()} style={{ fontSize: 13 }}>
                  {importTakeoffFile ? importTakeoffFile.name : 'Choose Takeoff'} <Icon name="cloudup" size={14} stroke={2.2}/>
                </button>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>Accubid Breakdown (.pdf) — labor + cost split</div>
                <input ref={importBreakdownRef} type="file" accept=".pdf" style={{ display: 'none' }}
                  onChange={e => dispatch({ type: 'pickFile', slot: 'breakdown', file: e.target.files?.[0] ?? null })}/>
                <button className="btn ghost" disabled={importBusy} onClick={() => importBreakdownRef.current?.click()} style={{ fontSize: 13 }}>
                  {importBreakdownFile ? importBreakdownFile.name : 'Choose Breakdown'} <Icon name="cloudup" size={14} stroke={2.2}/>
                </button>
              </div>
              <button className="btn" disabled={importBusy || !importBidFile} onClick={readImportFiles} style={{ fontSize: 13 }}>
                {importBusy ? 'Reading…' : 'Read Files'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
                Amount
                <input type="number" value={importPreview.amount}
                  onChange={e => dispatch({ type: 'editPreview', patch: { amount: e.target.value } })}
                  style={{ width: '100%', marginTop: 4, font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '8px 10px', boxSizing: 'border-box' }}/>
              </label>
              <label style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
                Project Type
                <select value={importPreview.projectType}
                  onChange={e => dispatch({ type: 'editPreview', patch: { projectType: e.target.value } })}
                  style={{ width: '100%', marginTop: 4, font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '8px 10px', boxSizing: 'border-box' }}>
                  <option value="">— Select —</option>
                  {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label style={{ width: 140, fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
                Brand / Prototype
                <input type="text" value={importPreview.brand} placeholder="e.g. AutoZone"
                  onChange={e => dispatch({ type: 'editPreview', patch: { brand: e.target.value } })}
                  style={{ width: '100%', marginTop: 4, font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '8px 10px', boxSizing: 'border-box' }}/>
              </label>
              <label style={{ width: 110, fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
                Sq Ft
                <input type="number" value={importPreview.sqFt}
                  onChange={e => dispatch({ type: 'editPreview', patch: { sqFt: e.target.value } })}
                  style={{ width: '100%', marginTop: 4, font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '8px 10px', boxSizing: 'border-box' }}/>
              </label>
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
              Scope of Work (extracted — review before saving)
              <textarea value={importPreview.scopeText}
                onChange={e => dispatch({ type: 'editPreview', patch: { scopeText: e.target.value } })}
                style={{ width: '100%', marginTop: 4, font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', height: 160, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}/>
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn" disabled={savingImport} onClick={saveImportedBid} style={{ fontSize: 13 }}>
                {savingImport ? 'Saving…' : 'Save to Bid Card'}
              </button>
              <button className="btn ghost" disabled={savingImport} onClick={() => dispatch({ type: 'clear' })} style={{ fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ImportPanel);
