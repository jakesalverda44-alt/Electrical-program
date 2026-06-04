import React from 'react';
import Icon from '../../components/Icon';
import { Gen } from '../../types';
import { GEN_STAGES, GenStageKey } from './constants';
import RecordFiles from '../../components/RecordFiles';

function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }
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
}

export default function GenDetailDrawer({ gen, pendingDeclined, onStage, onCancelDeclined, onClose, onEditGen }: Props) {
  const isTerminal = gen.stage === 'awarded' || gen.stage === 'declined';

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
          <div className="dtl-amt">{moneyFull(Number(gen.amount))}</div>

          <div className="dtl-stage-label">Stage</div>
          <div className="dtl-stages">
            {GEN_STAGES.map(s => {
              const isActive = gen.stage === s.key;
              return (
                <button
                  key={s.key}
                  className={'dtl-stage' + (isActive ? ' on' : '')}
                  style={isActive ? {
                    background: s.color,
                    borderColor: s.color,
                    color: s.key === 'building' ? '#11192a' : '#fff',
                  } : undefined}
                  onClick={() => onStage(s.key)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Lifecycle timeline with real timestamps */}
          <div className="dtl-stage-label" style={{ marginTop: 16 }}>Lifecycle</div>
          <div style={{ marginBottom: 4 }}>
            {[
              { label: 'Built',   done: true,                   when: gen.built_on || null },
              { label: 'Sent',    done: !!gen.sent_at,          when: fmtTs(gen.sent_at) },
              { label: 'Viewed',  done: !!gen.viewed_at,        when: fmtTs(gen.viewed_at) },
              { label: 'Signed',  done: !!gen.signed_at,        when: fmtTs(gen.signed_at) },
              { label: 'Awarded', done: gen.stage === 'awarded', when: gen.stage === 'awarded' ? 'Marked awarded' : null },
            ].map((s, i, arr) => (
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
            ))}
          </div>

          {pendingDeclined && (
            <div className="lost-confirm">
              <Icon name="x" size={14} stroke={2}/>
              <span>Mark this proposal as declined?</span>
              <button className="btn ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={onCancelDeclined}>Cancel</button>
              <button className="btn" style={{ height: 28, fontSize: 12, padding: '0 10px', background: 'var(--slate)', borderColor: 'var(--slate)' }} onClick={() => onStage('declined')}>Confirm</button>
            </div>
          )}

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
            <div className="dtl-row"><span className="dtl-k">Proposal amount</span><span className="dtl-v num">{moneyFull(Number(gen.amount))}</span></div>
            <div className="dtl-row"><span className="dtl-k">Built</span><span className="dtl-v">{gen.built_on}</span></div>
            <div className="dtl-row"><span className="dtl-k">Salesperson</span><span className="dtl-v">{gen.salesperson_name}</span></div>
          </div>

          {gen.proposal_token && (
            <button
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
              onClick={() => window.open(`${window.location.origin}/p/${gen.proposal_token}`, '_blank', 'noopener')}
            >
              <Icon name="eye" size={15} stroke={1.9}/>View customer proposal
            </button>
          )}

          {!isTerminal && (
            <button
              className="btn amber"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={() => { onClose(); onEditGen(gen); }}
            >
              <Icon name="doc" size={15} stroke={1.9}/>Edit in Proposal Builder
            </button>
          )}

          {/* File attachments for this job — proposal, PO, permit, signed contract, delivery/startup, photos */}
          <RecordFiles linkedId={gen.id} linkedName={gen.customer} div="gen"
            emptyHint="No files yet. Attach the proposal, PO, permit, signed contract, delivery/startup docs, or photos."/>
        </div>
      </div>
    </div>
  );
}
