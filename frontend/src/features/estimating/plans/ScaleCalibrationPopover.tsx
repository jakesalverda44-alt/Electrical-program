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

// Fix round 1 / N4 — calibration used to accept two points ANY distance
// apart, even 1pt: two clicks that landed almost on top of each other
// (a shaky trackpad, a mis-click) turned a tiny pixel error into a huge
// relative scale error, since ft_per_pt = knownLength / distancePt — the
// smaller the denominator, the more a 1-2pt click imprecision swings the
// result. 50pt (~0.7in on the printed sheet) is short enough to still
// calibrate off a real dimension line on a typical architectural sheet,
// long enough that ordinary click imprecision stops dominating the
// result. This is a hard requirement — Set scale stays disabled below it
// — unlike the (softer, still-committable) warnings below.
const MIN_CALIBRATION_DISTANCE_PT = 50;

// Fix round 1 / N4 — "warn when the implied scale is extreme". Generous
// bounds around every real architectural/site-plan scale this app's own
// scaleParse.ts documents (1/8"=1'-0" -> 0.111 ft/pt, up to a large site
// plan at 1"=100' -> 1.157 ft/pt) — wide enough that a legitimate large-
// format sheet never trips it, tight enough to catch the obvious typo
// (a known length entered as "1266" instead of "12'6"", or a decimal
// slip) that produces a scale nothing on a real plan set would ever use.
const MIN_SANE_FT_PER_PT = 0.01;
const MAX_SANE_FT_PER_PT = 5;

export default function ScaleCalibrationPopover({ points, titleBlockLabel, onCommit, onCancel }: ScaleCalibrationPopoverProps) {
  const [input, setInput] = useState('');
  const dPt = distancePt(points[0], points[1]);
  const parsedFeet = parseFeetInches(input);
  const tooShort = dPt > 0 && dPt < MIN_CALIBRATION_DISTANCE_PT;
  const canCommit = parsedFeet != null && dPt >= MIN_CALIBRATION_DISTANCE_PT;

  const typedFtPerPt = parsedFeet != null && dPt > 0 ? parsedFeet / dPt : null;
  const suggestedFtPerPt = titleBlockLabel ? ftPerPtFromLabel(titleBlockLabel) : null;
  const disagreementPct = typedFtPerPt != null && suggestedFtPerPt != null && suggestedFtPerPt > 0
    ? Math.abs(typedFtPerPt - suggestedFtPerPt) / suggestedFtPerPt * 100
    : null;
  const disagreesWithTitleBlock = disagreementPct != null && disagreementPct > DISAGREEMENT_WARN_PCT;
  const extremeScale = typedFtPerPt != null && (typedFtPerPt < MIN_SANE_FT_PER_PT || typedFtPerPt > MAX_SANE_FT_PER_PT);

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
      {/* Fix round 1 / N4 — a hard requirement (Set scale stays disabled
          below MIN_CALIBRATION_DISTANCE_PT), never just a warning: two
          clicks this close together can't calibrate anything reliably. */}
      {tooShort && (
        <div className="plan-scale-popover-error" data-testid="plan-scale-too-short-error">
          These two points are too close together to calibrate accurately — draw a longer reference line.
        </div>
      )}
      {disagreesWithTitleBlock && (
        <div className="plan-scale-popover-warn" data-testid="plan-scale-disagreement-warning">
          This measurement disagrees with the title block's {titleBlockLabel} by {Math.round(disagreementPct as number)}% — double check before setting.
        </div>
      )}
      {!tooShort && extremeScale && (
        <div className="plan-scale-popover-warn" data-testid="plan-scale-extreme-warning">
          That implies an unusually {(typedFtPerPt as number) > MAX_SANE_FT_PER_PT ? 'large' : 'small'} scale — double-check the length you entered.
        </div>
      )}
      <div className="plan-scale-popover-actions">
        <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <button className="btn primary sm" disabled={!canCommit} onClick={commitTyped}>Set scale</button>
      </div>
    </div>
  );
}
