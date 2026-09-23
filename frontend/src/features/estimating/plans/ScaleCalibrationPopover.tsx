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
  /** The title-block-parsed suggestion, when the sheet was built/refreshed
   *  with one and hasn't been calibrated by hand yet (est_sheets.scale_label
   *  when scale_source==='titleblock'). */
  titleBlockLabel: string | null;
  onCommit: (ftPerPt: number, label: string) => void;
  onCancel: () => void;
}

export default function ScaleCalibrationPopover({ points, titleBlockLabel, onCommit, onCancel }: ScaleCalibrationPopoverProps) {
  const [input, setInput] = useState('');
  const dPt = distancePt(points[0], points[1]);
  const parsedFeet = parseFeetInches(input);
  const canCommit = parsedFeet != null && dPt > 0;

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
      <div className="plan-scale-popover-actions">
        <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <button className="btn primary sm" disabled={!canCommit} onClick={commitTyped}>Set scale</button>
      </div>
    </div>
  );
}
