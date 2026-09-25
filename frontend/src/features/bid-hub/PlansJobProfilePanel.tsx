import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { useMutation } from '../../hooks/useMutation';
import { Bid } from '../../types';
import { ProjectDoc, isGeneratedDoc } from '../preconstruction/PcWorkspace/shared';
import { isPdfOrImage } from '../preconstruction/PcWorkspace/parsing';

// Bid Overview: Plans Upload + Job Profile (2026-09-24 plan) — Decision 1's
// panel. Uploading here uses the exact same storage (POST /documents,
// category 'plans') Estimating -> Documents has always shown; that tab now
// only links back here (coordinator override, same date). The sheet check
// (Decision 2) and the job-profile extraction (Decision 3) both run right
// after an upload; the card-update rules (Decision 4) already applied on
// the server by the time this component reads the response — this panel's
// only job is to show what happened and let the estimator accept/ignore a
// conflict.

interface FieldEvidence { value: unknown; sheet: string | null; quote: string | null; confidence: 'extracted' | 'inferred' }
interface StoredSuggestion { value: unknown; sheet: string | null; quote: string | null; status: 'pending' | 'accepted' | 'ignored' }
interface SheetSummary { total: number; electrical: number; missingRefs: number }
interface JobProfileGet {
  profile: Record<string, FieldEvidence>;
  suggestions: Record<string, StoredSuggestion>;
  sheet_summary: SheetSummary | null;
  cost_cents: number | null;
  updated_at: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  project_type: 'Project type', brand: 'Brand', store_number: 'Store #',
  prototype: 'Prototype', loc: 'Location', sq_ft: 'Building SF', plan_date: 'Plan date',
  owner_name: 'Owner', architect: 'Architect', engineer: 'Engineer of record',
  build_type: 'Build type', name: 'Bid name',
};

// Display order — the plan lists these fields in this order (Decision 3).
const FIELD_ORDER = [
  'project_type', 'brand', 'store_number', 'prototype', 'loc', 'sq_ft',
  'plan_date', 'owner_name', 'architect', 'engineer', 'build_type',
];

function displayValue(field: string, v: unknown): string {
  if (v == null) return '—';
  if (field === 'sq_ft') return `${Number(v).toLocaleString()} SF`;
  if (field === 'plan_date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${m}/${d}/${y}`;
  }
  return String(v);
}

function eligiblePlanDoc(d: ProjectDoc): boolean {
  return isPdfOrImage(d) && !isGeneratedDoc(d);
}

interface Props {
  bid: Bid;
  onBidUpdated: (bid: Bid) => void;
  onGoEstimating: () => void;
}

export default function PlansJobProfilePanel({ bid, onBidUpdated, onGoEstimating }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: docsData, reload: reloadDocs } = useApi<ProjectDoc[]>('/documents', { params: { linked_id: bid.id } });
  const planDocs = useMemo(() => (docsData ?? []).filter(eligiblePlanDoc), [docsData]);

  const { data: profileData, reload: reloadProfile } = useApi<JobProfileGet | null>(`/preconstruction/${bid.id}/job-profile`);

  const { run: runPipeline, saving: analyzing } = useMutation(
    async (docIds: string[]) => {
      // Best-effort: a role without run_analysis (Decision 8 — this step
      // deliberately does NOT require it) still gets the profile even
      // though the one-line sheet summary won't be there yet.
      try { await api.post(`/preconstruction/${bid.id}/sheet-check/run`, { document_ids: docIds }); } catch { /* see above */ }
      const { data } = await api.post(`/preconstruction/${bid.id}/job-profile/run`, { document_ids: docIds });
      return data as { bid: Bid };
    },
    {
      onSuccess: (data) => { onBidUpdated(data.bid); reloadProfile(); },
      errorTitle: 'Could not read the plans',
    },
  );

  const { run: runUpload, saving: uploading } = useMutation(
    async (files: File[]) => {
      const newIds: string[] = [];
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('linked_id', bid.id);
        fd.append('linked_name', bid.name);
        fd.append('div', 'elec');
        fd.append('category', 'plans');
        fd.append('display_name', f.name);
        const { data } = await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        newIds.push(data.id as string);
      }
      return newIds;
    },
    {
      onSuccess: async (newIds) => {
        reloadDocs();
        const allIds = [...new Set([...planDocs.map(d => d.id), ...newIds])];
        if (allIds.length) await runPipeline(allIds);
      },
      errorTitle: 'Upload failed',
    },
  );

  const busy = uploading || analyzing;

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => /\.(pdf|jpe?g|png|zip)$/i.test(f.name));
    if (arr.length) runUpload(arr);
  };

  const { run: runSuggestion } = useMutation(
    async ({ field, action }: { field: string; action: 'accept' | 'ignore' }) => {
      const { data } = await api.put(`/preconstruction/${bid.id}/job-profile/suggestions/${field}`, { action });
      return data as { bid: Bid };
    },
    {
      onSuccess: (data) => { onBidUpdated(data.bid); reloadProfile(); },
      errorTitle: 'Could not update the suggestion',
    },
  );

  const profileFields = profileData?.profile ?? {};
  const suggestions = Object.entries(profileData?.suggestions ?? {}).filter(([, s]) => s.status === 'pending');
  const summary = profileData?.sheet_summary ?? null;

  return (
    <div className="panel" data-testid="plans-job-profile-panel">
      <div className="panel-hdr">
        <span className="panel-title">
          <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
            <Icon name="file" size={15} stroke={1.8}/>
          </span>
          Plans &amp; Job Profile
        </span>
        <button className="btn ghost" style={{ height: 26, fontSize: 11, padding: '0 8px' }} onClick={onGoEstimating}>
          Open in Estimating →
        </button>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.zip" style={{ display: 'none' }}
          onChange={e => { handleFiles(e.target.files ?? []); if (fileInputRef.current) fileInputRef.current.value = ''; }}
          data-testid="plans-file-input"
        />
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border2)'}`, borderRadius: 12, padding: '22px 16px',
            textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s, background .15s',
            background: dragOver ? 'var(--blue-soft)' : 'var(--surface2)' }}
        >
          <Icon name="cloudup" size={24} stroke={1.6}/>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>
            {busy ? 'Uploading and reading the plans…' : 'Drop plan sheets here or click to browse'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>PDF, JPG, PNG, ZIP</div>
        </div>

        {planDocs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {planDocs.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text2)', padding: '3px 0' }}>
                <Icon name="file" size={12} stroke={1.8}/>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.display_name || d.name}</span>
                {d.page_count != null && <span style={{ color: 'var(--text3)' }}>{d.page_count} pg</span>}
              </div>
            ))}
          </div>
        )}

        {summary && (
          <div style={{ fontSize: 12.5, color: 'var(--text3)', fontWeight: 600 }} data-testid="sheet-summary-line">
            {summary.total} sheet{summary.total !== 1 ? 's' : ''} in set · {summary.electrical} electrical
            {summary.missingRefs > 0 ? ` · ${summary.missingRefs} missing ref${summary.missingRefs !== 1 ? 's' : ''}` : ''}
          </div>
        )}

        {Object.keys(profileFields).length > 0 && (
          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }} data-testid="detected-profile">
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              Detected from plans
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
              {FIELD_ORDER.filter(f => profileFields[f]).map(f => (
                <div key={f} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 700 }}>{FIELD_LABELS[f]}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }} title={profileFields[f].quote ?? undefined}>
                    {displayValue(f, profileFields[f].value)}
                    {profileFields[f].sheet && <span style={{ color: 'var(--text3)', fontWeight: 500 }}> ({profileFields[f].sheet})</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="job-profile-suggestions">
            {suggestions.map(([field, s]) => (
              <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--amber-soft)', borderRadius: 9, padding: '10px 12px' }}>
                <Icon name="spark" size={14} stroke={2}/>
                <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>
                  {field === 'name'
                    ? <>Plans suggest naming this bid <strong>"{String(s.value)}"</strong>. Rename?</>
                    : <>Plans say <strong>{displayValue(field, s.value)}</strong> for {FIELD_LABELS[field] ?? field} — card says <strong>{displayValue(field, (bid as unknown as Record<string, unknown>)[field])}</strong>. Update?</>}
                </div>
                <button className="btn ghost" style={{ height: 26, fontSize: 11, padding: '0 8px' }}
                  onClick={() => runSuggestion({ field, action: 'ignore' })} data-testid={`suggestion-ignore-${field}`}>
                  Ignore
                </button>
                <button className="btn" style={{ height: 26, fontSize: 11, padding: '0 8px' }}
                  onClick={() => runSuggestion({ field, action: 'accept' })} data-testid={`suggestion-accept-${field}`}>
                  Accept
                </button>
              </div>
            ))}
          </div>
        )}

        {planDocs.length === 0 && !busy && (
          <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
            No plans on this bid yet.
          </div>
        )}
      </div>
    </div>
  );
}
