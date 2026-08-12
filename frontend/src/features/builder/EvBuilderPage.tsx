import React, { useState } from 'react';
import Icon from '../../components/Icon';
import { EvForm, EV_TIERS, EV_PRICES, evTierLabel, evTierPrice } from './evData';
import { CustomItem } from './genData';
import { blankEvForm, calcEvTotals, migrateEvForm, evProposalNo } from './evCalc';
import EvProposalPreview from './EvProposalPreview';
import SendProposalModal from './SendProposalModal';
import api from '../../api/client';
import { Gen } from '../../types';
import { useSettings, useShowToast } from '../../contexts/AppContext';
import { parseAddress } from '../../lib/address';

// Sign outside the currency symbol, matching the proposal document: "-$200", not "$-200".
// Shows cents only when an amount has them, so a $15,430 job stays readable while a
// $675.50 one is stated exactly. The proposal document itself always prints two decimals
// (fmtDec) — this is the in-app summary chrome.
function fmt(n: number) {
  const abs = Math.abs(n);
  const hasCents = Math.round(abs * 100) % 100 !== 0;
  return (n < 0 ? '-$' : '$') + abs.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface)',
  border: '1px solid var(--border2)', borderRadius: 9,
  padding: '9px 12px', outline: 'none', boxSizing: 'border-box',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</label>
      {children}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">
          <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
            <Icon name={icon as never} size={15} stroke={1.9}/>
          </span>
          {title}
        </span>
      </div>
      <div className="builder-field-grid" style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

interface Props {
  setGens: (fn: (prev: Gen[]) => Gen[]) => void;
  onSaved: () => void;
  editGen?: Gen | null;
  /** Rendered above the form when creating a new proposal — the Generator/EV switch. */
  productSwitch?: React.ReactNode;
}

function genToEvForm(g: Gen): EvForm {
  const blank = blankEvForm();
  let saved: Partial<EvForm> | null | undefined;
  try {
    saved = typeof g.form_data === 'string'
      ? JSON.parse(g.form_data) as Partial<EvForm>
      : (g.form_data as Partial<EvForm> | null | undefined);
  } catch {
    saved = null;
  }
  if (saved && typeof saved === 'object') {
    const merged = { ...blank, ...migrateEvForm(saved as Record<string, unknown>) } as EvForm;
    // A lead's combined address lands entirely in the address field (city/zip empty).
    // Split it so the builder fields are uniform, same as the generator builder does.
    if (!merged.city && typeof merged.address === 'string' && merged.address.includes(',')) {
      const p = parseAddress(merged.address);
      if (p.city || p.state || p.zip) {
        merged.address = p.street || merged.address;
        merged.city = p.city;
        if (p.state) merged.state = p.state;
        merged.zip = p.zip;
      }
    }
    return merged;
  }
  const [city, state] = (g.loc || '').split(',').map(s => s.trim());
  return { ...blank, customer: g.customer || '', city: city || '', state: state || blank.state };
}

export default function EvBuilderPage({ setGens, onSaved, editGen, productSwitch }: Props) {
  const showToast = useShowToast();
  const { settings: s } = useSettings();
  const [form, setForm] = useState<EvForm>(() => editGen ? genToEvForm(editGen) : blankEvForm(s));
  const [screen, setScreen] = useState<'builder' | 'preview'>('builder');
  const [proposalNo] = useState(() => editGen?.proposal_no || evProposalNo());
  const [saving, setSaving] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [savedGenId, setSavedGenId] = useState<string | null>(editGen?.id ?? null);

  const set = (key: keyof EvForm, val: unknown) => setForm(prev => {
    const next = { ...prev, [key]: val };
    // Picking a different tier means you want that tier's price — otherwise an override
    // typed for the old tier would quietly ride along on the new one.
    if (key === 'distanceTier') next.tierPriceOverride = null;
    return next;
  });

  const customItems: CustomItem[] = Array.isArray(form.customItems) ? form.customItems : [];
  const addCustomItem = () => set('customItems', [...customItems, { id: crypto.randomUUID(), desc: '', amount: 0, taxable: false }]);
  const patchCustomItem = (id: string, patch: Partial<CustomItem>) =>
    set('customItems', customItems.map(it => it.id === id ? { ...it, ...patch } : it));
  const removeCustomItem = (id: string) => set('customItems', customItems.filter(it => it.id !== id));

  const totals = calcEvTotals(form);

  const persist = async (): Promise<string | null> => {
    if (!form.customer.trim()) { showToast({ title: 'Customer name required' }); return null; }
    setSaving(true);
    try {
      const payload = {
        product_type: 'ev_charger' as const,
        customer: form.customer,
        loc: [form.city, form.state].filter(Boolean).join(', ') || form.address || '—',
        // The pipeline's equipment columns describe what's being installed; an EV job has
        // no kW rating, so kw stays null rather than reading as a 0 kW generator.
        mfr: 'Tesla',
        model: 'Wall Connector',
        kw: null,
        amount: totals.total,
        tax: totals.tax,
        addons: (form.panelUpgrade ? 1 : 0) + customItems.filter(it => it.desc.trim()).length,
        proposal_no: proposalNo,
        form_data: form,
        totals_data: totals,
      };
      if (editGen) {
        const r = await api.patch(`/gens/${editGen.id}`, payload);
        const updatedGen: Gen = r.data.gen ?? r.data;
        setGens(prev => prev.some(g => g.id === editGen.id)
          ? prev.map(g => g.id === editGen.id ? updatedGen : g)
          : [updatedGen, ...prev]);
        return editGen.id;
      }
      const r = await api.post('/gens', { ...payload, stage: 'building' });
      setGens(prev => [r.data, ...prev]);
      setSavedGenId(r.data.id);
      return r.data.id as string;
    } catch {
      showToast({ title: 'Save failed', sub: 'Please try again' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const id = await persist();
    if (!id) return;
    showToast({ title: editGen ? 'Proposal updated' : 'Proposal saved', sub: editGen ? form.customer : `${form.customer} added to pipeline` });
    onSaved();
  };

  const handleSendClick = async () => {
    const id = await persist();
    if (id) { setSavedGenId(id); setShowSend(true); }
  };

  if (screen === 'preview') {
    return <EvProposalPreview form={form} totals={totals} proposalNo={proposalNo} onBack={() => setScreen('builder')} appSettings={s} genId={savedGenId ?? undefined}/>;
  }

  return (
    <div className="scroll view-enter">
      <div className="builder-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, padding: '20px 28px 40px', alignItems: 'start' }}>
        <div>
          {productSwitch}

          <Section title="Customer & Site" icon="building">
            <Field label="Customer Name">
              <input style={INPUT_STYLE} value={form.customer} onChange={e => set('customer', e.target.value)} placeholder="Full name or company"/>
            </Field>
            <Field label="Attention / Contact">
              <input style={INPUT_STYLE} value={form.attn} onChange={e => set('attn', e.target.value)} placeholder="Contact person"/>
            </Field>
            <Field label="Address">
              <input style={INPUT_STYLE} value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street address"/>
            </Field>
            <Field label="City">
              <input style={INPUT_STYLE} value={form.city} onChange={e => set('city', e.target.value)} placeholder="City"/>
            </Field>
            <Field label="State">
              <input style={INPUT_STYLE} value={form.state} onChange={e => set('state', e.target.value)} placeholder="FL"/>
            </Field>
            <Field label="ZIP">
              <input style={INPUT_STYLE} value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="ZIP"/>
            </Field>
            <Field label="Phone">
              <input style={INPUT_STYLE} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(000) 000-0000"/>
            </Field>
            <Field label="Email">
              <input style={INPUT_STYLE} value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@email.com"/>
            </Field>
          </Section>

          <Section title="Installation" icon="bolt">
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Distance — Panel to Charger">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {EV_TIERS.map(t => (
                    <label key={t.key} style={{
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      padding: '10px 12px', borderRadius: 9,
                      border: `1px solid ${form.distanceTier === t.key ? 'var(--accent)' : 'var(--border2)'}`,
                      background: form.distanceTier === t.key ? 'var(--blue-soft)' : 'var(--surface)',
                    }}>
                      <input type="radio" name="ev-distance" checked={form.distanceTier === t.key}
                        onChange={() => set('distanceTier', t.key)}
                        style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}/>
                      <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{t.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text2)' }}>{fmt(EV_PRICES[t.key])}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <div style={{ marginTop: 12 }}>
                <Field label="Install Price">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="number" step="0.01" style={{ ...INPUT_STYLE, flex: '1 1 140px', width: 'auto' }}
                      value={form.tierPriceOverride ?? evTierPrice(form.distanceTier)}
                      onChange={e => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) set('tierPriceOverride', n);
                      }}/>
                    {form.tierPriceOverride !== null && (
                      <button type="button" onClick={() => set('tierPriceOverride', null)}
                        style={{ padding: '7px 12px', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                          border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text2)' }}>
                        Reset to {fmt(evTierPrice(form.distanceTier))}
                      </button>
                    )}
                  </div>
                </Field>
                {form.tierPriceOverride !== null && (
                  <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700, marginTop: 6 }}>
                    Custom price — standard {evTierLabel(form.distanceTier).toLowerCase()} rate is {fmt(evTierPrice(form.distanceTier))}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
                Runs past 25 ft: quote the 16–25 ft tier and add the overage as a custom line item below.
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <input type="checkbox" checked={!!form.panelUpgrade} onChange={e => set('panelUpgrade', e.target.checked)}
                  style={{ accentColor: 'var(--green)', width: 16, height: 16 }}/>
                Service upgrade to 200A ({fmt(EV_PRICES.panelUpgrade)})
              </label>
            </div>
          </Section>

          <Section title="Pricing & Terms" icon="dollar">
            <Field label={`Discount (${form.discountType === '%' ? '%' : '$'})`}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" min={0} step="0.01" style={{ ...INPUT_STYLE, flex: 1 }} value={form.discount} onChange={e => set('discount', Number(e.target.value))}/>
                <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', border: '1px solid var(--border2)', flexShrink: 0 }}>
                  {(['$', '%'] as const).map(t => (
                    <button key={t} type="button" onClick={() => set('discountType', t)}
                      style={{ padding: '0 10px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                        background: form.discountType === t ? 'var(--accent)' : 'var(--surface)',
                        color: form.discountType === t ? '#fff' : 'var(--text2)' }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </Field>
            {/* A flat dollar amount, not a rate: an EV quote's tax is a passthrough of the tax
                APT paid on materials, so a percentage of the contract would drift from it. */}
            <Field label="Sales Tax ($)">
              <input type="number" min={0} step="0.01" style={INPUT_STYLE} value={form.taxAmount} onChange={e => set('taxAmount', Number(e.target.value))}/>
            </Field>
            <Field label="Proposal Valid For (days)">
              <input type="number" min={1} max={365} style={INPUT_STYLE} value={form.validDays} onChange={e => set('validDays', Number(e.target.value))}/>
            </Field>
            <Field label="Deposit (%)">
              <input type="number" min={0} max={100} style={INPUT_STYLE} value={form.depositPct} onChange={e => set('depositPct', Number(e.target.value))}/>
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={!!form.includeBreakdown} onChange={e => set('includeBreakdown', e.target.checked)} style={{ accentColor: 'var(--green)', width: 16, height: 16 }}/>
              Include Price Breakdown Page
            </label>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Custom Line Items">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {customItems.map(it => (
                    <div key={it.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input style={{ ...INPUT_STYLE, flex: '1 1 200px', width: 'auto' }} value={it.desc}
                        placeholder="Description — e.g. Extra 40 ft of run"
                        onChange={e => patchCustomItem(it.id, { desc: e.target.value })}/>
                      {/* No min={0}: a negative amount reads on the proposal as a named credit.
                          A part-typed value like "-" parses to NaN and is dropped, so the field
                          keeps what the rep is mid-way through typing. */}
                      <input type="number" step="0.01" style={{ ...INPUT_STYLE, flex: '0 0 120px', width: 120 }} value={it.amount}
                        onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) patchCustomItem(it.id, { amount: n }); }}/>
                      <button type="button" onClick={() => removeCustomItem(it.id)} aria-label={`Remove ${it.desc.trim() || 'line item'}`}
                        style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 9, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                          border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text3)' }}>
                        ✕
                      </button>
                    </div>
                  ))}
                  <div>
                    <button type="button" onClick={addCustomItem}
                      style={{ padding: '7px 12px', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                        border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text2)' }}>
                      + Add Item
                    </button>
                  </div>
                </div>
              </Field>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Notes">
                <textarea style={{ ...INPUT_STYLE, height: 72, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional terms or notes…"/>
              </Field>
            </div>
          </Section>
        </div>

        {/* Summary panel */}
        <div style={{ position: 'sticky', top: 16 }}>
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">
                <span className="pt-ic" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                  <Icon name="dollar" size={15} stroke={1.9}/>
                </span>
                Proposal Summary
              </span>
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <Row label={`Installation — ${evTierLabel(form.distanceTier)}`} value={fmt(totals.tierAmt)}/>
              {totals.panelUpgradeAmt > 0 && <Row label="Service Upgrade 200A" value={fmt(totals.panelUpgradeAmt)}/>}
              {totals.customTotal !== 0 && <Row label="Custom Line Items" value={fmt(totals.customTotal)}/>}
              {totals.discountAmt > 0 && <Row label="Discount" value={`−${fmt(totals.discountAmt)}`}/>}
              <Row label="Sales Tax" value={fmt(totals.tax)}/>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }}/>
              <Row label="Total" value={fmt(totals.total)} strong/>
              {totals.deposit > 0 && <Row label={`Deposit (${form.depositPct}%)`} value={fmt(totals.deposit)}/>}
            </div>
            <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn" onClick={() => setScreen('preview')} style={{ width: '100%' }}>Preview Proposal</button>
              <button className="btn ghost" onClick={handleSave} disabled={saving} style={{ width: '100%' }}>
                {saving ? 'Saving…' : editGen ? 'Save Changes' : 'Save to Pipeline'}
              </button>
              <button className="btn ghost" onClick={handleSendClick} disabled={saving} style={{ width: '100%' }}>Send to Customer</button>
            </div>
          </div>
        </div>
      </div>

      {showSend && savedGenId && (
        <SendProposalModal
          genId={savedGenId}
          defaultEmail={form.email}
          proposalNo={proposalNo}
          spec="Tesla Wall Connector"
          total={fmt(totals.total)}
          deposit={fmt(totals.deposit)}
          onSent={updated => { setGens(prev => prev.map(g => g.id === updated.id ? updated : g)); setShowSend(false); onSaved(); }}
          onClose={() => setShowSend(false)}
        />
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: 'var(--text3)', fontWeight: strong ? 800 : 600 }}>{label}</span>
      <span style={{ fontWeight: strong ? 900 : 700, fontSize: strong ? 15 : 13 }}>{value}</span>
    </div>
  );
}
