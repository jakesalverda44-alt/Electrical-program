import React, { useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import { Gen } from '../../types';
import { useShowToast } from '../../contexts/AppContext';

interface LoadRow { fuel?: 'Electric' | 'Gas'; volt?: '120V' | '240V'; hp?: string; amps?: string; }

interface ChecklistData {
  disc: '' | 'Yes' | 'No';
  em: '' | 'Yes' | 'No';
  powerCo: string;
  serviceAmps: string;
  atsQtyAmps: string;
  acSize: string;
  lra: string;
  airHandler: '' | 'Electric' | 'Gas';
  gasType: '' | 'LP' | 'NG';
  tankSize: string;
  tankType: '' | 'AG' | 'UG';
  loads: Record<number, LoadRow>;
  feedLen: string;
  gasRunLength: string;
  locDesc: string;
  notes: string;
}

const BLANK: ChecklistData = {
  disc: '', em: '', powerCo: '', serviceAmps: '', atsQtyAmps: '', acSize: '', lra: '',
  airHandler: '', gasType: '', tankSize: '', tankType: '',
  loads: {}, feedLen: '', gasRunLength: '', locDesc: '', notes: '',
};

// Same fixed appliance list as the standalone Job Kickoff Tool, keyed by index
// (two "Other" rows share a name, so the name alone can't be the key).
const LOADS: { n: string; fuel?: boolean; volt?: boolean; hp?: boolean; amps?: boolean }[] = [
  { n: 'Dryer', fuel: true }, { n: 'Microwave' }, { n: 'Range Oven w/Top', fuel: true }, { n: 'Cook Top', fuel: true },
  { n: 'Oven', fuel: true, amps: true }, { n: 'Pool Heater', fuel: true, amps: true }, { n: 'Water Heater', fuel: true, amps: true },
  { n: 'Hot Tub (small)' }, { n: 'Hot Tub (large)' }, { n: 'Dishwasher' }, { n: 'Freezer' }, { n: 'Refrigerator' },
  { n: 'EV Charger', volt: true, amps: true }, { n: 'Pool Pump', volt: true, hp: true, amps: true }, { n: 'Sump / Grinder Pump', volt: true, hp: true, amps: true },
  { n: 'Well Pump', volt: true, hp: true, amps: true }, { n: 'Garage Door Opener' }, { n: 'Water Softener' }, { n: 'Garbage Disposal' },
  { n: 'Shop / Shed / MIL Suite', volt: true, amps: true }, { n: 'Boat House / Lift', volt: true, hp: true, amps: true },
  { n: 'Sprinkler Pump', volt: true, hp: true, amps: true }, { n: 'Other', volt: true, amps: true }, { n: 'Other', volt: true, amps: true },
];

function parseChecklist(raw: Gen['checklist_data']): ChecklistData {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') return { ...BLANK, ...parsed, loads: { ...(parsed as ChecklistData).loads } };
  } catch { /* fall through to blank */ }
  return { ...BLANK, loads: {} };
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
  const printRef = useRef<HTMLDivElement>(null);

  const form = useMemo(() => parseGenForm(gen.form_data), [gen.form_data]);
  const address = [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ') || gen.loc;

  const set = <K extends keyof ChecklistData>(k: K, v: ChecklistData[K]) => setData(d => ({ ...d, [k]: v }));
  const setLoad = (i: number, patch: Partial<LoadRow>) =>
    setData(d => ({ ...d, loads: { ...d.loads, [i]: { ...d.loads[i], ...patch } } }));

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
    if (!printRef.current) return;
    setExporting(true);
    try {
      await save(true);
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const canvas = await html2canvas(printRef.current, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true });
      const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = canvas.height * (pageW / canvas.width);
      const imgData = canvas.toDataURL('image/png');
      let heightLeft = imgH, position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH);
        heightLeft -= pageH;
      }
      const fd = new FormData();
      fd.append('file', pdf.output('blob'), `Site Visit Checklist - ${gen.customer}.pdf`);
      fd.append('linked_id', gen.id);
      fd.append('linked_name', gen.customer);
      fd.append('div', 'gen');
      fd.append('category', 'site_checklist');
      fd.append('display_name', `Site Visit Checklist — ${gen.customer}`);
      await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      showToast({ title: 'Checklist finalized', sub: 'PDF attached to this job' });
    } catch {
      showToast({ title: 'Export failed', sub: 'Try again' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ marginTop: 4 }}>
      <div ref={printRef} style={{ background: '#fff', color: INK, padding: 14, borderRadius: 10, border: '1px solid var(--border2)' }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, color: HEAD, fontSize: 14 }}>ACCURATE POWER &amp; TECHNOLOGY, INC.</div>
          <div style={{ fontSize: 10.5, color: MUTED }}>Site Visit Checklist</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12, fontSize: 12.5 }}>
          <div><b>Name:</b> {gen.customer}</div>
          <div><b>Gen Size / Brand:</b> {gen.mfr} {gen.model}</div>
          <div><b>Proposal No.:</b> {gen.proposal_no || '—'}</div>
          <div><b>Date:</b> {new Date().toLocaleDateString()}</div>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          <Field label="AC Unit Size"><input style={inputStyle} value={data.acSize} onChange={e => set('acSize', e.target.value)}/></Field>
          <Field label="LRA"><input style={inputStyle} value={data.lra} onChange={e => set('lra', e.target.value)}/></Field>
          <Field label="Air Handler (Heat Strips)"><ToggleGroup options={['Electric', 'Gas']} value={data.airHandler} onChange={v => set('airHandler', v)}/></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Field label="Gas Type"><ToggleGroup options={['LP', 'NG']} value={data.gasType} onChange={v => set('gasType', v)}/></Field>
          <Field label="Tank Size / Qty"><input style={inputStyle} value={data.tankSize} onChange={e => set('tankSize', e.target.value)}/></Field>
          <Field label="Tank Type"><ToggleGroup options={['AG', 'UG']} value={data.tankType} onChange={v => set('tankType', v)}/></Field>
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
                    <td style={{ padding: '4px 6px' }}>{row.fuel ? <ToggleGroup options={['Electric', 'Gas']} value={lv.fuel || ''} onChange={v => setLoad(i, { fuel: v as LoadRow['fuel'] })}/> : <span style={{ color: '#c2ccd6' }}>—</span>}</td>
                    <td style={{ padding: '4px 6px' }}>{row.volt ? <ToggleGroup options={['120V', '240V']} value={lv.volt || ''} onChange={v => setLoad(i, { volt: v as LoadRow['volt'] })}/> : <span style={{ color: '#c2ccd6' }}>—</span>}</td>
                    <td style={{ padding: '4px 6px' }}>{row.hp ? <input style={miniStyle} value={lv.hp || ''} onChange={e => setLoad(i, { hp: e.target.value })}/> : <span style={{ color: '#c2ccd6' }}>—</span>}</td>
                    <td style={{ padding: '4px 6px' }}>{row.amps ? <input style={miniStyle} value={lv.amps || ''} onChange={e => setLoad(i, { amps: e.target.value })}/> : <span style={{ color: '#c2ccd6' }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        <button className="btn amber" style={{ flex: 1, justifyContent: 'center' }} disabled={exporting} onClick={finalize}>
          {exporting ? 'Exporting…' : 'Finalize / Export PDF'}
        </button>
      </div>
    </div>
  );
}
