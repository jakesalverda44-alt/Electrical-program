import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';

export function AISection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const keys = ['ai_anthropic_key','ai_model','ai_max_tokens','ai_temperature'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? ''])));
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    const fresh = Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  const hasChanges = keys.some(k => vals[k] !== orig[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings', vals); setOrig(vals); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  const MODEL_OPTIONS = [
    'claude-sonnet-4-6',
    'claude-opus-4-8',
    'claude-haiku-4-5-20251001',
  ];
  const models = vals.ai_model && !MODEL_OPTIONS.includes(vals.ai_model)
    ? [vals.ai_model, ...MODEL_OPTIONS]
    : MODEL_OPTIONS;

  return (
    <div>
      <SectionTitle title="AI Configuration" sub="Settings for the Anthropic Claude AI used in plan analysis and proposal generation."/>

      <div style={{ background: 'var(--amber-soft)', border: '1px solid rgba(224,165,59,.3)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--amber)', lineHeight: 1.6 }}>
        <strong>⚠️ Security Note:</strong> Do not add your Anthropic API key until you are in the final testing phase. The system operates without it — AI features will return a graceful "unavailable" response until the key is set.
      </div>

      <Field label="Anthropic API Key" desc="Your key from console.anthropic.com. Leave blank until ready for testing.">
        <input type="password" style={inputStyle} value={vals.ai_anthropic_key} onChange={set('ai_anthropic_key')} placeholder="sk-ant-••••••••••"/>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <Field label="Model">
          <select style={{ ...inputStyle, appearance: 'none' }} value={vals.ai_model} onChange={set('ai_model')}>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Max Tokens">
          <input type="number" style={inputStyle} value={vals.ai_max_tokens} onChange={set('ai_max_tokens')} min={256} max={8192}/>
        </Field>
        <Field label="Temperature (0–1)">
          <input type="number" style={inputStyle} value={vals.ai_temperature} onChange={set('ai_temperature')} min={0} max={1} step={0.1}/>
        </Field>
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}
