// Upload panel for the Pre-Bid tab. Without this control the backend's import route is
// unreachable from the UI at all — this is the highest-value panel in the feature.
import { useState } from 'react';
import api from '../../api/client';

interface ImportResult { sqFtApplied: boolean; suggestedBrand: string | null }

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: 13,
};

export default function PreBidUpload({ bidId, hasScope, hasTakeoff, onImported }: {
  bidId: string;
  hasScope: boolean;
  hasTakeoff: boolean;
  onImported: () => void;
}) {
  const [scopeFile, setScopeFile] = useState<File | null>(null);
  const [takeoffFile, setTakeoffFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [brandApplied, setBrandApplied] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const canSubmit = (!!scopeFile || !!takeoffFile) && !submitting;

  const submit = async () => {
    if (!scopeFile && !takeoffFile) return;
    setSubmitting(true);
    setError(null);
    const fd = new FormData();
    if (scopeFile) fd.append('scope', scopeFile);
    if (takeoffFile) fd.append('takeoff', takeoffFile);
    try {
      const { data } = await api.post(`/preconstruction/${bidId}/import-prebid`, fd);
      setResult({ sqFtApplied: !!data?.sqFtApplied, suggestedBrand: data?.suggestedBrand ?? null });
      setBrandApplied(false);
      setScopeFile(null);
      setTakeoffFile(null);
      setInputKey(k => k + 1);
      onImported();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Upload failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const applyBrand = async () => {
    if (!result?.suggestedBrand) return;
    setApplying(true);
    try {
      await api.patch(`/bids/${bidId}`, { brand: result.suggestedBrand });
      setBrandApplied(true);
    } catch {
      setError('Could not apply the suggested brand.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-hdr"><span className="panel-title">Upload pre-bid package</span></div>
      <div style={{ padding: '12px 16px' }}>
        <div style={rowStyle}>
          <label style={{ minWidth: 190 }}>
            Scope narrative (.docx)
            {hasScope && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>— on file</span>}
          </label>
          <input key={`scope-${inputKey}`} type="file" accept=".docx"
            onChange={e => setScopeFile(e.target.files?.[0] ?? null)} />
        </div>
        <div style={rowStyle}>
          <label style={{ minWidth: 190 }}>
            Quantity takeoff (.xlsx)
            {hasTakeoff && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>— on file</span>}
          </label>
          <input key={`takeoff-${inputKey}`} type="file" accept=".xlsx"
            onChange={e => setTakeoffFile(e.target.files?.[0] ?? null)} />
        </div>
        {error && <div style={{ color: 'var(--amber)', fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
        <button onClick={submit} disabled={!canSubmit}
          style={{ padding: '6px 14px', fontSize: 13, cursor: canSubmit ? 'pointer' : 'default' }}>
          {submitting ? 'Uploading…' : 'Upload'}
        </button>

        {result && (
          <div style={{ marginTop: 12, fontSize: 12.5 }}>
            {result.sqFtApplied && (
              <div style={{ color: 'var(--muted)' }}>Square footage filled from the takeoff.</div>
            )}
            {result.suggestedBrand && (
              <div style={{ marginTop: 4 }}>
                Suggested brand: <strong>{result.suggestedBrand}</strong>{' '}
                {brandApplied ? (
                  <span style={{ color: 'var(--muted)' }}>Applied.</span>
                ) : (
                  <button onClick={applyBrand} disabled={applying}
                    style={{ fontSize: 12, padding: '2px 8px', cursor: 'pointer' }}>
                    {applying ? 'Applying…' : 'Apply'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
