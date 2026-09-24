// Takeoff accuracy, Task 8 — Settings → Account Rules (admin edit).
//
// Each rule: who it matches (brand / owner aliases, optional project types),
// and for each kind of material who furnishes and who installs it — a fixed
// answer, or "Ask" (taken from an explicit statement on the drawings, else a
// scope question for the estimator). Plus required scope bullets, forbidden
// phrases and the no-MDP-unless-drawn switch. The Default rule applies when
// nothing matches.
import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { Field, SectionTitle, inputStyle } from '../shared';

type Party = 'APT' | 'GC' | 'Owner' | 'Vendor' | 'Others';
const PARTIES: Party[] = ['APT', 'GC', 'Owner', 'Vendor', 'Others'];
type TermKey = 'lighting' | 'panels' | 'disconnects' | 'power_poles' | 'other_equipment';
const TERMS: Array<{ key: TermKey; label: string }> = [
  { key: 'lighting', label: 'Lighting fixtures' },
  { key: 'panels', label: 'Panelboards' },
  { key: 'disconnects', label: 'Disconnects / safety switches' },
  { key: 'power_poles', label: 'Power poles' },
  { key: 'other_equipment', label: 'Other equipment' },
];
type RuleTerm = { mode: 'fixed'; furnishBy: Party; installBy: Party; vendor?: string; contact?: string } | { mode: 'ask' };

export interface AccountRule {
  id: string;
  name: string;
  isDefault: boolean;
  matchAliases: string[];
  projectTypes: string[];
  priority: number;
  terms: Partial<Record<TermKey, RuleTerm>>;
  requiredScopeBullets: Array<{ section: string; text: string }>;
  forbiddenPhrases: string[];
  noMdpUnlessOnDrawings: boolean;
  notes: string;
  active: boolean;
}

type Draft = Omit<AccountRule, 'id' | 'isDefault' | 'matchAliases' | 'projectTypes' | 'forbiddenPhrases' | 'requiredScopeBullets'> & {
  aliasesText: string; typesText: string; forbiddenText: string; bulletsText: string;
};

function toDraft(r: AccountRule): Draft {
  return {
    name: r.name, priority: r.priority, terms: JSON.parse(JSON.stringify(r.terms)), noMdpUnlessOnDrawings: r.noMdpUnlessOnDrawings,
    notes: r.notes, active: r.active,
    aliasesText: r.matchAliases.join(', '), typesText: r.projectTypes.join(', '),
    forbiddenText: r.forbiddenPhrases.join('\n'),
    bulletsText: r.requiredScopeBullets.map(b => `${b.section}: ${b.text}`).join('\n'),
  };
}

const EMPTY: AccountRule = { id: '', name: '', isDefault: false, matchAliases: [], projectTypes: [], priority: 100, terms: {}, requiredScopeBullets: [], forbiddenPhrases: [], noMdpUnlessOnDrawings: false, notes: '', active: true };

function fromDraft(d: Draft) {
  const list = (s: string, sep: RegExp) => s.split(sep).map(x => x.trim()).filter(Boolean);
  return {
    name: d.name, priority: Number(d.priority), terms: d.terms, noMdpUnlessOnDrawings: d.noMdpUnlessOnDrawings, notes: d.notes, active: d.active,
    matchAliases: list(d.aliasesText, /,/), projectTypes: list(d.typesText, /,/),
    forbiddenPhrases: list(d.forbiddenText, /\n/),
    requiredScopeBullets: list(d.bulletsText, /\n/).map(line => {
      const m = /^([A-Fa-f])\s*[:.)-]\s*(.+)$/.exec(line);
      return m ? { section: m[1].toUpperCase(), text: m[2].trim() } : { section: '', text: line };
    }),
  };
}

function errorOf(err: unknown): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not save the rule';
}

export function AccountRulesSection() {
  const { data, reload } = useApi<{ rules: AccountRule[] }>('/account-rules');
  const rules = useMemo(() => data?.rules ?? [], [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const selected = selectedId === 'new' ? EMPTY : rules.find(r => r.id === selectedId) ?? null;
  useEffect(() => {
    if (!selectedId && rules.length) setSelectedId(rules[0].id);
  }, [rules, selectedId]);
  useEffect(() => {
    setDraft(selected ? toDraft(selected) : null);
    setError(null);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, data]);

  const setTerm = (key: TermKey, t: RuleTerm | undefined) => setDraft(d => {
    if (!d) return d;
    const terms = { ...d.terms };
    if (t) terms[key] = t; else delete terms[key];
    return { ...d, terms };
  });

  const save = async () => {
    if (!draft || !selected) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const body = fromDraft(draft);
      const { data: rule } = selectedId === 'new'
        ? await api.post<AccountRule>('/account-rules', body)
        : await api.put<AccountRule>(`/account-rules/${selected.id}`, body);
      await reload();
      setSelectedId(rule.id);
      setSaved(true);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || selected.isDefault || selectedId === 'new') return;
    if (!window.confirm(`Delete the ${selected.name} account rule?`)) return;
    try {
      await api.delete(`/account-rules/${selected.id}`);
      setSelectedId(null);
      await reload();
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const small: React.CSSProperties = { ...inputStyle, padding: '6px 8px', fontSize: 12.5 };

  return (
    <div>
      <SectionTitle title="Account Rules" sub="Who furnishes and installs what, per national account or project type. Applied to every AI takeoff and enforced on the proposal; drawings that say otherwise are flagged for you, never silently overridden."/>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 180, display: 'flex', flexDirection: 'column', gap: 4 }} role="listbox" aria-label="Account rules">
          {rules.map(r => (
            <button key={r.id} type="button" role="option" aria-selected={selectedId === r.id}
              className={`btn ${selectedId === r.id ? 'primary' : 'ghost'} sm`} style={{ justifyContent: 'flex-start' }}
              onClick={() => setSelectedId(r.id)}>
              {r.name}{r.isDefault ? ' (default)' : ''}{r.active ? '' : ' — off'}
            </button>
          ))}
          <button type="button" className="btn ghost sm" onClick={() => setSelectedId('new')}>+ New rule</button>
        </div>

        {draft && selected && (
          <div style={{ flex: 1, minWidth: 280 }} data-testid="account-rule-editor">
            <Field label="Name">
              <input aria-label="Rule name" style={inputStyle} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/>
            </Field>
            {!selected.isDefault && (
              <>
                <Field label="Matches (brand / owner names, comma-separated)" desc="Case-insensitive, whole words — checked against the bid's brand and name and the owner the drawings print.">
                  <input aria-label="Aliases" style={inputStyle} value={draft.aliasesText} onChange={e => setDraft({ ...draft, aliasesText: e.target.value })}/>
                </Field>
                <Field label="Project types (optional, comma-separated)" desc="e.g. car_wash. Empty = any project type.">
                  <input aria-label="Project types" style={inputStyle} value={draft.typesText} onChange={e => setDraft({ ...draft, typesText: e.target.value })}/>
                </Field>
              </>
            )}

            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', margin: '14px 0 6px' }}>Furnish / install</div>
            {TERMS.map(({ key, label }) => {
              const t = draft.terms[key];
              const mode = t ? t.mode : 'unset';
              return (
                <div key={key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 6 }} data-testid={`term-${key}`}>
                  <span style={{ width: 190, fontSize: 13, fontWeight: 700 }}>{label}</span>
                  <select aria-label={`${label} mode`} style={{ ...small, width: 120 }} value={mode}
                    onChange={e => {
                      const m = e.target.value;
                      if (m === 'unset') setTerm(key, undefined);
                      else if (m === 'ask') setTerm(key, { mode: 'ask' });
                      else setTerm(key, { mode: 'fixed', furnishBy: 'APT', installBy: 'APT' });
                    }}>
                    <option value="unset">Not set</option>
                    <option value="fixed">Fixed</option>
                    <option value="ask">Ask</option>
                  </select>
                  {t && t.mode === 'fixed' && (
                    <>
                      <label style={{ fontSize: 12 }}>Furnish
                        <select aria-label={`${label} furnished by`} style={{ ...small, width: 90, marginLeft: 4 }} value={t.furnishBy}
                          onChange={e => setTerm(key, { ...t, furnishBy: e.target.value as Party })}>
                          {PARTIES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                      <label style={{ fontSize: 12 }}>Install
                        <select aria-label={`${label} installed by`} style={{ ...small, width: 90, marginLeft: 4 }} value={t.installBy}
                          onChange={e => setTerm(key, { ...t, installBy: e.target.value as Party })}>
                          {PARTIES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                      <input aria-label={`${label} vendor`} placeholder="Supplier / national account" style={{ ...small, width: 200 }} value={t.vendor ?? ''}
                        onChange={e => setTerm(key, { ...t, vendor: e.target.value })}/>
                      <input aria-label={`${label} contact`} placeholder="Contact" style={{ ...small, width: 180 }} value={t.contact ?? ''}
                        onChange={e => setTerm(key, { ...t, contact: e.target.value })}/>
                    </>
                  )}
                  {t && t.mode === 'ask' && <span style={{ fontSize: 12, color: 'var(--text3)' }}>From the drawings; otherwise the estimator is asked.</span>}
                </div>
              );
            })}

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, margin: '10px 0' }}>
              <input type="checkbox" checked={draft.noMdpUnlessOnDrawings} onChange={e => setDraft({ ...draft, noMdpUnlessOnDrawings: e.target.checked })}/>
              No MDP language unless an MDP is on the drawings
            </label>
            <Field label="Required scope bullets (one per line, “C: text”)">
              <textarea aria-label="Required scope bullets" rows={3} style={{ ...inputStyle, fontFamily: 'inherit' }} value={draft.bulletsText} onChange={e => setDraft({ ...draft, bulletsText: e.target.value })}/>
            </Field>
            <Field label="Forbidden phrases (one per line)" desc="The proposal and GC takeoff are blocked if any of these appear.">
              <textarea aria-label="Forbidden phrases" rows={3} style={{ ...inputStyle, fontFamily: 'inherit' }} value={draft.forbiddenText} onChange={e => setDraft({ ...draft, forbiddenText: e.target.value })}/>
            </Field>
            <Field label="Notes">
              <textarea aria-label="Notes" rows={2} style={{ ...inputStyle, fontFamily: 'inherit' }} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })}/>
            </Field>
            {!selected.isDefault && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10 }}>
                <input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })}/>
                Active
              </label>
            )}
            {error && <div role="alert" style={{ color: 'var(--red)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save rule'}</button>
              {!selected.isDefault && selectedId !== 'new' && <button type="button" className="btn ghost" onClick={() => void remove()}>Delete</button>}
              {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>✓ Saved</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
