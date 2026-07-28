import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import Icon from './Icon';
import { sheetToRows, docxToHtml, sanitizeDocHtml } from './filePreview';

interface Props {
  title: string;
  kind: 'sheet' | 'doc';
  buf: ArrayBuffer;
  onClose: () => void;
  onDownload: () => void;
}

export default function FilePreviewModal({ title, kind, buf, onClose, onDownload }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheets, setSheets] = useState<string[][][]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [html, setHtml] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        if (kind === 'sheet') {
          const wb = XLSX.read(buf, { type: 'array' });
          const rows = await sheetToRows(buf);
          if (cancelled) return;
          setSheetNames(wb.SheetNames);
          setSheets(rows);
          setActiveSheet(0);
        } else {
          const rawHtml = await docxToHtml(buf);
          if (cancelled) return;
          setHtml(sanitizeDocHtml(rawHtml));
        }
      } catch {
        if (!cancelled) setError('Could not render a preview of this file.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [buf, kind]);

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: '100%', maxWidth: 900 }}>
        <div className="modal-hdr">
          <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h3>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          {loading ? (
            <div style={{ fontSize: 12.5, color: 'var(--text3)', padding: '20px 0' }}>Loading preview…</div>
          ) : error ? (
            <div style={{ fontSize: 12.5, color: 'var(--red)', padding: '20px 0' }}>{error}</div>
          ) : kind === 'sheet' ? (
            <>
              {sheetNames.length > 1 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  {sheetNames.map((name, i) => (
                    <button
                      key={name + i}
                      className={i === activeSheet ? 'btn' : 'btn ghost'}
                      onClick={() => setActiveSheet(i)}
                      style={{ padding: '5px 10px', fontSize: 12 }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
                  <tbody>
                    {(sheets[activeSheet] || []).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ border: '1px solid var(--border)', padding: '5px 8px', whiteSpace: 'nowrap' }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="docx-preview" dangerouslySetInnerHTML={{ __html: html }}/>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn" onClick={onDownload}>Download</button>
        </div>
      </div>
    </div>
  );
}
