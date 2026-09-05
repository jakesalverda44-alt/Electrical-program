import React, { memo } from 'react';
import Icon from '../../../components/Icon';
import { PcWorkspace } from '../constants';
import { ProjectDoc } from './shared';
import { isElecSheet, isPdfOrImage } from './parsing';

interface FilesTabProps {
  ws: PcWorkspace;
  fileInputRef: React.RefObject<HTMLInputElement>;
  fileObjectsRef: React.MutableRefObject<File[]>;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  projectDocs: ProjectDoc[];
  selectedDocIds: Set<string>;
  setSelectedDocIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  removeFile: (id: string, name: string) => void;
  clearFiles: () => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (e: React.DragEvent) => void;
  viewProjectDoc: (doc: ProjectDoc) => void;
  onGoFiles?: () => void;
}

function FilesTab({ ws, fileInputRef, fileObjectsRef, dragOver, setDragOver, projectDocs, selectedDocIds,
  setSelectedDocIds, removeFile, clearFiles, handleFileUpload, handleDrop, viewProjectDoc, onGoFiles }: FilesTabProps) {
  const elecCount = fileObjectsRef.current.filter(f => isElecSheet(f.name)).length;
  const totalCount = fileObjectsRef.current.length;
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
      {/* Drag-and-drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{ border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border2)'}`, borderRadius: 12, padding: '28px 20px',
          textAlign: 'center', cursor: 'pointer', marginBottom: 16, transition: 'border-color .15s, background .15s',
          background: dragOver ? 'var(--blue-soft)' : 'var(--surface2)' }}>
        <Icon name="cloudup" size={28} stroke={1.6}/>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginTop: 10, marginBottom: 4 }}>
          Drop plan sheets here or click to browse
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>PDF, JPG, PNG, ZIP — electrical sheets auto-detected</div>
        {totalCount > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: 'var(--text3)' }}>
            {totalCount} file{totalCount !== 1 ? 's' : ''} · <span style={{ color: 'var(--blue)' }}>{elecCount} electrical sheet{elecCount !== 1 ? 's' : ''} identified</span>
          </div>
        )}
      </div>
      {ws.files.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          No files uploaded yet.
        </div>
      ) : (
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">
              <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                <Icon name="file" size={15} stroke={1.8}/>
              </span>
              Uploaded Plan Files
            </span>
            <button className="btn ghost" onClick={clearFiles} style={{ height: 30, fontSize: 12, padding: '0 10px', color: '#E06A6A', borderColor: 'rgba(224,106,106,.45)' }}>
              <Icon name="x" size={13} stroke={2}/>Clear All
            </button>
          </div>
          <div className="table-scroll">
          <table className="ctable">
            <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Sheet Type</th><th></th></tr></thead>
            <tbody>
              {ws.files.map(f => {
                const elec = isElecSheet(f.name);
                return (
                  <tr key={f.id}>
                    <td className="nm"><Icon name="file" size={13} stroke={1.8}/> {f.name}</td>
                    <td><span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--blue-soft)', color: 'var(--blue)', textTransform: 'uppercase' }}>{f.type}</span></td>
                    <td className="sub">{f.size}</td>
                    <td>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase',
                        background: elec ? 'var(--green-soft)' : 'var(--surface2)',
                        color: elec ? 'var(--green)' : 'var(--text3)' }}>
                        {elec ? 'Electrical' : 'Other'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        title="Remove file"
                        onClick={() => removeFile(f.id, f.name)}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6 }}
                      >
                        <Icon name="x" size={13} stroke={2}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Files already attached to this bid in the Documents tab */}
      {projectDocs.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-hdr">
            <span className="panel-title">
              <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                <Icon name="file" size={15} stroke={1.8}/>
              </span>
              From Project Files
            </span>
            <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
              {selectedDocIds.size > 0 ? `${selectedDocIds.size} selected` : 'Select to include in takeoff'}
            </span>
          </div>
          <div style={{ padding: '4px 0' }}>
            {projectDocs.map(d => {
              const checked = selectedDocIds.has(d.id);
              const elec = isElecSheet(d.name);
              const eligible = isPdfOrImage(d);
              return (
                <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: eligible ? 'pointer' : 'not-allowed',
                  opacity: eligible ? 1 : 0.5,
                  background: checked ? 'var(--blue-soft)' : 'transparent', transition: 'background .1s' }}>
                  <input type="checkbox" checked={checked} disabled={!eligible}
                    title={eligible ? undefined : 'AI can only read PDFs and images'}
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
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', flexShrink: 0,
                    background: elec ? 'var(--green-soft)' : 'var(--surface2)',
                    color: elec ? 'var(--green)' : 'var(--text3)' }}>
                    {elec ? 'Electrical' : (d.category ?? '').replace(/_/g, ' ')}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(FilesTab);
