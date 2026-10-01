// UI cleanup round 2B — the Quick-pricing "Rates & markups" card: the labor rate,
// crew size and the six markup percentages. Same inputs, labels and handlers as
// before; they just live in a foldable card now.
import React from 'react';
import { DEFAULT_SETTINGS, type EstimateSettings } from '../types';
import { PricingCard } from './PricingCard';
import { numberOrDefault, ratesSummary } from './laborPricingModel';

const SETTINGS_PCT_FIELDS: { key: keyof EstimateSettings; label: string }[] = [
  { key: 'material_tax_pct', label: 'Material tax %' },
  { key: 'consumables_pct', label: 'Consumables %' },
  { key: 'small_tools_pct', label: 'Small tools %' },
  { key: 'supervision_pct', label: 'Supervision %' },
  { key: 'overhead_pct', label: 'Overhead %' },
  { key: 'profit_pct', label: 'Profit %' },
];

export interface QuickRatesCardProps {
  settings: EstimateSettings;
  setSettings: (updater: EstimateSettings | ((prev: EstimateSettings) => EstimateSettings)) => void;
}

export function QuickRatesCard({ settings, setSettings }: QuickRatesCardProps) {
  return (
    <PricingCard storageKey="est-lp-rates-open" defaultOpen title="Rates & markups" testId="lp-rates" summary={ratesSummary(settings)}>
      <fieldset className="lp-rate-group">
        <legend>Labor</legend>
        <div className="lp-settings-row">
          <label className="lp-settings-field">
            Labor rate ($/hr)
            <input type="number" value={settings.labor_rate}
              onChange={e => { const v = numberOrDefault(e.target.value, DEFAULT_SETTINGS.labor_rate); setSettings(prev => ({ ...prev, labor_rate: v })); }} />
          </label>
          <label className="lp-settings-field">
            Crew size
            <input type="number" value={settings.crew_size}
              onChange={e => { const v = numberOrDefault(e.target.value, DEFAULT_SETTINGS.crew_size); setSettings(prev => ({ ...prev, crew_size: v })); }} />
          </label>
        </div>
      </fieldset>
      <fieldset className="lp-rate-group">
        <legend>Markups</legend>
        <div className="lp-settings-row">
          {SETTINGS_PCT_FIELDS.map(f => (
            <label className="lp-settings-field" key={f.key}>
              {f.label}
              <input type="number" value={settings[f.key] as number}
                onChange={e => { const v = numberOrDefault(e.target.value, DEFAULT_SETTINGS[f.key] as number); setSettings(prev => ({ ...prev, [f.key]: v })); }} />
            </label>
          ))}
        </div>
      </fieldset>
    </PricingCard>
  );
}
