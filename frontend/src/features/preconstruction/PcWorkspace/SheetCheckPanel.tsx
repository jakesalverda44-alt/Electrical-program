// Next round A3 — the Sheet Check panel in the Documents step:
//   Included            — analysed sheets, and reference sheets with where
//                         they were referenced from ("referenced by E-7 note 3")
//   Needed but missing  — referenced but not uploaded: Upload, or Skip with a
//                         reason (skipped ones become proposal clarifications)
//   Left out            — every other page, with a force-in checkbox (reason)
// plus a shortcut to the one Run button ("Run without N sheets").
import { memo, useState } from 'react';
import Icon from '../../../components/Icon';
import { runButtonLabel, type SheetCheckData, type SheetCheckPage, type SheetCheckUpdate } from './useSheetCheck';

interface Props {
  data: SheetCheckData | null;
  error: string | null;
  canRun: boolean;
  onUpdate: (u: SheetCheckUpdate) => Promise<boolean>;
  onRecheck: () => void;
  /** Fix round S6 — classify the pages again (a page may have been missed). */
  onReclassify?: () => void;
  onUpload: () => void;
  onRunAnalysis: () => void;
  analysisRunning: boolean;
}

const label = (p: Pick<SheetCheckPage, 'sheetNo' | 'title' | 'file' | 'page'>) =>
  p.sheetNo || p.title ? `${p.sheetNo}${p.sheetNo && p.title ? ' — ' : ''}${p.title}` : `${p.file} p${p.page}`;

function ReasonForm({ placeholder, confirm, onSubmit, onCancel, testId }: {
  placeholder: string; confirm: string; onSubmit: (reason: string) => Promise<boolean>; onCancel: () => void; testId: string;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const okLen = reason.trim().length >= 10;
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder={placeholder} data-testid={`${testId}-reason`}
        style={{ flex: '1 1 220px', font: 'inherit', fontSize: 12.5, padding: '5px 8px', border: '1px solid var(--border2)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)' }}/>
      <button className="btn" disabled={!okLen || busy} data-testid={`${testId}-confirm`} style={{ height: 28, fontSize: 12 }}
        onClick={async () => { setBusy(true); const ok = await onSubmit(reason.trim()); setBusy(false); if (ok) onCancel(); }}>
        {confirm}
      </button>
      <button className="btn ghost" onClick={onCancel} style={{ height: 28, fontSize: 12 }}>Cancel</button>
      {!okLen && <span style={{ fontSize: 11.5, color: 'var(--text3)', alignSelf: 'center' }}>At least 10 characters</span>}
    </div>
  );
}

function SheetCheckPanel({ data, error, canRun, onUpdate, onRecheck, onReclassify, onUpload, onRunAnalysis, analysisRunning }: Props) {
  const [skipping, setSkipping] = useState<string | null>(null);
  const [forcing, setForcing] = useState<string | null>(null);
  const [showLeftOut, setShowLeftOut] = useState(false);
  const running = data?.status === 'running';
  const pages = data?.pages ?? [];
  const included = pages.filter(p => p.role !== 'excluded');
  const leftOut = pages.filter(p => p.role === 'excluded');
  const missing = data?.missing ?? [];
  const unskipped = data?.unskippedMissing ?? missing.filter(m => !m.skip).length;

  return (
    <div className="panel" style={{ margin: '0 24px 16px' }} data-testid="sheet-check-panel">
      <div className="panel-hdr">
        <span className="panel-title">
          <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
            <Icon name="file" size={15} stroke={1.8}/>
          </span>
          Sheet Check
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {running && <span data-testid="sheet-check-running" style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 700 }}>Checking sheets…</span>}
          {canRun && !running && pages.length > 0 && (
            <>
              <button className="btn ghost" onClick={onRecheck} style={{ height: 28, fontSize: 12 }}>Check again</button>
              {onReclassify && (
                <button className="btn ghost" onClick={onReclassify} style={{ height: 28, fontSize: 12 }} data-testid="sheet-check-reclassify"
                  title="Read every title block again (e.g. a page was placed in the wrong discipline)">Re-classify pages</button>
              )}
            </>
          )}
        </div>
      </div>
      <div style={{ padding: '12px 18px' }}>
        {error && <div style={{ color: 'var(--red)', fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
        {data?.status === 'error' && <div style={{ color: 'var(--red)', fontSize: 12.5, marginBottom: 8 }}>The sheet check failed: {data.error}</div>}
        {running && pages.length === 0 && (
          <div style={{ height: 4, background: 'var(--border2)', borderRadius: 2, overflow: 'hidden', margin: '8px 0' }}>
            <div style={{ height: '100%', width: '60%', background: 'var(--blue)', borderRadius: 2, animation: 'pcprogress 2.5s ease-in-out infinite alternate' }}/>
          </div>
        )}
        {!running && pages.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>
            Add plan files (or tick them under From Project Files) — the sheets are checked automatically.
          </div>
        )}

        {missing.length > 0 && (
          <div data-testid="sheet-check-missing" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
              Needed but missing ({missing.length})
            </div>
            {missing.map(m => (
              <div key={m.id} data-testid={`missing-${m.id}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{m.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                    referenced by {m.referencedBy.map(r => `${r.fromLabel}${r.note ? ` ${r.note}` : ''}`).join(', ')}
                  </span>
                  <span style={{ flex: 1 }}/>
                  {m.skip ? (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--text2)' }}>Skipped — {m.skip.reason}</span>
                      <button className="btn ghost" style={{ height: 26, fontSize: 12 }} onClick={() => void onUpdate({ action: 'unskip', refId: m.id })}>Undo</button>
                    </>
                  ) : (
                    <>
                      <button className="btn ghost" style={{ height: 26, fontSize: 12 }} onClick={onUpload} data-testid={`missing-upload-${m.id}`}>Upload</button>
                      <button className="btn ghost" style={{ height: 26, fontSize: 12 }} onClick={() => setSkipping(m.id)} data-testid={`missing-skip-${m.id}`}>Skip</button>
                    </>
                  )}
                </div>
                {m.referencedBy[0]?.context && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>“{m.referencedBy[0].context}”</div>}
                {skipping === m.id && (
                  <ReasonForm testId={`skip-${m.id}`} placeholder={`Why skip it? (proposal will say: ${m.notProvidedText})`} confirm="Skip"
                    onSubmit={reason => onUpdate({ action: 'skip', refId: m.id, reason, inputKey: data?.inputKey ?? null })} onCancel={() => setSkipping(null)}/>
                )}
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6 }}>
              Skipped sheets are listed in the proposal's Exclusions &amp; Clarifications (e.g. “Mechanical schedules not provided at time of bid”).
            </div>
          </div>
        )}

        {included.length > 0 && (
          <div data-testid="sheet-check-included" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
              Included ({included.length})
            </div>
            {included.map(p => (
              <div key={p.key} data-testid={`sheet-${p.key}`} style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '3px 0', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, minWidth: 0 }}>{label(p)}</span>
                {p.role === 'reference' && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--blue)', background: 'var(--blue-soft)', borderRadius: 6, padding: '1px 6px' }}>reference</span>
                )}
                <span style={{ color: 'var(--text3)', fontSize: 12 }}>{p.reason}</span>
                <span style={{ flex: 1 }}/>
                {p.override ? (
                  <button className="btn ghost" style={{ height: 24, fontSize: 11.5 }} onClick={() => void onUpdate({ action: 'clear', pageKey: p.key })}>Undo</button>
                ) : (
                  <button className="btn ghost" style={{ height: 24, fontSize: 11.5 }} onClick={() => setForcing(`out:${p.key}`)} data-testid={`leave-out-${p.key}`}>Leave out</button>
                )}
                {forcing === `out:${p.key}` && (
                  <ReasonForm testId={`out-${p.key}`} placeholder="Why leave it out?" confirm="Leave out"
                    onSubmit={reason => onUpdate({ action: 'exclude', pageKey: p.key, reason })} onCancel={() => setForcing(null)}/>
                )}
              </div>
            ))}
          </div>
        )}

        {leftOut.length > 0 && (
          <div data-testid="sheet-check-left-out">
            <button className="btn ghost" style={{ height: 26, fontSize: 12, marginBottom: 6 }} onClick={() => setShowLeftOut(v => !v)}>
              {showLeftOut ? 'Hide' : 'Show'} left out ({leftOut.length})
            </button>
            {showLeftOut && leftOut.map(p => (
              <div key={p.key} style={{ fontSize: 12.5, padding: '3px 0' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={forcing === `in:${p.key}`} data-testid={`force-in-${p.key}`}
                    onChange={e => (p.override ? void onUpdate({ action: 'clear', pageKey: p.key }) : setForcing(e.target.checked ? `in:${p.key}` : null))}/>
                  <span style={{ fontWeight: 700 }}>{label(p)}</span>
                  <span style={{ color: 'var(--text3)', fontSize: 12 }}>{p.reason}</span>
                </label>
                {forcing === `in:${p.key}` && (
                  <ReasonForm testId={`in-${p.key}`} placeholder="Why include it?" confirm="Include"
                    onSubmit={reason => onUpdate({ action: 'include', pageKey: p.key, reason })} onCancel={() => setForcing(null)}/>
                )}
              </div>
            ))}
          </div>
        )}

        {(data?.unclassifiedFiles?.length ?? 0) > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
            Not yet classified (the analysis will read them page by page): {data!.unclassifiedFiles.join(', ')}
          </div>
        )}

        {canRun && pages.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={onRunAnalysis} disabled={running || analysisRunning} data-testid="sheet-check-run" style={{ fontSize: 13 }}>
              <Icon name="spark" size={14} stroke={1.9}/>{runButtonLabel(unskipped)}
            </button>
            {unskipped > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 10 }}>
                Running without them records them as not provided at time of bid.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(SheetCheckPanel);
