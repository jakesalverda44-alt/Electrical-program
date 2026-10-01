// The Plans view's "no scale on this sheet yet" prompt. One banner, five
// states (data-testid): plan-scale-needed-banner, plan-scale-suggestion-banner
// (title-block text layer), plan-scale-ambiguous-banner (several scales in the
// text layer), plan-scale-ai-banner (only the AI read one) and
// plan-scale-conflict-banner (title block and AI disagree — a pick is
// required). Every state has the "Pick a scale" dropdown and the measure
// button. Nothing here saves on its own: the caller PUTs what it is handed.
import React, { useState } from 'react';
import { SheetRow } from '../types';
import ScalePicker from './ScalePicker';
import { effectiveTitleBlockFtPerPt, scalesDisagree } from './scaleParse';

export type ScaleBannerMode = 'conflict' | 'ambiguous' | 'suggestion' | 'ai' | 'needed';

/** Pure: which banner (if any) a sheet gets. */
export function scaleBannerMode(sheet: SheetRow): ScaleBannerMode | null {
  if (sheet.ft_per_pt != null || sheet.page_group === 'spec') return null;
  const hasTb = sheet.suggested_ft_per_pt != null && !!sheet.suggested_label && !sheet.scale_ambiguous;
  const hasAi = sheet.ai_ft_per_pt != null && !!sheet.ai_scale_label;
  // A drawing whose number the page reader missed lands in 'other'; it still
  // gets every prompt except the plain "needed" one.
  if (sheet.page_group === 'other' && !sheet.scale_ambiguous && !hasTb && !hasAi) return null;
  if (sheet.scale_ambiguous) return 'ambiguous';
  // Title block (text layer) wins when both exist and agree; disagreement needs a pick.
  if (hasTb && hasAi && scalesDisagree(sheet.ai_ft_per_pt as number, sheet.suggested_ft_per_pt as number, 1)) return 'conflict';
  if (hasTb) return 'suggestion';
  if (hasAi) return 'ai';
  return 'needed';
}

export interface ScaleBannerProps {
  sheet: SheetRow;
  busy: boolean;
  /** Effective (half-size applied) ft/pt + label + source, ready to PUT. */
  onCommit: (ftPerPt: number, label: string, source: 'titleblock' | 'standard') => void;
  onMeasure: () => void;
}

const BTN_ROW: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

export default function ScaleBanner({ sheet, busy, onCommit, onMeasure }: ScaleBannerProps) {
  const [pickOther, setPickOther] = useState(false);
  const mode = scaleBannerMode(sheet);
  if (!mode) return null;

  const tbLabel = sheet.suggested_label;
  const aiLabel = sheet.ai_scale_label;
  const tbEff = effectiveTitleBlockFtPerPt(sheet.suggested_ft_per_pt, sheet.half_size);
  const aiEff = effectiveTitleBlockFtPerPt(sheet.ai_ft_per_pt ?? null, sheet.half_size);
  const pick = (ft: number, label: string) => onCommit(ft, label, 'standard');
  const measure = (text: string) => (
    <button type="button" className="btn ghost sm" data-testid="plan-set-scale" onClick={onMeasure}>{text}</button>
  );

  let text: string;
  if (mode === 'conflict') text = `The title block says ${tbLabel} but the AI read ${aiLabel} on this sheet — pick the right one.`;
  else if (mode === 'ambiguous') text = 'This sheet shows more than one scale — measure a known length to set it.';
  else if (mode === 'suggestion') text = `No scale on this sheet yet. The title block says ${tbLabel}.`;
  else if (mode === 'ai') text = `The AI read SCALE: ${aiLabel} on this sheet.`;
  else text = 'No scale on this sheet yet — lengths can’t be measured until you set one.';

  return (
    <div className="plan-scale-banner plan-scale-banner-warn" data-testid={`plan-scale-${mode}-banner`}>
      <span>{text}</span>
      <span style={BTN_ROW}>
        {mode === 'conflict' && (
          <>
            <button type="button" className="btn primary sm" disabled={busy || tbEff == null}
              onClick={() => tbEff != null && tbLabel && onCommit(tbEff, tbLabel, 'titleblock')}>
              Use title block ({tbLabel})
            </button>
            <button type="button" className="btn primary sm" disabled={busy || aiEff == null}
              onClick={() => aiEff != null && aiLabel && onCommit(aiEff, `${aiLabel} (AI read, confirmed)`, 'standard')}>
              Use AI read ({aiLabel})
            </button>
          </>
        )}
        {mode === 'suggestion' && (
          <button type="button" className="btn primary sm" disabled={busy}
            onClick={() => tbEff != null && tbLabel && onCommit(tbEff, tbLabel, 'titleblock')}>
            {busy ? 'Confirming…' : 'Confirm'}
          </button>
        )}
        {mode === 'ai' && (
          <>
            <button type="button" className="btn primary sm" disabled={busy}
              onClick={() => aiEff != null && aiLabel && onCommit(aiEff, `${aiLabel} (AI read, confirmed)`, 'standard')}>
              Use it
            </button>
            {!pickOther && <button type="button" className="btn ghost sm" onClick={() => setPickOther(true)}>Pick another</button>}
            {pickOther && <ScalePicker aiRawFtPerPt={sheet.ai_ft_per_pt} halfSize={sheet.half_size} busy={busy} onPick={pick} />}
            {measure('Measure')}
          </>
        )}
        {mode !== 'ai' && (
          <>
            {/* The AI read pre-selects the dropdown only when nothing else on the sheet contradicts it. */}
            <ScalePicker aiRawFtPerPt={mode === 'conflict' ? null : sheet.ai_ft_per_pt} halfSize={sheet.half_size} busy={busy} onPick={pick} />
            {measure('Set scale by measuring')}
          </>
        )}
      </span>
    </div>
  );
}
