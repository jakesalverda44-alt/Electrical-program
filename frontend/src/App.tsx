import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, isPrivileged } from './hooks/useAuth';
import { useToast } from './hooks/useToast';
import { useAppSettings } from './hooks/useAppSettings';
import LoginPage from './features/auth/LoginPage';
import AppShell from './features/layout/AppShell';
import DashboardPage from './features/dashboard/DashboardPage';
import ElecPipelinePage from './features/pipeline/ElecPipelinePage';
import GenPipelinePage from './features/gen-pipeline/GenPipelinePage';
import SalesByRepPage from './features/sales-by-rep/SalesByRepPage';
import IntakeInboxPage from './features/intake/IntakeInboxPage';
import BuilderPage from './features/builder/BuilderPage';
import PreconstructionPage from './features/preconstruction/PreconstructionPage';
import ElecProjectsPage from './features/elec-projects/ElecProjectsPage';
import GenProjectsPage from './features/gen-projects/GenProjectsPage';
import ContactsPage from './features/contacts/ContactsPage';
import ReportingPage from './features/reporting/ReportingPage';
import CommsPage from './features/comms/CommsPage';
import DocsPage from './features/docs/DocsPage';
import FollowupsPage from './features/followups/FollowupsPage';
import ProposalPublicPage from './pages/ProposalPublicPage';
import SettingsPage from './features/settings/SettingsPage';
import { PcWorkspace } from './features/preconstruction/constants';
import Toast from './components/Toast';
import api from './api/client';
import { Bid, Gen, WonJob, Activity } from './types';

function StubPage({ title }: { title: string }) {
  return (
    <div className="scroll view-enter">
      <div style={{ padding: 32, color: 'var(--text2)', fontSize: 15 }}>
        <b>{title}</b> — coming soon
      </div>
    </div>
  );
}

export default function App() {
  const { user, login, logout } = useAuth();
  const { toast, showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // The active view is derived from the URL so pages are bookmarkable and the
  // browser back/forward buttons work. setView simply navigates.
  const view = location.pathname.replace(/^\/+/, '').split('/')[0] || 'dashboard';
  const setView = useCallback((v: string) => navigate('/' + v), [navigate]);
  const [dashFilter, setDashFilter] = useState('all');
  const [bids, setBids] = useState<Bid[]>([]);
  const [gens, setGens] = useState<Gen[]>([]);
  const [wonJobs, setWonJobs] = useState<WonJob[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [repNames, setRepNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pcData, setPcData] = useState<Record<string, PcWorkspace>>({});
  const [intakeCount, setIntakeCount] = useState(0);
  const [openAddBid, setOpenAddBid] = useState(false);
  const [addBidGc, setAddBidGc] = useState<string | undefined>(undefined);
  const [followupCount, setFollowupCount] = useState(0);
  const [editGen, setEditGen] = useState<import('./types').Gen | null>(null);
  const { settings, reload: reloadSettings } = useAppSettings(!!user);

  const triggerFlash = useCallback((id: string) => {
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1800);
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([api.get('/dashboard'), api.get('/users'), api.get('/preconstruction/workspaces')])
      .then(([dash, users, workspaces]) => {
        const bidsData: Bid[] = dash.data.bids;
        setBids(bidsData);
        setGens(dash.data.gens);
        setWonJobs(dash.data.wonJobs);
        setActivity(dash.data.activity);
        setRepNames(users.data.map((u: { name: string }) => u.name));
        // Restore persisted workspace state
        const restored: Record<string, PcWorkspace> = {};
        for (const row of (workspaces.data as Array<Record<string, unknown>>)) {
          const bid = bidsData.find(b => b.id === row.bid_id);
          if (!bid) continue;
          restored[bid.id] = {
            bidId:             bid.id,
            bidName:           bid.name,
            amount:            bid.amount ?? 0,
            step:              (row.step as PcWorkspace['step']) || 'intake',
            activeTab:         (row.active_tab as PcWorkspace['activeTab']) || 'overview',
            notes:             (row.notes as string) || '',
            scope:             (row.scope as Record<string, string>) || {},
            rfis:              (row.rfis as PcWorkspace['rfis']) || [],
            files:             (row.files as PcWorkspace['files']) || [],
            aiDone:            !!(row.ai_done),
            proposalGenerated: !!(row.proposal_generated),
            aiRunning:         false,
            aiLog:             [],
          };
        }
        setPcData(restored);
      })
      .finally(() => setLoading(false));
  }, [user]);

  const handleLogin = async (email: string, password: string) => {
    await login(email, password);
    navigate('/dashboard');
  };

  const handleNewBid = useCallback((bid: Bid) => {
    setBids(prev => [bid, ...prev]);
    triggerFlash(bid.id);
  }, [triggerFlash]);

  const handlePcUpdate = useCallback((bidId: string, ws: PcWorkspace) => {
    setPcData(prev => ({ ...prev, [bidId]: ws }));
  }, []);

  const handleBidUpdated = useCallback((updated: Bid) => {
    setBids(prev => prev.map(b => b.id === updated.id ? updated : b));
  }, []);

  // Open the add-bid flow, optionally pre-filling the GC (e.g. from a customer hub).
  const openNewBid = useCallback((gc?: string) => {
    setAddBidGc(gc);
    setView('elec-proposals');
    setOpenAddBid(true);
  }, [setView]);

  const genProposalCount  = gens.filter(g => g.stage !== 'awarded' && g.stage !== 'declined').length;
  const elecProposalCount = bids.filter(b => b.stage === 'due' || b.stage === 'submitted').length;
  const genProjectCount   = gens.filter(g => g.stage === 'awarded').length;
  const elecProjectCount  = bids.filter(b => b.stage === 'awarded').length;

  if (!user) {
    return (
      <>
        <Routes>
          <Route path="/login" element={<LoginPage onLogin={handleLogin}/>}/>
          <Route path="/reset-password" element={<LoginPage onLogin={handleLogin}/>}/>
          <Route path="/p/:token" element={<ProposalPublicPage/>}/>
          <Route path="*" element={<Navigate to="/login" replace/>}/>
        </Routes>
        {toast && <Toast toast={toast}/>}
      </>
    );
  }

  const renderView = () => {
    if (loading) {
      return (
        <div className="scroll view-enter">
          <div style={{ padding: 32, color: 'var(--text3)' }}>Loading…</div>
        </div>
      );
    }
    switch (view) {
      case 'dashboard':
        return (
          <DashboardPage
            bids={bids} gens={gens} wonJobs={wonJobs} activity={activity}
            repNames={repNames}
            userName={user.name} userRole={user.role}
            onNav={setView} onNewProposal={() => setView('builder')}
          />
        );
      case 'elec-proposals':
        return (
          <ElecPipelinePage
            bids={bids} setBids={setBids}
            setWonJobs={setWonJobs} showToast={showToast}
            onOpenPreconstruction={() => setView('preconstruction')}
            flashId={flashId}
            openAddBid={openAddBid}
            onAddBidHandled={() => { setOpenAddBid(false); setAddBidGc(undefined); }}
            initialGc={addBidGc}
          />
        );
      case 'gen-proposals':
        return (
          <GenPipelinePage
            gens={gens} setGens={setGens}
            setWonJobs={setWonJobs} showToast={showToast}
            onOpenBuilder={() => { setEditGen(null); setView('builder'); }}
            onEditGen={g => { setEditGen(g); setView('builder'); }}
            flashId={flashId}
            onNav={setView}
          />
        );
      case 'sales-by-rep':
        return <SalesByRepPage wonJobs={wonJobs}/>;
      case 'intake':
        return (
          <IntakeInboxPage
            onBidAccepted={(bid) => { setBids(prev => [bid, ...prev]); setView('elec-proposals'); }}
            showToast={showToast}
            onPendingChange={setIntakeCount}
          />
        );
      case 'builder':
        return (
          <BuilderPage
            setGens={setGens}
            setWonJobs={setWonJobs}
            showToast={showToast}
            onSaved={() => { setEditGen(null); setView('gen-proposals'); }}
            editGen={editGen}
            appSettings={settings}
          />
        );
      case 'preconstruction':
        return (
          <PreconstructionPage
            bids={bids}
            pcData={pcData}
            onPcUpdate={handlePcUpdate}
            onBidUpdated={handleBidUpdated}
            showToast={showToast}
            userRole={user?.role}
            settings={settings}
          />
        );
      case 'elec-projects':
        return <ElecProjectsPage bids={bids} setBids={setBids} setWonJobs={setWonJobs} showToast={showToast}/>;
      case 'gen-projects':
        return <GenProjectsPage gens={gens} setGens={setGens} setWonJobs={setWonJobs} showToast={showToast}/>;
      case 'contacts':
        return <ContactsPage showToast={showToast} onNewBid={openNewBid} userRole={user.role}/>;
      case 'reporting':
        return <ReportingPage bids={bids} gens={gens} wonJobs={wonJobs}/>;
      case 'followups':
        return <FollowupsPage showToast={showToast} onCountChange={setFollowupCount}/>;
      case 'comms':
        return <CommsPage bids={bids} gens={gens} activity={activity} showToast={showToast} userName={user.name}/>;
      case 'docs':
        return <DocsPage bids={bids} gens={gens} showToast={showToast} userName={user.name}/>;
      case 'admin':
        if (!isPrivileged(user)) {
          return (
            <div className="scroll view-enter">
              <div style={{ padding: 32, color: 'var(--text2)', fontSize: 15 }}>
                <b>Settings</b> — you don’t have permission to view this page. Contact an owner or administrator.
              </div>
            </div>
          );
        }
        return <SettingsPage settings={settings} onSettingsSaved={reloadSettings}/>;
      default:
        return <StubPage title={view.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}/>;
    }
  };

  const shell = (
    <>
      <AppShell
        view={view}
        onNav={setView}
        user={user}
        onLogout={logout}
        genProposalCount={genProposalCount}
        elecProposalCount={elecProposalCount}
        genProjectCount={genProjectCount}
        elecProjectCount={elecProjectCount}
        newIncoming={intakeCount}
        followupCount={followupCount}
        dashFilter={dashFilter}
        onDashFilter={setDashFilter}
        onNewProposal={() => setView('builder')}
        onNewBid={() => openNewBid()}
        bids={bids} gens={gens}
      >
        {renderView()}
      </AppShell>
      {toast && <Toast toast={toast}/>}
    </>
  );

  return (
    <Routes>
      {/* Public proposal stays reachable even when signed in */}
      <Route path="/p/:token" element={<ProposalPublicPage/>}/>
      {/* Auth pages are meaningless when already signed in */}
      <Route path="/login" element={<Navigate to="/dashboard" replace/>}/>
      <Route path="/reset-password" element={<Navigate to="/dashboard" replace/>}/>
      {/* Everything else renders the app shell; the view is read from the path */}
      <Route path="*" element={shell}/>
    </Routes>
  );
}
