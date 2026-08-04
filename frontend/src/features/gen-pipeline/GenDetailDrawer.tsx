import React, { useState, useEffect } from 'react';
import Icon from '../../components/Icon';
import { Gen, WonJob } from '../../types';
import { GEN_STAGES, GenStageKey } from './constants';
import RecordFiles from '../../components/RecordFiles';
import { moneyFull } from '../../lib/money';
import api from '../../api/client';
import BuildFromNotesModal from '../builder/BuildFromNotesModal';
import AwardKickoffModal, { useKickoffDocs, kickoffStatus, KICKOFF_ROWS } from './AwardKickoffModal';
import SiteVisitChecklist from './SiteVisitChecklist';
import SignedContractCard from './SignedContractCard';
import ProposalActionBar from './ProposalActionBar';
import DrawerSection from './DrawerSection';
import SendProposalModal from '../builder/SendProposalModal';
import SurveyMarkupEditor from './SurveyMarkupEditor';
import DocSlot from './DocSlot';
import { parseSizerFile } from './sizerParse';
import { ChecklistData, BLANK } from './SiteVisitChecklist';
import { isPrivileged } from '../../hooks/useAuth';
import { useUser } from '../../contexts/AppContext';
import { useShowToast } from '../../contexts/AppContext';

function fmtTs(ts?: string | null) {
  if (!ts) return null;
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface Props {
  gen: Gen;
  pendingDeclined: boolean;
  onStage: (stage: GenStageKey) => void;
  onCancelDeclined: () => void;
  onClose: () => void;
  onEditGen: (gen: Gen) => void;
  onDuplicate: (gen: Gen) => void;
  onDelete: (gen: Gen) => void;
  onClosed: (gen: Gen) => void;
  onUpdated: (gen: Gen, wonJob?: WonJob | null) => void;
  /** True when the page just awarded this gen — opens the kickoff modal once. */
  autoKickoff?: boolean;
  onAutoKickoffHandled?: () => void;
  /** Other proposals for the same customer not already grouped with this one —
   *  candidates to retroactively link as alternate options. */
  linkCandidates?: Gen[];
  onLink?: (targetId: string) => void;
  /** Other options already grouped with this one — named in the countersign warning,
   *  since executing this contract supersedes them. */
  groupSiblings?: Gen[];
}

interface Draft { customer: string; loc: string; mfr: string; model: string; kw: string; amount: string; addons: string; date_won: string; }

export default function GenDetailDrawer({ gen, pendingDeclined, onStage, onCancelDeclined, onClose, onEditGen, onDuplicate, onDelete, onClosed, onUpdated, autoKickoff, onAutoKickoffHandled, linkCandidates, onLink, groupSiblings }: Props) {
  const canDelete = isPrivileged(useUser());
  const showToast = useShowToast();
  const isTerminal = gen.stage === 'awarded' || gen.stage === 'declined' || gen.stage === 'signed' || gen.stage === 'superseded';
  const [closingJob, setClosingJob] = useState(false);
  const [showBuildNotes, setShowBuildNotes] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'overview' | 'checklist' | 'survey'>('overview');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>({ customer: '', loc: '', mfr: '', model: '', kw: '', amount: '', addons: '', date_won: '' });
  const [showKickoff, setShowKickoff] = useState(!!autoKickoff);
  const [showSend, setShowSend] = useState(false);
  // Bumped by the action bar's "Countersign & award" so the contract card opens its own
  // confirmation — the signature and its warning live there, and duplicating them in the
  // header would give two places to execute a contract.
  const [countersignTick, setCountersignTick] = useState(0);
  useEffect(() => {
    if (autoKickoff) { setShowKickoff(true); onAutoKickoffHandled?.(); }
  }, [autoKickoff, onAutoKickoffHandled]);
  const kickoffDocs = useKickoffDocs(gen.id);

  const startEdit = () => {
    setDraft({
      customer: gen.customer || '',
      loc: gen.loc || '',
      mfr: gen.mfr || 'Kohler',
      model: gen.model || '',
      kw: String(gen.kw ?? ''),
      amount: String(gen.amount ?? ''),
      addons: String(gen.addons ?? ''),
      date_won: gen.date_won ? String(gen.date_won).slice(0, 10) : '',
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/gens/${gen.id}`, {
        customer: draft.customer.trim(),
        loc: draft.loc.trim(),
        mfr: draft.mfr,
        model: draft.model.trim(),
        kw: Number(draft.kw) || 0,
        amount: Number(draft.amount) || 0,
        addons: Number(draft.addons) || 0,
        ...(gen.stage === 'awarded' && draft.date_won ? { date_won: draft.date_won } : {}),
      });
      const updated = data.gen ?? data;
      onUpdated(updated, data.wonJob ?? null);
      setEditing(false);
      showToast({ title: 'Details updated', sub: updated.customer });
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft(d => ({ ...d, [k]: e.target.value }));

  // When a sizer report is uploaded, parse it and auto-fill the Site Visit Checklist
  // (gas type, LRA, AC tons, appliance fuels/amps). Merged over existing data so manual
  // edits to untouched fields survive; sizer-derived fields are refreshed from the new file.
  const autofillFromSizer = async (file: File) => {
    try {
      const { fields, loads, notesLine } = await parseSizerFile(file);
      let current: ChecklistData;
      try {
        const raw = typeof gen.checklist_data === 'string' ? JSON.parse(gen.checklist_data) : gen.checklist_data;
        current = {
          ...BLANK, ...(raw || {}),
          loads: { ...(raw?.loads || {}) },
          acUnits: Array.isArray(raw?.acUnits) ? raw.acUnits : [],
          customLoads: Array.isArray(raw?.customLoads) ? raw.customLoads : [],
        };
      } catch { current = { ...BLANK, loads: {}, acUnits: [], customLoads: [] }; }
      // Strip legacy keys so they never re-enter state and get re-persisted on save.
      const currentAny = current as unknown as Record<string, unknown>;
      delete currentAny.acSize;
      delete currentAny.lra;
      delete currentAny.tankSize;
      delete currentAny.tankType;

      const notes = notesLine && !current.notes.includes(notesLine)
        ? [current.notes, notesLine].filter(Boolean).join('\n')
        : current.notes;
      const merged: ChecklistData = {
        ...current,
        ...fields,
        acUnits: current.acUnits.length ? current.acUnits : (fields.acUnits || []),
        loads: { ...current.loads, ...loads },
        notes,
      };
      const { data } = await api.patch(`/gens/${gen.id}`, { checklist_data: merged });
      onUpdated(data.gen ?? data);
      const filled = Object.keys(fields).length + Object.keys(loads).length;
      showToast(filled
        ? { title: 'Checklist auto-filled from sizer', sub: 'Open the Checklist tab to review' }
        : { title: 'Sizer uploaded', sub: "Couldn't read checklist data from it" });
    } catch {
      showToast({ title: 'Sizer uploaded', sub: 'Auto-fill failed — enter checklist manually' });
    }
  };

  const handleCloseJob = async () => {
    if (!window.confirm(`Mark "${gen.customer}" as closed/complete? This will move the Drive folder to Completed Generator Jobs and remove it from the active pipeline.`)) return;
    setClosingJob(true);
    try {
      const { data } = await api.post(`/gens/${gen.id}/close`);
      onClosed(data);
    } finally {
      setClosingJob(false);
    }
  };

  return (
    <div className="drawer-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-hdr">
          <div>
            <div className="drawer-eyebrow">Generator Proposal</div>
            <div className="drawer-title">{gen.customer}</div>
          </div>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>

        <div className="drawer-body">
          <div style={{ display: 'flex', flexShrink: 0, border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden' }}>
            {(['overview', 'checklist', 'survey'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ flex: 1, minHeight: 40, lineHeight: '40px', padding: '0 8px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  border: 'none', borderRight: t !== 'survey' ? '1px solid var(--border2)' : 'none',
                  background: tab === t ? 'var(--blue)' : 'var(--surface2)',
                  color: tab === t ? '#fff' : 'var(--text2)', whiteSpace: 'nowrap' }}>
                {t === 'overview' ? 'Overview' : t === 'checklist' ? 'Checklist' : 'Survey'}
              </button>
            ))}
          </div>

          {tab === 'checklist' ? (
            <SiteVisitChecklist gen={gen} onUpdated={g => onUpdated(g)}/>
          ) : tab === 'survey' ? (
            <SurveyMarkupEditor gen={gen} onUpdated={g => onUpdated(g)}/>
          ) : (
          <>
          {/* Who, where it stands, and the one thing to do next — before any read-only
              detail, because that is what the drawer is opened for. */}
          <ProposalActionBar
            gen={gen}
            canDelete={canDelete}
            closingJob={closingJob}
            onView={() => window.open(`${window.location.origin}/p/${gen.proposal_token}?preview=1`, '_blank', 'noopener')}
            onEdit={() => { onClose(); onEditGen(gen); }}
            onSend={() => setShowSend(true)}
            onCountersign={() => setCountersignTick(t => t + 1)}
            onKickoff={() => setShowKickoff(true)}
            onAddOption={() => onDuplicate(gen)}
            onBuildFromNotes={() => setShowBuildNotes(true)}
            onCloseJob={handleCloseJob}
            onDelete={() => onDelete(gen)}
          />

          {gen.stage === 'superseded' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
              color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border2)',
              borderRadius: 8, padding: '8px 10px', marginBottom: 4 }}>
              <Icon name="check" size={14} stroke={2}/>
              Superseded — a different option for this customer was awarded instead. Not counted as a loss.
            </div>
          )}

          <div className="dtl-stage-label">Stage</div>
          <div className="dtl-stages">
            {GEN_STAGES.map(s => {
              const isActive = gen.stage === s.key;
              // "Signed" is set automatically when the customer signs the proposal.
              const lockedSigned = s.key === 'signed' && !isActive && !gen.signed_at;
              return (
                <button
                  key={s.key}
                  className={'dtl-stage' + (isActive ? ' on' : '')}
                  disabled={lockedSigned}
                  title={lockedSigned ? 'Set automatically when the customer signs the proposal' : undefined}
                  style={{
                    ...(isActive ? {
                      background: s.color,
                      borderColor: s.color,
                      color: s.key === 'building' ? '#11192a' : '#fff',
                    } : undefined),
                    ...(lockedSigned ? { opacity: .4, cursor: 'not-allowed' } : undefined),
                  }}
                  onClick={() => { if (!lockedSigned) onStage(s.key); }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Lifecycle timeline — folded by default: the action bar already says where
              the deal stands, so the full history is for when someone asks. */}
          <DrawerSection
            title="Lifecycle"
            hint={gen.signed_at ? 'Signed' : gen.viewed_at ? 'Viewed' : gen.sent_at ? 'Sent' : 'Building'}
          >
          <div style={{ marginBottom: 4 }}>
            {(() => {
              const steps: { label: string; done: boolean; when: string | null }[] = [
                { label: 'Built',   done: true,                   when: gen.built_on || null },
                { label: 'Sent',    done: !!gen.sent_at,          when: fmtTs(gen.sent_at) },
                { label: 'Viewed',  done: !!gen.viewed_at,        when: fmtTs(gen.viewed_at) },
                { label: 'Signed',  done: !!gen.signed_at,        when: fmtTs(gen.signed_at) },
                { label: 'Awarded', done: gen.stage === 'awarded', when: gen.stage === 'awarded' ? 'Marked awarded' : null },
              ];
              if (gen.stage === 'awarded') {
                steps.push({ label: 'Closed', done: !!gen.closed_at, when: fmtTs(gen.closed_at) });
              }
              return steps.map((s, i, arr) => (
                <div key={s.label} style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                      background: s.done ? 'var(--green)' : 'transparent',
                      border: '2px solid ' + (s.done ? 'var(--green)' : 'var(--border2)') }}/>
                    {i < arr.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 14, background: s.done ? 'var(--green)' : 'var(--border)' }}/>}
                  </div>
                  <div style={{ paddingBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: s.done ? 'var(--text)' : 'var(--text3)' }}>{s.label}</div>
                    {s.when && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{s.when}</div>}
                  </div>
                </div>
              ));
            })()}
          </div>
          </DrawerSection>

          {pendingDeclined && (
            <div className="lost-confirm">
              <Icon name="x" size={14} stroke={2}/>
              <span>Mark this proposal as declined?</span>
              <button className="btn ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={onCancelDeclined}>Cancel</button>
              <button className="btn" style={{ height: 28, fontSize: 12, padding: '0 10px', background: 'var(--slate)', borderColor: 'var(--slate)' }} onClick={() => onStage('declined')}>Confirm</button>
            </div>
          )}

          {editing ? (
            <div className="dtl-section">
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--text3)', marginBottom: 12 }}>Edit Details</div>
              {([
                { label: 'Customer', key: 'customer', type: 'text' },
                { label: 'Location', key: 'loc', type: 'text' },
                { label: 'Model', key: 'model', type: 'text' },
                { label: 'kW Output', key: 'kw', type: 'number' },
                { label: 'Amount ($)', key: 'amount', type: 'number' },
                { label: 'Add-ons ($)', key: 'addons', type: 'number' },
              ] as { label: string; key: keyof Draft; type: string }[]).map(f => (
                <div key={f.key} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>{f.label}</div>
                  <input
                    type={f.type}
                    value={draft[f.key]}
                    onChange={set(f.key)}
                    style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 7,
                      padding: '7px 10px', fontSize: 13, color: 'var(--text)', fontFamily: f.type === 'number' ? 'var(--mono)' : 'inherit',
                      outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>Manufacturer</div>
                <select value={draft.mfr} onChange={set('mfr')}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 7,
                    padding: '7px 10px', fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}>
                  <option>Kohler</option>
                  <option>Generac</option>
                </select>
              </div>
              {gen.stage === 'awarded' && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>Contract Date (sales month)</div>
                  <input type="date" value={draft.date_won} onChange={set('date_won')}
                    style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 7,
                      padding: '7px 10px', fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn" style={{ flex: 1, justifyContent: 'center' }} disabled={saving} onClick={saveEdit}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <DrawerSection title="Details" hint={[gen.mfr, gen.model].filter(Boolean).join(' ') || undefined}>
            <div className="dtl-section">
              <div className="dtl-row"><span className="dtl-k">Manufacturer</span>
                <span className="dtl-v">
                  <span className={'chip-mfr ' + gen.mfr} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 5, textTransform: 'uppercase', letterSpacing: '.04em', background: gen.mfr === 'Kohler' ? 'var(--blue-soft)' : 'var(--amber-soft)', color: gen.mfr === 'Kohler' ? 'var(--blue)' : 'var(--amber)' }}>
                    <Icon name="bolt" size={11} stroke={2}/>{gen.mfr}
                  </span>
                </span>
              </div>
              <div className="dtl-row"><span className="dtl-k">Model</span><span className="dtl-v">{gen.model}</span></div>
              <div className="dtl-row"><span className="dtl-k">Output</span><span className="dtl-v num">{gen.kw} kW</span></div>
              <div className="dtl-row"><span className="dtl-k">Add-ons</span><span className="dtl-v">{gen.addons}</span></div>
              <div className="dtl-row"><span className="dtl-k">Location</span><span className="dtl-v">{gen.loc}</span></div>
              {(gen.site_visit_at || gen.site_visit_needs_time) && (
                <div className="dtl-row">
                  <span className="dtl-k">Site visit</span>
                  <span className="dtl-v">
                    {gen.site_visit_at
                      ? fmtTs(gen.site_visit_at)
                      : <span style={{ color: 'var(--amber)', fontWeight: 700 }}>Needs a time</span>}
                  </span>
                </div>
              )}
              <div className="dtl-row"><span className="dtl-k">Proposal amount</span><span className="dtl-v num">{moneyFull(Number(gen.amount))}</span></div>
              <div className="dtl-row"><span className="dtl-k">Built</span><span className="dtl-v">{gen.built_on}</span></div>
              <div className="dtl-row"><span className="dtl-k">Salesperson</span><span className="dtl-v">{gen.salesperson_name}</span></div>
              <button className="btn ghost"
                style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                onClick={startEdit}
              >
                <Icon name="doc" size={14} stroke={1.9}/>Edit Details
              </button>
            </div>
            </DrawerSection>
          )}

          {/* Sizer report — usually run on Generac/Kohler's own sizing tool and saved
              off-CRM, then attached here once the job's underway. */}
          <DrawerSection title="Documents" defaultOpen>
          <div className="dtl-section">
            <div className="dtl-stage-label" style={{ marginBottom: 8 }}>Sizer Report</div>
            <DocSlot genId={gen.id} category="sizer_report" label="Sizer Report" onUploaded={autofillFromSizer}/>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>Uploading a sizer auto-fills the Site Visit Checklist — review &amp; edit it in the Checklist tab.</div>
          </div>

          {/* The executed contract gets its own row above the general file list — it is
              the one document anyone opening a signed job is looking for, and burying it
              among site photos is how a missing archive went unnoticed. */}
          <SignedContractCard gen={gen} siblings={groupSiblings} onUpdated={g => onUpdated(g)} requestCountersign={countersignTick}/>

          {/* Photos & files up top so site-visit capture is one tap on mobile, not
              buried below every action button. */}
          <RecordFiles linkedId={gen.id} linkedName={gen.customer} div="gen" cameraFirst title="Photos & Files"
            emptyHint="No files yet. Snap site-visit photos, or attach the proposal, PO, permit, signed contract, or delivery/startup docs."/>
          </DrawerSection>

          {gen.stage === 'awarded' && (
            <div className="dtl-section" style={{ marginTop: 16 }}>
              <div className="dtl-stage-label" style={{ marginBottom: 8 }}>Kickoff</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {KICKOFF_ROWS.map(r => {
                  const st = kickoffStatus(gen, kickoffDocs.docs, r.category);
                  return (
                    <span key={r.category} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border2)', color: st === 'done' ? 'var(--text)' : 'var(--text3)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: st === 'done' ? 'var(--green)' : st === 'progress' ? 'var(--amber)' : 'var(--border2)' }}/>
                      {r.label}
                    </span>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
                {gen.kickoff_email_drafted_at
                  ? `Kickoff email drafted ${fmtTs(gen.kickoff_email_drafted_at)}`
                  : 'Kickoff email not drafted yet'}
              </div>
              <button className="btn ghost" style={{ width: '100%', justifyContent: 'center', color: 'var(--blue)', borderColor: 'rgba(59,130,246,.4)' }}
                onClick={() => setShowKickoff(true)}>
                <Icon name="mail" size={14} stroke={1.9}/>Open Kickoff
              </button>
            </div>
          )}

          {/* View, Edit, Send, Build from notes, Close job, Duplicate and Delete all
              moved into the action bar at the top of this tab. They used to sit here, in
              a stack of seven full-width buttons below every read-only field, which put
              Delete one row from Edit and hid Send entirely. */}

          {/* Retroactively link an already-existing proposal for this customer as an
              alternate option — for pairs not created via Duplicate, so they never
              got a shared group. Works either direction, including linking a still-
              open sibling onto one that's already been awarded. */}
          {!!linkCandidates?.length && (
            <div className="dtl-section" style={{ marginTop: 16 }}>
              <div className="dtl-stage-label" style={{ marginBottom: 8 }}>Link as Alternate Option</div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 8 }}>
                Other proposals for {gen.customer}. Linking means awarding one supersedes the other instead of it counting as a loss.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {linkCandidates.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    fontSize: 12.5, padding: '6px 8px', border: '1px solid var(--border2)', borderRadius: 7 }}>
                    <span style={{ fontWeight: 600 }}>
                      {c.kw}kW · {moneyFull(Number(c.amount))} <span style={{ color: 'var(--text3)', fontWeight: 500 }}>· {c.stage}</span>
                    </span>
                    <button className="btn ghost" style={{ height: 26, fontSize: 11.5, padding: '0 10px' }}
                      onClick={() => onLink?.(c.id)}>
                      Link
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Google Drive folder links — shown when folders were auto-created on award */}
          {gen.drive_job_folder_id && (
            <div className="dtl-section" style={{ marginTop: 16 }}>
              <div className="dtl-stage-label" style={{ marginBottom: 8 }}>Google Drive Folders</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { label: 'Engineering', id: gen.drive_engineering_folder_id },
                  { label: 'Permit',      id: gen.drive_permit_folder_id },
                  { label: 'Contract',    id: gen.drive_contract_folder_id },
                  { label: 'Invoices',    id: gen.drive_invoices_folder_id },
                  { label: 'All Job Files', id: gen.drive_job_folder_id },
                ].filter(f => f.id).map(f => (
                  <a
                    key={f.label}
                    href={`https://drive.google.com/drive/folders/${f.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--blue)', textDecoration: 'none', padding: '4px 0' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    {f.label}
                  </a>
                ))}
              </div>
            </div>
          )}
          </>
          )}

        </div>
      </div>

      {/* Sending used to live only in the builder, reachable after a save, so there was
          no way to resend from the record a rep is actually looking at. */}
      {showSend && (
        <SendProposalModal
          genId={gen.id}
          defaultEmail={(() => {
            const f = gen.form_data;
            const parsed = typeof f === 'string' ? (() => { try { return JSON.parse(f); } catch { return null; } })() : f;
            return (parsed as { email?: string } | null)?.email || '';
          })()}
          proposalNo={gen.proposal_no || ''}
          spec={`${gen.kw ? `${gen.kw}kW ` : ''}${gen.mfr || ''}`.trim()}
          total={moneyFull(Number(gen.amount))}
          deposit={moneyFull(Number(gen.amount) / 2)}
          onSent={updated => { setShowSend(false); onUpdated(updated); }}
          onClose={() => setShowSend(false)}
        />
      )}

      {showBuildNotes && (
        <BuildFromNotesModal
          genId={gen.id}
          onClose={() => setShowBuildNotes(false)}
          onSuccess={updatedGen => {
            setShowBuildNotes(false);
            onClose();
            onEditGen(updatedGen);
          }}
        />
      )}

      {showKickoff && (
        <AwardKickoffModal
          gen={gen}
          onClose={() => { setShowKickoff(false); kickoffDocs.refresh(); }}
          onOpenTab={t => { setShowKickoff(false); setTab(t); kickoffDocs.refresh(); }}
          onUpdated={g => onUpdated(g)}
          onSizerUploaded={async f => {
            await autofillFromSizer(f);
            setShowKickoff(false);
            kickoffDocs.refresh();
            setTab('checklist');
          }}
        />
      )}
    </div>
  );
}
