import React, { useMemo, useState } from 'react';
import api from '../../api/client';
import { Gen } from '../../types';
import { useShowToast } from '../../contexts/AppContext';
import { buildChecklistPdf } from './checklistPdf';

export interface LoadRow { fuel?: 'Electric' | 'Gas'; volt?: '120V' | '240V'; hp?: string; amps?: string; }

export interface AcUnit { size: string; type: '' | 'Central' | 'Mini Split' | 'Heat Pump' | 'Other'; lra: string }
export interface CustomLoad extends LoadRow { name: string }
export const AC_TYPES = ['Central', 'Mini Split', 'Heat Pump', 'Other'] as const;

export interface ChecklistData {
  disc: '' | 'Yes' | 'No';
  em: '' | 'Yes' | 'No';
  powerCo: string;
  serviceAmps: string;
  atsQtyAmps: string;
  sqft: string;
  acUnits: AcUnit[];
  airHandler: '' | 'Electric' | 'Gas';
  gasType: '' | 'LP' | 'NG';
  loads: Record<number, LoadRow>;
  customLoads: CustomLoad[];
  feedLen: string;
  gasRunLength: string;
  locDesc: string;
  notes: string;
}

export const BLANK: ChecklistData = {
  disc: '', em: '', powerCo: '', serviceAmps: '', atsQtyAmps: '', sqft: '',
  acUnits: [], airHandler: '', gasType: '',
  loads: {}, customLoads: [], feedLen: '', gasRunLength: '', locDesc: '', notes: '',
};

// Same fixed appliance list as the standalone Job Kickoff Tool, keyed by index
// (two "Other" rows share a name, so the name alone can't be the key).
export const LOADS: { n: string }[] = [
  { n: 'Dryer' }, { n: 'Microwave' }, { n: 'Range Oven w/Top' }, { n: 'Cook Top' },
  { n: 'Oven' }, { n: 'Pool Heater' }, { n: 'Water Heater' },
  { n: 'Hot Tub (small)' }, { n: 'Hot Tub (large)' }, { n: 'Dishwasher' }, { n: 'Freezer' }, { n: 'Refrigerator' },
  { n: 'EV Charger' }, { n: 'Pool Pump' }, { n: 'Sump / Grinder Pump' },
  { n: 'Well Pump' }, { n: 'Garage Door Opener' }, { n: 'Water Softener' }, { n: 'Garbage Disposal' },
  { n: 'Shop / Shed / MIL Suite' }, { n: 'Boat House / Lift' },
  { n: 'Sprinkler Pump' }, { n: 'Other' }, { n: 'Other' },
];

function parseChecklist(raw: Gen['checklist_data']): ChecklistData {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Partial<ChecklistData> & { acSize?: string; lra?: string };
      const merged: ChecklistData = {
        ...BLANK, ...p,
        loads: { ...(p.loads || {}) },
        acUnits: Array.isArray(p.acUnits) ? p.acUnits : [],
        customLoads: Array.isArray(p.customLoads) ? p.customLoads : [],
      };
      // Legacy single AC fields → first AC unit. Old tankSize/tankType are dropped.
      if (!merged.acUnits.length && (p.acSize || p.lra)) {
        merged.acUnits = [{ size: p.acSize || '', type: '', lra: p.lra || '' }];
      }
      // Strip legacy keys so they never re-enter state and get re-persisted by save().
      const mergedAny = merged as unknown as Record<string, unknown>;
      delete mergedAny.acSize;
      delete mergedAny.lra;
      delete mergedAny.tankSize;
      delete mergedAny.tankType;
      return merged;
    }
  } catch { /* fall through to blank */ }
  return { ...BLANK, loads: {}, acUnits: [], customLoads: [] };
}

function parseGenForm(raw: Gen['form_data']): Record<string, unknown> {
  try { return (typeof raw === 'string' ? JSON.parse(raw) : raw) || {}; }
  catch { return {}; }
}

// The checklist renders on a white "paper" card (so it exports to a clean PDF), so it uses
// fixed light-theme colors — NOT the app's dark-mode CSS vars, which would be invisible here.
const INK = '#1c2430';
const MUTED = '#6b7683';
const LINE = '#dce3ec';
const HEAD = '#164a86';

const inputStyle: React.CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600, color: INK,
  background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8,
  padding: '7px 10px', outline: 'none', boxSizing: 'border-box',
};
const miniStyle: React.CSSProperties = { ...inputStyle, width: 74 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</label>
      {children}
    </div>
  );
}

function ToggleGroup<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 7, overflow: 'hidden' }}>
      {options.map(o => (
        <button key={o} type="button" onClick={() => onChange(value === o ? ('' as T) : o)}
          style={{ background: value === o ? HEAD : '#fff', color: value === o ? '#fff' : MUTED,
            border: 'none', padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          {o}
        </button>
      ))}
    </div>
  );
}

export default function SiteVisitChecklist({ gen, onUpdated }: { gen: Gen; onUpdated: (gen: Gen) => void }) {
  const showToast = useShowToast();
  const [data, setData] = useState<ChecklistData>(() => parseChecklist(gen.checklist_data));
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const form = useMemo(() => parseGenForm(gen.form_data), [gen.form_data]);
  const address = [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ') || gen.loc;

  const pdfHeader = () => ({
    customer: gen.customer || '',
    genLabel: [gen.mfr, gen.model, gen.kw ? `${gen.kw}kW` : ''].filter(Boolean).join(' '),
    proposalNo: gen.proposal_no || '',
    address,
    date: new Date().toLocaleDateString(),
  });

  const set = <K extends keyof ChecklistData>(k: K, v: ChecklistData[K]) => setData(d => ({ ...d, [k]: v }));
  const setLoad = (i: number, patch: Partial<LoadRow>) =>
    setData(d => ({ ...d, loads: { ...d.loads, [i]: { ...d.loads[i], ...patch } } }));
  const setAc = (i: number, patch: Partial<AcUnit>) =>
    setData(d => ({ ...d, acUnits: d.acUnits.map((u, j) => j === i ? { ...u, ...patch } : u) }));
  const removeAc = (i: number) =>
    setData(d => ({ ...d, acUnits: d.acUnits.filter((_, j) => j !== i) }));
  const setCustom = (i: number, patch: Partial<CustomLoad>) =>
    setData(d => ({ ...d, customLoads: d.customLoads.map((c, j) => j === i ? { ...c, ...patch } : c) }));
  const removeCustom = (i: number) =>
    setData(d => ({ ...d, customLoads: d.customLoads.filter((_, j) => j !== i) }));

  const save = async (silent = false) => {
    setSaving(true);
    try {
      const { data: res } = await api.patch(`/gens/${gen.id}`, { checklist_data: data });
      onUpdated(res.gen ?? res);
      if (!silent) showToast({ title: 'Checklist saved' });
    } catch {
      showToast({ title: 'Save failed', sub: 'Try again' });
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    setExporting(true);
    try {
      await save(true);
      const pdf = await buildChecklistPdf(pdfHeader(), data, 'filled');
      // Capture prior finalized checklist ids before uploading, so we only ever delete
      // pre-existing docs (never the fresh one) and never leave the gen with no checklist
      // doc if the upload fails.
      let priorIds: string[] = [];
      try {
        const { data: docs } = await api.get('/documents', { params: { linked_id: gen.id } });
        priorIds = (docs as { id: string; category: string }[])
          .filter(d => d.category === 'site_checklist')
          .map(d => d.id);
      } catch { /* non-fatal — worst case a duplicate remains */ }
      const fd = new FormData();
      fd.append('file', pdf.output('blob'), `Site Visit Checklist - ${gen.customer}.pdf`);
      fd.append('linked_id', gen.id);
      fd.append('linked_name', gen.customer);
      fd.append('div', 'gen');
      fd.append('category', 'site_checklist');
      fd.append('display_name', `Site Visit Checklist — ${gen.customer}.pdf`);
      await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      // Replace any prior finalized checklist so re-finalizing doesn't stack copies.
      try {
        for (const id of priorIds) await api.delete(`/documents/${id}`);
      } catch { /* non-fatal — worst case a duplicate remains */ }
      showToast({ title: 'Checklist finalized', sub: 'Clean PDF attached to this job' });
    } catch {
      showToast({ title: 'Export failed', sub: 'Try again' });
    } finally {
      setExporting(false);
    }
  };

  const printBlank = async () => {
    try {
      const pdf = await buildChecklistPdf(pdfHeader(), { ...BLANK, sqft: data.sqft }, 'blank');
      const url = URL.createObjectURL(pdf.output('blob'));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      showToast({ title: 'Could not build blank form', sub: 'Try again' });
    }
  };

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ background: '#fff', color: INK, padding: 14, borderRadius: 10, border: '1px solid var(--border2)' }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, color: HEAD, fontSize: 14 }}>ACCURATE POWER &amp; TECHNOLOGY, INC.</div>
          <div style={{ fontSize: 10.5, color: MUTED }}>Site Visit Checklist</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12, fontSize: 12.5 }}>
          <div><b>Name:</b> {gen.customer}</div>
          <div><b>Gen Size / Brand:</b> {gen.mfr} {gen.model}</div>
          <div><b>Proposal No.:</b> {gen.proposal_no || '—'}</div>
          <div><b>Date:</b> {new Date().toLocaleDateString()}</div>
          <div><b>Sq/Ft:</b> <input style={{ ...inputStyle, display: 'inline-block', width: 90, padding: '3px 8px' }} value={data.sqft} onChange={e => set('sqft', e.target.value)}/></div>
          <div style={{ gridColumn: '1 / -1' }}><b>Address:</b> {address}</div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#164a86', marginBottom: 6, marginTop: 10 }}>Service &amp; System</div>
        <div style={{ display: 'flex', gap: 20, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>Disconnect: <ToggleGroup options={['Yes', 'No']} value={data.disc} onChange={v => set('disc', v)}/></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>Em Panel: <ToggleGroup options={['Yes', 'No']} value={data.em} onChange={v => set('em', v)}/></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          <Field label="Power Company"><input style={inputStyle} value={data.powerCo} onChange={e => set('powerCo', e.target.value)}/></Field>
          <Field label="Service AMPS"><input style={inputStyle} value={data.serviceAmps} onChange={e => set('serviceAmps', e.target.value)}/></Field>
          <Field label="ATS Qty / AMPS"><input style={inputStyle} value={data.atsQtyAmps} onChange={e => set('atsQtyAmps', e.target.value)}/></Field>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>AC Units</div>
          {data.acUnits.map((u, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr auto', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <input style={inputStyle} placeholder="Size (e.g. 3 Ton)" value={u.size} onChange={e => setAc(i, { size: e.target.value })}/>
              <ToggleGroup options={[...AC_TYPES]} value={u.type} onChange={v => setAc(i, { type: v as AcUnit['type'] })}/>
              <input style={inputStyle} placeholder="LRA" value={u.lra} onChange={e => setAc(i, { lra: e.target.value })}/>
              <button type="button" onClick={() => removeAc(i)} style={{ border: 'none', background: 'none', color: '#c0392b', cursor: 'pointer', fontWeight: 700 }}>✕</button>
            </div>
          ))}
          <button type="button" className="btn ghost" style={{ fontSize: 12, height: 30, padding: '0 12px' }}
            onClick={() => setData(d => ({ ...d, acUnits: [...d.acUnits, { size: '', type: '', lra: '' }] }))}>
            + Add AC unit
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Field label="Air Handler (Heat Strips)"><ToggleGroup options={['Electric', 'Gas']} value={data.airHandler} onChange={v => set('airHandler', v)}/></Field>
          <Field label="Gas Type"><ToggleGroup options={['LP', 'NG']} value={data.gasType} onChange={v => set('gasType', v)}/></Field>
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#164a86', marginBottom: 6 }}>Loads / Appliances</div>
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Appliance', 'Fuel', 'Volts', 'HP', 'AMPS'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: MUTED, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', padding: '4px 6px', borderBottom: `1px solid ${LINE}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LOADS.map((row, i) => {
                const lv = data.loads[i] || {};
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${LINE}` }}>
                    <td style={{ padding: '4px 6px', fontWeight: 600 }}>{row.n}</td>
                    <td style={{ padding: '4px 6px' }}><ToggleGroup options={['Electric', 'Gas']} value={lv.fuel || ''} onChange={v => setLoad(i, { fuel: v as LoadRow['fuel'] })}/></td>
                    <td style={{ padding: '4px 6px' }}><ToggleGroup options={['120V', '240V']} value={lv.volt || ''} onChange={v => setLoad(i, { volt: v as LoadRow['volt'] })}/></td>
                    <td style={{ padding: '4px 6px' }}><input style={miniStyle} value={lv.hp || ''} onChange={e => setLoad(i, { hp: e.target.value })}/></td>
                    <td style={{ padding: '4px 6px' }}><input style={miniStyle} value={lv.amps || ''} onChange={e => setLoad(i, { amps: e.target.value })}/></td>
                  </tr>
                );
              })}
              {data.customLoads.map((row, i) => (
                <tr key={`c${i}`} style={{ borderBottom: `1px solid ${LINE}` }}>
                  <td style={{ padding: '4px 6px' }}>
                    <input style={{ ...inputStyle, width: 140 }} placeholder="Appliance" value={row.name}
                      onChange={e => setCustom(i, { name: e.target.value })}/>
                  </td>
                  <td style={{ padding: '4px 6px' }}><ToggleGroup options={['Electric', 'Gas']} value={row.fuel || ''} onChange={v => setCustom(i, { fuel: v as LoadRow['fuel'] })}/></td>
                  <td style={{ padding: '4px 6px' }}><ToggleGroup options={['120V', '240V']} value={row.volt || ''} onChange={v => setCustom(i, { volt: v as LoadRow['volt'] })}/></td>
                  <td style={{ padding: '4px 6px' }}><input style={miniStyle} value={row.hp || ''} onChange={e => setCustom(i, { hp: e.target.value })}/></td>
                  <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                    <input style={miniStyle} value={row.amps || ''} onChange={e => setCustom(i, { amps: e.target.value })}/>
                    <button type="button" onClick={() => removeCustom(i)} style={{ marginLeft: 6, border: 'none', background: 'none', color: '#c0392b', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn ghost" style={{ marginTop: 4, fontSize: 12, height: 30, padding: '0 12px' }}
            onClick={() => setData(d => ({ ...d, customLoads: [...d.customLoads, { name: '' }] }))}>
            + Add appliance
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <Field label="Gen Feed Length / Type"><input style={inputStyle} value={data.feedLen} onChange={e => set('feedLen', e.target.value)}/></Field>
          <Field label="Gas Run Length"><input style={inputStyle} value={data.gasRunLength} onChange={e => set('gasRunLength', e.target.value)}/></Field>
        </div>
        <div style={{ marginBottom: 10 }}>
          <Field label="Gen Location Description"><textarea rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} value={data.locDesc} onChange={e => set('locDesc', e.target.value)}/></Field>
        </div>
        <div>
          <Field label="Notes"><textarea rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} value={data.notes} onChange={e => set('notes', e.target.value)}/></Field>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }} disabled={saving} onClick={() => save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={printBlank}>
          Print Blank
        </button>
        <button className="btn amber" style={{ flex: 1, justifyContent: 'center' }} disabled={exporting} onClick={finalize}>
          {exporting ? 'Exporting…' : 'Finalize / Export PDF'}
        </button>
      </div>
    </div>
  );
}
