import React, { useState } from 'react';
import Icon from '../../components/Icon';
import { AppSettings } from '../../hooks/useAppSettings';
import { inputStyle } from './shared';
import { CompanySection } from './sections/CompanySection';
import { UsersSection } from './sections/UsersSection';
import { ProposalDefaultsSection } from './sections/ProposalDefaultsSection';
import { GenPricingSection } from './sections/GenPricingSection';
import { EmailSection } from './sections/EmailSection';
import { AISection } from './sections/AISection';
import { AIPermissionsSection } from './sections/AIPermissionsSection';
import { IntegrationsSection } from './sections/IntegrationsSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { SecuritySection } from './sections/SecuritySection';
import { TrashSection } from './sections/TrashSection';
import { AuditSection } from './sections/AuditSection';
import { CommissionsSection } from './sections/CommissionsSection';

interface Props {
  settings: AppSettings;
  onSettingsSaved: () => void;
}

type SectionId = 'company' | 'proposal-defaults' | 'gen-pricing' | 'users' | 'email' | 'ai' | 'ai-permissions' | 'integrations' | 'notifications' | 'security' | 'trash' | 'audit' | 'commissions';

const NAV: { group: string; items: { id: SectionId; label: string; icon: string }[] }[] = [
  { group: 'Organization', items: [
    { id: 'company',          label: 'Company Profile', icon: 'building' },
    { id: 'users',            label: 'Users',           icon: 'users'    },
  ]},
  { group: 'Proposals', items: [
    { id: 'proposal-defaults', label: 'Defaults',       icon: 'doc'      },
    { id: 'gen-pricing',       label: 'Gen Pricing',    icon: 'zap'      },
    { id: 'commissions',       label: 'Commissions',    icon: 'dollar'   },
  ]},
  { group: 'Integrations', items: [
    { id: 'email',            label: 'Email Delivery',  icon: 'send'     },
    { id: 'ai',               label: 'AI',              icon: 'cpu'      },
    { id: 'ai-permissions',   label: 'AI Permissions',  icon: 'shield'   },
    { id: 'integrations',     label: 'Integrations',    icon: 'link'     },
  ]},
  { group: 'System', items: [
    { id: 'notifications',    label: 'Notifications',   icon: 'bell'     },
    { id: 'security',         label: 'Security',        icon: 'shield'   },
    { id: 'audit',            label: 'Audit Log',       icon: 'clip'     },
    { id: 'trash',            label: 'Trash',           icon: 'trash'    },
  ]},
];

export default function SettingsPage({ settings, onSettingsSaved }: Props) {
  const [active, setActive] = useState<SectionId>('company');
  const [search, setSearch] = useState('');

  const allItems = NAV.flatMap(g => g.items);
  const filtered = search
    ? allItems.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
    : null;

  return (
    <div className="scroll view-enter" style={{ height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh', maxHeight: '100vh', overflow: 'hidden' }}>

        {/* ── Left sidebar ── */}
        <div style={{ background: 'var(--surface2)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          <div style={{ padding: '20px 16px 12px' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)', marginBottom: 12 }}>Settings</div>
            <div style={{ position: 'relative' }}>
              <Icon name="search" size={13} stroke={1.9} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', pointerEvents: 'none' }}/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                style={{ ...inputStyle, paddingLeft: 28, fontSize: 12, padding: '7px 10px 7px 28px' }}/>
            </div>
          </div>

          <nav style={{ flex: 1, padding: '0 8px 20px' }}>
            {(filtered ? [{ group: 'Results', items: filtered }] : NAV).map(g => (
              <div key={g.group} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', padding: '6px 8px 3px' }}>{g.group}</div>
                {g.items.map(item => (
                  <button key={item.id} onClick={() => { setActive(item.id); setSearch(''); }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', border: 'none',
                      borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: active === item.id ? 700 : 500,
                      background: active === item.id ? 'var(--accent)' : 'transparent',
                      color: active === item.id ? '#fff' : 'var(--text2)', textAlign: 'left' }}>
                    <Icon name={item.icon} size={15} stroke={active === item.id ? 2 : 1.7}/>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>

        {/* ── Right content ── */}
        <div style={{ overflow: 'auto', padding: '28px 32px 60px' }}>
          {active === 'company'           && <CompanySection     settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'users'             && <UsersSection/>}
          {active === 'proposal-defaults' && <ProposalDefaultsSection settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'gen-pricing'       && <GenPricingSection  settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'commissions'       && <CommissionsSection settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'email'             && <EmailSection       settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'ai'                && <AISection          settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'ai-permissions'    && <AIPermissionsSection settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'integrations'      && <IntegrationsSection/>}
          {active === 'notifications'     && <NotificationsSection settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'security'          && <SecuritySection    settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'audit'             && <AuditSection/>}
          {active === 'trash'             && <TrashSection/>}
        </div>
      </div>
    </div>
  );
}
