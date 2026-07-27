import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';
import { currencySymbol } from '../../../lib/money';

export function ProposalDefaultsSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const keys = ['gen_default_labor','gen_default_permit','gen_default_startup','gen_default_tax_rate',
                 'gen_default_pad','gen_default_smm','gen_default_surge_pro','gen_default_battery',
                 'gen_default_em_panel',
                 'gen_default_extra_wire','gen_default_lull','gen_default_crane',
                 'gen_default_deposit_pct','gen_default_valid_days',
                 'proposal_default_message','gas_contacts_text'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? ''])));
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    const fresh = Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  const hasChanges = keys.some(k => vals[k] !== orig[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings', vals); setOrig(vals); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  const cur = currencySymbol();
  const fields: [string, string, string][] = [
    ['gen_default_labor',     'Labor & Installation',     cur],
    ['gen_default_permit',    'Permit Fee',               cur],
    ['gen_default_startup',   'Startup & Commissioning',  cur],
    ['gen_default_tax_rate',  'Tax Rate',                 '%'],
    ['gen_default_pad',       'Concrete Pad',             cur],
    ['gen_default_smm',       'SMM (Preventative Maint.)', cur],
    ['gen_default_surge_pro', 'Surge Protector Pro',      cur],
    ['gen_default_battery',   'Battery Maintainer',       cur],
    ['gen_default_em_panel',  'EM Panel',                 cur],
    ['gen_default_extra_wire','Extra Wire (per ft)',       cur],
    ['gen_default_lull',      'Lull',                     cur],
    ['gen_default_crane',     'Crane',                    cur],
    ['gen_default_deposit_pct','Deposit',                 '%'],
    ['gen_default_valid_days', 'Proposal Valid For',      'days'],
  ];

  return (
    <div>
      <SectionTitle title="Proposal Defaults" sub="Default values pre-filled when creating a new generator proposal. These can still be overridden per-proposal."/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        {fields.map(([key, label, unit]) => (
          <Field key={key} label={`${label} (${unit})`}>
            <input type="number" style={inputStyle} value={vals[key]} onChange={set(key)}/>
          </Field>
        ))}
      </div>

      <SectionTitle title="Proposal Email" sub="Included automatically when a proposal is sent to a customer."/>
      <Field label="Default Message" desc="Pre-written message appended to every proposal email, below the note field.">
        <textarea rows={4} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          value={vals.proposal_default_message} onChange={set('proposal_default_message')}
          placeholder="e.g. We appreciate the opportunity to earn your business. Financing options are available — let us know if you'd like details."/>
      </Field>
      <Field label="Gas Contacts" desc="Shown in the email only when 'Include gas contacts' is checked when sending a proposal.">
        <textarea rows={4} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          value={vals.gas_contacts_text} onChange={set('gas_contacts_text')}
          placeholder={'e.g. TECO Gas: (813) 275-3909\nPeoples Gas: (877) 832-6747'}/>
      </Field>

      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}
