// Remodel + footage round — Settings > Labor Library > Allowances: the
// editable numbers behind the footage allowance (B2, app_settings
// est_footage_ratios) and the default Equipment / General Expenses lines
// (B4, est_cost_line_defaults) — each one JSON setting, shown as plain
// number fields. The
// server merges whatever is saved over its own defaults, field by field,
// so a blank or bad field falls back instead of pricing NaN.
import React, { useEffect, useState } from 'react';
import api from '../../../api/client';
import { useMutation } from '../../../hooks/useMutation';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SaveBar, inputStyle } from '../shared';

export interface JsonNumberField {
  /** Dot path into the JSON object, e.g. "emtPerPoint.device". */
  path: string;
  label: string;
  desc?: string;
  /** Shown ×100 and saved ÷100 (a 0-1 share edited as a %). */
  percent?: boolean;
}

type Json = Record<string, unknown>;

function getPath(o: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, k) => (cur && typeof cur === 'object' ? (cur as Json)[k] : undefined), o);
}

function setPath(o: Json, path: string, value: unknown): Json {
  const [head, ...rest] = path.split('.');
  if (!rest.length) return { ...o, [head]: value };
  const child = (o[head] && typeof o[head] === 'object' ? o[head] : {}) as Json;
  return { ...o, [head]: setPath(child, rest.join('.'), value) };
}

export function parseJsonSetting(raw: string | undefined, defaults: Json): Json {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') {
      let merged = defaults;
      const walk = (obj: Json, prefix: string) => {
        for (const [k, v] of Object.entries(obj)) {
          const p = prefix ? `${prefix}.${k}` : k;
          if (v && typeof v === 'object' && !Array.isArray(v)) walk(v as Json, p);
          else merged = setPath(merged, p, v);
        }
      };
      walk(parsed as Json, '');
      return merged;
    }
  } catch { /* fall back to defaults */ }
  return defaults;
}

function display(v: unknown, percent?: boolean): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return String(percent ? Math.round(n * 10000) / 100 : n);
}

export function JsonNumberSettingPanel({ settingKey, defaults, fields, intro, settings, onSaved, testId }: {
  settingKey: keyof AppSettings;
  defaults: Json;
  fields: JsonNumberField[];
  intro: React.ReactNode;
  settings: AppSettings;
  onSaved: () => void;
  testId: string;
}) {
  const [base, setBase] = useState<Json>(defaults);
  const [values, setValues] = useState<Record<string, string>>({});
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const merged = parseJsonSetting(settings[settingKey] as string | undefined, defaults);
    setBase(merged);
    const next: Record<string, string> = {};
    for (const f of fields) next[f.path] = display(getPath(merged, f.path), f.percent);
    setValues(next);
    setOrig(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, settingKey]);

  const { run: save, saving } = useMutation(
    async () => {
      let out = base;
      for (const f of fields) {
        const n = Number(values[f.path]);
        if (values[f.path] === '' || !Number.isFinite(n) || n < 0) continue; // keep the current value
        out = setPath(out, f.path, f.percent ? n / 100 : n);
      }
      await api.put('/settings', { [settingKey]: JSON.stringify(out) });
    },
    { onSuccess: () => { setOrig(values); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }, errorTitle: 'Could not save' },
  );

  return (
    <div data-testid={testId} style={{ marginTop: 28 }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14, maxWidth: 560, lineHeight: 1.5 }}>{intro}</div>
      {fields.map(f => (
        <Field label={f.label} desc={f.desc} key={f.path}>
          <input type="number" min={0} step="any" style={{ ...inputStyle, maxWidth: 200 }} value={values[f.path] ?? ''}
            data-testid={`${testId}-${f.path}`}
            onChange={e => setValues(prev => ({ ...prev, [f.path]: e.target.value }))} />
        </Field>
      ))}
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={JSON.stringify(values) !== JSON.stringify(orig)} />
    </div>
  );
}

// ── B2: footage allowance ratios ────────────────────────────────────────────

/** Mirrors backend estimating/footageAllowance.ts DEFAULT_FOOTAGE_SETTINGS. */
export const FOOTAGE_DEFAULTS: Json = {
  version: 1,
  emtPerPoint: { fixture: 6.6, device: 6.6, equipment: 6.6 },
  mcPerFixture: 7.89,
  wirePerConduitFt: 5.54,
  baseConductors: 3,
  wire10Share: 0.47,
  pvcSitePerPole: 130,
  v2DisagreePct: 40,
  pointsPerCircuit: 8,
};

const FOOTAGE_FIELDS: JsonNumberField[] = [
  { path: 'emtPerPoint.fixture', label: 'Branch EMT per fixture (ft)' },
  { path: 'emtPerPoint.device', label: 'Branch EMT per device (ft)', desc: 'Receptacles, switches, sensors.' },
  { path: 'emtPerPoint.equipment', label: 'Branch EMT per equipment connection (ft)' },
  { path: 'wirePerConduitFt', label: 'Wire ft per conduit ft', desc: "#12/#10 conductor-feet per foot of branch EMT at 3-wire circuits (Chris's jobs share homeruns, so it's more than 3)." },
  { path: 'wire10Share', label: 'Share of branch wire carried as #10 (%)', percent: true },
  { path: 'mcPerFixture', label: 'MC whip per fixture (ft)' },
  { path: 'pvcSitePerPole', label: 'Site PVC per site pole (ft)', desc: 'Only two calibration jobs had poles — low confidence.' },
  { path: 'v2DisagreePct', label: 'Geometry vs ratio: flag above (%)', desc: 'When the plan-geometry estimate and the ratio disagree by more than this, the larger is used and the line says so.' },
];

export function FootageRatiosPanel({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  return (
    <JsonNumberSettingPanel
      settingKey="est_footage_ratios" defaults={FOOTAGE_DEFAULTS} fields={FOOTAGE_FIELDS} settings={settings} onSaved={onSaved}
      testId="footage-ratios"
      intro={<><b>Footage allowance.</b> Every analysis adds branch conduit/wire/MC lines from the counted devices and fixtures using these ratios — calibrated on 5 of Chris&apos;s jobs (leave-one-out error about ±35% on EMT). A measured run on the plans, or a qty you type, always replaces the allowance.</>}
    />
  );
}

// ── B4: default Equipment / General Expenses lines ─────────────────────────

/** Mirrors backend estimating/costLineDefaults.ts DEFAULT_COST_LINE_DEFAULTS. */
export const COST_LINE_DEFAULTS: Json = {
  version: 1,
  equipment: { smallJobMaxHours: 0, smallJobAmount: 0, perHour: 4.03, minimum: 890 },
  generalExpenses: { smallJobMaxHours: 300, smallJobAmount: 290, perHour: 0, minimum: 3060 },
};

const COST_LINE_FIELDS: JsonNumberField[] = [
  { path: 'equipment.perHour', label: 'Equipment $ per labor hour' },
  { path: 'equipment.minimum', label: 'Equipment minimum ($)', desc: 'One scissor lift.' },
  { path: 'generalExpenses.smallJobMaxHours', label: 'General expenses: small job up to (hours)' },
  { path: 'generalExpenses.smallJobAmount', label: 'General expenses, small job ($)', desc: 'Permits only.' },
  { path: 'generalExpenses.minimum', label: 'General expenses, larger job ($)', desc: 'Permits + temporary power and lighting.' },
];

export function CostLineDefaultsPanel({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  return (
    <JsonNumberSettingPanel
      settingKey="est_cost_line_defaults" defaults={COST_LINE_DEFAULTS} fields={COST_LINE_FIELDS} settings={settings} onSaved={onSaved}
      testId="cost-line-defaults"
      intro={<><b>Equipment &amp; general expenses.</b> A bid with labor hours and no line of its own gets one default of each, fitted to Chris&apos;s ten breakdowns. It follows the hours until you edit it; an edited or deleted default is never touched again.</>}
    />
  );
}
