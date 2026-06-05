import React, { useState, useEffect } from 'react';
import Icon from '../../components/Icon';
import { GenForm } from './genData';
import { blankGenForm, getGenSizes, calcGenTotals, genProposalNo } from './genCalc';
import ProposalPreview from './ProposalPreview';
import SendProposalModal from './SendProposalModal';
import api from '../../api/client';
import { Gen, WonJob } from '../../types';
import { useSettings, useShowToast } from '../../contexts/AppContext';

function fmt(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }

interface Props {
  setGens: (fn: (prev: Gen[]) => Gen[]) => void;
  setWonJobs?: (fn: (prev: WonJob[]) => WonJob[]) => void;
  onSaved: () => void;
  editGen?: Gen | null;
}

type Screen = 'builder' | 'preview';

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface)',
  border: '1px solid var(--border2)', borderRadius: 9,
  padding: '9px 12px', outline: 'none', boxSizing: 'border-box',
};
const SELECT_STYLE = { ...INPUT_STYLE, cursor: 'pointer' };

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
            <Icon name={icon as any} size={15} stroke={1.9}/>
          </span>
          {title}
        </span>
      </div>
      <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function genToForm(g: Gen): GenForm {
  const blank = blankGenForm();
  let saved: Partial<GenForm> | null | undefined;
  try {
    saved = typeof g.form_data === 'string'
      ? JSON.parse(g.form_data) as Partial<GenForm>
      : (g.form_data as Partial<GenForm> | null | undefined);
  } catch {
    saved = null;
  }
  if (saved && typeof saved === 'object') {
    return { ...blank, ...saved };
  }
  const [city, state] = (g.loc || '').split(',').map(s => s.trim());
  return {
    ...blank,
    customer: g.customer || '',
    city: city || '',
    state: state || '',
    brand: (g.mfr === 'Kohler' || g.mfr === 'Generac') ? g.mfr : 'Kohler',
    size: g.model || blank.size,
    jobType: 'new-install',
    removalFee: 500,
    attn: '',
    discountType: '$',
  };
}

export default function BuilderPage({ setGens, setWonJobs, onSaved, editGen }: Props) {
  const showToast = useShowToast();
  const { settings: s } = useSettings();
  const [form, setForm] = useState<GenForm>(() => editGen ? genToForm(editGen) : blankGenForm(s));
  const [screen, setScreen] = useState<Screen>('builder');
  const [proposalNo] = useState(() => editGen?.proposal_no || genProposalNo(form.brand, form.coolingType));
  const [saving, setSaving] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [savedGenId, setSavedGenId] = useState<string | null>(editGen?.id ?? null);
  const [benchmarks, setBenchmarks] = useState<Array<{ min: number; max: number; avgAmount: number | null; avgPerKw: number | null; count: number }>>([]);

  useEffect(() => {
    api.get('/gens/benchmark').then(r => setBenchmarks(r.data)).catch(() => {});
  }, []);

  const set = (key: keyof GenForm, val: unknown) => setForm(prev => {
    const next = { ...prev, [key]: val };
    if (key === 'brand' || key === 'coolingType') {
      const sizes = getGenSizes(next);
      if (!sizes.includes(next.size)) next.size = sizes[0] ?? '';
    }
    return next;
  });

  const totals = calcGenTotals(form);
  const sizes  = getGenSizes(form);

  const handleSave = async () => {
    if (!form.customer.trim()) { showToast({ title: 'Customer name required' }); return; }
    setSaving(true);
    try {
      const payload = {
        customer:   form.customer,
        loc:        [form.city, form.state].filter(Boolean).join(', ') || form.address || '—',
        mfr:        form.brand,
        model:      form.size,
        kw:         parseInt(form.size),
        amount:     totals.total,
        tax:        totals.tax,
        addons:     (form.smm ? 1 : 0) + (form.surgePro ? 1 : 0) + (form.battery ? 1 : 0) + (form.pad ? 1 : 0),
        proposal_no: proposalNo,
        form_data:   form,
        totals_data: totals,
      };
      if (editGen) {
        const r = await api.patch(`/gens/${editGen.id}`, payload);
        const updatedGen: Gen = r.data.gen ?? r.data;
        setGens(prev => prev.map(g => g.id === editGen.id ? updatedGen : g));
        if (r.data.wonJob && setWonJobs) {
          setWonJobs(prev => prev.map(w => w.proposal_id === editGen.id ? r.data.wonJob : w));
        }
        showToast({ title: 'Proposal updated', sub: form.customer });
      } else {
        const r = await api.post('/gens', { ...payload, stage: 'building' });
        setGens(prev => [r.data, ...prev]);
        setSavedGenId(r.data.id);
        showToast({ title: 'Proposal saved', sub: `${form.customer} added to Gen pipeline` });
      }
      onSaved();
    } catch {
      showToast({ title: 'Save failed', sub: 'Please try again' });
    } finally {
      setSaving(false);
    }
  };

  if (screen === 'preview') {
    return <ProposalPreview form={form} totals={totals} proposalNo={proposalNo} onBack={() => setScreen('builder')} appSettings={s}/>;
  }

  return (
    <div className="scroll view-enter">
      <div className="builder-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, padding: '20px 28px 40px', alignItems: 'start' }}>
        <div>
          {/* Section 1: Customer & Site */}
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
            <Field label="State / Zip">
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8 }}>
                <input style={INPUT_STYLE} value={form.state} onChange={e => set('state', e.target.value)}/>
                <input style={INPUT_STYLE} value={form.zip}   onChange={e => set('zip',   e.target.value)} placeholder="ZIP"/>
              </div>
            </Field>
            <Field label="Phone">
              <input style={INPUT_STYLE} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(352) 555-0000"/>
            </Field>
            <Field label="Email">
              <input style={INPUT_STYLE} value={form.email} onChange={e => set('email', e.target.value)} placeholder="customer@email.com"/>
            </Field>
          </Section>

          {/* Section 2: Generator */}
          <Section title="Generator" icon="bolt">
            <Field label="Brand">
              <select style={SELECT_STYLE} value={form.brand} onChange={e => set('brand', e.target.value)}>
                <option value="Kohler">Kohler</option>
                <option value="Generac">Generac</option>
              </select>
            </Field>
            <Field label="Cooling Type">
              <select style={SELECT_STYLE} value={form.coolingType} onChange={e => set('coolingType', e.target.value)}>
                <option value="air-cooled">Air-Cooled</option>
                <option value="liquid-cooled">Liquid-Cooled</option>
              </select>
            </Field>
            <Field label="Size">
              <select style={SELECT_STYLE} value={form.size} onChange={e => set('size', e.target.value)}>
                {sizes.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="ATS Size">
              <select style={SELECT_STYLE} value={form.ats} onChange={e => set('ats', e.target.value)}>
                {['100A','150A','200A','400A'].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Job Type">              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderRadius: 9, overflow: 'hidden', border: '1px solid var(--border2)' }}>
                {(['new-install', 'swap-out'] as const).map(jt => (
                  <button key={jt} onClick={() => {
                    set('jobType', jt);
                    if (jt === 'swap-out') {
                      setForm(f => ({ ...f, jobType: 'swap-out', pad: false, labor: 1500, permit: 475 }));
                    } else {
                      setForm(f => ({ ...f, jobType: 'new-install', labor: s.gen_default_labor ? Number(s.gen_default_labor) : 3000, permit: s.gen_default_permit ? Number(s.gen_default_permit) : 1250 }));
                    }
                  }}
                    style={{ padding: '9px 0', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                      background: form.jobType === jt ? 'var(--accent)' : 'var(--surface)',
                      color: form.jobType === jt ? '#fff' : 'var(--text2)' }}>
                    {jt === 'new-install' ? 'New Install' : 'Swap-Out'}
                  </button>
                ))}
              </div>
            </Field>
            {form.jobType === 'swap-out' && (
              <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#92400E', fontWeight: 700 }}>
                SWAP-OUT INSTALLATION<br/>
                <span style={{ fontWeight: 500, fontSize: 11 }}>Remove existing generator · Install on existing pad · Use existing ATS</span>
              </div>
            )}
          </Section>

          {/* Section 3: Installation Options */}
          <Section title="Installation Options" icon="gear">
            {([
              ['pad',      form.jobType === 'swap-out' ? 'Concrete Pad (new)' : 'Concrete Pad'],
              ['smm',      'SMM Maintenance'],
              ['surgePro', 'SurgeProtector Pro'],
              ['battery',  'Battery'],
            ] as [keyof GenForm, string][]).map(([k, label]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, gridColumn: '1' }}>
                <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} style={{ accentColor: 'var(--green)', width: 16, height: 16 }}/>
                {label}
              </label>
            ))}
            {form.jobType === 'swap-out' && (
              <Field label="Removal / Disposal Fee ($)">
                <input type="number" min={0} style={INPUT_STYLE} value={form.removalFee} onChange={e => set('removalFee', Number(e.target.value))}/>
              </Field>
            )}
            <Field label="Extra Wire (ft)">
              <input type="number" min={0} style={INPUT_STYLE} value={form.extraWire} onChange={e => set('extraWire', Number(e.target.value))}/>
            </Field>
          </Section>

          {/* Section 4: Add-ons */}
          <Section title="Add-ons" icon="plus">
            <Field label="Lift Type">
              <select style={SELECT_STYLE} value={form.liftType} onChange={e => set('liftType', e.target.value)}>
                <option value="none">None</option>
                <option value="lull">Lull ($1,100)</option>
                <option value="crane">Crane ($1,800)</option>
              </select>
            </Field>
            <Field label="LC ATS">
              <select style={SELECT_STYLE} value={form.lcATS} onChange={e => set('lcATS', e.target.value)}>
                <option value="none">None</option>
                <option value="150A">150A</option>
                <option value="200A">200A</option>
              </select>
            </Field>
            <Field label="Additional ATS Units">
              <input type="number" min={0} max={10} style={INPUT_STYLE} value={form.additionalATS} onChange={e => set('additionalATS', Number(e.target.value))}/>
            </Field>
          </Section>

          {/* Section 5: Pricing & Terms */}
          <Section title="Pricing & Terms" icon="dollar">
            <Field label="Labor">
              <input type="number" min={0} style={INPUT_STYLE} value={form.labor} onChange={e => set('labor', Number(e.target.value))}/>
            </Field>
            <Field label="Permit">
              <input type="number" min={0} style={INPUT_STYLE} value={form.permit} onChange={e => set('permit', Number(e.target.value))}/>
            </Field>
            <Field label="Startup">
              <input type="number" min={0} style={INPUT_STYLE} value={form.startup} onChange={e => set('startup', Number(e.target.value))}/>
            </Field>
            <Field label={`Discount (${form.discountType === '%' ? '%' : '$'})`}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" min={0} style={{ ...INPUT_STYLE, flex: 1 }} value={form.discount} onChange={e => set('discount', Number(e.target.value))}/>
                <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', border: '1px solid var(--border2)', flexShrink: 0 }}>
                  {(['$', '%'] as const).map(t => (
                    <button key={t} onClick={() => set('discountType', t)}
                      style={{ padding: '0 10px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                        background: form.discountType === t ? 'var(--accent)' : 'var(--surface)',
                        color: form.discountType === t ? '#fff' : 'var(--text2)' }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </Field>
            <Field label="Tax Rate (%)">
              <input type="number" min={0} max={20} step={0.1} style={INPUT_STYLE} value={form.taxRate} onChange={e => set('taxRate', Number(e.target.value))}/>
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={!!form.includeBreakdown} onChange={e => set('includeBreakdown', e.target.checked)} style={{ accentColor: 'var(--green)', width: 16, height: 16 }}/>
              Include Price Breakdown Page
            </label>
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
            <div style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', marginBottom: 12 }}>
                {form.brand} {form.size} · {form.coolingType === 'air-cooled' ? 'Air' : 'Liquid'}-Cooled
              </div>
              {[
                { label: 'Generator',    val: totals.genP },
                ...(totals.padAmt     ? [{ label: 'Pad',         val: totals.padAmt     }] : []),
                ...(totals.smmTotal   ? [{ label: 'SMM',         val: totals.smmTotal   }] : []),
                ...(totals.surgeTotal ? [{ label: 'Surge Pro',   val: totals.surgeTotal }] : []),
                ...(totals.batteryAmt ? [{ label: 'Battery',     val: totals.batteryAmt }] : []),
                ...(totals.liftAmt    ? [{ label: 'Lift',        val: totals.liftAmt    }] : []),
                ...(totals.lcATS      ? [{ label: 'LC ATS',      val: totals.lcATS      }] : []),
                ...(totals.extraATS   ? [{ label: 'Extra ATS',   val: totals.extraATS   }] : []),
                { label: 'Labor',        val: totals.laborAmt   },
                { label: 'Permit',       val: totals.permitAmt  },
                { label: 'Startup',      val: totals.startupAmt },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5, color: 'var(--text2)' }}>
                  <span>{r.label}</span>
                  <span className="num" style={{ fontWeight: 700 }}>{fmt(r.val)}</span>
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }}/>
              {totals.discountAmt > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5, color: 'var(--red, #E06A6A)' }}>
                  <span>Discount{form.discountType === '%' ? ` (${form.discount}%)` : ''}</span>
                  <span className="num">−{fmt(totals.discountAmt)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5, color: 'var(--text2)' }}>
                <span>Tax ({form.taxRate}%)</span>
                <span className="num">{fmt(totals.tax)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 900, color: 'var(--text)', marginTop: 8 }}>
                <span>Total</span>
                <span className="num">{fmt(totals.total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                <span>50% Deposit</span>
                <span className="num">{fmt(totals.deposit)}</span>
              </div>

              {/* Price benchmark flag */}
              {(() => {
                const kw = parseInt(form.size) || 0;
                const b = benchmarks.find(bk => kw >= bk.min && kw < bk.max);
                if (!b || !b.avgAmount || b.count < 2) return null;
                const pct = ((totals.total - b.avgAmount) / b.avgAmount) * 100;
                if (Math.abs(pct) < 15) return null;
                const high = pct > 0;
                return (
                  <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8,
                    background: high ? 'rgba(224,106,106,.1)' : 'var(--amber-soft)',
                    border: `1px solid ${high ? 'rgba(224,106,106,.25)' : 'rgba(224,165,59,.25)'}` }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: high ? '#E06A6A' : 'var(--amber)', marginBottom: 3 }}>
                      {high ? '▲' : '▼'} {Math.abs(Math.round(pct))}% {high ? 'above' : 'below'} avg
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 600 }}>
                      Avg for {kw}kW range: {fmt(b.avgAmount)} ({b.count} sold)
                    </div>
                  </div>
                );
              })()}

              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn" onClick={() => setScreen('preview')} style={{ fontSize: 13 }}>
                  <Icon name="doc" size={14} stroke={1.9}/> Preview Proposal
                </button>
                <button className="btn" onClick={handleSave} disabled={saving} style={{ fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)' }}>
                  <Icon name="check" size={14} stroke={2.2}/> {saving ? 'Saving…' : 'Save to Pipeline'}
                </button>
                {savedGenId && (
                  <button className="btn" onClick={() => setShowSend(true)}
                    style={{ fontSize: 13, background: 'var(--navy, #1B3A6B)', borderColor: 'var(--navy, #1B3A6B)', color: '#fff' }}>
                    <Icon name="send" size={14} stroke={2} style={{ color: '#fff' }}/> Send to Customer
                  </button>
                )}
              </div>

              {showSend && savedGenId && (
                <SendProposalModal
                  genId={savedGenId}
                  defaultEmail={form.email}
                  proposalNo={proposalNo}
                  total={fmt(totals.total)}
                  deposit={fmt(totals.deposit)}
                  onSent={updatedGen => {
                    setGens(prev => prev.map(g => g.id === updatedGen.id ? updatedGen : g));
                    setShowSend(false);
                    showToast({ title: 'Proposal sent', sub: `Email delivered to ${form.email}` });
                  }}
                  onClose={() => setShowSend(false)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
