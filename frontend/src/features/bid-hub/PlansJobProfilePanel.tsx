import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { useMutation } from '../../hooks/useMutation';
import { Bid } from '../../types';
import { ProjectDoc, isCurrentPlanDoc } from '../preconstruction/PcWorkspace/shared';
import { PROJECT_TYPES } from '../preconstruction/constants';

// Bid Overview: Plans Upload + Job Profile — Decision 1's panel.
//
// Job profile fix round (review 1755e62): uploading files the plans as the
// bid's documents (same POST /documents storage Estimating reads), then asks
// the server to read them. The server waits for the sheet check of exactly
// these files (202 'waiting') and then makes one structured model call over
// the covers, code / area data and electrical title blocks; this panel polls
// until the profile is done. Only validated, high-confidence values were
// filled onto the card; everything else shows here as a suggestion.

type Confidence = 'high' | 'medium' | 'low';
interface FieldEvidence { value: unknown; sheet: string | null; quote: string | null; confidence: Confidence; validated?: boolean; notes?: string[]; label?: string }
interface StoredSuggestion { value: unknown; sheet: string | null; quote: string | null; status: 'pending' | 'accepted' | 'ignored' | 'overridden'; confidence?: string; notes?: string[] }
interface SystemEvidence { value: boolean | null; sheet: string | null; quote: string | null }
interface SheetSummary { status?: string; total: number; electrical: number; missingRefs: number }
interface FillRecord { value: unknown; status: 'filled' | 'rejected' | 'edited' }
interface RejectedValue { field: string; value: unknown; sheet: string | null; reason: string }
export interface JobProfileGet {
  status?: 'idle' | 'waiting' | 'running' | 'complete' | 'undetermined' | 'error';
  profile?: Record<string, FieldEvidence>;
  suggestions?: Record<string, StoredSuggestion>;
  systems?: Record<string, SystemEvidence> | null;
  fills?: Record<string, FillRecord>;
  rejected?: RejectedValue[] | null;
  sheet_summary?: SheetSummary | null;
  cost_cents?: number | string | null;
  error?: string | null;
  undetermined_reason?: string | null;
  updated_at?: string | null;
  bid?: Bid | null;
}

const FIELD_LABELS: Record<string, string> = {
  project_type: 'Project type', brand: 'Brand', store_number: 'Store #',
  prototype: 'Prototype', loc: 'Location', sq_ft: 'Building SF', plan_date: 'Plan date',
  owner_name: 'Owner', architect: 'Architect', engineer: 'Engineer of record',
  build_type: 'Build type', name: 'Bid name',
};

const FIELD_ORDER = [
  'project_type', 'brand', 'store_number', 'prototype', 'loc', 'sq_ft',
  'plan_date', 'owner_name', 'architect', 'engineer', 'build_type',
];

const SYSTEM_LABELS: Array<[string, string]> = [
  ['fuel', 'Fuel'], ['site_lighting', 'Site lighting'], ['fire_alarm', 'Fire alarm'], ['generator', 'Generator'], ['ev', 'EV charging'],
];

const BUILD_TYPE_LABELS: Record<string, string> = { new: 'New build', remodel: 'Remodel', tenant: 'Tenant fit-out' };

/** A card or plans value for display — labels, not codes (review N1 / S11),
 *  dates without the time (review B3). */
export function displayValue(field: string, v: unknown): string {
  if (v == null || v === '' || v === '—') return '—';
  if (field === 'sq_ft') return `${Number(v).toLocaleString('en-US')} SF`;
  if (field === 'project_type') return PROJECT_TYPES.find(t => t.value === v)?.label ?? String(v);
  if (field === 'build_type') return BUILD_TYPE_LABELS[String(v)] ?? String(v);
  if (field === 'plan_date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split('-');
    return `${m}/${d}/${y}`;
  }
  return String(v);
}

const POLL_MS = 2500;
const MAX_POLLS = 120; // ~5 minutes

interface Props {
  bid: Bid;
  onBidUpdated: (bid: Bid) => void;
  onGoEstimating: () => void;
}

export default function PlansJobProfilePanel({ bid, onBidUpdated, onGoEstimating }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: docsData, reload: reloadDocs } = useApi<ProjectDoc[]>('/documents', { params: { linked_id: bid.id } });
  const planDocs = useMemo(() => (docsData ?? []).filter(isCurrentPlanDoc), [docsData]);

  const { data: loadedProfile } = useApi<JobProfileGet | null>(`/preconstruction/${bid.id}/job-profile`);
  const [live, setLive] = useState<JobProfileGet | null>(null);
  const profileData = live ?? loadedProfile ?? null;
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  const settle = (data: JobProfileGet) => {
    setLive(data);
    if (data.bid) onBidUpdated(data.bid);
  };

  const poll = (n = 0) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setPolling(true);
    pollTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/preconstruction/${bid.id}/job-profile`);
        if (!alive.current) return;
        const d = data as JobProfileGet;
        setLive(d);
        if ((d.status === 'waiting' || d.status === 'running') && n < MAX_POLLS) { poll(n + 1); return; }
        setPolling(false);
        settle(d);
      } catch {
        if (alive.current) setPolling(false);
      }
    }, POLL_MS);
  };

  // A run still in progress when the page opened: keep following it.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !loadedProfile) return;
    resumed.current = true;
    if (loadedProfile.status === 'waiting' || loadedProfile.status === 'running') poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedProfile]);

  // Round 2 (R2-B2) — "Read the plans again" is always offered, even while
  // a run is waiting, and forces a fresh sheet check + model call.
  const { run: readPlans, saving: starting } = useMutation(
    async (opts: { force?: boolean }) => {
      const res = await api.post(`/preconstruction/${bid.id}/job-profile/run`, opts.force ? { force: true } : {});
      return res.data as JobProfileGet;
    },
    {
      onSuccess: (data) => {
        setLive(data);
        if (data.status === 'waiting' || data.status === 'running') poll();
        else settle(data);
      },
      errorTitle: 'Could not read the plans',
    },
  );

  const { run: runUpload, saving: uploading } = useMutation(
    async (files: File[]) => {
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('linked_id', bid.id);
        fd.append('linked_name', bid.name);
        fd.append('div', 'elec');
        fd.append('category', 'plans');
        fd.append('display_name', f.name);
        await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
    },
    {
      onSuccess: async () => {
        reloadDocs();
        // The server reads the bid's current plan set (never old revisions or
        // generated files) and waits for its sheet check.
        await readPlans({});
      },
      errorTitle: 'Upload failed',
    },
  );

  const busy = uploading || starting || polling;

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => /\.(pdf|jpe?g|png|zip)$/i.test(f.name));
    if (arr.length) runUpload(arr);
  };

  const { run: runSuggestion } = useMutation(
    async ({ field, action }: { field: string; action: 'accept' | 'ignore' }) => {
      const { data } = await api.put(`/preconstruction/${bid.id}/job-profile/suggestions/${field}`, { action });
      return { bid: (data as { bid: Bid }).bid, field, action };
    },
    {
      onSuccess: ({ bid: updated, field, action }) => {
        onBidUpdated(updated);
        setLive(prev => {
          const base = prev ?? loadedProfile;
          if (!base?.suggestions?.[field]) return base ?? null;
          return { ...base, bid: updated, suggestions: { ...base.suggestions, [field]: { ...base.suggestions[field], status: action === 'accept' ? 'accepted' : 'ignored' } } };
        });
      },
      errorTitle: 'Could not update the suggestion',
    },
  );

  const status = profileData?.status ?? 'idle';
  const profileFields = profileData?.profile ?? {};
  const suggestions = Object.entries(profileData?.suggestions ?? {}).filter(([, s]) => s.status === 'pending');
  const summary = profileData?.sheet_summary ?? null;
  const fills = profileData?.fills ?? {};
  const systems = profileData?.systems ?? null;
  const rejected = profileData?.rejected ?? [];
  const cardValue = (field: string) => (bid as unknown as Record<string, unknown>)[field];

  const statusLine = (() => {
    if (uploading) return 'Uploading the plans…';
    if (status === 'waiting') return 'Sorting the sheets (sheet check)… the profile runs when it finishes.';
    if (status === 'running') return 'Reading the cover, code data and electrical title blocks…';
    return null;
  })();

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

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
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
            {busy ? 'Reading the plans…' : 'Drop plan sheets here or click to browse'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>PDF, JPG, PNG, ZIP</div>
        </div>

        {planDocs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {planDocs.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text2)', padding: '3px 0', minWidth: 0 }}>
                <Icon name="file" size={12} stroke={1.8}/>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.display_name || d.name}</span>
                {d.page_count != null && <span style={{ color: 'var(--text3)' }}>{d.page_count} pg</span>}
              </div>
            ))}
            {!uploading && !starting && (
              <button type="button" className="btn ghost" data-testid="read-plans"
                onClick={() => readPlans(status === 'idle' ? {} : { force: true })}
                style={{ alignSelf: 'flex-start', height: 26, fontSize: 11, padding: '0 8px', marginTop: 4 }}>
                {status === 'idle' ? 'Read the plans' : 'Read the plans again'}
              </button>
            )}
          </div>
        )}

        {statusLine && (
          <div data-testid="job-profile-status" style={{ fontSize: 12.5, color: 'var(--blue)', fontWeight: 600 }}>{statusLine}</div>
        )}
        {status === 'undetermined' && !busy && (
          <div data-testid="job-profile-undetermined" style={{ fontSize: 12.5, color: 'var(--amber)', fontWeight: 600 }}>
            Couldn't determine the job from these plans{profileData?.undetermined_reason ? ` — ${profileData.undetermined_reason}` : ''}. Nothing on the card was changed.
          </div>
        )}
        {status === 'error' && !busy && (
          <div data-testid="job-profile-error" style={{ fontSize: 12.5, color: 'var(--red)', fontWeight: 600 }}>
            Couldn't read the plans{profileData?.error ? ` — ${profileData.error}` : ''}.
          </div>
        )}

        {summary && (
          <div style={{ fontSize: 12.5, color: 'var(--text3)', fontWeight: 600 }} data-testid="sheet-summary-line">
            {summary.status === 'running' && !summary.total
              ? 'Sheet check running…'
              : <>{summary.total} sheet{summary.total !== 1 ? 's' : ''} in set · {summary.electrical} electrical
                {summary.missingRefs > 0 ? ` · ${summary.missingRefs} missing ref${summary.missingRefs !== 1 ? 's' : ''}` : ''}</>}
          </div>
        )}

        {Object.keys(profileFields).length > 0 && (
          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }} data-testid="detected-profile">
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              Detected from plans
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px 16px' }}>
              {FIELD_ORDER.filter(f => profileFields[f]).map(f => {
                const ev = profileFields[f];
                const filled = fills[f]?.status === 'filled';
                const tag = filled ? 'filled' : ev.confidence !== 'high' || ev.validated === false ? `${ev.confidence} confidence` : null;
                return (
                  <div key={f} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} data-testid={`detected-${f}`}>
                    <span style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 700 }}>{FIELD_LABELS[f]}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, overflowWrap: 'anywhere' }}
                      title={[ev.quote ? `"${ev.quote}"` : null, ...(ev.notes ?? [])].filter(Boolean).join(' — ') || undefined}>
                      {displayValue(f, ev.value)}
                      {ev.sheet && <span style={{ color: 'var(--text3)', fontWeight: 500 }}> ({ev.sheet})</span>}
                      {tag && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: filled ? 'var(--green)' : 'var(--amber)' }}>{tag}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {systems && (
          <div data-testid="notable-systems" style={{ fontSize: 12.5, color: 'var(--text2)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
            <span style={{ fontWeight: 700, color: 'var(--text3)' }}>Notable systems:</span>
            {SYSTEM_LABELS.map(([k, label]) => {
              const s = systems[k];
              const v = s?.value;
              return (
                <span key={k} data-testid={`system-${k}`} title={s?.quote ? `"${s.quote}"` : undefined}
                  style={{ color: v === true ? 'var(--green)' : v === false ? 'var(--text3)' : 'var(--text3)', fontWeight: v === true ? 700 : 500 }}>
                  {label}: {v === true ? `yes${s?.sheet ? ` (${s.sheet})` : ''}` : v === false ? 'no' : 'not shown'}
                </span>
              );
            })}
          </div>
        )}

        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="job-profile-suggestions">
            {suggestions.map(([field, s]) => {
              const current = cardValue(field);
              const empty = current == null || current === '' || current === '—';
              return (
                <div key={field} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--amber-soft)', borderRadius: 9, padding: '10px 12px' }}>
                  <Icon name="spark" size={14} stroke={2}/>
                  <div style={{ flex: '1 1 180px', minWidth: 0, fontSize: 12.5, color: 'var(--text)', fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {field === 'name'
                      ? <>Plans suggest naming this bid <strong>"{String(s.value)}"</strong>. Rename?</>
                      : empty
                        ? <>Plans say <strong>{displayValue(field, s.value)}</strong> for {FIELD_LABELS[field] ?? field}. Use it?</>
                        : <>Plans say <strong>{displayValue(field, s.value)}</strong> for {FIELD_LABELS[field] ?? field} — card says <strong>{displayValue(field, current)}</strong>. Update?</>}
                    {s.confidence && s.confidence !== 'high' && field !== 'name' && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, marginTop: 2 }}>
                        {s.confidence} confidence{s.notes?.length ? ` — ${s.notes.join('; ')}` : ''}{s.sheet ? ` (sheet ${s.sheet})` : ''}
                      </div>
                    )}
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
              );
            })}
          </div>
        )}

        {rejected.length > 0 && (
          <details data-testid="job-profile-rejected" style={{ fontSize: 12, color: 'var(--text3)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{rejected.length} value{rejected.length !== 1 ? 's' : ''} from the plans not used</summary>
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              {rejected.map((r, i) => (
                <li key={i} style={{ overflowWrap: 'anywhere' }}>{FIELD_LABELS[r.field] ?? r.field} "{String(r.value)}"{r.sheet ? ` (${r.sheet})` : ''} — {r.reason}</li>
              ))}
            </ul>
          </details>
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
