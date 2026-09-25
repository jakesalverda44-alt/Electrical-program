import React, { memo } from 'react';
import Icon from '../../../components/Icon';
import { ProjectDoc, isGeneratedDoc } from './shared';
import { isElecSheet, isPdfOrImage } from './parsing';

interface FilesTabProps {
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  projectDocs: ProjectDoc[];
  selectedDocIds: Set<string>;
  setSelectedDocIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  viewProjectDoc: (doc: ProjectDoc) => void;
  onGoFiles?: () => void;
  /** Coordinator override (2026-09-24) — the plan-file dropzone moved to the
   *  Bid Hub's Overview tab ("Plans & Job Profile" panel); Documents is now a
   *  read-only list of the bid's plan files plus this link. */
  onGoOverview?: () => void;
}

// Coordinator override (2026-09-24) — this tab no longer has its own upload
// UI. The hidden file input stays: SheetCheckPanel's per-sheet "Upload" (a
// missing referenced sheet) still opens it via fileInputRef, a narrower,
// targeted action distinct from the bulk dropzone that used to live here.
function FilesTab({ fileInputRef, handleFileUpload, projectDocs, selectedDocIds,
  setSelectedDocIds, viewProjectDoc, onGoFiles, onGoOverview }: FilesTabProps) {
  return (
    <div style={{ padding: '20px 24px' }}>
      <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.zip" style={{ display: 'none' }} onChange={handleFileUpload}/>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
        All project files (view/download) live in the Files tab.
        {onGoFiles && (
          <>
            {' '}
            <button type="button" onClick={onGoFiles}
              style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--blue)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
              Go to Files
            </button>
          </>
        )}
      </div>

      {/* Plan set — read-only here; uploading/replacing plans happens on Overview. */}
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">
            <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
              <Icon name="file" size={15} stroke={1.8}/>
            </span>
            Plan Files
          </span>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
            {selectedDocIds.size > 0 ? `${selectedDocIds.size} selected` : 'Select to include in takeoff'}
          </span>
        </div>
        {onGoOverview && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border2)', fontSize: 12, color: 'var(--text3)' }}>
            <button type="button" onClick={onGoOverview}
              style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--blue)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
              Add or replace plans on the bid Overview →
            </button>
          </div>
        )}
        {projectDocs.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            No plan files yet — add them on the bid Overview.
          </div>
        ) : (
          <div style={{ padding: '4px 0' }}>
            {projectDocs.map(d => {
              const checked = selectedDocIds.has(d.id);
              const elec = isElecSheet(d.name);
              // Re-run reset follow-up — the CRM's own proposals, takeoffs and
              // pre-bid packages are never analysis inputs.
              const generated = isGeneratedDoc(d);
              const eligible = isPdfOrImage(d) && !generated;
              return (
                <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: eligible ? 'pointer' : 'not-allowed',
                  opacity: eligible ? 1 : 0.5,
                  background: checked ? 'var(--blue-soft)' : 'transparent', transition: 'background .1s' }}>
                  <input type="checkbox" checked={checked} disabled={!eligible}
                    title={eligible ? undefined : generated ? 'CRM-generated — not an analysis input' : 'AI can only read PDFs and images'}
                    data-testid={`project-doc-checkbox-${d.id}`}
                    onChange={e => setSelectedDocIds(prev => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(d.id); else next.delete(d.id);
                      return next;
                    })}
                    style={{ width: 15, height: 15, accentColor: 'var(--blue)', cursor: eligible ? 'pointer' : 'not-allowed', flexShrink: 0 }}
                  />
                  <Icon name="file" size={13} stroke={1.8}/>
                  <span
                    onClick={e => { e.preventDefault(); e.stopPropagation(); viewProjectDoc(d); }}
                    title="Click to preview"
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                    className="pc-file-name-link"
                  >
                    {d.display_name || d.name}
                  </span>
                  {d.page_count != null && (
                    <span className="sub" style={{ fontSize: 11, flexShrink: 0 }}>{d.page_count} pg</span>
                  )}
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', flexShrink: 0,
                    background: elec ? 'var(--green-soft)' : 'var(--surface2)',
                    color: elec ? 'var(--green)' : 'var(--text3)' }}>
                    {elec && !generated ? 'Electrical' : (d.category ?? '').replace(/_/g, ' ')}
                  </span>
                  {generated && (
                    <span data-testid={`project-doc-generated-${d.id}`} style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', flexShrink: 0, background: 'var(--surface2)', color: 'var(--text3)' }}
                      title="Generated by the CRM — not an analysis input">
                      {d.superseded_at ? 'Superseded' : 'Generated'}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(FilesTab);
