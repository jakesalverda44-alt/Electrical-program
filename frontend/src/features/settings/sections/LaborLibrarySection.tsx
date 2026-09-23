// Task 11 — replaces UnitCostSection. Same Settings nav slot ('unit-costs'),
// admin only. Items / Assemblies / Labor Factors / Defaults / Calibration.
import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { useMutation } from '../../../hooks/useMutation';
import { useConfirm } from '../../../components/ConfirmDialog';
import Badge, { BadgeTone } from '../../../components/Badge';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, inputStyle } from '../shared';
import { Library, LibraryItem, LibraryAssembly, LibraryFactor } from '../../estimating/types';
import { TAKEOFF_CATEGORIES } from '../../estimating/categories';

type SubTab = 'items' | 'assemblies' | 'factors' | 'defaults' | 'calibration';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'items', label: 'Items' },
  { key: 'assemblies', label: 'Assemblies' },
  { key: 'factors', label: 'Labor Factors' },
  { key: 'defaults', label: 'Defaults' },
  { key: 'calibration', label: 'Calibration' },
];

const SOURCE_TONE: Record<string, BadgeTone> = { seed: 'neutral', manual: 'info', calibrated: 'warn', accubid: 'good' };

export function LaborLibrarySection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [subTab, setSubTab] = useState<SubTab>('items');

  return (
    <div>
      <SectionTitle
        title="Labor Library"
        sub="The material/labor catalog the estimating engine prices takeoffs against. Seeded values are industry-typical starting points — edit them as real jobs confirm or correct them."
      />
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            data-testid={`ll-subtab-${t.key}`}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700,
              padding: '8px 12px', color: subTab === t.key ? 'var(--text)' : 'var(--text3)',
              borderBottom: subTab === t.key ? '2px solid var(--blue)' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'items' && <ItemsPanel />}
      {subTab === 'assemblies' && <AssembliesPanel />}
      {subTab === 'factors' && <FactorsPanel />}
      {subTab === 'defaults' && <DefaultsPanel settings={settings} onSaved={onSaved} />}
      {subTab === 'calibration' && <CalibrationPanel />}
    </div>
  );
}

// ── Items ────────────────────────────────────────────────────────────────────

function ItemsPanel() {
  const { data, reload } = useApi<Library>('/estimating/library');
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);
  const [undoItem, setUndoItem] = useState<LibraryItem | null>(null);

  const items = useMemo(() => {
    let list = data?.items ?? [];
    if (categoryFilter) list = list.filter(i => i.category === categoryFilter);
    if (unverifiedOnly) list = list.filter(i => i.material_price_date == null);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
    }
    return list;
  }, [data, categoryFilter, unverifiedOnly, search]);

  const saveField = async (item: LibraryItem, patch: Partial<LibraryItem>) => {
    await api.put(`/estimating/library/items/${item.id}`, patch);
    reload();
  };

  const deactivate = async (item: LibraryItem) => {
    if (!(await confirm({ title: `Deactivate "${item.name}"?`, body: 'Existing bids keep their priced lines; this item stops matching new takeoff lines.' }))) return;
    await api.put(`/estimating/library/items/${item.id}`, { active: false });
    setUndoItem(item);
    setTimeout(() => setUndoItem(prev => (prev?.id === item.id ? null : prev)), 8000);
    reload();
  };

  const undo = async () => {
    if (!undoItem) return;
    await api.put(`/estimating/library/items/${undoItem.id}`, { active: true });
    setUndoItem(null);
    reload();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input placeholder="Search items…" style={{ ...inputStyle, maxWidth: 220 }} value={search}
          onChange={e => setSearch(e.target.value)} data-testid="ll-item-search" />
        <select style={{ ...inputStyle, maxWidth: 220 }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {TAKEOFF_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)' }}>
          <input type="checkbox" checked={unverifiedOnly} onChange={e => setUnverifiedOnly(e.target.checked)} />
          Unverified price only
        </label>
      </div>

      {undoItem && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--amber-soft)', borderRadius: 8, marginBottom: 10, fontSize: 12.5, color: 'var(--amber)' }}>
          Deactivated "{undoItem.name}".
          <button onClick={undo} className="btn ghost" style={{ fontSize: 12 }} data-testid="ll-item-undo">Undo</button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} data-testid="ll-items-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 6 }}>Name</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Category</th>
            <th style={{ padding: 6 }}>Unit</th>
            <th style={{ padding: 6 }}>Material $</th>
            <th style={{ padding: 6 }}>Price date</th>
            <th style={{ padding: 6 }}>Labor hrs</th>
            <th style={{ padding: 6 }}>Source</th>
            <th style={{ padding: 6 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} data-testid={`ll-item-row-${item.id}`}>
              <td style={{ padding: 6 }}>{item.name}</td>
              <td style={{ padding: 6, color: 'var(--text3)' }}>{item.category}</td>
              <td style={{ padding: 6, textAlign: 'center' }}>{item.unit}</td>
              <td style={{ padding: 6 }}>
                <input type="number" defaultValue={item.material_cost} style={{ ...inputStyle, width: 90 }}
                  data-testid={`ll-item-material-${item.id}`}
                  onBlur={e => { const v = Number(e.target.value); if (v !== item.material_cost) void saveField(item, { material_cost: v }); }} />
                {item.material_price_date == null && <span className="lp-unverified-marker" title="Unverified price" style={{ marginLeft: 4 }}>!</span>}
              </td>
              <td style={{ padding: 6 }}>
                <input type="date" defaultValue={item.material_price_date ?? ''} style={{ ...inputStyle, width: 130 }}
                  onBlur={e => { const v = e.target.value || null; if (v !== item.material_price_date) void saveField(item, { material_price_date: v }); }} />
              </td>
              <td style={{ padding: 6 }}>
                <input type="number" defaultValue={item.labor_hours} style={{ ...inputStyle, width: 80 }}
                  data-testid={`ll-item-hours-${item.id}`}
                  onBlur={e => { const v = Number(e.target.value); if (v !== item.labor_hours) void saveField(item, { labor_hours: v }); }} />
              </td>
              <td style={{ padding: 6 }}><Badge tone={SOURCE_TONE[item.source] ?? 'neutral'} size="sm">{item.source}</Badge></td>
              <td style={{ padding: 6 }}>
                {item.active
                  ? <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => void deactivate(item)} data-testid={`ll-item-deactivate-${item.id}`}>Deactivate</button>
                  : <span style={{ color: 'var(--text3)', fontSize: 11 }}>Inactive</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Assemblies ───────────────────────────────────────────────────────────────

function AssembliesPanel() {
  const { data, reload } = useApi<Library>('/estimating/library');
  const [expanded, setExpanded] = useState<string | null>(null);

  const setComponentQty = async (assembly: LibraryAssembly, itemId: string, qtyPer: number) => {
    const components = assembly.components.map(c => (c.item_id === itemId ? { item_id: c.item_id, qty_per: qtyPer } : { item_id: c.item_id, qty_per: c.qty_per }));
    await api.put(`/estimating/library/assemblies/${assembly.id}`, { components });
    reload();
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} data-testid="ll-assemblies-table">
      <thead>
        <tr><th style={{ textAlign: 'left', padding: 6 }}>Name</th><th style={{ padding: 6 }}>Category</th><th style={{ padding: 6 }}>Unit</th><th style={{ padding: 6 }}>Source</th><th style={{ padding: 6 }}></th></tr>
      </thead>
      <tbody>
        {(data?.assemblies ?? []).map(asm => (
          <React.Fragment key={asm.id}>
            <tr data-testid={`ll-assembly-row-${asm.id}`}>
              <td style={{ padding: 6 }}>{asm.name}</td>
              <td style={{ padding: 6, color: 'var(--text3)' }}>{asm.category}</td>
              <td style={{ padding: 6, textAlign: 'center' }}>{asm.unit}</td>
              <td style={{ padding: 6 }}><Badge tone={SOURCE_TONE[asm.source] ?? 'neutral'} size="sm">{asm.source}</Badge></td>
              <td style={{ padding: 6 }}>
                <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setExpanded(prev => (prev === asm.id ? null : asm.id))}
                  data-testid={`ll-assembly-expand-${asm.id}`}>
                  {expanded === asm.id ? 'Hide components' : `${asm.components.length} components`}
                </button>
              </td>
            </tr>
            {expanded === asm.id && (
              <tr>
                <td colSpan={5} style={{ padding: '4px 6px 12px 24px' }}>
                  {asm.components.map(c => (
                    <div key={c.item_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                      <span style={{ flex: 1 }}>{c.item_name}</span>
                      <input type="number" defaultValue={c.qty_per} style={{ ...inputStyle, width: 80 }}
                        data-testid={`ll-component-qty-${asm.id}-${c.item_id}`}
                        onBlur={e => { const v = Number(e.target.value); if (v !== c.qty_per) void setComponentQty(asm, c.item_id, v); }} />
                      <span style={{ color: 'var(--text3)', fontSize: 11 }}>per unit</span>
                    </div>
                  ))}
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ── Labor Factors ────────────────────────────────────────────────────────────

function FactorsPanel() {
  const { data, reload } = useApi<Library>('/estimating/library');

  const save = async (factor: LibraryFactor, patch: Partial<LibraryFactor>) => {
    await api.put(`/estimating/library/factors/${factor.id}`, patch);
    reload();
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} data-testid="ll-factors-table">
      <thead>
        <tr><th style={{ textAlign: 'left', padding: 6 }}>Label</th><th style={{ padding: 6 }}>Group</th><th style={{ padding: 6 }}>Pct</th><th style={{ padding: 6 }}>Active</th></tr>
      </thead>
      <tbody>
        {(data?.factors ?? []).map(f => (
          <tr key={f.id} data-testid={`ll-factor-row-${f.id}`}>
            <td style={{ padding: 6 }}>
              <input defaultValue={f.label} style={{ ...inputStyle, width: 220 }}
                onBlur={e => { if (e.target.value !== f.label) void save(f, { label: e.target.value }); }} />
            </td>
            <td style={{ padding: 6, color: 'var(--text3)' }}>{f.group_key}</td>
            <td style={{ padding: 6 }}>
              <input type="number" defaultValue={f.pct} style={{ ...inputStyle, width: 70 }}
                data-testid={`ll-factor-pct-${f.id}`}
                onBlur={e => { const v = Number(e.target.value); if (v !== f.pct) void save(f, { pct: v }); }} />
            </td>
            <td style={{ padding: 6, textAlign: 'center' }}>
              <input type="checkbox" checked={f.active} onChange={e => void save(f, { active: e.target.checked })} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_FIELDS: { key: keyof AppSettings; label: string; fallback: string }[] = [
  { key: 'est_default_labor_rate', label: 'Labor rate ($/hr)', fallback: '38' },
  { key: 'est_default_material_tax_pct', label: 'Material tax (%)', fallback: '7' },
  { key: 'est_default_small_tools_pct', label: 'Small tools (%)', fallback: '3' },
  { key: 'est_default_supervision_pct', label: 'Supervision (%)', fallback: '0' },
  { key: 'est_default_consumables_pct', label: 'Consumables (%)', fallback: '2' },
  // Fix round 1 / B8 — Decision 7's drops/slack defaults, stamped onto a
  // new linear run at creation time (PlansWorkspace.tsx) and editable per-
  // run afterward via the DropsSlackPopover.
  { key: 'est_default_drop_ft', label: 'Default drop (ft, per drop)', fallback: '10' },
  { key: 'est_default_slack_pct', label: 'Default slack (%)', fallback: '10' },
];

function DefaultsPanel({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of DEFAULT_FIELDS) next[f.key] = (settings[f.key] as string | undefined) ?? f.fallback;
    setValues(next);
    setOrig(next);
  }, [settings]);

  const { run: save, saving } = useMutation(
    async () => { await api.put('/settings', values); },
    { onSuccess: () => { setOrig(values); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }, errorTitle: 'Could not save defaults' },
  );

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14, maxWidth: 520, lineHeight: 1.5 }}>
        Applied to a new bid's estimating settings unless overridden on that bid. Overhead %, profit % and crew size
        default per-bid (10%, 15%, 3) and aren't a global setting in this phase.
      </div>
      {DEFAULT_FIELDS.map(f => (
        <Field label={f.label} key={f.key}>
          <input type="number" style={{ ...inputStyle, maxWidth: 200 }} value={values[f.key] ?? ''}
            data-testid={`ll-default-${f.key}`}
            onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))} />
        </Field>
      ))}
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={JSON.stringify(values) !== JSON.stringify(orig)} />
    </div>
  );
}

// ── Calibration ──────────────────────────────────────────────────────────────

interface CategoryGap { category: string; totalEngineHours: number; suggestedAdjustmentPct: number }
interface CalibrationReport {
  bids: { bidId: string; bidName: string; engineHours: number; accubidHours: number; ratio: number }[];
  overallRatio: number;
  suggestedGlobalAdjustmentPct: number;
  categoryGaps: CategoryGap[];
}

function CalibrationPanel() {
  const { data, reload } = useApi<CalibrationReport>('/estimating/calibration');
  const confirm = useConfirm();
  const [applying, setApplying] = useState<string | null>(null);

  // Fix round 1 / B4 — the old version fired the request and reloaded on
  // success with no feedback at all: a 400 (e.g. "0 rows changed", now a
  // real error from the server) went completely unnoticed, and even a
  // successful apply never told the estimator HOW MANY rows it touched.
  // useMutation's default error toast plus an explicit success toast fix
  // both.
  const applyMutation = useMutation(
    (scope: 'global' | 'category', category: string | undefined, pct: number) =>
      api.post<{ updatedCount: number }>('/estimating/calibration/apply', { scope, category, adjustmentPct: pct }).then(r => r.data),
    {
      successToast: (result, scope, category) => ({
        title: 'Adjustment applied',
        sub: `${result.updatedCount} item${result.updatedCount === 1 ? '' : 's'} updated${scope === 'category' ? ` in "${category}"` : ''}.`,
        variant: 'success',
      }),
      errorTitle: 'Could not apply adjustment',
    }
  );

  const apply = async (scope: 'global' | 'category', category: string | undefined, pct: number) => {
    const label = scope === 'global' ? 'every active item' : `every active item in "${category}"`;
    if (!(await confirm({ title: 'Apply suggested adjustment?', body: `Multiplies labor_hours by ${(1 + pct / 100).toFixed(2)}x for ${label} and marks them source=calibrated.` }))) return;
    setApplying(scope === 'global' ? 'global' : category ?? null);
    try {
      const result = await applyMutation.run(scope, category, pct);
      if (result) reload(); // undefined means the mutation failed — its own error toast already fired
    } finally {
      setApplying(null);
    }
  };

  if (!data) return null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase' }}>Overall ratio (engine / Accubid)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }} data-testid="ll-overall-ratio">{data.overallRatio.toFixed(2)}x</div>
        </div>
        <button className="btn ghost" data-testid="ll-apply-global"
          onClick={() => void apply('global', undefined, data.suggestedGlobalAdjustmentPct)}
          disabled={applying === 'global'}>
          Apply suggested global adjustment ({data.suggestedGlobalAdjustmentPct >= 0 ? '+' : ''}{data.suggestedGlobalAdjustmentPct.toFixed(1)}%)
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 20 }} data-testid="ll-calibration-bids">
        <thead><tr><th style={{ textAlign: 'left', padding: 6 }}>Bid</th><th style={{ padding: 6 }}>Engine hrs</th><th style={{ padding: 6 }}>Accubid hrs</th><th style={{ padding: 6 }}>Ratio</th></tr></thead>
        <tbody>
          {data.bids.map(b => (
            <tr key={b.bidId}><td style={{ padding: 6 }}>{b.bidName}</td><td style={{ padding: 6, textAlign: 'right' }}>{b.engineHours.toFixed(1)}</td><td style={{ padding: 6, textAlign: 'right' }}>{b.accubidHours.toFixed(1)}</td><td style={{ padding: 6, textAlign: 'right' }}>{b.ratio.toFixed(2)}x</td></tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>Largest category gaps</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} data-testid="ll-calibration-categories">
        <thead><tr><th style={{ textAlign: 'left', padding: 6 }}>Category</th><th style={{ padding: 6 }}>Engine hrs</th><th style={{ padding: 6 }}>Suggested adj.</th><th style={{ padding: 6 }}></th></tr></thead>
        <tbody>
          {data.categoryGaps.map(g => (
            <tr key={g.category} data-testid={`ll-category-gap-${g.category}`}>
              <td style={{ padding: 6 }}>{g.category}</td>
              <td style={{ padding: 6, textAlign: 'right' }}>{g.totalEngineHours.toFixed(1)}</td>
              <td style={{ padding: 6, textAlign: 'right' }}>{g.suggestedAdjustmentPct >= 0 ? '+' : ''}{g.suggestedAdjustmentPct.toFixed(1)}%</td>
              <td style={{ padding: 6 }}>
                <button className="btn ghost" style={{ fontSize: 11 }} data-testid={`ll-apply-category-${g.category}`}
                  onClick={() => void apply('category', g.category, g.suggestedAdjustmentPct)}
                  disabled={applying === g.category}>
                  Apply
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
