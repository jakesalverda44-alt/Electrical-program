// UI cleanup round 2A — one card per kind of review question. Each card owns
// its own input state; the only thing it sends is the same request body the
// old generic renderer sent (see payloadCases.ts). The typicalassign card is
// NOT here: it lives in its own file (TypicalAssignCard.tsx) on purpose.
import React, { useState } from 'react';
import type { ReviewItem } from '../TakeoffReviewPanel';
import { useConfirm } from '../../../../components/ConfirmDialog';
import ReasonPicker, { useReasonSlot } from './ReasonPicker';
import { actionsOf, choiceLabel, isRealReason, notOnJobFirst, reasonPresets, resolutionText, unitsOf } from './reviewModel';

export interface CardProps {
  item: ReviewItem;
  busy: boolean;
  /** Posts one answer; true on success, false on error (the panel shows the toast). */
  resolve: (itemIds: string[], body: Record<string, unknown>, key: string) => Promise<boolean>;
}

type Slot = ReturnType<typeof useReasonSlot>;

/** The picker for one item-level "Why?" (not on this job / confirm). */
function ItemReason({ item, slot, k, busy, resolve }: CardProps & { slot: Slot; k: 'noj' | 'confirm' }) {
  if (slot.open !== k) return null;
  const noj = k === 'noj';
  return (
    <ReasonPicker
      idBase={`${k}-${item.id}`}
      inputLabel={noj ? `Why ${item.title} is not on this job` : `Why you confirm ${item.title}`}
      presets={reasonPresets(item, noj ? 'not_on_job' : 'confirm')}
      busy={busy}
      onSave={async reason => { if (await resolve([item.id], { action: noj ? 'not_on_job' : 'confirm', reason }, `${noj ? 'noj' : 'confirm'}:${item.id}`)) slot.close(); }}
      onCancel={() => slot.cancel(k)}
    />
  );
}

function NojTrigger({ item, slot, busy, primary }: { item: ReviewItem; slot: Slot; busy: boolean; primary?: boolean }) {
  return (
    <button type="button" className={primary ? 'btn primary sm' : 'btn ghost sm'} disabled={busy} data-testid={`review-noj-${item.id}`} {...slot.trigger('noj', `noj-${item.id}`)}>
      Not on this job
    </button>
  );
}

function CountInput({ item, qty, setQty }: { item: ReviewItem; qty: string; setQty: (v: string) => void }) {
  return (
    <input
      type="number" min={item.id.startsWith('demosuggest:') ? 0 : 1} step={1} inputMode="numeric"
      aria-label={`Count for ${item.title}`} placeholder="Count"
      value={qty} onChange={e => setQty(e.target.value)}
    />
  );
}

function MarkersButton({ item, busy, resolve }: CardProps) {
  return (
    <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void resolve([item.id], { action: 'markers' }, `markers:${item.id}`)}>
      Use confirmed markers
    </button>
  );
}

/** A zero / heads / typical / unscheduled / photo item: a count, markers, or not on this job. */
export function CountCard(props: CardProps) {
  const { item, busy, resolve } = props;
  const acts = actionsOf(item);
  const [qty, setQty] = useState('');
  const slot = useReasonSlot();
  const first = notOnJobFirst(item) && acts.includes('not_on_job');
  const saveCount = (
    <button type="button" className={first ? 'btn ghost sm' : 'btn primary sm'} disabled={!qty || busy}
      onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty) }, `count:${item.id}`)}>
      Save count
    </button>
  );
  return (
    <>
      <div className="tr-actions">
        {first && <><NojTrigger item={item} slot={slot} busy={busy} primary /><span className="tr-sub">or it’s here:</span></>}
        {acts.includes('count') && <><CountInput item={item} qty={qty} setQty={setQty} />{saveCount}</>}
        {acts.includes('markers') && <MarkersButton {...props} />}
        {!first && acts.includes('not_on_job') && <NojTrigger item={item} slot={slot} busy={busy} />}
      </div>
      <ItemReason {...props} slot={slot} k="noj" />
    </>
  );
}

/** count + confirm (recount, status, coverage, democompare): confirm the AI's number, or type the right one. */
export function QuantityCard(props: CardProps) {
  const { item, busy, resolve } = props;
  const acts = actionsOf(item);
  const [qty, setQty] = useState('');
  const slot = useReasonSlot();
  return (
    <>
      <div className="tr-actions">
        <button type="button" className="btn primary sm" disabled={busy} {...slot.trigger('confirm', `confirm-${item.id}`)}>
          {item.aiCount != null ? `Confirm AI count ${item.aiCount}` : 'Confirm'}
        </button>
        <span className="tr-sub">or enter the right count:</span>
        <CountInput item={item} qty={qty} setQty={setQty} />
        <button type="button" className="btn ghost sm" disabled={!qty || busy}
          onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty) }, `count:${item.id}`)}>
          Save count
        </button>
        {acts.includes('markers') && <MarkersButton {...props} />}
        {acts.includes('not_on_job') && <NojTrigger item={item} slot={slot} busy={busy} />}
      </div>
      <ItemReason {...props} slot={slot} k="confirm" />
      <ItemReason {...props} slot={slot} k="noj" />
    </>
  );
}

/** Any item answered from a list of options. One click saves the answer. */
export function ChoiceCard({ item, busy, resolve }: CardProps) {
  const acts = actionsOf(item);
  const [qty, setQty] = useState('');
  const options = item.options ?? [];
  return (
    <>
      {options.length > 0 && (
        <div className="tr-actions tr-choices" role="group" aria-label={item.question ?? item.title}>
          {options.map((o, i) => {
            const { label, hint } = choiceLabel(item, o, i);
            const suggested = o === item.suggested;
            return (
              <button key={o} type="button" className={suggested ? 'btn primary sm' : 'btn ghost sm'} disabled={busy}
                // The label is only text: the payload always carries the exact option.
                onClick={() => void resolve([item.id], { action: 'answer', answer: o }, `ans:${item.id}`)}>
                <span>{label}{suggested && <> <span className="tr-chip tr-chip-q">Suggested</span></>}</span>
                {hint && <span className="tr-choice-hint">{hint}</span>}
              </button>
            );
          })}
        </div>
      )}
      {item.suggested && <span className="tr-sub">Suggested: {item.suggested} — the drawings say “by G.C.”, which is APT’s scope.</span>}
      {options.length === 0 && !acts.includes('count') && <span className="tr-sub">No choices were sent for this item — re-run the analysis.</span>}
      {acts.includes('count') && (
        <div className="tr-actions">
          {options.length > 0 && <span className="tr-sub">or enter a different count:</span>}
          <CountInput item={item} qty={qty} setQty={setQty} />
          <button type="button" className="btn ghost sm" disabled={!qty || busy}
            onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty) }, `count:${item.id}`)}>
            Save count
          </button>
        </div>
      )}
    </>
  );
}

/** confirm only: a single Confirm that asks why. */
export function ConfirmCard(props: CardProps) {
  const { item, busy } = props;
  const slot = useReasonSlot();
  return (
    <>
      <div className="tr-actions">
        <button type="button" className="btn ghost sm" disabled={busy} {...slot.trigger('confirm', `confirm-${item.id}`)}>Confirm</button>
      </div>
      <ItemReason {...props} slot={slot} k="confirm" />
    </>
  );
}

/** A tag drawn on the plans but not on the schedule: name it with a count, say it's the same as another type, or not on this job. */
export function UnlistedCard(props: CardProps) {
  const { item, busy, resolve } = props;
  const acts = actionsOf(item);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [qty, setQty] = useState('');
  const [same, setSame] = useState('');
  const slot = useReasonSlot();
  const options = item.options ?? [];
  return (
    <>
      <div className="tr-actions">
        <span className="tr-sub">It’s a new type:</span>
        <input type="text" aria-label={`What is Type ${item.type ?? ''}?`.replace(' ?', '?')} placeholder="What is it? e.g. 4 ft LED strip, surface mounted"
          value={name} onChange={e => { setName(e.target.value); setNameTouched(true); }} />
        <input type="number" min={1} step={1} inputMode="numeric" aria-label={`Count for ${item.title}`} placeholder={`${item.aiCount ?? 'Count'}`}
          value={qty} onChange={e => setQty(e.target.value)} />
        {/* Remodel round A2 — an unlisted tag is counted WITH its name (the reason field). */}
        <button type="button" className="btn primary sm" disabled={!qty || !isRealReason(name) || busy}
          onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty), reason: name }, `count:${item.id}`)}>
          Save count
        </button>
        {nameTouched && !isRealReason(name) && <span className="tr-sub">Say what it is in a few words (at least 10 characters). It becomes the line name.</span>}
      </div>
      {acts.includes('answer') && options.length > 0 && (
        <div className="tr-actions">
          <span className="tr-sub">Or it’s the same as:</span>
          <select aria-label="Same as which type?" value={same} onChange={e => setSame(e.target.value)}>
            <option value="">Pick a type…</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <button type="button" className="btn ghost sm" disabled={!same || busy} data-testid={`unlisted-same-save-${item.id}`}
            onClick={() => void resolve([item.id], { action: 'answer', answer: same }, `ans:${item.id}`)}>
            Save
          </button>
        </div>
      )}
      {acts.includes('not_on_job') && (
        <div className="tr-actions"><NojTrigger item={item} slot={slot} busy={busy} /></div>
      )}
      <ItemReason {...props} slot={slot} k="noj" />
    </>
  );
}

/** Fix round B6 — a legend-zero group: EACH member gets its own row with its
 *  own action (not on job / enter qty). No bulk button applies one action to
 *  every member at once; the one shortcut ("mark all remaining not on job")
 *  sits behind a confirm dialog listing every member it would touch. */
export function LegendGroupCard({ item, busy, resolve }: CardProps) {
  const confirm = useConfirm();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [allReason, setAllReason] = useState('');
  const slot = useReasonSlot();
  const members = item.groupedTypes ?? [];
  const { total, answered } = unitsOf(item);
  const remaining = members.filter(m => !m.resolution);
  return (
    <div className="tr-group-members" data-testid={`review-groupmembers-${item.id}`}>
      <div className="tr-sub">{answered} of {total} answered</div>
      <ul className="tr-list">
        {members.map(m => {
          const mid = `${item.id}::${m.key}`;
          const k = `noj:${m.key}`;
          const idBase = `groupmember-noj-${mid}`;
          return (
            <li key={m.key} className="tr-item" data-testid={`review-groupmember-${mid}`} data-member-key={m.key}
              {...(m.resolution ? {} : { 'data-member-open': 'true', tabIndex: -1 })}>
              <div className="tr-item-head"><strong>{m.type}</strong>{m.description ? ` — ${m.description}` : ''}</div>
              {m.resolution ? (
                <div className="tr-sub" data-testid={`review-groupmember-done-${mid}`}>{resolutionText(m.resolution)}</div>
              ) : (
                <>
                  <div className="tr-actions">
                    <button type="button" className="btn primary sm" disabled={busy} data-testid={idBase} {...slot.trigger(k, idBase)}>Not on this job</button>
                    <span className="tr-sub">or it’s here:</span>
                    <input type="number" min={1} step={1} inputMode="numeric" aria-label={`Count for ${m.type}`} placeholder="Count (from the schedule, or as counted)"
                      value={qty[mid] ?? ''} data-testid={`groupmember-qty-${mid}`} onChange={e => setQty(q => ({ ...q, [mid]: e.target.value }))} />
                    <button type="button" className="btn ghost sm" disabled={!qty[mid] || busy} data-testid={`groupmember-count-${mid}`}
                      onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty[mid]), memberKey: m.key }, `grpmember:${mid}`)}>
                      Save count
                    </button>
                  </div>
                  {slot.open === k && (
                    <ReasonPicker idBase={idBase} inputLabel={`Why ${m.type} is not on this job`} inputTestId={`groupmember-reason-input-${mid}`}
                      presets={reasonPresets(item, 'not_on_job')} busy={busy}
                      onSave={async reason => { if (await resolve([item.id], { action: 'not_on_job', reason, memberKey: m.key }, `grpmember:${mid}`)) slot.close(); }}
                      onCancel={() => slot.cancel(k)} />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {remaining.length >= 2 && (
        <div className="tr-bulk" data-testid={`group-noj-all-${item.id}`}>
          <input type="text" aria-label={`Reason for all ${remaining.length} remaining members of ${item.title}`}
            placeholder="Reason for all of them (at least 10 characters)"
            value={allReason} data-testid={`group-noj-all-reason-${item.id}`} onChange={e => setAllReason(e.target.value)} />
          <button type="button" className="btn ghost sm" disabled={allReason.trim().length < 10 || busy} data-testid={`group-noj-all-button-${item.id}`}
            onClick={async () => {
              const ok = await confirm({
                title: `Mark all ${remaining.length} remaining not on this job?`,
                body: <ul>{remaining.map(m => <li key={m.key}>{m.type}{m.description ? ` — ${m.description}` : ''}</li>)}</ul>,
                confirmLabel: 'Confirm',
              });
              if (!ok) return;
              // No memberKey: the server answers every member that doesn't have
              // one yet, each with its OWN recorded resolution — never a single
              // blanket flag on the group.
              void resolve([item.id], { action: 'not_on_job', reason: allReason }, `grp:${item.id}:all`);
            }}>
            Mark all {remaining.length} remaining not on this job
          </button>
        </div>
      )}
    </div>
  );
}

/** Fix round 3 / B10, B11 — a gap-fill/reconcile finding: EACH type it covers
 *  gets its own row, in its OWN unit (heads for a site_lighting type, count
 *  otherwise) — never a number broadcast to a sibling type. Never "not on this
 *  job": the finding is about a second source disagreeing with the plans, so
 *  the three actions are "Confirm the found marks on the plans" (gap-fill
 *  only), "No more on this job — keep current count N" (rejects the
 *  suggestion/mismatch, keeps the type's current value) and "Enter correct
 *  count". */
export function ReconcileCard({ item, busy, resolve }: CardProps) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const slot = useReasonSlot();
  const canMarkers = (item.actions ?? []).includes('markers');
  return (
    <div className="tr-group-members" data-testid={`review-reconcile-members-${item.id}`}>
      <ul className="tr-list">
        {(item.reconcileMembers ?? []).map(m => {
          const mid = `${item.id}::${m.key}`;
          const k = `keep:${m.key}`;
          const idBase = `reconcilemember-reject-${mid}`;
          const save = (key: string) => resolve([item.id], { action: 'count', qty: Number(qty[mid]), memberKey: m.key }, key);
          return (
            <li key={m.key} className="tr-item" data-testid={`review-reconcilemember-${mid}`} data-member-key={m.key}
              {...(m.resolution && !m.resolution.needs ? {} : { 'data-member-open': 'true', tabIndex: -1 })}>
              <div className="tr-item-head">
                <strong>{m.type}</strong>{m.description ? ` — ${m.description}` : ''}
                <span className="tr-sub"> — currently {m.currentQty} {m.unit}</span>
              </div>
              {m.resolution?.needs ? (
                // Fix round 4 / B13, N9 — half done: poles or heads still needed.
                <div className="tr-actions" data-testid={`review-reconcilemember-needs-${mid}`}>
                  <span className="tr-sub">
                    {m.resolution.needs === 'heads'
                      ? `${m.resolution.poles} pole${m.resolution.poles === 1 ? '' : 's'} confirmed — heads per pole is not on the schedule: enter the heads.`
                      : `${m.resolution.qty} heads entered — the poles can't be derived: enter the pole count.`}
                  </span>
                  <input type="number" min={1} step={1} inputMode="numeric"
                    aria-label={`${m.resolution.needs === 'heads' ? 'Heads' : 'Pole count'} for ${m.type}`}
                    placeholder={m.resolution.needs === 'heads' ? 'Heads' : 'Poles'}
                    value={qty[mid] ?? ''} data-testid={`reconcilemember-needs-qty-${mid}`} onChange={e => setQty(q => ({ ...q, [mid]: e.target.value }))} />
                  <button type="button" className="btn primary sm" disabled={!qty[mid] || busy} data-testid={`reconcilemember-needs-save-${mid}`}
                    onClick={() => void save(`rcmember:${mid}`)}>
                    {m.resolution.needs === 'heads' ? 'Save heads' : 'Save poles'}
                  </button>
                </div>
              ) : m.resolution ? (
                <div className="tr-sub" data-testid={`review-reconcilemember-done-${mid}`}>{resolutionText(m.resolution)}</div>
              ) : (
                <>
                  <div className="tr-actions">
                    {canMarkers && (
                      <button type="button" className="btn ghost sm" disabled={busy} data-testid={`reconcilemember-markers-${mid}`}
                        onClick={() => void resolve([item.id], { action: 'markers', memberKey: m.key }, `rcmember:${mid}`)}>
                        Confirm the found marks on the plans
                      </button>
                    )}
                    <input type="number" min={1} step={1} inputMode="numeric" aria-label={`Correct count for ${m.type} (${m.unit})`}
                      placeholder={m.unit === 'heads' ? 'Correct heads' : 'Correct count'}
                      value={qty[mid] ?? ''} data-testid={`reconcilemember-qty-${mid}`} onChange={e => setQty(q => ({ ...q, [mid]: e.target.value }))} />
                    <button type="button" className="btn primary sm" disabled={!qty[mid] || busy} data-testid={`reconcilemember-count-${mid}`}
                      onClick={() => void save(`rcmember:${mid}`)}>
                      Enter correct count
                    </button>
                    <button type="button" className="btn ghost sm" disabled={busy} data-testid={idBase} {...slot.trigger(k, idBase)}>
                      No more on this job — keep current count {m.currentQty}
                    </button>
                  </div>
                  {slot.open === k && (
                    <ReasonPicker idBase={idBase} inputLabel={`Why no more ${m.type} on this job`} inputTestId={`reconcilemember-reason-input-${mid}`}
                      presets={reasonPresets(item, 'keep')} busy={busy}
                      onSave={async reason => { if (await resolve([item.id], { action: 'confirm', reason, memberKey: m.key }, `rcmember:${mid}`)) slot.close(); }}
                      onCancel={() => slot.cancel(k)} />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
