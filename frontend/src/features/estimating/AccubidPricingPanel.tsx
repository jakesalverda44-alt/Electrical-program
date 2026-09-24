// Next round Part B, Task 2/3 — the Accubid-mode Labor & Pricing sections:
// Crew (day/night shift), overhead/markup, Quotes (budget-pending blocks
// send), Equipment, General Expenses, and Alternates (add/deduct, printed
// on the proposal without changing the base price). Mounted by
// LaborPricingStep in place of the Phase A settings row when
// settings.pricing_mode === 'accubid'.
import React, { useEffect, useState } from 'react';
import { useAccubidPricing } from './useAccubidPricing';
import { AccubidAlternate, AccubidCostLine, AccubidQuote, AccubidSettings } from './types';

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function numberOrDefault(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface AccubidPricingPanelProps {
  bidId: string;
  showToast?: (t: { title: string; sub?: string; variant?: 'success' | 'error' }) => void;
}

export function AccubidPricingPanel({ bidId, showToast }: AccubidPricingPanelProps) {
  const {
    loading, saving, error, settings, recap, totalHours, quotes, costLines, alternates,
    saveSettings, addQuote, updateQuote, removeQuote, addCostLine, updateCostLine, removeCostLine,
    addAlternate, updateAlternate, removeAlternate,
  } = useAccubidPricing(bidId);

  const [form, setForm] = useState<AccubidSettings>(settings);
  useEffect(() => { setForm(settings); }, [settings]);

  const dirty = JSON.stringify(form) !== JSON.stringify(settings);

  const onSaveSettings = async () => {
    try {
      await saveSettings(form);
      showToast?.({ title: 'Crew & pricing saved', variant: 'success' });
    } catch {
      showToast?.({ title: 'Could not save crew & pricing settings', variant: 'error' });
    }
  };

  if (loading) return <div data-testid="accubid-loading">Loading Accubid pricing…</div>;

  const field = (label: string, key: keyof AccubidSettings, opts: { step?: number; title?: string } = {}) => (
    <label className="lp-settings-field" key={key} title={opts.title}>
      {label}
      <input type="number" step={opts.step ?? 1} value={form[key] as number}
        onChange={e => setForm(prev => ({ ...prev, [key]: numberOrDefault(e.target.value, settings[key] as number) }))} />
    </label>
  );

  return (
    <div data-testid="accubid-pricing-panel">
      {recap.blocksSend && (
        <div className="lp-banner" data-testid="accubid-blocks-send" style={{ borderColor: 'var(--red)' }}>
          <strong>Hold — {recap.budgetPendingQuotes.length} quote{recap.budgetPendingQuotes.length === 1 ? '' : 's'} still budget-pending.</strong>
          &nbsp;The proposal can&apos;t be sent until every quote is firm ({recap.budgetPendingQuotes.map(q => q.description).join(', ')}).
        </div>
      )}
      {error && <div className="lp-banner" data-testid="accubid-error">{error}</div>}

      <h3 style={{ marginTop: 0 }}>Crew</h3>
      <div className="lp-settings-row">
        <label className="lp-settings-field">
          Shift
          <select value={form.shift} onChange={e => setForm(prev => ({ ...prev, shift: e.target.value === 'night' ? 'night' : 'day' }))} data-testid="accubid-shift">
            <option value="day">Day</option>
            <option value="night">Night</option>
          </select>
        </label>
        {field('Journeyman #', 'journeymanCount')}
        {field('Journeyman $/hr', 'journeymanRate', { step: 0.01 })}
        {field('Apprentice #', 'apprenticeCount')}
        {field('Apprentice $/hr', 'apprenticeRate', { step: 0.01 })}
        {field('Foreman #', 'foremanCount')}
        {field('Foreman $/hr', 'foremanRate', { step: 0.01 })}
      </div>
      {form.shift === 'night' && (
        <div className="lp-settings-row" title="Night rates override the day rates above only while Shift is set to Night; leave blank to use the day rate at night too.">
          {field('Night journeyman $/hr', 'nightJourneymanRate', { step: 0.01 })}
          {field('Night apprentice $/hr', 'nightApprenticeRate', { step: 0.01 })}
          {field('Night foreman $/hr', 'nightForemanRate', { step: 0.01 })}
        </div>
      )}
      <div className="lp-settings-row">
        {field('Burden %', 'burdenPct', { step: 0.1 })}
        {field('Fringe $/hr', 'fringePerHr', { step: 0.01 })}
        <div className="lp-settings-field" style={{ justifyContent: 'flex-end' }}>Total hours: <strong>{totalHours.toFixed(3)}</strong></div>
      </div>

      <h3>Overhead & Markup</h3>
      <div className="lp-settings-row">
        {field('Material tax %', 'materialTaxPct', { step: 0.1 })}
        {field('Labor overhead %', 'laborOverheadPct', { step: 0.1, title: 'Decision 5 default: 38% on labor only, editable per bid — see Settings for the per-GC default table.' })}
        {field('Material markup %', 'materialMarkupPct', { step: 0.1 })}
        {field('Labor markup %', 'laborMarkupPct', { step: 0.1 })}
        {field('Default quote markup %', 'quoteMarkupDefaultPct', { step: 0.1 })}
        {field('Adjustment %', 'adjustmentMarkupPct', { step: 0.1, title: 'Percent of Net Cost.' })}
        {field('Sales markup %', 'salesMarkupPct', { step: 0.1, title: '"CE Sales Markup" — percent of (Net Cost + Total Markup), applied last.' })}
      </div>
      <div style={{ margin: '8px 0' }}>
        <button type="button" className="btn" disabled={!dirty || saving} onClick={onSaveSettings} data-testid="accubid-save-settings">
          {saving ? 'Saving…' : 'Save crew & pricing'}
        </button>
      </div>

      <QuotesSection quotes={quotes} defaultMarkupPct={settings.quoteMarkupDefaultPct} onAdd={addQuote} onUpdate={updateQuote} onRemove={removeQuote} />
      <CostLinesSection kind="equipment" title="Equipment" lines={costLines.filter(c => c.kind === 'equipment')} onAdd={addCostLine} onUpdate={updateCostLine} onRemove={removeCostLine} />
      <CostLinesSection kind="general_expense" title="General Expenses" lines={costLines.filter(c => c.kind === 'general_expense')} onAdd={addCostLine} onUpdate={updateCostLine} onRemove={removeCostLine} />
      <AlternatesSection alternates={alternates} onAdd={addAlternate} onUpdate={updateAlternate} onRemove={removeAlternate} />

      <h3>Selling price breakdown</h3>
      <table className="lp-table" data-testid="accubid-recap-table">
        <tbody>
          <tr><td>Material</td><td>{money(recap.materialTotal)}</td></tr>
          <tr><td>Field labor</td><td>{money(recap.fieldLaborCost)}</td></tr>
          {recap.equipmentTotal > 0 && <tr><td>Equipment</td><td>{money(recap.equipmentTotal)}</td></tr>}
          {recap.generalExpensesTotal > 0 && <tr><td>General expenses</td><td>{money(recap.generalExpensesTotal)}</td></tr>}
          {recap.quotesNetTotal > 0 && <tr><td>Quotes</td><td>{money(recap.quotesNetTotal + recap.quotesTaxTotal)}</td></tr>}
          <tr><td>Prime cost</td><td>{money(recap.primeCost)}</td></tr>
          <tr><td>Labor overhead</td><td>{money(recap.laborOverhead)}</td></tr>
          <tr><td>Net cost</td><td>{money(recap.netCost)}</td></tr>
          <tr><td>Total markup</td><td>{money(recap.totalMarkup)}</td></tr>
          {recap.salesMarkup > 0 && <tr><td>Sales markup</td><td>{money(recap.salesMarkup)}</td></tr>}
          <tr style={{ fontWeight: 700 }}><td>Selling price</td><td data-testid="accubid-selling-price">{money(recap.sellingPrice)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function QuotesSection({ quotes, defaultMarkupPct, onAdd, onUpdate, onRemove }: {
  quotes: AccubidQuote[]; defaultMarkupPct: number;
  onAdd: (q: Omit<AccubidQuote, 'id' | 'sort'>) => Promise<void>;
  onUpdate: (id: string, patch: Partial<AccubidQuote>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [markupPct, setMarkupPct] = useState(String(defaultMarkupPct));
  const add = async () => {
    if (!desc.trim() || !amount) return;
    await onAdd({ description: desc.trim(), amount: Number(amount), taxPct: 0, markupPct: Number(markupPct) || defaultMarkupPct, status: 'budget_pending', vendor: null });
    setDesc(''); setAmount('');
  };
  return (
    <div data-testid="accubid-quotes">
      <h3>Vendor Quotes</h3>
      <table className="lp-table">
        <thead><tr><th>Description</th><th>Amount</th><th>Tax %</th><th>Markup %</th><th>Status</th><th /></tr></thead>
        <tbody>
          {quotes.map(q => (
            <tr key={q.id} data-testid={`accubid-quote-${q.id}`}>
              <td>{q.description}</td>
              <td>{money(q.amount)}</td>
              <td>{q.taxPct}%</td>
              <td>{q.markupPct}%</td>
              <td>
                <select value={q.status} onChange={e => onUpdate(q.id, { status: e.target.value === 'firm' ? 'firm' : 'budget_pending' })}>
                  <option value="budget_pending">Budget pending</option>
                  <option value="firm">Firm</option>
                </select>
              </td>
              <td><button type="button" className="btn ghost" onClick={() => onRemove(q.id)}>Remove</button></td>
            </tr>
          ))}
          <tr>
            <td><input placeholder="Switchgear" value={desc} onChange={e => setDesc(e.target.value)} /></td>
            <td><input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 90 }} /></td>
            <td />
            <td><input type="number" value={markupPct} onChange={e => setMarkupPct(e.target.value)} style={{ width: 60 }} /></td>
            <td colSpan={2}><button type="button" className="btn" onClick={add} data-testid="accubid-add-quote">Add quote</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CostLinesSection({ kind, title, lines, onAdd, onUpdate, onRemove }: {
  kind: 'equipment' | 'general_expense'; title: string; lines: AccubidCostLine[];
  onAdd: (c: Omit<AccubidCostLine, 'id' | 'sort'>) => Promise<void>;
  onUpdate: (id: string, patch: Partial<AccubidCostLine>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const add = async () => {
    if (!desc.trim() || !amount) return;
    await onAdd({ kind, description: desc.trim(), amount: Number(amount), taxPct: 0 });
    setDesc(''); setAmount('');
  };
  return (
    <div data-testid={`accubid-costlines-${kind}`}>
      <h3>{title}</h3>
      <table className="lp-table">
        <thead><tr><th>Description</th><th>Amount</th><th /></tr></thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id}>
              <td>{l.description}</td>
              <td>{money(l.amount)}</td>
              <td><button type="button" className="btn ghost" onClick={() => onRemove(l.id)}>Remove</button></td>
            </tr>
          ))}
          <tr>
            <td><input placeholder={kind === 'equipment' ? 'Scissor lift' : 'Permits'} value={desc} onChange={e => setDesc(e.target.value)} /></td>
            <td><input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 90 }} /></td>
            <td><button type="button" className="btn" onClick={add}>Add</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AlternatesSection({ alternates, onAdd, onUpdate, onRemove }: {
  alternates: AccubidAlternate[];
  onAdd: (a: Omit<AccubidAlternate, 'id' | 'auto' | 'sourceRule' | 'sort'>) => Promise<void>;
  onUpdate: (id: string, patch: Partial<AccubidAlternate>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<'add' | 'deduct'>('deduct');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const add = async () => {
    if (!desc.trim() || !amount) return;
    await onAdd({ kind, description: desc.trim(), amount: Number(amount) });
    setDesc(''); setAmount('');
  };
  return (
    <div data-testid="accubid-alternates">
      <h3>Alternates</h3>
      <table className="lp-table">
        <thead><tr><th>Kind</th><th>Description</th><th>Amount</th><th /></tr></thead>
        <tbody>
          {alternates.map(a => (
            <tr key={a.id} data-testid={`accubid-alternate-${a.id}`}>
              <td>{a.kind === 'add' ? 'ADD' : 'DEDUCT'}{a.auto ? ' (auto)' : ''}</td>
              <td>{a.description}</td>
              <td>{money(a.amount)}</td>
              <td>{!a.auto && <button type="button" className="btn ghost" onClick={() => onRemove(a.id)}>Remove</button>}</td>
            </tr>
          ))}
          <tr>
            <td>
              <select value={kind} onChange={e => setKind(e.target.value === 'add' ? 'add' : 'deduct')}>
                <option value="deduct">Deduct</option>
                <option value="add">Add</option>
              </select>
            </td>
            <td><input placeholder="if existing office fixtures stay" value={desc} onChange={e => setDesc(e.target.value)} /></td>
            <td><input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 90 }} /></td>
            <td><button type="button" className="btn" onClick={add} data-testid="accubid-add-alternate">Add</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
