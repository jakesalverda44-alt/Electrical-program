// Task 9 — the Labor & Pricing screen. Replaces the old flat-rate PricingTab.
// Receives its state from useEstimatingBid() (owned by the caller, shared
// with BidSummary) rather than fetching or persisting anything itself.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import Modal from '../../components/Modal';
import { useConfirm } from '../../components/ConfirmDialog';
import { type DuplicatePair, DEFAULT_SETTINGS, EstimateLine, EstimateSettings, EstUnit, Library, LibraryFactor, PricingRecap } from './types';
import { AccubidPricingPanel } from './AccubidPricingPanel';

// Fix round 2 / SF2 — the resolver only offers items/assemblies whose unit
// FAMILY is compatible with the line's own unit: EA is its own family; LF/C/M
// are one family (mirrors backend/src/estimating/mapper.ts's isUnitCompatible —
// duplicated here since the frontend has no reason to import backend code).
function unitFamily(u: string): 'EA' | 'LINEAR' | 'OTHER' {
  const n = (u ?? '').trim().toUpperCase();
  if (n === 'EA') return 'EA';
  if (n === 'LF' || n === 'C' || n === 'M') return 'LINEAR';
  return 'OTHER';
}
function isUnitCompatible(a: string, b: string): boolean {
  const fa = unitFamily(a);
  const fb = unitFamily(b);
  if (fa === 'OTHER' || fb === 'OTHER') return false;
  return fa === fb;
}
const KNOWN_UNITS: EstUnit[] = ['EA', 'LF', 'C', 'M'];

// Fix round 2 / N1 — clearing a rate/pct input (empty string) used to become
// Number('') = 0, a REAL zero rate/pct silently substituted for "I haven't
// decided yet" — reverts to the field's own default instead. Read eagerly
// (before setSettings' updater callback runs), same reasoning as N3's
// floors_above_2 fix: a controlled input's DOM value can be reset by React
// before a LAZY read inside the updater would see it.
function numberOrDefault(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface LaborPricingStepProps {
  /** Next round B2/B3 — mounts AccubidPricingPanel in place of the Phase A
   *  settings row when settings.pricing_mode === 'accubid'. */
  bidId?: string;
  lines: EstimateLine[];
  settings: EstimateSettings;
  recap: PricingRecap;
  saving: boolean;
  syncing: boolean;
  saveError: string | null;
  /** Fix round 1 / B5 — when true, onSync confirms before overwriting
   *  takeoff-sourced lines with unsaved estimator edits. */
  dirty?: boolean;
  setLines: (updater: EstimateLine[] | ((prev: EstimateLine[]) => EstimateLine[])) => void;
  setSettings: (updater: EstimateSettings | ((prev: EstimateSettings) => EstimateSettings)) => void;
  // Fix round 2 / R2-S1 — widened from Promise<void>; see
  // EstimatingWorkspace.tsx's own save prop comment. This component's own
  // Save button already discards the result explicitly (`void save()`).
  save: () => Promise<unknown>;
  syncTakeoff: () => Promise<{ added: number; updated: number; vanished: number; rebound?: number; unbound?: number } | null>;
  showToast?: (t: { title: string; sub?: string; variant?: 'success' | 'error' }) => void;
  /** Next round A7 — possible duplicates from the server (GET / sync /
   *  refused save); the open ones block the save until resolved. */
  duplicates?: DuplicatePair[];
  /** Fix round B5 — a line_key named by the evidence gate's 409 (a manual/
   *  overridden line with no real "Evidence / reason" yet); scrolls to and
   *  focuses that line's reason field once, then calls onFocusedLine. */
  focusLineKey?: string | null;
  onFocusedLine?: () => void;
}

/** Fix round B5 — mirrors backend/src/ai/reviewItems.ts's isRealReason: a
 *  real explanation, not just enough characters (".........." fails). */
export function isRealReason(reason: string): boolean {
  return reason.trim().length >= 10 && /[A-Za-z]{3,}/.test(reason);
}

/** Next round A7 — the pairs still open against the CURRENT lines: both
 *  lines still here, and no "keep both" decision on the kept one. */
export function openDuplicatePairs(pairs: DuplicatePair[], lines: EstimateLine[]): DuplicatePair[] {
  const byKey = new Map(lines.filter(l => l.line_key).map(l => [l.line_key as string, l]));
  return pairs.filter(p => {
    const k = byKey.get(p.keptKey);
    const n = byKey.get(p.newKey);
    return !!k && !!n && !k.excluded && !n.excluded && !(k.dup_ok?.with ?? []).includes(p.newKey);
  });
}

function DuplicatePairControl({ pair, onRemove, onKeepBoth }: {
  pair: DuplicatePair;
  onRemove: (key: string) => void;
  onKeepBoth: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= 10 && /[A-Za-z]{3,}/.test(reason);
  return (
    <div className="lp-banner" data-testid={`lp-dup-${pair.keptKey}-${pair.newKey}`} style={{ borderColor: 'var(--red)' }}>
      <div><strong>Possible duplicate</strong> ({pair.category}): “{pair.keptDescription}” ({pair.keptQty} {pair.unit}, kept from the previous run) and “{pair.newDescription}” ({pair.newQty} {pair.unit}, new takeoff line).</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <button type="button" className="btn ghost" onClick={() => onRemove(pair.newKey)} data-testid="lp-dup-remove-new">Same item — exclude the new line</button>
        <button type="button" className="btn ghost" onClick={() => onRemove(pair.keptKey)} data-testid="lp-dup-remove-kept">Same item — exclude my old line</button>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Different items? Say why (at least 10 characters)" data-testid="lp-dup-reason"
          style={{ flex: '1 1 220px', font: 'inherit', fontSize: 12.5 }}/>
        <button type="button" className="btn ghost" disabled={!ok} onClick={() => onKeepBoth(reason.trim())} data-testid="lp-dup-keep-both">Different items — keep both</button>
      </div>
    </div>
  );
}

/** Fix round 1 / S8 — a brand-new manual line needs a STABLE id the instant
 *  it's created, before it's ever priced/saved. Without one, recapByKey had
 *  to fall back to pairing by array index, which misaligns a line with the
 *  wrong priced values the moment a request resolves out of order or a row
 *  is deleted/reordered while a live-recalc request is in flight. */
function newLineId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const SETTINGS_PCT_FIELDS: { key: keyof EstimateSettings; label: string }[] = [
  { key: 'material_tax_pct', label: 'Material tax %' },
  { key: 'consumables_pct', label: 'Consumables %' },
  { key: 'small_tools_pct', label: 'Small tools %' },
  { key: 'supervision_pct', label: 'Supervision %' },
  { key: 'overhead_pct', label: 'Overhead %' },
  { key: 'profit_pct', label: 'Profit %' },
];

function lineKey(line: EstimateLine, idx: number): string {
  return line.id ?? `new-${idx}`;
}

export function LaborPricingStep({
  bidId, lines, settings, recap, saving, syncing, saveError, dirty, setLines, setSettings, save, syncTakeoff, showToast, duplicates = [],
  focusLineKey, onFocusedLine,
}: LaborPricingStepProps) {
  const openDups = useMemo(() => openDuplicatePairs(duplicates, lines), [duplicates, lines]);
  const dupKeys = useMemo(() => new Set(openDups.flatMap(p => [p.keptKey, p.newKey])), [openDups]);
  const { data: library } = useApi<Library>('/estimating/library');
  const [resolverIndex, setResolverIndex] = useState<number | null>(null);
  const [resolverQuery, setResolverQuery] = useState('');
  // Fix round 1 / S7 — "Keep as manual line" used to accept a line with
  // material_unit_override/labor_hours_override silently defaulted to 0/0 —
  // an invisible $0 line an estimator never meant to create. Require an
  // explicit value in at least one field before the button is even clickable.
  const [manualMaterial, setManualMaterial] = useState('');
  const [manualHours, setManualHours] = useState('');
  const closeResolver = () => { setResolverIndex(null); setResolverQuery(''); setManualMaterial(''); setManualHours(''); };
  const confirm = useConfirm();
  // N8: the most recently deleted manual line, kept around just long enough
  // to offer Undo — cleared on the next delete or once the toast fades.
  const [lastDeleted, setLastDeleted] = useState<{ line: EstimateLine; index: number } | null>(null);

  // Fix round 1 / S8 — pair each priced recap line with its CLIENT line by
  // stable id, not array position. A line's id is always present: real
  // lines have their DB uuid, proposed/takeoff lines have a stable
  // `proposed-N`/DB id, and every manual line gets one the instant it's
  // created (newLineId(), below) — so there is no longer a need to fall
  // back to an index-derived key at all.
  const recapByKey = useMemo(() => {
    const map = new Map<string, PricingRecap['lines'][number]>();
    recap.lines.forEach(l => { if (l.id) map.set(l.id, l); });
    return map;
  }, [recap.lines]);

  const categories = useMemo(() => {
    const order: string[] = [];
    const byCategory = new Map<string, { line: EstimateLine; idx: number }[]>();
    lines.forEach((line, idx) => {
      if (!byCategory.has(line.category)) { byCategory.set(line.category, []); order.push(line.category); }
      byCategory.get(line.category)!.push({ line, idx });
    });
    return order.map(cat => ({ category: cat, rows: byCategory.get(cat)! }));
  }, [lines]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Fix round B5 — the evidence gate's 409 names an offending line by its
  // line_key; jump to it: un-collapse its category if needed, scroll it
  // into view and focus its reason field, once.
  const evidenceNoteRefs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => {
    if (!focusLineKey) return;
    const line = lines.find(l => l.line_key === focusLineKey);
    if (!line) { onFocusedLine?.(); return; }
    if (collapsed[line.category]) setCollapsed(prev => ({ ...prev, [line.category]: false }));
    const t = setTimeout(() => {
      const el = evidenceNoteRefs.current[focusLineKey];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
      onFocusedLine?.();
    }, 50); // one tick past the un-collapse re-render above, so the row exists to scroll to
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLineKey]);

  const recheckCount = lines.filter(l => !!l.recheck_run_id).length;

  const updateLine = (idx: number, patch: Partial<EstimateLine>) => {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addManualLine = () => {
    setLines(prev => [...prev, {
      id: newLineId(),
      category: categories[0]?.category ?? 'Branch Power', description: '', qty: 1, unit: 'EA',
      material_unit_override: 0, labor_hours_override: 0, source: 'manual',
    }]);
  };

  // N8: delete a manual line with Undo, rather than only exposing "exclude".
  const deleteManualLine = (idx: number) => {
    setLines(prev => {
      setLastDeleted({ line: prev[idx], index: idx });
      return prev.filter((_, i) => i !== idx);
    });
    if (showToast) {
      showToast({ title: 'Line deleted', sub: 'Undo available — re-add it from the Add manual line button if needed.' });
    }
  };
  const undoDelete = () => {
    if (!lastDeleted) return;
    setLines(prev => {
      const next = [...prev];
      next.splice(Math.min(lastDeleted.index, next.length), 0, lastDeleted.line);
      return next;
    });
    setLastDeleted(null);
  };

  const onSync = async () => {
    // Fix round 1 / B5 — ask first when there's unsaved work sitting on top
    // of the last saved/proposed snapshot, so a sync never silently
    // discards an in-progress edit. Fix round 2 / SF6 — the old copy here
    // ("Manual lines and estimator overrides are never touched") was wrong:
    // useEstimatingBid.syncTakeoff() REPLACES the entire client `lines`
    // array with the server's response, so every unsaved edit is lost —
    // including a brand-new unsaved manual line or an override that was
    // never saved. Saved overrides and estimator-edited quantities (any
    // qty_overridden line) DO survive, because the server itself preserves
    // those (fix round 1 / B5) — but only for what was actually saved.
    if (dirty) {
      const ok = await confirm({
        title: 'Sync from takeoff?',
        body: 'Syncing discards any unsaved changes on this screen. Already-saved overrides and quantities you\'ve edited are kept — save first if you want to keep unsaved work.',
      });
      if (!ok) return;
    }
    try {
      const res = await syncTakeoff();
      if (res && showToast) {
        const carried = (res.unbound ?? 0) > 0 ? ` · ${res.unbound} kept line${res.unbound === 1 ? '' : 's'} not found in the new takeoff` : '';
        showToast({ title: 'Synced from takeoff', sub: `${res.added} added · ${res.updated} updated · ${res.vanished} removed${carried}` });
      }
    } catch (err) {
      // N8: a failed sync used to fail silently from the estimator's POV
      // (the button just stopped spinning) — surface it.
      if (showToast) showToast({ title: 'Sync failed', sub: err instanceof Error ? err.message : 'Could not sync from takeoff', variant: 'error' });
    }
  };

  // Fix round 2 / SF2 — derive "needs resolving" from the SERVER's recap
  // (PricedLine.unresolved), not from id presence: an item_id/assembly_id
  // can be set on a line that still didn't actually match (an incompatible
  // unit silently prices it at $0 server-side while looking "resolved"
  // here). Falls back to the old id-based heuristic only before any
  // priced data has arrived at all (e.g. the very first render).
  const unmatchedIndices = lines
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => {
      if (l.excluded || l.source !== 'takeoff') return false;
      const priced = l.id ? recapByKey.get(l.id) : undefined;
      return priced ? priced.unresolved : (!l.assembly_id && !l.item_id);
    })
    .map(({ idx }) => idx);

  const resolverLine = resolverIndex != null ? lines[resolverIndex] : null;
  // Fix round 2 / SF2 — an LS/SET/LOT/blank/unrecognized unit can't be
  // judged compatible with anything; the estimator sets a real unit first
  // (the select below) before the resolver can offer any candidates at all.
  const resolverLineUnitKnown = !!resolverLine && unitFamily(resolverLine.unit) !== 'OTHER';

  const resolverCandidates = useMemo(() => {
    if (!library || resolverIndex == null || !resolverLine || !resolverLineUnitKnown) return [];
    const q = resolverQuery.trim().toLowerCase();
    const all: { kind: 'assembly' | 'item'; id: string; name: string; unit: string }[] = [
      ...library.assemblies.filter(a => a.active).map(a => ({ kind: 'assembly' as const, id: a.id, name: a.name, unit: a.unit })),
      ...library.items.filter(i => i.active).map(i => ({ kind: 'item' as const, id: i.id, name: i.name, unit: i.unit })),
    ]
      // Fix round 2 / SF2 — never offer a unit-incompatible candidate: picking
      // one used to silently price the line at $0 (resolveLines discards the
      // match server-side) while the UI showed it as "resolved".
      .filter(c => isUnitCompatible(c.unit, resolverLine.unit));
    if (!q) return all.slice(0, 25);
    return all.filter(c => c.name.toLowerCase().includes(q)).slice(0, 25);
  }, [library, resolverIndex, resolverLine, resolverLineUnitKnown, resolverQuery]);

  const pickResolution = (idx: number, candidate: { kind: 'assembly' | 'item'; id: string }) => {
    updateLine(idx, {
      assembly_id: candidate.kind === 'assembly' ? candidate.id : null,
      item_id: candidate.kind === 'item' ? candidate.id : null,
      // Fix round 2 / SF4 — an estimator's own pick from the resolver is a
      // manual resolution; a later sync-takeoff must never silently replace
      // it with a fresh mapper guess.
      match_source: 'manual',
    });
    closeResolver();
  };

  const factorsByGroup = useMemo(() => {
    const groups = new Map<string, LibraryFactor[]>();
    for (const f of library?.factors ?? []) {
      if (!f.active) continue;
      if (!groups.has(f.group_key)) groups.set(f.group_key, []);
      groups.get(f.group_key)!.push(f);
    }
    return Array.from(groups.entries());
  }, [library]);

  const toggleFactor = (factor: LibraryFactor, group: LibraryFactor[]) => {
    setSettings(prev => {
      const withoutGroup = prev.factor_ids.filter(id => !group.some(f => f.id === id));
      const isSelected = prev.factor_ids.includes(factor.id);
      return { ...prev, factor_ids: isSelected ? withoutGroup : [...withoutGroup, factor.id] };
    });
  };

  // Review round 2 / S17 — a per-bid pricing-mode switch. Confirms first
  // (switching immediately changes which number is "the" bid amount — see
  // B4's persistPriceForBid), then flips settings.pricing_mode and saves
  // right away so bids.amount/bid_estimates re-persist from the NEW mode's
  // engine immediately, rather than sitting on a stale number from the old
  // mode until some unrelated edit happens to trigger a save.
  const onSwitchPricingMode = async () => {
    const next = settings.pricing_mode === 'accubid' ? 'phase_a' : 'accubid';
    const ok = await confirm({
      title: next === 'accubid' ? 'Switch this bid to Accubid pricing?' : 'Switch this bid to Phase A pricing?',
      body: next === 'accubid'
        ? 'The price will come from crew, overhead/markup and vendor quotes (Chris\'s Accubid workflow) instead of the flat labor rate below. Labor factors you\'ve selected still apply, compounding as Accubid\'s own "Labor Factoring." Saves immediately.'
        : 'The price will come from a flat labor rate, overhead % and profit % (Phase A) instead of crew/Accubid markups. Vendor quotes and Accubid settings stay saved but stop affecting the price until you switch back. Saves immediately.',
    });
    if (!ok) return;
    setSettings(prev => ({ ...prev, pricing_mode: next }));
    try {
      await save();
      showToast?.({ title: `Switched to ${next === 'accubid' ? 'Accubid' : 'Phase A'} pricing`, variant: 'success' });
    } catch {
      showToast?.({ title: 'Could not save the pricing-mode switch', variant: 'error' });
    }
  };

  // Review round 2 / S17 — factors (and floors above 2, which scales the
  // MULTI-STORY factor) are a property of the TAKEOFF, not of which pricing
  // engine is active, so this row renders regardless of mode — it used to
  // live only in the Phase A branch below, silently hiding it (and every
  // factor an estimator had already picked) the moment a bid switched to
  // Accubid mode, even though the backend was ALSO dropping those same
  // factors from the Accubid hours sum (fixed in accubidBidData.ts).
  const factorsRow = (
    <>
      <div className="lp-settings-row">
        <label className="lp-settings-field" title="Multiplies the MULTI-STORY labor factor below — 0 means no multi-story adjustment even if that factor is selected.">
          Floors above 2
          <input type="number" min={0} value={settings.floors_above_2} data-testid="lp-floors-above-2"
            onChange={e => { const v = numberOrDefault(e.target.value, DEFAULT_SETTINGS.floors_above_2); setSettings(prev => ({ ...prev, floors_above_2: v })); }} />
        </label>
      </div>
      {factorsByGroup.length > 0 && (
        <div className="lp-settings-row" data-testid="lp-factor-chips">
          {factorsByGroup.map(([group, factors]) => (
            <div key={group} style={{ display: 'flex', gap: 6 }}>
              {factors.map(f => (
                <button
                  key={f.id}
                  type="button"
                  className={`lp-factor-chip${settings.factor_ids.includes(f.id) ? ' lp-factor-chip-active' : ''}`}
                  onClick={() => toggleFactor(f, factors)}
                  data-testid={`lp-factor-${f.code}`}
                >
                  {f.label} (+{f.pct}%)
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div data-testid="labor-pricing-step">
      <div className="lp-settings-row" data-testid="lp-pricing-mode-row">
        <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>
          Pricing mode: <strong>{settings.pricing_mode === 'accubid' ? 'Accubid' : 'Phase A'}</strong>
        </span>
        <button type="button" className="btn ghost" onClick={() => void onSwitchPricingMode()} data-testid="lp-switch-pricing-mode">
          Switch to {settings.pricing_mode === 'accubid' ? 'Phase A' : 'Accubid'} pricing
        </button>
      </div>

      {factorsRow}

      {settings.pricing_mode === 'accubid' ? (
        bidId ? <AccubidPricingPanel bidId={bidId} showToast={showToast} /> : null
      ) : (
      <>
      <div className="lp-settings-row">
        <label className="lp-settings-field">
          Labor rate ($/hr)
          <input type="number" value={settings.labor_rate}
            onChange={e => { const v = numberOrDefault(e.target.value, DEFAULT_SETTINGS.labor_rate); setSettings(prev => ({ ...prev, labor_rate: v })); }} />
        </label>
        <label className="lp-settings-field">
          Crew size
          <input type="number" value={settings.crew_size}
            onChange={e => { const v = numberOrDefault(e.target.value, DEFAULT_SETTINGS.crew_size); setSettings(prev => ({ ...prev, crew_size: v })); }} />
        </label>
        {SETTINGS_PCT_FIELDS.map(f => (
          <label className="lp-settings-field" key={f.key}>
            {f.label}
            <input type="number" value={settings[f.key] as number}
              onChange={e => { const v = numberOrDefault(e.target.value, DEFAULT_SETTINGS[f.key] as number); setSettings(prev => ({ ...prev, [f.key]: v })); }} />
          </label>
        ))}
      </div>
      </>
      )}

      {openDups.length > 0 && (
        <div data-testid="lp-duplicates">
          {openDups.map(p => (
            <DuplicatePairControl key={`${p.keptKey}-${p.newKey}`} pair={p}
              // Fix round S10 — excluded (a tombstone on the takeoff item that
              // sync keeps), never deleted: a delete came back on the next sync.
              onRemove={key => setLines(prev => prev.map(l => (l.line_key === key ? { ...l, excluded: true, sync_excluded: false } : l)))}
              onKeepBoth={reason => setLines(prev => prev.map(l => (l.line_key === p.keptKey
                ? { ...l, dup_ok: { with: [...(l.dup_ok?.with ?? []), p.newKey], reason, at: new Date().toISOString() } }
                : l)))}/>
          ))}
          <div style={{ fontSize: 12, color: 'var(--text3)', margin: '4px 0 8px' }}>
            Resolve {openDups.length === 1 ? 'it' : 'each one'} before saving — the proposal is blocked until then too.
          </div>
        </div>
      )}

      {recheckCount > 0 && (
        <div className="lp-banner" data-testid="lp-recheck-banner">
          {recheckCount} line{recheckCount === 1 ? '' : 's'} kept from the previous analysis run (you had edited {recheckCount === 1 ? 'it' : 'them'}) — re-check {recheckCount === 1 ? 'it' : 'them'} against the new takeoff.
          {' '}Sync from takeoff re-binds {recheckCount === 1 ? 'it' : 'them'} to the new run only on the same category, unit and description; a line it can&apos;t match is left as is (it may duplicate a new takeoff line) — mark each one checked when done.
        </div>
      )}

      {unmatchedIndices.length > 0 && (
        <div className="lp-banner" data-testid="lp-unmatched-banner">
          {unmatchedIndices.length} unmatched line{unmatchedIndices.length === 1 ? '' : 's'} need resolving.
          <button type="button" className="btn ghost" onClick={() => setResolverIndex(unmatchedIndices[0])}>Resolve</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn ghost" onClick={onSync} disabled={syncing} data-testid="lp-sync-button">
          {syncing ? 'Syncing…' : 'Sync from takeoff'}
        </button>
        <button type="button" className="btn ghost" onClick={addManualLine} data-testid="lp-add-manual">
          Add manual line
        </button>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving || openDups.length > 0} data-testid="lp-save-button"
          title={openDups.length ? 'Resolve the possible duplicate first' : undefined}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveError && <span style={{ color: 'var(--red)', fontSize: 12, alignSelf: 'center' }} data-testid="lp-save-error">{saveError}</span>}
        {lastDeleted && (
          <span style={{ fontSize: 12, alignSelf: 'center', color: 'var(--text3)' }}>
            Line deleted.{' '}
            <button type="button" className="lp-reset-btn" data-testid="lp-undo-delete" onClick={undoDelete}>Undo</button>
          </span>
        )}
      </div>

      <table
        className="lp-table"
        data-testid="lp-table"
        onKeyDown={e => {
          // Enter moves focus to the same column in the next editable row —
          // Tab already does this natively via DOM order, this only adds what
          // native <input> behavior doesn't (Enter has no default focus-move).
          if (e.key !== 'Enter') return;
          const target = e.target as HTMLElement;
          const field = target.getAttribute('data-field');
          const row = target.getAttribute('data-row');
          if (!field || row == null) return;
          e.preventDefault();
          const next = (e.currentTarget as HTMLTableElement).querySelector<HTMLElement>(
            `[data-field="${field}"][data-row="${Number(row) + 1}"]`
          );
          next?.focus();
        }}
      >
        <thead>
          <tr>
            <th>Description</th><th>Qty</th><th>Unit</th><th>Mat $/unit</th><th>Mat ext</th>
            <th>Hrs/unit</th><th>Hrs ext</th><th>Labor $</th><th>Conf</th><th></th>
          </tr>
        </thead>
        <tbody>
          {categories.map(({ category, rows }) => {
            const isCollapsed = !!collapsed[category];
            const catTotal = recap.categories.find(c => c.category === category);
            return (
              <React.Fragment key={category}>
                <tr className="lp-category-row">
                  <td colSpan={10}>
                    <button type="button" className="lp-reset-btn" style={{ display: 'inline', color: 'var(--text)' }}
                      onClick={() => setCollapsed(prev => ({ ...prev, [category]: !prev[category] }))}
                      data-testid={`lp-category-toggle-${category}`}>
                      {isCollapsed ? '▸' : '▾'}
                    </button>
                    {' '}{category}
                    {catTotal && ` — ${catTotal.material.toFixed(0)} mat / ${catTotal.labor.toFixed(0)} labor`}
                  </td>
                </tr>
                {!isCollapsed && rows.map(({ line, idx }) => {
                  const priced = line.id ? recapByKey.get(line.id) : undefined;
                  const matEdited = line.material_unit_override != null;
                  const hrsEdited = line.labor_hours_override != null;
                  // Fix round 2 / SF2 — see unmatchedIndices above for why
                  // this reads the server's recap, not id presence.
                  const isUnresolved = line.source === 'takeoff'
                    && (priced ? priced.unresolved : (!line.assembly_id && !line.item_id));
                  // Fix round 2 / SF1 — a fuzzy match is not WRONG, just
                  // worth a second look; badge it distinctly from a genuinely
                  // unresolved line.
                  const isFuzzyMatch = !isUnresolved && (priced?.matchConfidence ?? line.match_confidence) === 'fuzzy';
                  return (
                    <tr key={lineKey(line, idx)} className={line.excluded ? 'lp-row-excluded' : ''} data-testid={`lp-row-${idx}`}>
                      <td>
                        <input value={line.description} data-field="description" data-row={idx}
                          onChange={e => updateLine(idx, { description: e.target.value })} />
                        {isUnresolved && (
                          <button type="button" className="lp-reset-btn" style={{ display: 'inline', color: 'var(--amber)' }}
                            onClick={() => setResolverIndex(idx)} data-testid={`lp-resolve-${idx}`}>resolve</button>
                        )}
                        {isFuzzyMatch && (
                          <span
                            className="lp-fuzzy-badge"
                            data-testid={`lp-fuzzy-badge-${idx}`}
                            title="Matched at fuzzy confidence — worth a second look, not necessarily wrong."
                            style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4, padding: '1px 4px' }}
                          >
                            check match
                          </span>
                        )}
                        {/* Fix round 2 / N2 — a hand-typed qty won't ever be
                            refreshed by a future sync; a quiet hint, not a
                            comparison against a live takeoff value (that
                            would need another sync round-trip this UI
                            doesn't have on hand). */}
                        {line.recheck_run_id && (
                          <span
                            data-testid={`lp-recheck-badge-${idx}`}
                            title="You had edited this line before the analysis was re-run, so it was kept. Check it against the new takeoff."
                            style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4, padding: '1px 4px' }}
                          >
                            {line.recheck_reason === 'no_confident_match'
                              ? 're-check: no confident match in the new takeoff'
                              : line.recheck_reason === 'ambiguous_match'
                                ? 're-check: more than one new takeoff line matches'
                                : 'From previous run — re-check'}
                            {!dupKeys.has(line.line_key ?? '') && (
                              <button type="button" className="lp-reset-btn" style={{ display: 'inline', marginLeft: 4, color: 'var(--amber)' }}
                                data-testid={`lp-recheck-done-${idx}`}
                                onClick={() => updateLine(idx, { recheck_run_id: null, recheck_reason: null })}>checked</button>
                            )}
                          </span>
                        )}
                        {line.qty_overridden && (
                          <span
                            data-testid={`lp-qty-locked-hint-${idx}`}
                            title="Quantity was entered by hand — sync from takeoff will never overwrite it. Re-sync to check whether the takeoff itself changed."
                            style={{ marginLeft: 6, fontSize: 10, color: 'var(--text3)' }}
                          >
                            🔒 qty
                          </span>
                        )}
                        {/* Fix round B5 — a manual line, or a takeoff line
                            whose qty was hand-overridden, has no AI evidence
                            trail; the evidence gate (409 on generate/send)
                            blocks on it until this reads as a real reason
                            (10+ characters, actual letters). */}
                        {!line.excluded && (line.source === 'manual' || line.qty_source === 'manual') && (
                          <div className="tr-sub" style={{ marginTop: 4 }}>
                            <input
                              type="text"
                              aria-label={`Evidence / reason for ${line.description || 'this line'}`}
                              placeholder="Evidence / reason (10+ characters) — why this line/quantity, with no AI takeoff evidence behind it"
                              value={line.evidence_note ?? ''}
                              data-field="evidence_note"
                              data-row={idx}
                              data-testid={`lp-evidence-note-${idx}`}
                              ref={el => { if (line.line_key) evidenceNoteRefs.current[line.line_key] = el; }}
                              onChange={e => updateLine(idx, { evidence_note: e.target.value })}
                              style={!isRealReason(line.evidence_note ?? '') ? { borderColor: 'var(--amber)' } : undefined}
                            />
                            {!isRealReason(line.evidence_note ?? '') && (
                              <span data-testid={`lp-evidence-note-missing-${idx}`} style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: 'var(--amber)' }}>
                                needed before this can go to the GC
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <input type="number" value={line.qty} data-field="qty" data-row={idx}
                          onChange={e => updateLine(idx, {
                            qty: Number(e.target.value),
                            // Fix round 1 / B5 — mark this line's qty as
                            // estimator-set so a future sync-takeoff never
                            // overwrites it, even for a takeoff-sourced line.
                            qty_overridden: true,
                            // Fix round 1 / S7 — a hand-typed qty is no
                            // longer plan-confirmed, even if the line was
                            // previously Applied from a markup rollup:
                            // composeBidData.ts's "Applied" chip and the
                            // items panel's "not verified on plans" count
                            // both key off qty_source==='markup', and
                            // leaving it as 'markup' here would present a
                            // hand-typed number as plan-confirmed.
                            qty_source: 'manual',
                          })} />
                      </td>
                      <td>{line.unit}</td>
                      <td className={matEdited ? 'lp-cell-edited' : ''}>
                        <input type="number" value={line.material_unit_override ?? priced?.materialUnit ?? 0}
                          data-field="material_unit_override" data-row={idx}
                          onChange={e => updateLine(idx, {
                            // Fix round 1 / S7 — clearing the field (empty
                            // string) reverts to the library value (null),
                            // never a real $0 override; Number('') is 0,
                            // which would otherwise silently zero the price.
                            material_unit_override: e.target.value === '' ? null : Number(e.target.value),
                          })} />
                        {matEdited && (
                          <button type="button" className="lp-reset-btn" onClick={() => updateLine(idx, { material_unit_override: null })}>reset</button>
                        )}
                      </td>
                      <td>{Number.isFinite(priced?.materialExt) ? priced!.materialExt.toFixed(2) : '—'}</td>
                      <td className={hrsEdited ? 'lp-cell-edited' : ''}>
                        <input type="number" value={line.labor_hours_override ?? priced?.hoursUnit ?? 0}
                          data-field="labor_hours_override" data-row={idx}
                          onChange={e => updateLine(idx, {
                            labor_hours_override: e.target.value === '' ? null : Number(e.target.value), // S7, same as material above
                          })} />
                        {hrsEdited && (
                          <button type="button" className="lp-reset-btn" onClick={() => updateLine(idx, { labor_hours_override: null })}>reset</button>
                        )}
                      </td>
                      <td>{Number.isFinite(priced?.hoursExt) ? priced!.hoursExt.toFixed(2) : '—'}</td>
                      <td>{Number.isFinite(priced?.laborExt) ? priced!.laborExt.toFixed(2) : '—'}</td>
                      <td>{line.confidence ?? ''}</td>
                      <td>
                        <label style={{ fontSize: 11 }}>
                          <input type="checkbox" checked={!!line.excluded} data-testid={`lp-exclude-${idx}`}
                            onChange={e => updateLine(idx, {
                              excluded: e.target.checked,
                              // Fix round 2 / B2 — an explicit toggle (either
                              // direction) is a USER decision from this
                              // point on, not sync-takeoff's; clear the
                              // sync-driven flag so a later sync-takeoff
                              // never treats it as "reversible on
                              // reappearance" for a choice the estimator
                              // just made themselves.
                              sync_excluded: false,
                            })} /> excl.
                        </label>
                        {line.source === 'manual' && (
                          <button type="button" className="lp-reset-btn" style={{ marginLeft: 6 }}
                            onClick={() => deleteManualLine(idx)} data-testid={`lp-delete-${idx}`}>
                            delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {resolverIndex != null && resolverLine && (
        <Modal open onClose={closeResolver} title="Resolve line">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320 }}>
            {!resolverLineUnitKnown ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>
                  This line's unit ("{resolverLine.unit || '(blank)'}") isn't EA/LF/C/M — set the real unit
                  before picking a match (fix round 2 / SF2: an LS/SET/LOT/blank unit can't be judged
                  compatible with anything).
                </div>
                <select
                  value={KNOWN_UNITS.includes(resolverLine.unit) ? resolverLine.unit : ''}
                  data-testid="lp-resolver-unit-select"
                  onChange={e => updateLine(resolverIndex, { unit: e.target.value as EstUnit })}
                >
                  <option value="" disabled>Choose a unit…</option>
                  {KNOWN_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            ) : (
              <>
                <input
                  placeholder="Search items and assemblies…"
                  value={resolverQuery}
                  onChange={e => setResolverQuery(e.target.value)}
                  data-testid="lp-resolver-search"
                  autoFocus
                />
                <div style={{ maxHeight: 280, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {resolverCandidates.map(c => (
                    <button
                      key={`${c.kind}-${c.id}`}
                      type="button"
                      className="btn ghost"
                      style={{ justifyContent: 'flex-start' }}
                      data-testid={`lp-resolver-candidate-${c.id}`}
                      onClick={() => pickResolution(resolverIndex, c)}
                    >
                      {c.name} <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{c.unit}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                No match? Keep it as a manual line — enter a material $ or labor hours value first (fix round 1 / S7: an unpriced manual line can't be created silently at $0).
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number" placeholder="Material $" value={manualMaterial}
                  onChange={e => setManualMaterial(e.target.value)}
                  data-testid="lp-resolver-manual-material"
                />
                <input
                  type="number" placeholder="Labor hours" value={manualHours}
                  onChange={e => setManualHours(e.target.value)}
                  data-testid="lp-resolver-manual-hours"
                />
              </div>
              <button
                type="button"
                className="btn ghost"
                data-testid="lp-resolver-keep-manual"
                disabled={manualMaterial.trim() === '' && manualHours.trim() === ''}
                onClick={() => {
                  updateLine(resolverIndex, {
                    source: 'manual',
                    material_unit_override: manualMaterial.trim() === '' ? 0 : Number(manualMaterial),
                    labor_hours_override: manualHours.trim() === '' ? 0 : Number(manualHours),
                  });
                  closeResolver();
                }}
              >
                Keep as manual line
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
