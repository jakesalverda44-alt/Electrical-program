import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';

const AI_PERM_COLS: { key: string; label: string; desc: string }[] = [
  { key: 'run_analysis',    label: 'Run Analysis',    desc: 'Trigger the AI plan analysis pipeline' },
  { key: 'view_results',   label: 'View Results',    desc: 'Read analysis output and reports' },
  { key: 'manage_settings',label: 'Manage Settings', desc: 'Edit AI keys, model, temperature' },
];

const DEFAULT_ROLE_MATRIX: Record<string, Record<string, boolean>> = {
  owner:           { run_analysis: true,  manage_settings: true,  view_results: true  },
  administrator:   { run_analysis: true,  manage_settings: true,  view_results: true  },
  estimator:       { run_analysis: true,  manage_settings: false, view_results: true  },
  sales_manager:   { run_analysis: false, manage_settings: false, view_results: true  },
  salesperson:     { run_analysis: false, manage_settings: false, view_results: false },
  project_manager: { run_analysis: false, manage_settings: false, view_results: true  },
  technician:      { run_analysis: false, manage_settings: false, view_results: false },
  accounting:      { run_analysis: false, manage_settings: false, view_results: false },
  read_only:       { run_analysis: false, manage_settings: false, view_results: false },
};

interface AIUsageRow { id: string; name: string; role: string; count: number }

export function AIPermissionsSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const parseMatrix = (): Record<string, Record<string, boolean>> => {
    try {
      const stored = settings.ai_role_permissions ? JSON.parse(settings.ai_role_permissions) : {};
      return { ...DEFAULT_ROLE_MATRIX, ...stored };
    } catch { return { ...DEFAULT_ROLE_MATRIX }; }
  };

  const [matrix,    setMatrix]   = useState<Record<string, Record<string, boolean>>>(parseMatrix);
  const [origMatrix, setOrigMatrix] = useState(JSON.stringify(parseMatrix()));
  const [aiEnabled, setAiEnabled] = useState(settings.ai_enabled !== 'false');
  const [analysisEnabled, setAnalysisEnabled] = useState(settings.ai_analysis_enabled !== 'false');
  const [dailyLimit, setDailyLimit] = useState(settings.ai_daily_limit_per_user || '10');
  const [origEnabled, setOrigEnabled] = useState(settings.ai_enabled !== 'false');
  const [origAnalysis, setOrigAnalysis] = useState(settings.ai_analysis_enabled !== 'false');
  const [origLimit, setOrigLimit] = useState(settings.ai_daily_limit_per_user || '10');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [users,  setUsers]  = useState<User[]>([]);
  const [usage,  setUsage]  = useState<AIUsageRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Record<string, boolean> | null>>({});
  const [overrideSaving, setOverrideSaving] = useState<string | null>(null);

  useEffect(() => {
    const m = parseMatrix();
    setMatrix(m); setOrigMatrix(JSON.stringify(m));
    const en = settings.ai_enabled !== 'false';
    const an = settings.ai_analysis_enabled !== 'false';
    const lim = settings.ai_daily_limit_per_user || '10';
    setAiEnabled(en); setOrigEnabled(en);
    setAnalysisEnabled(an); setOrigAnalysis(an);
    setDailyLimit(lim); setOrigLimit(lim);
  }, [settings]);

  useEffect(() => {
    api.get('/users').then(r => {
      const active = (r.data as User[]).filter(u => u.status !== 'inactive');
      setUsers(active);
      const ov: Record<string, Record<string, boolean> | null> = {};
      active.forEach(u => { ov[u.id] = (u as any).ai_override ?? null; });
      setOverrides(ov);
    }).catch(() => {});
    api.get('/ai/usage/today').then(r => setUsage(r.data)).catch(() => {});
  }, []);

  const toggleMatrix = (role: string, perm: string) => {
    setMatrix(prev => ({ ...prev, [role]: { ...prev[role], [perm]: !prev[role]?.[perm] } }));
  };

  const hasChanges = JSON.stringify(matrix) !== origMatrix ||
    aiEnabled !== origEnabled || analysisEnabled !== origAnalysis || dailyLimit !== origLimit;

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        ai_enabled: aiEnabled ? 'true' : 'false',
        ai_analysis_enabled: analysisEnabled ? 'true' : 'false',
        ai_daily_limit_per_user: dailyLimit,
        ai_role_permissions: JSON.stringify(matrix),
      });
      setOrigMatrix(JSON.stringify(matrix));
      setOrigEnabled(aiEnabled); setOrigAnalysis(analysisEnabled); setOrigLimit(dailyLimit);
      onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  const setUserOverride = async (userId: string, key: string, value: boolean | null) => {
    const current = overrides[userId] ?? {};
    const next = value === null ? { ...current } : { ...current, [key]: value };
    if (value === null) delete next[key];
    const payload = Object.keys(next).length === 0 ? null : next;
    setOverrideSaving(userId + key);
    try {
      await api.put(`/users/${userId}/ai-override`, payload);
      setOverrides(prev => ({ ...prev, [userId]: payload }));
    } finally { setOverrideSaving(null); }
  };

  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div>
      <SectionTitle title="AI Permissions" sub="Control who can use AI features, set limits, and manage emergency kill switches."/>

      {/* Kill Switches */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Emergency Controls
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            {
              label: 'AI Features Master Switch',
              desc: 'Instantly disables ALL AI features for every user. Takes effect on the next request.',
              value: aiEnabled, set: setAiEnabled, danger: !aiEnabled,
            },
            {
              label: 'Plan Analysis',
              desc: 'Disables the estimating plan analysis pipeline only. Other AI features unaffected.',
              value: analysisEnabled, set: setAnalysisEnabled, danger: !analysisEnabled,
            },
          ].map(item => (
            <div key={item.label} style={{ border: `1px solid ${item.danger ? 'rgba(224,106,106,.35)' : 'var(--border)'}`, borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: item.danger ? 'rgba(224,106,106,.10)' : 'var(--surface)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: item.danger ? 'var(--red)' : 'var(--text)', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: item.danger ? 'var(--red)' : 'var(--text3)', opacity: item.danger ? .8 : 1 }}>{item.desc}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: item.value ? 'var(--green)' : 'var(--red)', textTransform: 'uppercase' }}>
                  {item.value ? 'ON' : 'OFF'}
                </span>
                <button onClick={() => item.set(!item.value)}
                  style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', transition: 'background .2s',
                    background: item.value ? 'var(--accent)' : '#EF4444', position: 'relative', flexShrink: 0 }}>
                  <span style={{ position: 'absolute', top: 3, left: item.value ? 22 : 3, width: 18, height: 18,
                    borderRadius: '50%', background: '#fff', transition: 'left .2s', display: 'block' }}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Daily Limit */}
      <div style={{ marginBottom: 28 }}>
        <Field label="Daily Analysis Limit per User" desc="Maximum number of AI plan analyses a single user can run per calendar day. Set to 0 for unlimited.">
          <input type="number" min={0} max={999} value={dailyLimit} onChange={e => setDailyLimit(e.target.value)}
            style={{ ...inputStyle, maxWidth: 140 }}/>
        </Field>
      </div>

      {/* Role Permission Matrix */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Role Permissions
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Role</th>
                {AI_PERM_COLS.map(col => (
                  <th key={col.key} style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 700, color: 'var(--text3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLE_OPTIONS.map((role, i) => (
                <tr key={role} style={{ borderBottom: i < ROLE_OPTIONS.length - 1 ? '1px solid var(--border)' : 'none', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <RolePill role={role}/>
                  </td>
                  {AI_PERM_COLS.map(col => {
                    const checked = matrix[role]?.[col.key] ?? false;
                    return (
                      <td key={col.key} style={{ textAlign: 'center', padding: '12px 14px' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMatrix(role, col.key)}
                          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}/>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
          {AI_PERM_COLS.map(col => (
            <span key={col.key} style={{ marginRight: 16 }}>
              <strong>{col.label}:</strong> {col.desc}
            </span>
          ))}
        </div>
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>

      {/* Per-User Overrides */}
      {users.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Per-User Overrides
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
            Override individual users beyond their role defaults. Leave unchecked/checked to inherit role settings, or explicitly set here to override.
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>User</th>
                  <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Role</th>
                  {AI_PERM_COLS.map(col => (
                    <th key={col.key} style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 700, color: 'var(--text3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {col.label}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Suspended</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const ov = overrides[u.id] ?? null;
                  const isSuspended = ov?.suspended === true;
                  return (
                    <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none', background: isSuspended ? 'rgba(224,106,106,.10)' : i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)', opacity: overrideSaving?.startsWith(u.id) ? 0.6 : 1 }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                            {initials(u.name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{u.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}><RolePill role={u.role}/></td>
                      {AI_PERM_COLS.map(col => {
                        const inherited = matrix[u.role]?.[col.key] ?? false;
                        const ovVal = ov !== null && col.key in (ov ?? {}) ? (ov as any)[col.key] as boolean : null;
                        const effective = ovVal !== null ? ovVal : inherited;
                        const hasOverride = ovVal !== null && ovVal !== inherited;
                        return (
                          <td key={col.key} style={{ textAlign: 'center', padding: '12px 14px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                              <input type="checkbox" checked={effective} disabled={isSuspended}
                                onChange={() => setUserOverride(u.id, col.key, !effective)}
                                style={{ width: 16, height: 16, cursor: isSuspended ? 'not-allowed' : 'pointer', accentColor: 'var(--accent)', opacity: isSuspended ? 0.4 : 1 }}/>
                              {hasOverride && (
                                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.03em' }}>override</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'center', padding: '12px 14px' }}>
                        <button onClick={() => setUserOverride(u.id, 'suspended', isSuspended ? null : true)}
                          style={{ width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'background .2s',
                            background: isSuspended ? '#EF4444' : 'var(--border2)', position: 'relative' }}>
                          <span style={{ position: 'absolute', top: 2, left: isSuspended ? 18 : 2, width: 16, height: 16,
                            borderRadius: '50%', background: '#fff', transition: 'left .2s', display: 'block' }}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Usage Today */}
      {usage.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            AI Usage Today — {today}
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {usage.filter(r => r.count > 0).length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No AI analyses run today.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>User</th>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Role</th>
                    <th style={{ textAlign: 'center', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Analyses</th>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Limit</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.filter(r => r.count > 0).map((row, i, arr) => {
                    const pct = Math.min(100, (row.count / (parseInt(dailyLimit) || 10)) * 100);
                    return (
                      <tr key={row.id} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text)' }}>{row.name}</td>
                        <td style={{ padding: '12px 16px' }}><RolePill role={row.role}/></td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <span style={{ fontWeight: 800, color: pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--text)' }}>{row.count}</span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: 'var(--border2)', borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#EF4444' : pct >= 80 ? '#F59E0B' : 'var(--accent)', borderRadius: 3, transition: 'width .3s' }}/>
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{row.count} / {dailyLimit}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
