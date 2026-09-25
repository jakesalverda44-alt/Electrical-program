import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { useMutation } from '../../hooks/useMutation';
import { useConfirm } from '../../components/ConfirmDialog';
import { useShowToast } from '../../contexts/AppContext';
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
interface SheetSummary { status?: string; total: number; electrical: number; missingRefs: number; specPages?: number }
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
  /** Round 3 R3-B1 — likely plan revisions (answer Replace / Keep both). */
  revision_proposals?: RevisionProposal[];
  duplicate_sheets?: Array<{ sheetNo: string; files: string[]; titles: string[] }>;
}
interface RevisionProposal {
  id: string; olderFile: string; newerFile: string; matchingSheets: string[]; why: string;
  decision?: { decision: 'replace' | 'keep_both'; by: string; at: string };
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
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const showToast = useShowToast();

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

/** One file's upload post — `skipDedupe` for "Replace plan set", whose new
   *  bytes may legitimately match a file it's about to remove. */
  const uploadOne = async (f: File, opts: { skipDedupe?: boolean } = {}) => {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('linked_id', bid.id);
    fd.append('linked_name', bid.name);
    fd.append('div', 'elec');
    fd.append('category', 'plans');
    fd.append('display_name', f.name);
    if (opts.skipDedupe) fd.append('skip_dedupe', 'true');
    const { data } = await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    return { file: f, duplicate: !!(data as { duplicate?: boolean }).duplicate };
  };

  const { run: runUpload, saving: uploading } = useMutation(
    async (files: File[]) => {
      const results: Array<{ file: File; duplicate: boolean }> = [];
      for (const f of files) results.push(await uploadOne(f));
      return results;
    },
    {
      onSuccess: async () => {
        reloadDocs();
        // The server reads the bid's current plan set (never old revisions or
        // generated files) and waits for its sheet check.
        await readPlans({});
      },
      // Task 1 (dedupe) — a re-upload whose content hash already matches a
      // plan file on this bid stores nothing new; tell the user instead of
      // silently doing nothing.
      successToast: (results) => {
        const dupes = results.filter(r => r.duplicate);
        return dupes.length
          ? { title: dupes.length === 1 ? 'Already uploaded' : `${dupes.length} files already uploaded`, sub: dupes.map(d => d.file.name).join(', '), variant: 'info' }
          : null;
      },
      errorTitle: 'Upload failed',
    },
  );

  // Fix round, review S4 — Undo restores through the scoped route, which
  // refreshes in the same round trip (never the generic /documents restore
  // plus a separate job-profile/run — that left the sheet summary stale).
  const undoRemove = async (doc: ProjectDoc) => {
    try {
      const { data } = await api.post(`/preconstruction/${bid.id}/plan-files/${doc.id}/restore`);
      reloadDocs();
      settle(data as JobProfileGet);
      showToast({ title: 'Plan file restored', sub: doc.display_name || doc.name });
    } catch {
      showToast({ variant: 'error', title: 'Could not undo', sub: 'Restore it from Settings → Trash instead.' });
    }
  };

  // Task 1 — remove ("x"): soft-deletes to Trash (the existing documents
  // path), then refreshes the job profile from the response in one round
  // trip. Undo restores it and re-syncs.
  const { run: runRemoveFile } = useMutation(
    async (doc: ProjectDoc) => {
      const { data } = await api.delete(`/preconstruction/${bid.id}/plan-files/${doc.id}`);
      return { doc, data: data as JobProfileGet };
    },
    {
      onSuccess: ({ data }) => { reloadDocs(); settle(data); },
      successToast: ({ doc }) => ({
        title: 'Plan file removed', sub: doc.display_name || doc.name,
        action: { label: 'Undo', onClick: () => undoRemove(doc) },
      }),
      errorTitle: 'Could not remove the plan file',
    },
  );

  // Addendum PB1/PS1 — Undo for a replace takes the opId the replace itself
  // returned (never free-form document ids — the server refuses to trash
  // anything a client merely names), and is all-or-nothing: a 409 means
  // nothing changed, and the message says so.
  const undoReplace = async (replaceOpId: string, fileCount: number) => {
    try {
      const { data } = await api.post(`/preconstruction/${bid.id}/plan-files/replace/undo`, { opId: replaceOpId });
      reloadDocs();
      settle(data as JobProfileGet);
      showToast({ title: fileCount === 1 ? 'Plan file restored' : 'Plan set restored' });
    } catch (err) {
      const status = (err as { response?: { status?: number } } | null)?.response?.status;
      showToast({ variant: 'error', title: 'Could not undo',
        sub: status === 409 ? "Can't undo — restore the old files from Trash instead." : 'Restore the files from Settings → Trash instead.' });
    }
  };

  // Fix round, review S1/S2 — "Replace plan set" is ONE server-side,
  // all-or-nothing request: the server stores every new file, rolls back on
  // any failure (the old set is untouched), then trashes the old files and
  // refreshes exactly once. This replaces the old client-side loop of one
  // upload + one DELETE per file, which made one billed job-profile call
  // per old file and read a mixed old+new set in between.
  const { run: runReplace } = useMutation(
    async (files: File[]) => {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const { data } = await api.post(`/preconstruction/${bid.id}/plan-files/replace`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      return data as JobProfileGet & { uploaded: Array<{ id: string; name: string }>; removed: Array<{ id: string; name: string }>; failedRemovals: string[]; replaceOpId: string };
    },
    {
      onSuccess: (result) => { reloadDocs(); settle(result); },
      // Review S2 — removal failures are surfaced, never silently dropped.
      successToast: (result) => {
        const { removed, failedRemovals, replaceOpId } = result;
        const sub = [
          removed.length ? `${removed.length} file${removed.length === 1 ? '' : 's'} moved to Trash` : null,
          failedRemovals.length ? `could not remove: ${failedRemovals.join(', ')}` : null,
        ].filter(Boolean).join(' — ');
        return {
          title: 'Plan set replaced', sub: sub || undefined, variant: failedRemovals.length ? 'error' : 'success',
          ...(removed.length ? { action: { label: 'Undo', onClick: () => undoReplace(replaceOpId, removed.length) } } : {}),
        };
      },
      // Review S1/S2 — a partial-upload failure names the file and leaves
      // the old set untouched (the server already rolled back what did
      // upload); the default error toast surfaces that message as-is.
      errorTitle: 'Could not replace the plan set',
    },
  );

  const busy = uploading || starting || polling;

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => /\.(pdf|jpe?g|png|zip)$/i.test(f.name));
    if (arr.length) runUpload(arr);
  };

  const handleRemove = async (doc: ProjectDoc) => {
    if (!(await confirm({
      title: `Remove "${doc.display_name || doc.name}" from this bid's plan set?`,
      body: 'It moves to Trash — Undo restores it.',
      confirmLabel: 'Remove',
    }))) return;
    runRemoveFile(doc);
  };

  const handleReplaceFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => /\.(pdf|jpe?g|png|zip)$/i.test(f.name));
    if (!arr.length) return;
    const oldDocs = planDocs;
    if (!(await confirm({
      title: 'Replace the current plan set?',
      body: (
        <>
          This uploads the new file{arr.length === 1 ? '' : 's'} and moves the current plan file{oldDocs.length === 1 ? '' : 's'} to Trash:
          <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
            {oldDocs.map(d => <li key={d.id}>{d.display_name || d.name}</li>)}
          </ul>
        </>
      ),
      confirmLabel: 'Replace',
    }))) return;
    runReplace(arr);
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

  const { run: answerRevision, saving: answering } = useMutation(
    async ({ id, decision }: { id: string; decision: 'replace' | 'keep_both' }) => {
      const { data } = await api.put(`/preconstruction/${bid.id}/plan-revisions`, { id, decision });
      return data as { revisionProposals: RevisionProposal[]; duplicateSheets: JobProfileGet['duplicate_sheets'] };
    },
    {
      onSuccess: (data) => setLive(prev => ({ ...(prev ?? loadedProfile ?? {}), revision_proposals: data.revisionProposals, duplicate_sheets: data.duplicateSheets })),
      errorTitle: 'Could not save the answer',
    },
  );

  const status = profileData?.status ?? 'idle';
  const proposals = profileData?.revision_proposals ?? [];
  const duplicates = profileData?.duplicate_sheets ?? [];
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
            <input ref={replaceInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.zip" style={{ display: 'none' }}
              onChange={e => { handleReplaceFiles(e.target.files ?? []); if (replaceInputRef.current) replaceInputRef.current.value = ''; }}
              data-testid="replace-plan-set-input"
            />
            {planDocs.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text2)', padding: '3px 0', minWidth: 0 }}>
                <Icon name="file" size={12} stroke={1.8}/>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.display_name || d.name}</span>
                {d.page_count != null && <span style={{ color: 'var(--text3)' }}>{d.page_count} pg</span>}
                <button type="button" title="Remove this plan file" aria-label={`Remove ${d.display_name || d.name}`}
                  data-testid={`remove-plan-file-${d.id}`} onClick={() => handleRemove(d)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>
                  ×
                </button>
              </div>
            ))}
            {!uploading && !starting && (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn ghost" data-testid="read-plans"
                  onClick={() => readPlans(status === 'idle' ? {} : { force: true })}
                  style={{ height: 26, fontSize: 11, padding: '0 8px' }}>
                  {status === 'idle' ? 'Read the plans' : 'Read the plans again'}
                </button>
                <button type="button" className="btn ghost" data-testid="replace-plan-set"
                  onClick={() => replaceInputRef.current?.click()}
                  style={{ height: 26, fontSize: 11, padding: '0 8px' }}>
                  Replace plan set
                </button>
              </div>
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

        {proposals.length > 0 && (
          <div data-testid="plan-revisions" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {proposals.map(p => (
              <div key={p.id} data-testid={`plan-revision-${p.id}`} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: p.decision ? 'var(--surface2)' : 'var(--amber-soft)', borderRadius: 9, padding: '10px 12px' }}>
                <div style={{ flex: '1 1 200px', minWidth: 0, fontSize: 12.5, color: 'var(--text)', fontWeight: 600, overflowWrap: 'anywhere' }}>
                  <strong>{p.newerFile}</strong> appears to replace <strong>{p.olderFile}</strong> ({p.matchingSheets.length} matching sheet{p.matchingSheets.length === 1 ? '' : 's'})
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, marginTop: 2 }}>
                    {p.decision
                      ? `${p.decision.decision === 'replace' ? 'Replaced' : 'Kept both'} — ${p.decision.by}`
                      : `${p.why}. Run AI Analysis waits for your answer.`}
                  </div>
                </div>
                {!p.decision && (
                  <>
                    <button className="btn ghost" style={{ height: 26, fontSize: 11, padding: '0 8px' }} disabled={answering}
                      onClick={() => answerRevision({ id: p.id, decision: 'keep_both' })} data-testid={`revision-keep-${p.id}`}>
                      Keep both
                    </button>
                    <button className="btn" style={{ height: 26, fontSize: 11, padding: '0 8px' }} disabled={answering}
                      onClick={() => answerRevision({ id: p.id, decision: 'replace' })} data-testid={`revision-replace-${p.id}`}>
                      Replace
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {duplicates.length > 0 && (
          <div data-testid="duplicate-sheets" style={{ fontSize: 12, color: 'var(--text3)' }}>
            {duplicates.map(d => <div key={d.sheetNo}>{d.sheetNo} is in {d.files.join(' and ')} with different titles ({d.titles.join(' / ')}) — both are kept.</div>)}
          </div>
        )}

        {summary && planDocs.length > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text3)', fontWeight: 600 }} data-testid="sheet-summary-line">
            {summary.status === 'running' && !summary.total
              ? 'Sheet check running…'
              : <>{summary.total} plan sheet{summary.total !== 1 ? 's' : ''} · {summary.electrical} electrical
                {!!summary.specPages && ` · spec book ${summary.specPages} page${summary.specPages !== 1 ? 's' : ''}`}
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
