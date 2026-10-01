// "Pick a scale" — the standard architectural / engineering scale list, for
// sheets whose scale can't be read from a text layer (scanned plan sets).
// Used in the Plans scale banner and in the Scale popover. Saves nothing
// itself: onPick gets the effective ft/pt (half-size applied exactly once, via
// effectiveTitleBlockFtPerPt) and the "(picked)" label; the caller PUTs it with
// scale_source 'standard'.
import React, { useState } from 'react';
import {
  STANDARD_SCALES, StandardScale, matchStandardScale, pickedScaleLabel, standardFtPerPt, standardScaleById,
} from './scaleParse';

export interface ScalePickerProps {
  /** The AI-read scale (raw ft/pt), pre-selected when it is one of the standard
   *  scales. Never applied without the click on the button. */
  aiRawFtPerPt?: number | null;
  halfSize: boolean;
  buttonLabel?: string;
  busy?: boolean;
  /** Called on every selection change (the popover checks it against the measurement). */
  onSelect?: (scale: StandardScale | null) => void;
  onPick: (ftPerPt: number, label: string) => void;
}

export default function ScalePicker({ aiRawFtPerPt = null, halfSize, buttonLabel = 'Set scale', busy = false, onSelect, onPick }: ScalePickerProps) {
  const aiMatch = matchStandardScale(aiRawFtPerPt);
  const [selectedId, setSelectedId] = useState<string>(aiMatch?.id ?? '');
  const selected = standardScaleById(selectedId);
  const groups: Array<StandardScale['group']> = ['Architectural', 'Engineering'];
  return (
    <span className="plan-scale-picker" data-testid="plan-scale-picker">
      <select
        aria-label="Pick a scale"
        className="plan-scale-picker-select"
        value={selectedId}
        onChange={e => { setSelectedId(e.target.value); onSelect?.(standardScaleById(e.target.value)); }}
      >
        <option value="">Pick a scale…</option>
        {groups.map(g => (
          <optgroup key={g} label={g}>
            {STANDARD_SCALES.filter(s => s.group === g).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        className="btn primary sm"
        disabled={!selected || busy}
        onClick={() => { if (selected) onPick(standardFtPerPt(selected, halfSize), pickedScaleLabel(selected)); }}
      >
        {buttonLabel}
      </button>
      {aiMatch && selected?.id === aiMatch.id && (
        <span className="plan-scale-picker-hint" data-testid="plan-scale-ai-hint">Read from the drawing by the AI — confirm</span>
      )}
    </span>
  );
}
