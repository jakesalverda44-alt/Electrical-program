// UI cleanup round 2A — the "Why?" chooser used wherever the backend needs a
// reason on a single item. Ready-made reasons are one click; the estimator can
// still type their own. Everything it sends passes isRealReason (the backend
// rule, mirrored in estimating/reasons).
import React, { useEffect, useRef, useState } from 'react';
import { isRealReason } from '../../../estimating/reasons';

export interface ReasonPickerProps {
  /** testid prefix, e.g. `groupmember-noj-${mid}`; the id of the picker is derived from it. */
  idBase: string;
  /** aria-label of the typed box (keep the existing wording). */
  inputLabel: string;
  /** Keep the existing testids on the typed box. */
  inputTestId?: string;
  presets: string[];
  busy: boolean;
  onSave: (reason: string) => void;
  onCancel: () => void;
}

/** DOM id for a picker (ids here contain spaces/colons; aria-controls is space-separated). */
export function pickerId(idBase: string): string {
  return `rp-${idBase.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
}

export default function ReasonPicker({ idBase, inputLabel, inputTestId, presets, busy, onSave, onCancel }: ReasonPickerProps) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Review fix S4 — focus the typed box, never a one-click preset: a stray or held
  // Enter on the trigger must not be able to save a canned reason.
  useEffect(() => { inputRef.current?.focus(); }, []);
  const ok = isRealReason(text);
  return (
    <div
      id={pickerId(idBase)} className="tr-reason" role="group" aria-label="Why?"
      data-testid={`${idBase}-picker`}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
    >
      <span className="tr-sub">Why?</span>
      {presets.map(p => (
        <button key={p} type="button" className="btn ghost sm tr-reason-preset" disabled={busy} onClick={() => onSave(p)}>
          {p}
        </button>
      ))}
      <input
        ref={inputRef} type="text" placeholder="Or type your own reason" aria-label={inputLabel} data-testid={inputTestId}
        value={text} onChange={e => { setText(e.target.value); setTouched(true); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.repeat && ok && !busy) { e.preventDefault(); onSave(text); } }}
      />
      <button type="button" className="btn primary sm" data-testid={`${idBase}-save`} disabled={!ok || busy} onClick={() => onSave(text)}>
        Save reason
      </button>
      <button type="button" className="tr-link" onClick={onCancel}>Cancel</button>
      {touched && !ok && <span className="tr-sub">A few more words, please (at least 10 characters).</span>}
      {presets.length === 0 && <span className="tr-sub">This one needs a typed reason.</span>}
    </div>
  );
}

/** Which picker (if any) a card has open, plus the trigger wiring: aria-expanded,
 *  aria-controls, and returning focus to the trigger when it is cancelled. */
export function useReasonSlot() {
  const [open, setOpen] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  return {
    open,
    close: () => setOpen(null),
    cancel: (k: string) => { setOpen(null); refs.current[k]?.focus(); },
    trigger: (k: string, idBase: string) => ({
      ref: (el: HTMLButtonElement | null) => { refs.current[k] = el; },
      'aria-expanded': open === k,
      'aria-controls': pickerId(idBase),
      onClick: () => setOpen(o => (o === k ? null : k)),
    }),
  };
}
