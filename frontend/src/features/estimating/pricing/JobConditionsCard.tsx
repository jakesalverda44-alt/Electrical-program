// UI cleanup round 2B — the "Job conditions" card: the labor-factor chips (one pick
// per group) and Floors above 2. These are a property of the takeoff, not of the
// pricing engine, so the card renders in both pricing modes.
import React, { useId, useMemo } from 'react';
import { DEFAULT_SETTINGS, type EstimateSettings, type Library, type LibraryFactor } from '../types';
import { PricingCard } from './PricingCard';
import { factorGroupLabel, jobConditionsSummary, numberOrDefault } from './laborPricingModel';

export interface JobConditionsCardProps {
  library: Library | undefined;
  settings: EstimateSettings;
  setSettings: (updater: EstimateSettings | ((prev: EstimateSettings) => EstimateSettings)) => void;
  mode: 'phase_a' | 'accubid';
}

export function JobConditionsCard({ library, settings, setSettings, mode }: JobConditionsCardProps) {
  const baseId = useId();
  const factorsByGroup = useMemo(() => {
    const groups = new Map<string, LibraryFactor[]>();
    for (const f of library?.factors ?? []) {
      if (!f.active) continue;
      if (!groups.has(f.group_key)) groups.set(f.group_key, []);
      groups.get(f.group_key)!.push(f);
    }
    return Array.from(groups.entries());
  }, [library]);

  const toggleFactor = (factor: LibraryFactor, group: LibraryFactor[]) => {
    setSettings(prev => {
      const withoutGroup = prev.factor_ids.filter(id => !group.some(f => f.id === id));
      const isSelected = prev.factor_ids.includes(factor.id);
      return { ...prev, factor_ids: isSelected ? withoutGroup : [...withoutGroup, factor.id] };
    });
  };

  // A factor still on the bid but retired from the library keeps applying server-side, so say so.
  const retired = (library?.factors ?? []).filter(f => !f.active && settings.factor_ids.includes(f.id));

  return (
    <PricingCard
      storageKey="est-lp-conditions-open" defaultOpen title="Job conditions" testId="lp-conditions"
      summary={jobConditionsSummary(settings.factor_ids, library?.factors, settings.floors_above_2, mode)}
    >
      <p className="lp-hint">
        Pick at most one in each row. {mode === 'accubid' ? 'In Accubid pricing they multiply together (compound).' : 'Each one adds to the labor hours.'}
      </p>
      {factorsByGroup.length > 0 && (
        <div className="lp-cond-groups" data-testid="lp-factor-chips">
          {factorsByGroup.map(([group, factors]) => {
            const labelId = `${baseId}-${group}`;
            return (
              <div key={group} className="lp-cond-group" role="group" aria-labelledby={labelId}>
                <span id={labelId} className="lp-cond-group-label">{factorGroupLabel(group)}</span>
                {factors.map(f => {
                  const selected = settings.factor_ids.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className={`lp-factor-chip${selected ? ' lp-factor-chip-active' : ''}`}
                      aria-pressed={selected}
                      onClick={() => toggleFactor(f, factors)}
                      data-testid={`lp-factor-${f.code}`}
                    >
                      {f.label} (+{f.pct}%)
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {retired.map(f => (
        <div key={f.id} className="lp-hint" data-testid="lp-factor-retired">
          Also applied: {f.label} (+{f.pct}%) — no longer offered in the library.
        </div>
      ))}
      <div className="lp-settings-row">
        <label className="lp-settings-field" title="Multiplies the MULTI-STORY labor factor below — 0 means no multi-story adjustment even if that factor is selected.">
          Floors above 2
          <input type="number" min={0} value={settings.floors_above_2} data-testid="lp-floors-above-2"
            onChange={e => { const v = numberOrDefault(e.target.value, DEFAULT_SETTINGS.floors_above_2); setSettings(prev => ({ ...prev, floors_above_2: v })); }} />
        </label>
        <span className="lp-hint">Only used by the Multi-story factor.</span>
      </div>
    </PricingCard>
  );
}
