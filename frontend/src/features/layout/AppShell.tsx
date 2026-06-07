import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../components/Icon';
import SearchBox from '../../components/SearchBox';
import NotificationBell from '../../components/NotificationBell';
import ProfileModal from '../../components/ProfileModal';
import aptLogo from '../../assets/apt-logo.png';
import { Bid, Gen, User } from '../../types';
import { isPrivileged } from '../../hooks/useAuth';
import { useUser } from '../../contexts/AppContext';

type View = string;

interface NavItem { id: string; label: string; icon: string; tone?: string; count?: number; }
interface NavGroup { group: string; items: NavItem[]; }

interface Props {
  view: View;
  onNav: (v: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
  topbarExtra?: React.ReactNode;
  genProposalCount?: number;
  elecProposalCount?: number;
  genProjectCount?: number;
  elecProjectCount?: number;
  newIncoming?: number;
  followupCount?: number;
  dashFilter?: string;
  onDashFilter?: (f: string) => void;
  onNewProposal?: () => void;
  onNewBid?: () => void;
  onOpenImport?: () => void;
  bids?: Bid[];
  gens?: Gen[];
  showToast?: (t: { title: string; sub?: string }) => void;
}

const TB: Record<string, { title: string; sub: string | null }> = {
  dashboard:       { title: 'Sales Dashboard',      sub: `${new Date().toLocaleString('en-US',{month:'long',year:'numeric'})} · Accurate Power & Technology` },
  'gen-proposals': { title: 'Generator Proposals',  sub: 'Kohler & Generac · In-house proposal builder' },
  'elec-proposals':{ title: 'Electrical Proposals', sub: 'Electrical subcontracting · Bid tracking pipeline' },
  'sales-by-rep':  { title: 'Sales by Rep',         sub: 'Won jobs by salesperson · Generator & Electrical' },
  'gen-projects':  { title: 'Generator Projects',   sub: 'Installation & commissioning pipeline' },
  'elec-projects': { title: 'Electrical Projects',  sub: 'Construction & closeout pipeline' },
  intake:          { title: 'Intake Inbox',          sub: 'Bid invitations · AI extraction · Accept or reject' },
  preconstruction: { title: 'Preconstruction',       sub: 'AI-assisted bid development & proposal workflow' },
  builder:         { title: 'Proposal Builder',      sub: null },
  comms:           { title: 'Communications',        sub: 'Email timeline, notes & follow-ups' },
  followups:       { title: 'Follow-ups',            sub: 'Tasks & reminders · Stay on top of every deal' },
  docs:            { title: 'Documents',             sub: 'Plan sets, contracts & attachments' },
  reporting:       { title: 'Reporting',             sub: 'Pipeline analytics · Win rates · Forecast' },
  calendar:        { title: 'Calendar',              sub: 'Bid due dates · Won jobs · Project milestones' },
  contacts:        { title: 'Contacts',              sub: 'General contractors & manufacturer reps' },
  admin:           { title: 'Admin',                 sub: 'Users, roles & system configuration' },
  'gen-leads':     { title: 'Generator Leads',       sub: 'Lead tracking · Generator division' },
};

export default function AppShell({
  view, onNav, onLogout, children,
  genProposalCount = 0, elecProposalCount = 0, genProjectCount = 0, elecProjectCount = 0, newIncoming = 0,
  followupCount = 0,
  dashFilter = 'all', onDashFilter, onNewProposal, onNewBid, onOpenImport,
  bids = [], gens = [], showToast,
}: Props) {
  const user = useUser();
  const [profileDropOpen, setProfileDropOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'profile' | 'password'>('profile');
  const [localUser, setLocalUser] = useState<User>(user);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setLocalUser(user); }, [user]);

  useEffect(() => {
    if (!profileDropOpen) return;
    const h = (e: MouseEvent) => { if (dropRef.current && !dropRef.current.contains(e.target as Node)) setProfileDropOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [profileDropOpen]);

  const openProfile = (tab: 'profile' | 'password') => {
    setProfileTab(tab);
    setProfileDropOpen(false);
    setProfileOpen(true);
  };

  const nav: NavGroup[] = [
    { group: 'Sales', items: [
      { id: 'dashboard',      label: 'Sales Dashboard',      icon: 'dashboard' },
      { id: 'gen-proposals',  label: 'Generator Proposals',  icon: 'bolt', tone: 'amber', count: genProposalCount },
      { id: 'gen-leads',      label: 'Generator Leads',      icon: 'users', tone: 'amber' },
      { id: 'elec-proposals', label: 'Electrical Proposals', icon: 'pipeline', count: elecProposalCount },
      { id: 'intake',         label: 'Intake Inbox',         icon: 'bell', count: newIncoming },
      { id: 'sales-by-rep',   label: 'Sales by Rep',         icon: 'trend' },
    ]},
    { group: 'Preconstruction', items: [
      { id: 'preconstruction', label: 'Preconstruction', icon: 'sparkle' },
    ]},
    { group: 'Projects', items: [
      { id: 'gen-projects',   label: 'Generator Projects',  icon: 'bolt', tone: 'amber', count: genProjectCount },
      { id: 'elec-projects',  label: 'Electrical Projects', icon: 'checkc', count: elecProjectCount },
    ]},
    { group: 'Workspace', items: [
      { id: 'followups', label: 'Follow-ups',      icon: 'checkc', count: followupCount },
      { id: 'builder',   label: 'Proposal Builder', icon: 'doc' },
      { id: 'docs',      label: 'Documents',         icon: 'clip' },
    ]},
    { group: 'Insights', items: [
      { id: 'reporting', label: 'Reporting', icon: 'trend' },
      { id: 'calendar',  label: 'Calendar',  icon: 'clock' },
      { id: 'contacts',  label: 'Contacts',  icon: 'users' },
    ]},
  ];

  const [moreOpen, setMoreOpen] = useState(false);
  const canAdmin = isPrivileged(user);

  const tb = TB[view] || TB['dashboard'];
  const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2);

  const mobileBottomNav = [
    { id: 'dashboard',      label: 'Dashboard',  icon: 'dashboard', count: 0 },
    { id: 'gen-proposals',  label: 'Generator',  icon: 'bolt',      count: genProposalCount, amber: true },
    { id: 'elec-proposals', label: 'Electrical', icon: 'pipeline',  count: elecProposalCount },
    { id: 'gen-projects',   label: 'Projects',   icon: 'checkc',    count: 0 },
  ];

  const mobileMoreNav = [
    { id: 'followups',       label: 'Follow-ups',         icon: 'checkc',  count: followupCount },
    { id: 'intake',          label: 'Intake Inbox',       icon: 'bell',    count: newIncoming },
    { id: 'sales-by-rep',    label: 'Sales by Rep',       icon: 'trend',   count: 0 },
    { id: 'preconstruction', label: 'Preconstruction',    icon: 'sparkle', count: 0 },
    { id: 'elec-projects',   label: 'Elec. Projects',     icon: 'checkc',  count: elecProjectCount },
    { id: 'builder',         label: 'Proposal Builder',   icon: 'doc',     count: 0 },
    { id: 'docs',            label: 'Documents',          icon: 'clip',    count: 0 },
    { id: 'reporting',       label: 'Reporting',          icon: 'trend',   count: 0 },
    { id: 'calendar',        label: 'Calendar',           icon: 'clock',   count: 0 },
    { id: 'contacts',        label: 'Contacts',           icon: 'users',   count: 0 },
    ...(canAdmin ? [{ id: 'admin', label: 'Settings', icon: 'gear', count: 0 }] : []),
  ];

  const renderActions = () => {
    if (view === 'dashboard' || view === 'gen-proposals')
      return <button className="btn amber" onClick={onNewProposal}><Icon name="plus" size={16} stroke={2.4}/>New Proposal</button>;
    if (view === 'elec-proposals')
      return <>
        <button className="btn ghost" onClick={onOpenImport} style={{ position: 'relative' }}>
          <Icon name="cloud" size={16} stroke={1.9}/>Import from OneDrive
          {newIncoming > 0 && <span className="btn-badge">{newIncoming}</span>}
        </button>
        <button className="btn" onClick={onNewBid}><Icon name="plus" size={16} stroke={2.4}/>New Bid</button>
      </>;
    if (view === 'comms')
      return <button className="btn ghost"><Icon name="plus" size={16} stroke={2}/>Add Note</button>;
    return null;
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <img className="logo-img" src={aptLogo} alt="Accurate Power and Technology"/>
        </div>
        {nav.map(g => (
          <div className="nav-group" key={g.group}>
            <div className="nav-label">{g.group}</div>
            {g.items.map(it => {
              const isActive = view === it.id;
              const isAmber  = it.tone === 'amber';
              return (
                <button key={it.id}
                  className={'nav-btn' + (isActive ? ' active' + (isAmber ? ' amber' : '') : '')}
                  onClick={() => onNav(it.id)}>
                  <Icon name={it.icon} size={18} stroke={1.8}/>{it.label}
                  {(it.count ?? 0) > 0 && <span className="nav-count">{it.count}</span>}
                </button>
              );
            })}
          </div>
        ))}
        <div className="side-spacer"/>
        {canAdmin && (
          <button className="nav-btn" onClick={() => onNav('admin')}><Icon name="gear" size={18} stroke={1.8}/>Settings</button>
        )}
        <div ref={dropRef} style={{ position: 'relative' }}>
          <div className="side-user" onClick={() => setProfileDropOpen(o => !o)} style={{ cursor: 'pointer' }} title="Account">
            <span className="avatar">{localUser.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}</span>
            <span className="side-user-txt"><b>{localUser.name}</b><small>{localUser.role.replace(/_/g,' ')}</small></span>
            <Icon name="arrow" size={12} stroke={2} style={{ color: 'var(--text3)', marginLeft: 'auto', transform: profileDropOpen ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform .15s' }}/>
          </div>
          {profileDropOpen && (
            <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
              background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 11,
              boxShadow: '0 8px 24px rgba(0,0,0,.28)', overflow: 'hidden', zIndex: 50 }}>
              {[
                { label: 'Edit Profile', icon: 'gear', action: () => openProfile('profile') },
                { label: 'Change Password', icon: 'gear', action: () => openProfile('password') },
              ].map(item => (
                <button key={item.label} onClick={item.action}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px',
                    border: 'none', background: 'none', cursor: 'pointer', font: 'inherit',
                    fontSize: 13, fontWeight: 600, color: 'var(--text)', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  <Icon name={item.icon as any} size={14} stroke={1.8} style={{ color: 'var(--text3)' }}/>{item.label}
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '0 10px' }}/>
              <button onClick={() => { setProfileDropOpen(false); onLogout(); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px',
                  border: 'none', background: 'none', cursor: 'pointer', font: 'inherit',
                  fontSize: 13, fontWeight: 600, color: 'var(--red)', textAlign: 'left' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(224,106,106,.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <Icon name="x" size={14} stroke={2} style={{ color: 'var(--red)' }}/>Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="main">
        {view !== 'preview' && (
          <header className="topbar">
            <div className="top-left">
              <div>
                <div className="page-title">{tb.title}</div>
                {tb.sub && <div className="page-sub">{tb.sub}</div>}
              </div>
              {view === 'dashboard' && (
                <div className="seg">
                  <button className={dashFilter === 'all'  ? 'active' : ''} onClick={() => onDashFilter?.('all')}>All</button>
                  <button className={dashFilter === 'gen'  ? 'active amber' : ''} onClick={() => onDashFilter?.('gen')}><Icon name="bolt" size={14} stroke={2}/>Generators</button>
                  <button className={dashFilter === 'elec' ? 'active' : ''} onClick={() => onDashFilter?.('elec')}><Icon name="pipeline" size={14} stroke={2}/>Electrical</button>
                </div>
              )}
            </div>
            <div className="top-right">
              <SearchBox bids={bids} gens={gens} onNav={onNav}/>
              <NotificationBell authenticated onNav={onNav}/>
              {renderActions()}
            </div>
          </header>
        )}
        {children}
      </div>

      {/* Mobile bottom navigation */}
      <nav className="mobile-nav">
        {mobileBottomNav.map(it => (
          <button key={it.id} className={'mobile-nav-btn' + (view === it.id ? ' active' + (it.amber ? ' amber' : '') : '')} onClick={() => onNav(it.id)}>
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <Icon name={it.icon} size={22} stroke={1.8}/>
              {it.count > 0 && <span className="mobile-nav-badge">{it.count}</span>}
            </div>
            <span>{it.label}</span>
          </button>
        ))}
        <button className={'mobile-nav-btn mobile-nav-more' + (moreOpen ? ' active' : '')} onClick={() => setMoreOpen(o => !o)}>
          <Icon name="gear" size={22} stroke={1.8}/>
          <span>More</span>
        </button>
      </nav>

      {/* More drawer */}
      {moreOpen && (
        <>
          <div className="mobile-more-overlay" onClick={() => setMoreOpen(false)}/>
          <div className="mobile-more-sheet">
            <div className="mobile-more-handle"/>
            {mobileMoreNav.map(it => (
              <button key={it.id} className="mobile-more-item" onClick={() => { onNav(it.id); setMoreOpen(false); }}>
                <span className="mobile-more-item-ic"><Icon name={it.icon} size={20} stroke={1.8}/></span>
                {it.label}
                {it.count > 0 && <span className="mobile-nav-badge" style={{ position: 'static', marginLeft: 'auto' }}>{it.count}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {profileOpen && (
        <ProfileModal
          user={localUser}
          onClose={() => setProfileOpen(false)}
          onSaved={updated => { setLocalUser(updated); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
