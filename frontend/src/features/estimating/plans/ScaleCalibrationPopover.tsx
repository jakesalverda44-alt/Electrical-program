// Estimating Phase B, Task 5 — the Scale tool's popover: after two clicks
// (toolMachine's commitScalePoints effect), ask for the known real-world
// length between them, or offer the title-block-parsed scale as a
// one-click alternative. Pure presentation + ftInParse.ts; the actual
// PUT .../sheets/:documentId/:pageIndex/scale call is the caller's job.
import React, { useState } from 'react';
import { parseFeetInches } from './ftInParse';
import { ftPerPtFromLabel } from './scaleParse';
import { PdfPoint } from './toolMachine';

function distancePt(a: PdfPoint, b: PdfPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export interface ScaleCalibrationPopoverProps {
  points: [PdfPoint, PdfPoint];
  /** Fix round 1 / B7 — the title-block-parsed SUGGESTION
   *  (est_sheets.suggested_label), independent of whether the sheet has
   *  already been confirmed/calibrated — offered here as an alternate
   *  one-click "Use X" path whenever the estimator happens to be
   *  mid-calibration, on top of the standalone confirm banner
   *  PlansWorkspace.tsx renders without requiring any line-drawing at
   *  all. null when nothing was found, or the sheet has more than one
   *  distinct scale value (scale_ambiguous). */
  titleBlockLabel: string | null;
  onCommit: (ftPerPt: number, label: string) => void;
  onCancel: () => void;
}

// Fix round 1 / B7 — "the '>2% verify scale' warning isn't implemented."
// A measurement that disagrees with the title block's own suggestion by
// more than this is worth a second look before committing (a half-size
// print, a wrong known-length, or the title block simply being stale) —
// still fully committable either way, just flagged.
const DISAGREEMENT_WARN_PCT = 2;

export default function ScaleCalibrationPopover({ points, titleBlockLabel, onCommit, onCancel }: ScaleCalibrationPopoverProps) {
  const [input, setInput] = useState('');
  const dPt = distancePt(points[0], points[1]);
  const parsedFeet = parseFeetInches(input);
  const canCommit = parsedFeet != null && dPt > 0;

  const typedFtPerPt = canCommit && parsedFeet != null ? parsedFeet / dPt : null;
  const suggestedFtPerPt = titleBlockLabel ? ftPerPtFromLabel(titleBlockLabel) : null;
  const disagreementPct = typedFtPerPt != null && suggestedFtPerPt != null && suggestedFtPerPt > 0
    ? Math.abs(typedFtPerPt - suggestedFtPerPt) / suggestedFtPerPt * 100
    : null;
  const disagreesWithTitleBlock = disagreementPct != null && disagreementPct > DISAGREEMENT_WARN_PCT;

  const commitTyped = () => {
    if (!canCommit || parsedFeet == null) return;
    onCommit(parsedFeet / dPt, `Calibrated: ${input.trim()}`);
  };

  const commitTitleBlock = () => {
    if (!titleBlockLabel) return;
    const ftPerPt = ftPerPtFromLabel(titleBlockLabel);
    if (ftPerPt == null) return;
    onCommit(ftPerPt, titleBlockLabel);
  };

  return (
    <div className="plan-scale-popover" role="dialog" aria-label="Set sheet scale">
      {titleBlockLabel && (
        <button className="btn ghost sm" onClick={commitTitleBlock}>
          Use {titleBlockLabel}
        </button>
      )}
      <div className="plan-scale-popover-row">
        <label htmlFor="plan-scale-known-length">Known length of this line:</label>
        <input
          id="plan-scale-known-length"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`12'6"`}
          onKeyDown={e => { if (e.key === 'Enter') commitTyped(); if (e.key === 'Escape') onCancel(); }}
          autoFocus
        />
      </div>
      {input.trim() !== '' && parsedFeet == null && (
        <div className="plan-scale-popover-error">Enter a length like 12'6", 12.5, or 150'</div>
      )}
      {disagreesWithTitleBlock && (
        <div className="plan-scale-popover-warn" data-testid="plan-scale-disagreement-warning">
          This measurement disagrees with the title block's {titleBlockLabel} by {Math.round(disagreementPct as number)}% — double check before setting.
        </div>
      )}
      <div className="plan-scale-popover-actions">
        <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <button className="btn primary sm" disabled={!canCommit} onClick={commitTyped}>Set scale</button>
      </div>
    </div>
  );
}
