import React, { useState, useEffect } from 'react';
import api from '../../../api/client';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, inputStyle } from '../shared';
import { moneyFull } from '../../../lib/money';

export function CommissionsSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [rate, setRate] = useState(settings.commission_default_rate ?? '3');
  const [goal, setGoal] = useState(settings.sales_goal_monthly ?? '');
  const [orig, setOrig] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const snapshot = (r: string, g: string) => `${r}|${g}`;

  useEffect(() => {
    const r = settings.commission_default_rate ?? '3';
    const g = settings.sales_goal_monthly ?? '';
    setRate(r); setGoal(g); setOrig(snapshot(r, g));
  }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', { commission_default_rate: rate, sales_goal_monthly: goal });
      setOrig(snapshot(rate, goal)); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  return (
    <div>
      <SectionTitle title="Commissions & Goals" sub="Sales commission is a flat percentage of contract value, earned when a proposal is awarded or signed." />

      <Field label="Commission Rate (%)" desc="Applied to the contract value of each won job. Changing this affects new awards going forward; existing commissions are not recalculated.">
        <input type="number" step="0.1" min={0} max={100} style={{ ...inputStyle, maxWidth: 200 }}
          value={rate} onChange={e => setRate(e.target.value)} />
      </Field>

      <Field label="Monthly Sales Goal ($)" desc="Company-wide target for won jobs per month. The Sales Dashboard shows progress against it. Leave empty to hide goal tracking.">
        <input type="number" step="1000" min={0} style={{ ...inputStyle, maxWidth: 200 }}
          placeholder="e.g. 150000"
          value={goal} onChange={e => setGoal(e.target.value)} />
      </Field>

      <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', maxWidth: 520 }}>
        Example: a <b>{moneyFull(100000)}</b> contract at <b>{Number(rate) || 0}%</b> earns a commission of{' '}
        <b>{moneyFull(100000 * (Number(rate) || 0) / 100)}</b>.
        Mark commissions paid from the <b>Sales by Rep</b> page.
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={snapshot(rate, goal) !== orig} />
    </div>
  );
}
