// Next round Part B, Task 2/3 — the Accubid-mode Labor & Pricing sections:
// Crew (day/night shift), overhead/markup, Quotes (budget-pending blocks
// send), Equipment, General Expenses, and Alternates (add/deduct, printed
// on the proposal without changing the base price). Mounted by
// LaborPricingStep in place of the Phase A settings row when
// settings.pricing_mode === 'accubid'.
import React, { useEffect, useState } from 'react';
import { useAccubidPricing, type UseAccubidPricingResult } from './useAccubidPricing';
import { PricingCard } from './pricing/PricingCard';
import { alternatesSummary, costLinesSummary, crewSummary, quotesSummary } from './pricing/laborPricingModel';
import { AccubidAlternate, AccubidCostLine, AccubidQuote, AccubidSettings, FixturePackageQuestion } from './types';

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function numberOrDefault(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// Review round 2 / N15 — a night rate is OPTIONAL (null = "use the day rate
// at night too"): parses to null on a blank field, a validated non-negative
// number otherwise (falling back to the previous value on bad input, same
// as numberOrDefault above), so `nightJourneymanRate` etc. never carry a
// stray NaN into the save payload.
function nullableNumberOrDefault(raw: string, fallback: number | null): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface AccubidPricingPanelProps {
  bidId: string;
  showToast?: (t: { title: string; sub?: string; variant?: 'success' | 'error' }) => void;
  /** UI cleanup round 2B — the caller's own useAccubidPricing instance, so the status
   *  warnings can sit at the top of the page and share this panel's one fetch. */
  pricing?: UseAccubidPricingResult;
  /** Default true. LaborPricingStep passes false and renders <AccubidStatus> itself. */
  showStatus?: boolean;
}

/** UI cleanup round 2B — what can block sending (budget-pending hold), the load error and the
 *  fixture-package question. Never inside a collapsible card. */
export function accubidStatusActive(pricing: UseAccubidPricingResult): boolean {
  if (pricing.loading) return false;
  const q = pricing.fixturePackageQuestion;
  const questionOpen = !!q && q.quoteIds.some(id => pricing.quotes.some(x => x.id === id));
  return pricing.recap.blocksSend || !!pricing.error || questionOpen;
}

export function AccubidStatus({ pricing }: { pricing: UseAccubidPricingResult }) {
  if (!accubidStatusActive(pricing)) return null;
  const { recap, error, fixturePackageQuestion, quotes, updateQuote } = pricing;
  return (
    <>
      {recap.blocksSend && (
        <div className="lp-banner" data-testid="accubid-blocks-send" style={{ borderColor: 'var(--red)' }}>
          <strong>Hold — {recap.budgetPendingQuotes.length} quote{recap.budgetPendingQuotes.length === 1 ? '' : 's'} still budget-pending.</strong>
          &nbsp;The proposal can&apos;t be sent until every quote is firm ({recap.budgetPendingQuotes.map(q => q.description).join(', ')}).
        </div>
      )}
      {error && <div className="lp-banner" data-testid="accubid-error">{error}</div>}
      {fixturePackageQuestion && <FixturePackagePrompt question={fixturePackageQuestion} quotes={quotes} onUpdate={updateQuote} />}
    </>
  );
}

export function AccubidPricingPanel({ bidId, showToast, pricing, showStatus = true }: AccubidPricingPanelProps) {
  // With a lifted hook the panel's own instance gets a null id, so it never fetches.
  const own = useAccubidPricing(pricing ? null : bidId);
  const p = pricing ?? own;
  const {
    loading, saving, settings, recap, totalHours, quotes, costLines, alternates,
    saveSettings, addQuote, updateQuote, removeQuote, addCostLine, updateCostLine, removeCostLine,
    addAlternate, updateAlternate, removeAlternate, defaultOptIns, useDefaultCostLines,
  } = p;
  const onUseDefault = async (kind: 'equipment' | 'general_expense') => {
    try {
      await useDefaultCostLines([kind]);
      showToast?.({ title: `Default ${kind === 'equipment' ? 'equipment' : 'general expenses'} line added`, variant: 'success' });
    } catch {
      showToast?.({ title: 'Could not add the default line', variant: 'error' });
    }
  };

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

  // Review round 2 / N15 — a nullable (night-rate) field. `value={null}` on a
  // controlled <input> is what React warns about ("changing an uncontrolled
  // input to be controlled", or vice versa, as it flips between a real
  // number and null) — coalescing to '' keeps the input controlled the
  // whole time, and reads back as null exactly when the estimator leaves it
  // blank (meaning "use the day rate at night too").
  const nullableField = (label: string, key: keyof AccubidSettings, opts: { step?: number; title?: string } = {}) => (
    <label className="lp-settings-field" key={key} title={opts.title}>
      {label}
      <input type="number" step={opts.step ?? 1} value={(form[key] as number | null) ?? ''}
        onChange={e => setForm(prev => ({ ...prev, [key]: nullableNumberOrDefault(e.target.value, settings[key] as number | null) }))} />
    </label>
  );

  return (
    <div className="lp-page" data-testid="accubid-pricing-panel">
      {showStatus && <AccubidStatus pricing={p} />}

      <PricingCard
        storageKey="est-lp-acb-crew-open" defaultOpen title="Crew & markup" testId="accubid-crew-card"
        summary={<>{crewSummary(form, false)}{dirty && <span className="lp-card-summary-warn"> · Not saved</span>}</>}
      >
        <fieldset className="lp-rate-group">
          <legend>Crew</legend>
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
              {nullableField('Night journeyman $/hr', 'nightJourneymanRate', { step: 0.01 })}
              {nullableField('Night apprentice $/hr', 'nightApprenticeRate', { step: 0.01 })}
              {nullableField('Night foreman $/hr', 'nightForemanRate', { step: 0.01 })}
            </div>
          )}
          <div className="lp-settings-row">
            {field('Burden %', 'burdenPct', { step: 0.1 })}
            {field('Fringe $/hr', 'fringePerHr', { step: 0.01 })}
            <div className="lp-settings-field" style={{ justifyContent: 'flex-end' }}>Total hours: <strong>{totalHours.toFixed(3)}</strong></div>
          </div>
        </fieldset>

        <fieldset className="lp-rate-group">
          <legend>Overhead &amp; markup</legend>
          <div className="lp-settings-row">
            {field('Material tax %', 'materialTaxPct', { step: 0.1 })}
            {field('Labor overhead %', 'laborOverheadPct', { step: 0.1, title: 'Decision 5 default: 38% on labor only, editable per bid — see Settings for the per-GC default table.' })}
            {field('Material markup %', 'materialMarkupPct', { step: 0.1 })}
            {field('Labor markup %', 'laborMarkupPct', { step: 0.1 })}
            {field('Default quote markup %', 'quoteMarkupDefaultPct', { step: 0.1 })}
            {field('Adjustment %', 'adjustmentMarkupPct', { step: 0.1, title: 'Percent of Net Cost.' })}
            {field('Sales markup %', 'salesMarkupPct', { step: 0.1, title: '"CE Sales Markup" — percent of (Net Cost + Total Markup), applied last.' })}
          </div>
        </fieldset>
        <div style={{ margin: '8px 0' }}>
          <button type="button" className="btn" disabled={!dirty || saving} onClick={onSaveSettings} data-testid="accubid-save-settings">
            {saving ? 'Saving…' : 'Save crew & pricing'}
          </button>
          {dirty && <span className="lp-hint" data-testid="accubid-crew-dirty-note" style={{ marginLeft: 8 }}>Not saved yet — this button saves crew &amp; markup (the main Save doesn’t).</span>}
        </div>
      </PricingCard>

      <QuotesSection quotes={quotes} defaultMarkupPct={settings.quoteMarkupDefaultPct} onAdd={addQuote} onUpdate={updateQuote} onRemove={removeQuote} />
      <CostLinesSection kind="equipment" title="Equipment" lines={costLines.filter(c => c.kind === 'equipment')} onAdd={addCostLine} onUpdate={updateCostLine} onRemove={removeCostLine}
        onUseDefault={defaultOptIns.includes('equipment') ? () => onUseDefault('equipment') : undefined} />
      <CostLinesSection kind="general_expense" title="General expenses" lines={costLines.filter(c => c.kind === 'general_expense')} onAdd={addCostLine} onUpdate={updateCostLine} onRemove={removeCostLine}
        onUseDefault={defaultOptIns.includes('general_expense') ? () => onUseDefault('general_expense') : undefined} />
      <AlternatesSection alternates={alternates} onAdd={addAlternate} onUpdate={updateAlternate} onRemove={removeAlternate} />

      <PricingCard storageKey="est-lp-acb-price-open" defaultOpen title="Selling price breakdown" testId="accubid-price-card" summary={money(recap.sellingPrice)}>
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
        <p className="lp-hint" data-testid="accubid-price-hint">The Bid summary on the right is the live total, including unsaved changes.</p>
      </PricingCard>
    </div>
  );
}

/** Gap-closing T3 (J2) — "is this quote the fixture package?" Yes sets the quote's fixture-package flag (fixture lines
 *  go labor only); No remembers the answer. Never answered automatically. */
function FixturePackagePrompt({ question, quotes, onUpdate }: {
  question: FixturePackageQuestion; quotes: AccubidQuote[];
  onUpdate: (id: string, patch: Partial<AccubidQuote>) => Promise<void>;
}) {
  const open = question.quoteIds.map(id => quotes.find(q => q.id === id)).filter((q): q is AccubidQuote => !!q);
  const [pick, setPick] = useState(open[0]?.id ?? '');
  if (!open.length) return null;
  return (
    <div className="lp-hint lp-question" data-testid="accubid-fixture-package-question" role="group" aria-label="Fixture package question"
      style={{ border: '1px solid var(--amber)', borderRadius: 6, padding: '8px 10px', margin: '8px 0' }}>
      <div>{question.message}</div>
      {open.length > 1 && (
        <select value={pick} onChange={e => setPick(e.target.value)} data-testid="accubid-fixture-package-pick">
          {open.map(q => <option key={q.id} value={q.id}>{q.description} — {money(q.amount)}</option>)}
        </select>
      )}
      <button type="button" className="btn" data-testid="accubid-fixture-package-yes" onClick={() => onUpdate(pick || open[0].id, { fixturePackage: true, fixturePackageDecided: true })}>Yes — it is the fixture package</button>
      {' '}
      <button type="button" className="btn ghost" data-testid="accubid-fixture-package-no" onClick={async () => { for (const q of open) await onUpdate(q.id, { fixturePackageDecided: true }); }}>No — price both</button>
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
    <PricingCard storageKey="est-lp-acb-quotes-open" defaultOpen={quotes.length > 0} title="Vendor quotes" testId="accubid-quotes" summary={quotesSummary(quotes)}>
      <table className="lp-table">
        <thead><tr><th>Description</th><th>Amount</th><th>Tax %</th><th>Markup %</th><th>Status</th><th /></tr></thead>
        <tbody>
          {quotes.map(q => (
            <tr key={q.id} data-testid={`accubid-quote-${q.id}`}>
              <td>
                {q.description}
                <label className="lp-hint" style={{ display: 'block', fontSize: 11 }} title="The lighting package is quoted: fixture lines keep their labor and price no material.">
                  <input type="checkbox" checked={!!q.fixturePackage} data-testid={`accubid-quote-fixture-package-${q.id}`}
                    onChange={e => onUpdate(q.id, { fixturePackage: e.target.checked })} />
                  {' '}Fixture package (fixture lines: labor only)
                </label>
              </td>
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
    </PricingCard>
  );
}

function CostLinesSection({ kind, title, lines, onAdd, onUpdate, onRemove, onUseDefault }: {
  kind: 'equipment' | 'general_expense'; title: string; lines: AccubidCostLine[];
  onAdd: (c: Omit<AccubidCostLine, 'id' | 'sort'>) => Promise<void>;
  onUpdate: (id: string, patch: Partial<AccubidCostLine>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Price accuracy round C6 — shown only on a bid that may opt into the default. */
  onUseDefault?: () => void;
}) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const add = async () => {
    if (!desc.trim() || !amount) return;
    await onAdd({ kind, description: desc.trim(), amount: Number(amount), taxPct: 0 });
    setDesc(''); setAmount('');
  };
  const storageKey = kind === 'equipment' ? 'est-lp-acb-equipment-open' : 'est-lp-acb-ge-open';
  return (
    <PricingCard storageKey={storageKey} defaultOpen title={title} testId={`accubid-costlines-${kind}`}
      summary={`${costLinesSummary(lines)}${onUseDefault ? ' · default available' : ''}`}>
      {onUseDefault && (
        <div className="lp-hint" style={{ fontSize: 12, marginBottom: 6 }}>
          This bid predates the default {kind === 'equipment' ? 'equipment' : 'general expenses'} line.{' '}
          <button type="button" className="btn ghost" data-testid={`accubid-use-default-${kind}`} onClick={onUseDefault}>
            Use the default {kind === 'equipment' ? 'equipment' : 'general expenses'} line
          </button>
        </div>
      )}
      <table className="lp-table">
        <thead><tr><th>Description</th><th>Amount</th><th /></tr></thead>
        <tbody>
          {lines.filter(l => l.preview).map(l => (
            // C4 — a default the first save will add: shown, not editable yet.
            <tr key={l.id} data-testid={`accubid-costline-preview-${kind}`}>
              <td>{l.description}<div className="lp-hint" style={{ fontSize: 11, opacity: 0.75 }}>Added when you save — then editable.</div></td>
              <td>{money(l.amount)}</td>
              <td />
            </tr>
          ))}
          {lines.filter(l => !l.preview).map(l => (
            <tr key={l.id} data-testid={`accubid-costline-${l.id}`}>
              <td>
                {l.description}
                {l.autoDefault && (
                  <div className="lp-hint" data-testid={`accubid-costline-default-${l.id}`} style={{ fontSize: 11, opacity: 0.75 }}>
                    Default from Chris&apos;s past jobs (Settings &gt; Labor Library &gt; Allowances) — follows the labor hours until you change it.
                  </div>
                )}
              </td>
              <td>
                <CostAmountInput value={l.amount} onCommit={v => onUpdate(l.id, { amount: v })} testId={`accubid-costline-amount-${l.id}`} />
              </td>
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
    </PricingCard>
  );
}

/** B4 — an amount you can correct in place (a seeded default is meant to be
 *  edited); commits on blur/Enter only when the number actually changed. */
function CostAmountInput({ value, onCommit, testId }: { value: number; onCommit: (v: number) => Promise<void>; testId: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) { setText(String(value)); return; }
    if (n !== value) void onCommit(n);
  };
  return (
    <input type="number" min={0} step="0.01" value={text} data-testid={testId} style={{ width: 100 }}
      onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
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
    <PricingCard storageKey="est-lp-acb-alternates-open" defaultOpen={alternates.length > 0} title="Alternates" testId="accubid-alternates" summary={alternatesSummary(alternates)}>
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
    </PricingCard>
  );
}
