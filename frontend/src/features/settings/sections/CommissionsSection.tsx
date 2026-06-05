import React, { useState, useEffect } from 'react';
import api from '../../../api/client';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, inputStyle } from '../shared';

export function CommissionsSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [rate, setRate] = useState(settings.commission_default_rate ?? '3');
  const [orig, setOrig] = useState(settings.commission_default_rate ?? '3');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRate(settings.commission_default_rate ?? '3');
    setOrig(settings.commission_default_rate ?? '3');
  }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', { commission_default_rate: rate });
      setOrig(rate); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  return (
    <div>
      <SectionTitle title="Commissions" sub="Sales commission is a flat percentage of contract value, earned when a proposal is awarded or signed." />

      <Field label="Commission Rate (%)" desc="Applied to the contract value of each won job. Changing this affects new awards going forward; existing commissions are not recalculated.">
        <input type="number" step="0.1" min={0} max={100} style={{ ...inputStyle, maxWidth: 200 }}
          value={rate} onChange={e => setRate(e.target.value)} />
      </Field>

      <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', maxWidth: 520 }}>
        Example: a <b>$100,000</b> contract at <b>{Number(rate) || 0}%</b> earns a commission of{' '}
        <b>${(Math.round(100000 * (Number(rate) || 0)) / 100).toLocaleString()}</b>.
        Mark commissions paid from the <b>Sales by Rep</b> page.
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={rate !== orig} />
    </div>
  );
}
