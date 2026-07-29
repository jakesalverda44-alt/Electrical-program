import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Gen } from '../../types';
import { useShowToast } from '../../contexts/AppContext';
import DocSlot from './DocSlot';

export const KICKOFF_ROWS = [
  { category: 'contract',       label: 'Signed Proposal' },
  { category: 'sizer_report',   label: 'Sizer Report' },
  { category: 'survey',         label: 'Survey' },
  { category: 'labeled_survey', label: 'Labeled Survey' },
  { category: 'site_checklist', label: 'Site Visit Checklist' },
];

interface DocRow { id: string; category: string }

/** Shared fetch of a gen's kickoff-kit documents (also used by the drawer's
 *  Overview chips). One row per category matters; extra fields ignored. */
export function useKickoffDocs(genId: string) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    api.get('/documents', { params: { linked_id: genId } })
      .then(({ data }) => setDocs(data as DocRow[]))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [genId]);
  useEffect(refresh, [refresh]);
  return { docs, refresh, loading };
}

/** 'done' = finalized doc uploaded; 'progress' = tab has saved-but-unfinalized
 *  work (checklist_data / survey_markup JSONB); 'missing' = nothing yet. */
export function kickoffStatus(gen: Gen, docs: DocRow[], category: string): 'done' | 'progress' | 'missing' {
  if (docs.some(d => d.category === category)) return 'done';
  if (category === 'site_checklist' && gen.checklist_data) return 'progress';
  if ((category === 'survey' || category === 'labeled_survey') && gen.survey_markup) return 'progress';
  return 'missing';
}

const DOT: Record<'done' | 'progress' | 'missing', { bg: string; label: string }> = {
  done:     { bg: 'var(--green)',   label: 'Ready' },
  progress: { bg: 'var(--amber)',   label: 'In progress' },
  missing:  { bg: 'var(--border2)', label: 'Missing' },
};

interface Props {
  gen: Gen;
  onClose: () => void;
  onOpenTab: (tab: 'checklist' | 'survey') => void;
  onUpdated: (gen: Gen) => void;
  /** Forwarded to the sizer DocSlot so the existing checklist auto-fill keeps working. */
  onSizerUploaded?: (file: File) => void;
}

export default function AwardKickoffModal({ gen, onClose, onOpenTab, onUpdated, onSizerUploaded }: Props) {
  const showToast = useShowToast();
  const { docs, refresh, loading } = useKickoffDocs(gen.id);
  const [drafting, setDrafting] = useState(false);

  const hasContract = docs.some(d => d.category === 'contract');
  const redraft = !!gen.kickoff_email_drafted_at;

  const draftKickoff = async () => {
    setDrafting(true);
    try {
      const { data } = await api.post(`/gens/${gen.id}/kickoff-email`);
      const n = data.attachedLabels?.length || 0;
      const follow = data.toFollow?.length ? ` — to follow: ${data.toFollow.join(', ')}` : '';
      showToast({ title: 'Kickoff draft created in Outlook', sub: `${n} doc${n === 1 ? '' : 's'} attached${follow}` });
      onUpdated({ ...gen, kickoff_email_drafted_at: data.kickoff_email_drafted_at });
      onClose();
    } catch (e: any) {
      showToast({ title: 'Could not create draft', sub: e?.response?.data?.error || 'Try again' });
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-hdr">
          <h3>🎉 Job Awarded — Kickoff</h3>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '62vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            Get the kickoff kit together for <b>{gen.customer}</b>, then draft the team email. The signed proposal is required; everything else can follow.
          </div>

          {/* Signed proposal — auto-filled when the customer e-signed online. */}
          <DocSlot genId={gen.id} category="contract" label="Signed Proposal" accept="application/pdf,image/*" onChanged={refresh}/>
          {hasContract && gen.signed_at && (
            <div style={{ fontSize: 11.5, color: 'var(--green)', marginTop: -8 }}>Signed online by the customer — already attached.</div>
          )}

          <DocSlot genId={gen.id} category="sizer_report" label="Sizer Report" onUploaded={onSizerUploaded} onChanged={refresh}/>

          {/* Checklist + survey live in their drawer tabs — show status, link there. */}
          {KICKOFF_ROWS.filter(r => ['survey', 'labeled_survey', 'site_checklist'].includes(r.category)).map(r => {
            const st = kickoffStatus(gen, docs, r.category);
            return (
              <div key={r.category} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', border: '1px solid var(--border2)', borderRadius: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: DOT[st].bg, flexShrink: 0 }}/>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{r.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{loading ? '…' : DOT[st].label}</div>
                  </div>
                </div>
                <button className="btn ghost" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                  onClick={() => onOpenTab(r.category === 'site_checklist' ? 'checklist' : 'survey')}>
                  Open {r.category === 'site_checklist' ? 'Checklist' : 'Survey'} tab
                </button>
              </div>
            );
          })}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Later</button>
          <button className="btn" disabled={drafting || loading || !hasContract}
            title={!hasContract ? 'Upload the signed proposal first' : undefined}
            onClick={draftKickoff}>
            <Icon name="mail" size={14} stroke={1.9}/>
            {drafting ? 'Drafting…' : redraft ? 'Re-draft kickoff email' : 'Draft kickoff email'}
          </button>
        </div>
      </div>
    </div>
  );
}
