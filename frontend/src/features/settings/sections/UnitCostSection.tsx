import React, { useState, useEffect } from 'react';
import api from '../../../api/client';
import { Field, SectionTitle, SaveBar, inputStyle } from '../shared';
import { PROJECT_TYPES } from '../../preconstruction/constants';

const CATEGORIES = [
  'Service & Distribution',
  'Interior Lighting',
  'Exterior Site Lighting',
  'Lighting Controls',
  'Branch Power',
  'Site Underground Allowances',
  'Low Voltage',
  'Grounding',
];

interface CostLib {
  global: Record<string, number>;
  by_project_type: Record<string, Record<string, number>>;
}

const empty = (): CostLib => ({ global: {}, by_project_type: {} });

export function UnitCostSection() {
  const [lib, setLib]       = useState<CostLib>(empty());
  const [orig, setOrig]     = useState<CostLib>(empty());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.get('/estimates/unit-costs').then(r => {
      const data = r.data as CostLib;
      setLib(data);
      setOrig(JSON.parse(JSON.stringify(data)));
    }).catch(() => {});
  }, []);

  const setGlobal = (cat: string, val: string) => {
    const n = val === '' ? 0 : Number(val);
    setLib(prev => ({ ...prev, global: { ...prev.global, [cat]: n } }));
  };

  const setByType = (type: string, cat: string, val: string) => {
    const n = val === '' ? 0 : Number(val);
    setLib(prev => ({
      ...prev,
      by_project_type: {
        ...prev.by_project_type,
        [type]: { ...(prev.by_project_type[type] ?? {}), [cat]: n },
      },
    }));
  };

  const clearByType = (type: string, cat: string) => {
    setLib(prev => {
      const updated = { ...(prev.by_project_type[type] ?? {}) };
      delete updated[cat];
      return { ...prev, by_project_type: { ...prev.by_project_type, [type]: updated } };
    });
  };

  const hasChanges = JSON.stringify(lib) !== JSON.stringify(orig);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/estimates/unit-costs', lib);
      setOrig(JSON.parse(JSON.stringify(lib)));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const toggleType = (val: string) => setExpanded(p => ({ ...p, [val]: !p[val] }));

  return (
    <div>
      <SectionTitle
        title="Unit Cost Library"
        sub="Blended $/unit rates (material + labor) used to price AI takeoff quantities. Set global defaults and override per project type."
      />

      <Field label="Global Rates (all project types)" desc="Applied when no project-type override is set.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text3)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>Category</th>
              <th style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', padding: '4px 8px', borderBottom: '1px solid var(--border)', width: 120 }}>$/Unit</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map(cat => (
              <tr key={cat}>
                <td style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>{cat}</td>
                <td style={{ padding: '4px 0 4px 8px', borderBottom: '1px solid var(--border)' }}>
                  <input
                    type="number"
                    min={0}
                    style={{ ...inputStyle, textAlign: 'right', width: 110 }}
                    value={lib.global[cat] ?? ''}
                    onChange={e => setGlobal(cat, e.target.value)}
                    placeholder="0"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Field>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Project-Type Overrides</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>
          Override specific categories for each project type. Leave blank to use global rate.
        </div>
        {PROJECT_TYPES.map(pt => {
          const overrides = lib.by_project_type[pt.value] ?? {};
          const overrideCount = Object.keys(overrides).filter(k => overrides[k] !== undefined).length;
          return (
            <div key={pt.value} style={{ border: '1px solid var(--border)', borderRadius: 9, marginBottom: 8, overflow: 'hidden' }}>
              <button
                onClick={() => toggleType(pt.value)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface2)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}
              >
                <span>{pt.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)' }}>
                  {overrideCount > 0 ? `${overrideCount} override${overrideCount > 1 ? 's' : ''}` : 'No overrides'}
                  {' '}
                  {expanded[pt.value] ? '▲' : '▼'}
                </span>
              </button>
              {expanded[pt.value] && (
                <div style={{ padding: '12px 14px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text3)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>Category</th>
                        <th style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', padding: '4px 8px', borderBottom: '1px solid var(--border)', width: 120 }}>$/Unit Override</th>
                        <th style={{ width: 60, borderBottom: '1px solid var(--border)' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {CATEGORIES.map(cat => {
                        const hasOverride = cat in overrides;
                        return (
                          <tr key={cat}>
                            <td style={{ fontSize: 13, fontWeight: 600, color: hasOverride ? 'var(--text)' : 'var(--text3)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                              {cat}
                              {!hasOverride && <span style={{ fontSize: 11, marginLeft: 6 }}>(global: {lib.global[cat] ?? 0})</span>}
                            </td>
                            <td style={{ padding: '4px 0 4px 8px', borderBottom: '1px solid var(--border)' }}>
                              <input
                                type="number"
                                min={0}
                                style={{ ...inputStyle, textAlign: 'right', width: 110 }}
                                value={overrides[cat] ?? ''}
                                placeholder={String(lib.global[cat] ?? 0)}
                                onChange={e => setByType(pt.value, cat, e.target.value)}
                              />
                            </td>
                            <td style={{ padding: '4px 0 4px 4px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                              {hasOverride && (
                                <button
                                  onClick={() => clearByType(pt.value, cat)}
                                  style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                                  title="Clear override (use global)"
                                >✕</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges} />
    </div>
  );
}
