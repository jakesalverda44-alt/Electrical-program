// frontend/src/features/leads/LeadSiteSurvey.tsx
//
// Mobile-first guided site-visit questionnaire. Its state IS a LeadSurvey (see
// surveyMap.ts) — every step just narrows/widens that object. Answers autosave to
// `leads.survey_data` (debounced + on step change + on close) so a survey survives an
// app close mid-visit; re-entering resumes from lead.survey_data. See
// docs/superpowers/specs/2026-08-03-mobile-field-pack-design.md §2 for the full spec.
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import RecordFiles from '../../components/RecordFiles';
import api from '../../api/client';
import { Lead } from '../../types';
import { LeadSurvey } from './surveyMap';
import { getGenSizes } from '../builder/genCalc';

interface Props {
  lead: Lead;
  onUpdated: (lead: Lead) => void;
  onBuildProposal: () => void;
  onClose: () => void;
}

type StepId = 'jobType' | 'unit' | 'fuel' | 'placement' | 'swapout' | 'access' | 'extras' | 'photos' | 'notes';

const ALL_STEPS: { id: StepId; title: string }[] = [
  { id: 'jobType',   title: 'Job Type' },
  { id: 'unit',      title: 'Unit' },
  { id: 'fuel',      title: 'Fuel' },
  { id: 'placement', title: 'Placement' },
  { id: 'swapout',   title: 'Swap-Out Details' },
  { id: 'access',    title: 'Access' },
  { id: 'extras',    title: 'Extras' },
  { id: 'photos',    title: 'Site Photos' },
  { id: 'notes',     title: 'Notes' },
];

const AUTOSAVE_MS = 600;

const FIELD_LABELS: Record<string, string> = {
  jobType: 'Job Type', brand: 'Brand', coolingType: 'Cooling Type', size: 'Size',
  sizingNeeded: 'Needs Sizing', fuel: 'Fuel', genSide: 'Side of House',
  panelRel: 'Position vs. Panel', panelFt: 'Distance from Panel (ft)',
  feedFt: 'Feed Distance (ft)', base: 'Base', gasLine: 'Gas Line Disconnect/Reconnect',
  removal: 'Removal / Haul-Off', liftType: 'Lift', battery: 'Battery Maintainer',
  emPanel: 'EM Panel', surgeProQty: 'Surge Protector Qty', smmQty: 'SMM Qty', notes: 'Notes',
};

const numInput: React.CSSProperties = {
  font: 'inherit', fontSize: 14, fontWeight: 600, color: 'var(--text)',
  background: 'var(--surface)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '9px 12px', outline: 'none',
  boxSizing: 'border-box', width: '100%',
};

function optBtn(active: boolean): React.CSSProperties {
  return {
    minHeight: 44, padding: '10px 16px', borderRadius: 10,
    border: '1px solid ' + (active ? 'var(--amber)' : 'var(--border2)'),
    background: active ? 'var(--amber)' : 'var(--surface)',
    color: active ? '#11192a' : 'var(--text)',
    font: 'inherit', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
    flex: '1 1 auto', textAlign: 'center',
  };
}

function OptionButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" style={optBtn(active)} aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  );
}

function OptionRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>;
}

function QLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      fontSize: 11.5, fontWeight: 700, color: 'var(--text3)',
      textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6, display: 'block',
    }}>
      {children}
    </label>
  );
}

const SAVE_ERROR_MSG = "Couldn't save your answers — check connection and try again";

export default function LeadSiteSurvey({ lead, onUpdated, onBuildProposal, onClose }: Props) {
  const [survey, setSurvey] = useState<LeadSurvey>(() => (lead.survey_data as LeadSurvey | null) ?? {});
  const [stepIndex, setStepIndex] = useState(0);
  const [showFinish, setShowFinish] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  // Serialized snapshot of the last *successfully* persisted survey — lets close/step-change
  // skip the PATCH entirely when nothing changed since then (avoids zero-change PATCH noise
  // against leadWriteLimiter) and lets us tell "closing with nothing to lose" apart from
  // "closing with answers that failed to save."
  const lastSavedRef = useRef<string>(JSON.stringify((lead.survey_data as LeadSurvey | null) ?? {}));

  const steps = ALL_STEPS.filter(s => s.id !== 'swapout' || survey.jobType === 'swap-out');
  const clampedIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = steps[clampedIndex];

  function isDirty() {
    return JSON.stringify(survey) !== lastSavedRef.current;
  }

  // Never throws — callers that must know whether the save actually landed (Build
  // Proposal, Save & Close, close-with-unsaved-changes) check the returned boolean and
  // surface SAVE_ERROR_MSG themselves. Intermediate debounced/step-change saves ignore
  // the result and stay best-effort/silent by design.
  async function saveNow(): Promise<boolean> {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const serialized = JSON.stringify(survey);
    try {
      const { data } = await api.patch<Lead>(`/leads/${lead.id}`, { survey_data: survey });
      onUpdated(data);
      lastSavedRef.current = serialized;
      setSaveError(null);
      return true;
    } catch {
      return false;
    }
  }

  // Debounced autosave ~600ms after any answer change.
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; saveNow(); }, AUTOSAVE_MS);
    return () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey]);

  function set<K extends keyof LeadSurvey>(key: K, value: LeadSurvey[K]) {
    setSurvey(s => ({ ...s, [key]: value }));
  }

  function goNext() {
    if (isDirty()) saveNow();
    if (clampedIndex + 1 >= steps.length) {
      setShowFinish(true);
    } else {
      setStepIndex(clampedIndex + 1);
    }
  }

  function goBack() {
    if (showFinish) { setShowFinish(false); return; }
    if (isDirty()) saveNow();
    setStepIndex(i => Math.max(0, i - 1));
  }

  // Shared by the header ×, the backdrop click, and "Save & Close": nothing to save ->
  // close immediately; unsaved answers that fail to persist -> surface the error and
  // stay open rather than silently dropping them.
  async function closeWithSaveGuard() {
    if (!isDirty()) { onClose(); return; }
    const ok = await saveNow();
    if (ok) onClose();
    else setSaveError(SAVE_ERROR_MSG);
  }

  const handleClose = closeWithSaveGuard;
  const handleSaveClose = closeWithSaveGuard;

  async function handleBuildProposal() {
    const ok = await saveNow();
    if (!ok) { setSaveError(SAVE_ERROR_MSG); return; }
    onBuildProposal();
  }

  function renderStep(id: StepId) {
    switch (id) {
      case 'jobType':
        return (
          <OptionRow>
            <OptionButton label="New Install" active={survey.jobType === 'new-install'} onClick={() => set('jobType', 'new-install')} />
            <OptionButton label="Swap-Out" active={survey.jobType === 'swap-out'} onClick={() => set('jobType', 'swap-out')} />
          </OptionRow>
        );

      case 'unit': {
        const { brand, coolingType } = survey;
        const sizes = brand && coolingType
          ? getGenSizes({ brand, coolingType, jobType: survey.jobType ?? 'new-install' })
          : [];
        return (
          <>
            <QLabel>Brand</QLabel>
            <OptionRow>
              <OptionButton label="Kohler" active={brand === 'Kohler'} onClick={() => set('brand', 'Kohler')} />
              <OptionButton label="Generac" active={brand === 'Generac'} onClick={() => set('brand', 'Generac')} />
            </OptionRow>
            <QLabel>Cooling Type</QLabel>
            <OptionRow>
              <OptionButton label="Air-Cooled" active={coolingType === 'air-cooled'} onClick={() => set('coolingType', 'air-cooled')} />
              <OptionButton label="Liquid-Cooled" active={coolingType === 'liquid-cooled'} onClick={() => set('coolingType', 'liquid-cooled')} />
            </OptionRow>
            <QLabel>Size</QLabel>
            <OptionRow>
              <OptionButton label="Needs Sizing" active={!!survey.sizingNeeded} onClick={() => set('sizingNeeded', !survey.sizingNeeded)} />
            </OptionRow>
            {!survey.sizingNeeded && (
              brand && coolingType ? (
                <OptionRow>
                  {sizes.map(sz => (
                    <OptionButton key={sz} label={sz} active={survey.size === sz} onClick={() => set('size', sz)} />
                  ))}
                </OptionRow>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Select a brand and cooling type to see available sizes.</div>
              )
            )}
          </>
        );
      }

      case 'fuel':
        return (
          <OptionRow>
            <OptionButton label="Natural Gas" active={survey.fuel === 'Natural Gas'} onClick={() => set('fuel', 'Natural Gas')} />
            <OptionButton label="LP" active={survey.fuel === 'LP'} onClick={() => set('fuel', 'LP')} />
          </OptionRow>
        );

      case 'placement':
        return (
          <>
            <QLabel>Side of House</QLabel>
            <OptionRow>
              <OptionButton label="Left" active={survey.genSide === 'Left'} onClick={() => set('genSide', 'Left')} />
              <OptionButton label="Right" active={survey.genSide === 'Right'} onClick={() => set('genSide', 'Right')} />
            </OptionRow>
            <QLabel>Position vs. Panel</QLabel>
            <OptionRow>
              <OptionButton label="Same side as panel" active={survey.panelRel === 'Same side as panel'} onClick={() => set('panelRel', 'Same side as panel')} />
              <OptionButton label="Opposite side of panel" active={survey.panelRel === 'Opposite side of panel'} onClick={() => set('panelRel', 'Opposite side of panel')} />
              <OptionButton label="Next to panel" active={survey.panelRel === 'Next to panel'} onClick={() => set('panelRel', 'Next to panel')} />
            </OptionRow>
            {survey.panelRel !== 'Next to panel' && (
              <div>
                <QLabel>Distance from Panel (ft)</QLabel>
                <input
                  type="number" style={numInput} value={survey.panelFt ?? ''}
                  onChange={e => set('panelFt', e.target.value === '' ? undefined : Number(e.target.value))}
                />
              </div>
            )}
            <div>
              <QLabel>Electrical Feed Distance (ft)</QLabel>
              <input
                type="number" style={numInput} value={survey.feedFt ?? ''}
                onChange={e => set('feedFt', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </div>
            <QLabel>Base</QLabel>
            <OptionRow>
              <OptionButton label="Concrete Pad" active={survey.base === 'pad'} onClick={() => set('base', 'pad')} />
              <OptionButton label="Gen Stand (small)" active={survey.base === 'stand-small'} onClick={() => set('base', 'stand-small')} />
              <OptionButton label="Gen Stand (big)" active={survey.base === 'stand-big'} onClick={() => set('base', 'stand-big')} />
              <OptionButton label="Existing Pad" active={survey.base === 'existing-pad'} onClick={() => set('base', 'existing-pad')} />
            </OptionRow>
          </>
        );

      case 'swapout':
        return (
          <>
            <QLabel>Gas Line Disconnect & Reconnect Needed?</QLabel>
            <OptionRow>
              <OptionButton label="Yes" active={survey.gasLine === true} onClick={() => set('gasLine', true)} />
              <OptionButton label="No" active={survey.gasLine === false} onClick={() => set('gasLine', false)} />
            </OptionRow>
            <QLabel>Removal / Haul-Off Needed?</QLabel>
            <OptionRow>
              <OptionButton label="Yes" active={survey.removal === true} onClick={() => set('removal', true)} />
              <OptionButton label="No" active={survey.removal === false} onClick={() => set('removal', false)} />
            </OptionRow>
          </>
        );

      case 'access':
        return (
          <>
            <QLabel>Lift Required</QLabel>
            <OptionRow>
              <OptionButton label="None" active={survey.liftType === 'none'} onClick={() => set('liftType', 'none')} />
              <OptionButton label="Lull" active={survey.liftType === 'lull'} onClick={() => set('liftType', 'lull')} />
              <OptionButton label="Crane" active={survey.liftType === 'crane'} onClick={() => set('liftType', 'crane')} />
            </OptionRow>
          </>
        );

      case 'extras':
        return (
          <>
            <QLabel>Battery Maintainer</QLabel>
            <OptionRow>
              <OptionButton label="Yes" active={survey.battery === true} onClick={() => set('battery', true)} />
              <OptionButton label="No" active={survey.battery === false} onClick={() => set('battery', false)} />
            </OptionRow>
            <QLabel>EM Panel</QLabel>
            <OptionRow>
              <OptionButton label="Yes" active={survey.emPanel === true} onClick={() => set('emPanel', true)} />
              <OptionButton label="No" active={survey.emPanel === false} onClick={() => set('emPanel', false)} />
            </OptionRow>
            <div>
              <QLabel>Surge Protector Qty</QLabel>
              <input
                type="number" min={0} style={numInput} value={survey.surgeProQty ?? ''}
                onChange={e => set('surgeProQty', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </div>
            <div>
              <QLabel>SMM Qty</QLabel>
              <input
                type="number" min={0} style={numInput} value={survey.smmQty ?? ''}
                onChange={e => set('smmQty', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </div>
          </>
        );

      case 'photos':
        return <RecordFiles linkedId={lead.id} linkedName={lead.name} div="lead" cameraFirst title="Site Photos" />;

      case 'notes':
        return (
          <textarea
            style={{ ...numInput, minHeight: 140, resize: 'vertical' }}
            value={survey.notes ?? ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="Anything else worth noting for the proposal…"
          />
        );

      default:
        return null;
    }
  }

  const answered = Object.entries(survey).filter(([, v]) => v !== undefined && v !== null && v !== '');

  return (
    <div className="drawer-overlay" onMouseDown={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="drawer" style={{ width: 480 }}>
        <div className="drawer-hdr">
          <div>
            <div className="drawer-eyebrow">Site Survey — {lead.name}</div>
            <div className="drawer-title">{showFinish ? 'Review & Finish' : currentStep?.title}</div>
          </div>
          <button className="close-x" onClick={handleClose}><Icon name="x" size={16} stroke={2} /></button>
        </div>

        <div className="drawer-body">
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            {steps.map((s, i) => (
              <span
                key={s.id}
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: !showFinish && i === clampedIndex ? 'var(--amber)' : (showFinish || i < clampedIndex ? 'var(--text3)' : 'var(--border2)'),
                }}
              />
            ))}
          </div>

          {saveError && (
            <div style={{
              padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600,
              background: 'rgba(224,106,106,.1)', border: '1px solid rgba(224,106,106,.35)', color: '#E06A6A',
            }}>
              {saveError}
            </div>
          )}

          {showFinish ? (
            <>
              {answered.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text3)' }}>No answers recorded yet.</div>
              ) : (
                <div className="dtl-section">
                  {answered.map(([k, v]) => (
                    <div key={k} className="dtl-row">
                      <span className="dtl-k">{FIELD_LABELS[k] ?? k}</span>
                      <span className="dtl-v">{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <button className="btn amber" style={{ justifyContent: 'center' }} onClick={handleBuildProposal}>
                  <Icon name="bolt" size={14} stroke={2} />Build Proposal from Survey
                </button>
                <button className="btn ghost" style={{ justifyContent: 'center' }} onClick={handleSaveClose}>
                  Save & Close
                </button>
              </div>
            </>
          ) : (
            currentStep && renderStep(currentStep.id)
          )}
        </div>

        {!showFinish && (
          <div style={{ display: 'flex', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--border)' }}>
            <button className="btn ghost" onClick={goBack} disabled={clampedIndex === 0}>Back</button>
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={goNext}>Skip</button>
            <button className="btn amber" onClick={goNext}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
