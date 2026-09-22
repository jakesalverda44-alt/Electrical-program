// Task 9 — the Labor & Pricing screen. Replaces the old flat-rate PricingTab.
// Receives its state from useEstimatingBid() (owned by the caller, shared
// with BidSummary) rather than fetching or persisting anything itself.
import React, { useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import Modal from '../../components/Modal';
import { EstimateLine, EstimateSettings, Library, LibraryFactor, PricingRecap } from './types';

export interface LaborPricingStepProps {
  lines: EstimateLine[];
  settings: EstimateSettings;
  recap: PricingRecap;
  saving: boolean;
  syncing: boolean;
  saveError: string | null;
  setLines: (updater: EstimateLine[] | ((prev: EstimateLine[]) => EstimateLine[])) => void;
  setSettings: (updater: EstimateSettings | ((prev: EstimateSettings) => EstimateSettings)) => void;
  save: () => Promise<void>;
  syncTakeoff: () => Promise<{ added: number; updated: number; vanished: number } | null>;
  showToast?: (t: { title: string; sub?: string }) => void;
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
  lines, settings, recap, saving, syncing, saveError, setLines, setSettings, save, syncTakeoff, showToast,
}: LaborPricingStepProps) {
  const { data: library } = useApi<Library>('/estimating/library');
  const [resolverIndex, setResolverIndex] = useState<number | null>(null);
  const [resolverQuery, setResolverQuery] = useState('');

  const recapByKey = useMemo(() => {
    const map = new Map<string, PricingRecap['lines'][number]>();
    recap.lines.forEach((l, i) => map.set(lineKey(lines[i] ?? { category: l.category, description: l.description, qty: l.qty, unit: l.unit, source: 'manual' }, i), l));
    return map;
  }, [recap.lines, lines]);

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

  const updateLine = (idx: number, patch: Partial<EstimateLine>) => {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addManualLine = () => {
    setLines(prev => [...prev, {
      category: categories[0]?.category ?? 'Branch Power', description: '', qty: 1, unit: 'EA',
      material_unit_override: 0, labor_hours_override: 0, source: 'manual',
    }]);
  };

  const onSync = async () => {
    const res = await syncTakeoff();
    if (res && showToast) {
      showToast({ title: 'Synced from takeoff', sub: `${res.added} added · ${res.updated} updated · ${res.vanished} removed` });
    }
  };

  const unmatchedIndices = lines
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => l.source === 'takeoff' && !l.assembly_id && !l.item_id && !l.excluded)
    .map(({ idx }) => idx);

  const resolverCandidates = useMemo(() => {
    if (!library || resolverIndex == null) return [];
    const q = resolverQuery.trim().toLowerCase();
    const all: { kind: 'assembly' | 'item'; id: string; name: string; unit: string }[] = [
      ...library.assemblies.filter(a => a.active).map(a => ({ kind: 'assembly' as const, id: a.id, name: a.name, unit: a.unit })),
      ...library.items.filter(i => i.active).map(i => ({ kind: 'item' as const, id: i.id, name: i.name, unit: i.unit })),
    ];
    if (!q) return all.slice(0, 25);
    return all.filter(c => c.name.toLowerCase().includes(q)).slice(0, 25);
  }, [library, resolverIndex, resolverQuery]);

  const pickResolution = (idx: number, candidate: { kind: 'assembly' | 'item'; id: string }) => {
    updateLine(idx, {
      assembly_id: candidate.kind === 'assembly' ? candidate.id : null,
      item_id: candidate.kind === 'item' ? candidate.id : null,
    });
    setResolverIndex(null);
    setResolverQuery('');
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

  return (
    <div data-testid="labor-pricing-step">
      <div className="lp-settings-row">
        <label className="lp-settings-field">
          Labor rate ($/hr)
          <input type="number" value={settings.labor_rate}
            onChange={e => setSettings(prev => ({ ...prev, labor_rate: Number(e.target.value) }))} />
        </label>
        <label className="lp-settings-field">
          Crew size
          <input type="number" value={settings.crew_size}
            onChange={e => setSettings(prev => ({ ...prev, crew_size: Number(e.target.value) }))} />
        </label>
        {SETTINGS_PCT_FIELDS.map(f => (
          <label className="lp-settings-field" key={f.key}>
            {f.label}
            <input type="number" value={settings[f.key] as number}
              onChange={e => setSettings(prev => ({ ...prev, [f.key]: Number(e.target.value) }))} />
          </label>
        ))}
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
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving} data-testid="lp-save-button">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveError && <span style={{ color: 'var(--red)', fontSize: 12, alignSelf: 'center' }} data-testid="lp-save-error">{saveError}</span>}
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
                  const priced = recapByKey.get(lineKey(line, idx));
                  const matEdited = line.material_unit_override != null;
                  const hrsEdited = line.labor_hours_override != null;
                  const isUnresolved = line.source === 'takeoff' && !line.assembly_id && !line.item_id;
                  return (
                    <tr key={lineKey(line, idx)} className={line.excluded ? 'lp-row-excluded' : ''} data-testid={`lp-row-${idx}`}>
                      <td>
                        <input value={line.description} data-field="description" data-row={idx}
                          onChange={e => updateLine(idx, { description: e.target.value })} />
                        {isUnresolved && (
                          <button type="button" className="lp-reset-btn" style={{ display: 'inline', color: 'var(--amber)' }}
                            onClick={() => setResolverIndex(idx)} data-testid={`lp-resolve-${idx}`}>resolve</button>
                        )}
                      </td>
                      <td>
                        <input type="number" value={line.qty} data-field="qty" data-row={idx}
                          onChange={e => updateLine(idx, { qty: Number(e.target.value) })} />
                      </td>
                      <td>{line.unit}</td>
                      <td className={matEdited ? 'lp-cell-edited' : ''}>
                        <input type="number" value={line.material_unit_override ?? priced?.materialUnit ?? 0}
                          data-field="material_unit_override" data-row={idx}
                          onChange={e => updateLine(idx, { material_unit_override: Number(e.target.value) })} />
                        {matEdited && (
                          <button type="button" className="lp-reset-btn" onClick={() => updateLine(idx, { material_unit_override: null })}>reset</button>
                        )}
                      </td>
                      <td>{priced?.materialExt.toFixed(2) ?? '—'}</td>
                      <td className={hrsEdited ? 'lp-cell-edited' : ''}>
                        <input type="number" value={line.labor_hours_override ?? priced?.hoursUnit ?? 0}
                          data-field="labor_hours_override" data-row={idx}
                          onChange={e => updateLine(idx, { labor_hours_override: Number(e.target.value) })} />
                        {hrsEdited && (
                          <button type="button" className="lp-reset-btn" onClick={() => updateLine(idx, { labor_hours_override: null })}>reset</button>
                        )}
                      </td>
                      <td>{priced?.hoursExt.toFixed(2) ?? '—'}</td>
                      <td>{priced?.laborExt.toFixed(2) ?? '—'}</td>
                      <td>{line.confidence ?? ''}</td>
                      <td>
                        <label style={{ fontSize: 11 }}>
                          <input type="checkbox" checked={!!line.excluded} data-testid={`lp-exclude-${idx}`}
                            onChange={e => updateLine(idx, { excluded: e.target.checked })} /> excl.
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {resolverIndex != null && (
        <Modal open onClose={() => setResolverIndex(null)} title="Resolve line">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320 }}>
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
            <button
              type="button"
              className="btn ghost"
              data-testid="lp-resolver-keep-manual"
              onClick={() => { updateLine(resolverIndex, { source: 'manual', material_unit_override: 0, labor_hours_override: 0 }); setResolverIndex(null); setResolverQuery(''); }}
            >
              Keep as manual line
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
