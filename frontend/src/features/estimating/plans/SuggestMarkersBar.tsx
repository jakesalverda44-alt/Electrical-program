// Estimating Phase B, Task 7 (deferral closed) — "Suggest markers" (per
// sheet) + "Find tag on sheets…" + confirm/reject-all for the CURRENT
// sheet's suggested markers. A thin presentational component, same
// convention as Toolbar.tsx: all the actual tag-matching/text-fetching
// logic lives in PlansWorkspace.tsx (which owns bidId/sheets/the markup
// draft list) — this only renders the controls and forwards clicks.
import React, { useState } from 'react';

export interface FindTagResult {
  sheetKey: string;
  label: string;
  count: number;
}

export interface SuggestMarkersBarProps {
  /** False when the CURRENT sheet has no text layer (SheetRow.has_text_layer)
   *  — "Suggest markers"/"Find tag" both need text to search. */
  hasTextLayer: boolean;
  /** True while a suggest/search fetch is in flight — disables the buttons
   *  so a slow-loading document can't be double-triggered. */
  busy: boolean;
  suggestedCountOnSheet: number;
  onSuggestForSheet: () => void;
  onConfirmAllOnSheet: () => void;
  onRejectAllOnSheet: () => void;
  onFindTag: (tag: string) => void;
  /** null = no search has run yet; [] = searched, zero sheets matched. */
  findTagResults: FindTagResult[] | null;
  findTagBusy: boolean;
  onJumpToFindTagResult: (sheetKey: string) => void;
}

export default function SuggestMarkersBar({
  hasTextLayer, busy, suggestedCountOnSheet, onSuggestForSheet, onConfirmAllOnSheet, onRejectAllOnSheet,
  onFindTag, findTagResults, findTagBusy, onJumpToFindTagResult,
}: SuggestMarkersBarProps) {
  const [findOpen, setFindOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');

  return (
    <div className="plan-suggest-bar">
      {!hasTextLayer ? (
        <span className="plan-suggest-bar-notice">No text on this sheet — nothing to search for tags here.</span>
      ) : (
        <button type="button" className="btn ghost sm" disabled={busy} onClick={onSuggestForSheet}>
          {busy ? 'Suggesting…' : 'Suggest markers for this sheet'}
        </button>
      )}

      {suggestedCountOnSheet > 0 && (
        <span className="plan-suggest-bar-pending">
          {suggestedCountOnSheet} suggested
          <button type="button" className="btn ghost sm" onClick={onConfirmAllOnSheet}>Confirm all on this sheet</button>
          <button type="button" className="btn ghost sm" onClick={onRejectAllOnSheet}>Reject all</button>
        </span>
      )}

      <button
        type="button"
        className="btn ghost sm"
        onClick={() => setFindOpen(v => !v)}
        aria-expanded={findOpen}
      >
        Find tag on sheets…
      </button>

      {findOpen && (
        <div className="plan-suggest-bar-find">
          <input
            type="text"
            placeholder="Tag, e.g. A1"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && tagInput.trim()) onFindTag(tagInput.trim()); }}
            aria-label="Tag to find"
          />
          <button
            type="button"
            className="btn primary sm"
            disabled={!tagInput.trim() || findTagBusy}
            onClick={() => onFindTag(tagInput.trim())}
          >
            {findTagBusy ? 'Searching…' : 'Search'}
          </button>
          {findTagResults != null && (
            findTagResults.length === 0 ? (
              <div className="plan-suggest-bar-find-empty">No sheets matched.</div>
            ) : (
              <ul className="plan-suggest-bar-find-results">
                {findTagResults.map(r => (
                  <li key={r.sheetKey}>
                    <button type="button" className="btn ghost sm" onClick={() => onJumpToFindTagResult(r.sheetKey)}>
                      {r.label} ({r.count})
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </div>
  );
}
