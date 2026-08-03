import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../components/Icon';
import SearchBox from '../../components/SearchBox';
import NotificationBell from '../../components/NotificationBell';
import ProfileModal from '../../components/ProfileModal';
import aptLogo from '../../assets/apt-logo.png';
import { Bid, Gen, User } from '../../types';
import { isPrivileged } from '../../hooks/useAuth';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { useUser } from '../../contexts/AppContext';

type View = string;

interface NavItem { id: string; label: string; icon: string; tone?: string; count?: number; }
interface NavGroup { group: string; items: NavItem[]; }

interface Props {
  view: View;
  onNav: (v: string, recordId?: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
  topbarExtra?: React.ReactNode;
  genProposalCount?: number;
  elecProposalCount?: number;
  genProjectCount?: number;
  elecProjectCount?: number;
  newIncoming?: number;
  followupCount?: number;
  onNewProposal?: () => void;
  onNewBid?: () => void;
  onOpenImport?: () => void;
  bids?: Bid[];
  gens?: Gen[];
  showToast?: (t: { title: string; sub?: string }) => void;
}

/**
 * Command Center subtitle, computed at render time so the period and date are never
 * stale in a long-lived tab. Period boundaries (12/17) match the backend's
 * composeDaySummary so the header agrees with the hero's day summary.
 */
function briefSub(): string {
  const now = new Date();
  const h = now.getHours();
  const period = h < 12 ? 'Morning' : h < 17 ? 'Midday' : 'Evening';
  return `${period} brief · ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
}

const TB: Record<string, { title: string; sub: string | null }> = {
  dashboard:       { title: 'Home',                 sub: null },
  generators:      { title: 'Generators',           sub: 'Leads · Proposals · Installs — Generator division' },
  electrical:      { title: 'Electrical',           sub: 'Intake · Bids · Projects — Electrical division' },
  'sales-by-rep':  { title: 'Sales by Rep',         sub: 'Won jobs by salesperson · Generator & Electrical' },
  builder:         { title: 'Proposal Builder',      sub: null },
  comms:           { title: 'Communications',        sub: 'Email timeline, notes & follow-ups' },
  followups:       { title: 'Follow-ups',            sub: 'Tasks & reminders · Stay on top of every deal' },
  docs:            { title: 'Documents',             sub: 'Plan sets, contracts & attachments' },
  calendar:        { title: 'Calendar',              sub: 'Bid due dates · Won jobs · Project milestones' },
  contacts:        { title: 'Contacts',              sub: 'General contractors & manufacturer reps' },
  admin:           { title: 'Admin',                 sub: 'Users, roles & system configuration' },
};

export default function AppShell({
  view, onNav, onLogout, children,
  genProposalCount = 0, elecProposalCount = 0, genProjectCount = 0, elecProjectCount = 0, newIncoming = 0,
  followupCount = 0,
  onNewProposal, onNewBid, onOpenImport,
  bids = [], gens = [], showToast,
}: Props) {
  const user = useUser();
  const { canInstall, promptInstall, isIos, isStandalone, iosHintDismissed, dismissIosHint } = useInstallPrompt();
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
    { group: '', items: [
      { id: 'dashboard',  label: 'Home',       icon: 'dashboard' },
      { id: 'generators', label: 'Generators', icon: 'bolt', tone: 'amber', count: genProposalCount },
      { id: 'electrical', label: 'Electrical', icon: 'pipeline', count: elecProposalCount + newIncoming },
    ]},
    { group: 'Workspace', items: [
      { id: 'contacts',  label: 'Contacts',   icon: 'users' },
      { id: 'calendar',  label: 'Calendar',   icon: 'clock' },
      { id: 'followups', label: 'Follow-ups', icon: 'checkc', count: followupCount },
      { id: 'docs',      label: 'Documents',  icon: 'clip' },
    ]},
  ];

  const [moreOpen, setMoreOpen] = useState(false);
  const canAdmin = isPrivileged(user);

  const tbBase = TB[view] || TB['dashboard'];
  // Dynamic subtitles, evaluated per render so they never go stale in an open tab.
  const tb = tbBase.sub === null && tbBase.title === 'Home'
    ? { ...tbBase, sub: briefSub() }
    : tbBase;
  const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2);

  const mobileBottomNav = [
    { id: 'dashboard',           label: 'Home',       icon: 'dashboard', count: 0 },
    { id: 'generators/pipeline', label: 'Generators', icon: 'bolt',      count: genProposalCount },
    { id: 'electrical/bids',     label: 'Electrical', icon: 'pipeline',  count: elecProposalCount },
  ];

  const mobileMoreNav = [
    { id: 'contacts',  label: 'Contacts',   icon: 'users',  count: 0 },
    { id: 'calendar',  label: 'Calendar',   icon: 'clock',  count: 0 },
    { id: 'followups', label: 'Follow-ups', icon: 'checkc', count: followupCount },
    { id: 'docs',      label: 'Documents',  icon: 'clip',   count: 0 },
    ...(canAdmin ? [{ id: 'admin', label: 'Settings', icon: 'gear', count: 0 }] : []),
  ];

  const renderActions = () => {
    if (view === 'generators')
      return <button className="btn amber" onClick={onNewProposal}><Icon name="plus" size={16} stroke={2.4}/>New Proposal</button>;
    if (view === 'electrical')
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
        {nav.map((g, gi) => (
          <div className="nav-group" key={g.group || gi}>
            {g.group && <div className="nav-label">{g.group}</div>}
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
          <button key={it.id} className={'mobile-nav-btn' + (view === it.id.split('/')[0] ? ' active' : '')} onClick={() => onNav(it.id)}>
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
            {isIos && !isStandalone && !iosHintDismissed && (
              <div className="mobile-more-ios-hint">
                <span>Install this app: Share → Add to Home Screen</span>
                <button
                  type="button"
                  className="mobile-more-ios-hint-close"
                  onClick={dismissIosHint}
                  aria-label="Dismiss install hint"
                >
                  <Icon name="x" size={16} stroke={2}/>
                </button>
              </div>
            )}
            {canInstall && (
              <button
                className="mobile-more-item"
                onClick={() => { promptInstall(); setMoreOpen(false); }}
              >
                <span className="mobile-more-item-ic"><Icon name="cloudup" size={20} stroke={1.8}/></span>
                Install App
              </button>
            )}
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
