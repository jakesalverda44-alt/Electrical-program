import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, isPrivileged } from './hooks/useAuth';
import { useToast } from './hooks/useToast';
import { useAppSettings } from './hooks/useAppSettings';
import LoginPage from './features/auth/LoginPage';
import AppShell from './features/layout/AppShell';
import CommandCenterPage from './features/command-center/CommandCenterPage';
import SalesByRepPage from './features/sales-by-rep/SalesByRepPage';
import ContactsPage from './features/contacts/ContactsPage';
import CommsPage from './features/comms/CommsPage';
import FollowupsPage from './features/followups/FollowupsPage';
import CalendarPage from './features/calendar/CalendarPage';
import ProposalPublicPage from './pages/ProposalPublicPage';
import GeneratorsHubPage from './features/hubs/GeneratorsHubPage';
import ElectricalHubPage from './features/hubs/ElectricalHubPage';
// Code splitting (audit code #8): these six are among the biggest pages in the
// app (BuilderPage/EvBuilderPage's proposal builder + PDF preview,
// PcWorkspaceView's 2,800-line estimator behind BidHubPage, ElecProjectsPage's
// many CO/pay-app/RFI tables, SettingsPage, DocsPage) and are each visited by
// only a subset of sessions, so loading them eagerly in the main bundle taxes
// every session for pages most of them never open. `React.lazy` defers each
// to its own chunk, fetched the first time its view is reached; the one
// <Suspense> around `renderView()` below covers all of them, including
// EvBuilderPage (lazy-loaded inside BuilderPage.tsx) and ElecProjectsPage
// (lazy-loaded inside ElectricalHubPage.tsx) — Suspense catches a lazy
// component suspending anywhere in its subtree, not just direct children.
const BuilderPage = lazy(() => import('./features/builder/BuilderPage'));
const BidHubPage = lazy(() => import('./features/bid-hub/BidHubPage'));
const DocsPage = lazy(() => import('./features/docs/DocsPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
import { coerceGenTab, coerceElecTab } from './features/hubs/constants';
import { resolveLegacyPath } from './lib/legacyRoutes';
import { PcWorkspace, PC_TABS, ConfirmedService } from './features/preconstruction/constants';
import Toast from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import BootError from './components/BootError';
import NotFound from './components/NotFound';
import Icon from './components/Icon';
import { usePageTitle } from './hooks/usePageTitle';
import { AppProviders } from './contexts/AppContext';
import { useConfirmLeave } from './contexts/UnsavedGuardContext';
import { UNAUTHORIZED_EVENT, UnauthorizedDetail } from './api/session';
import { useApi } from './hooks/useApi';
import { Bid, Gen, WonJob, Activity } from './types';

interface DashboardPayload {
  bids: Bid[];
  gens: Gen[];
  wonJobs: WonJob[];
  activity: Activity[];
}

// StubPage is gone: every view in the switch below is shipped, so there was no
// genuinely-planned view left for it to represent — and its "coming soon" copy
// was what made a typo'd URL look like a feature (audit code #17 / ux #17).

/** Small page-level spinner shown while a lazy page's chunk is still loading —
 *  styled like the existing bootstrap "Loading…" state so a chunk fetch on a
 *  slow connection reads as the same kind of pause, not a different one. */
function PageLoadingFallback() {
  return (
    <div className="scroll view-enter">
      <div style={{ padding: 32, color: 'var(--text3)' }}>Loading…</div>
    </div>
  );
}

/** Tab title per view; the record-level pages set their own from the record. */
const VIEW_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  generators: 'Generators',
  electrical: 'Electrical',
  'sales-by-rep': 'Sales by Rep',
  builder: 'Proposal Builder',
  contacts: 'Contacts',
  calendar: 'Calendar',
  followups: 'Follow-ups',
  comms: 'Communications',
  docs: 'Documents',
  admin: 'Settings',
};

export default function App() {
  const { user, login, logout } = useAuth();
  const { toast, showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // The active view is derived from the URL so pages are bookmarkable and the
  // browser back/forward buttons work. setView simply navigates. An optional
  // second path segment carries a record id (e.g. /gen-leads/<id>) so global
  // search and notifications can deep-link straight to a specific record.
  const segments = location.pathname.replace(/^\/+/, '').split('/');
  const view = segments[0] || 'dashboard';
  const viewParam = segments[1] ? decodeURIComponent(segments[1]) : null;
  // Division hub views (/generators/{tab}/{recordId?}, /electrical/{tab}/{recordId?})
  // carry a tab as their second path segment and an optional record id as their third.
  const isHubView = view === 'generators' || view === 'electrical';
  const hubTab = isHubView ? (segments[1] ?? null) : null;
  const hubRecordId = isHubView && segments[2] ? decodeURIComponent(segments[2]) : null;
  // Old flat view URLs (bookmarks, backend-emitted links) redirect permanently to their
  // new hub path; resolves to null for anything that isn't a legacy key.
  const legacyTarget = resolveLegacyPath(location.pathname);
  // Every in-app navigation goes through here — the sidebar and mobile nav
  // (AppShell's `onNav`), the hub tab switches, global search, notification
  // deep links — so guarding this one function covers all of them, and
  // `useNavigate` is used nowhere else in the tree.
  const confirmLeave = useConfirmLeave();
  const setView = useCallback(
    (v: string, recordId?: string) => confirmLeave(
      () => navigate('/' + v + (recordId ? '/' + encodeURIComponent(recordId) : '')),
    ),
    [navigate, confirmLeave],
  );
  // Strip a deep-link record id back out of the URL once the page has opened it.
  // Hub views must keep the tab segment and only drop the record id.
  const clearParam = useCallback(() => {
    navigate(isHubView ? '/' + view + '/' + (hubTab ?? 'overview') : '/' + view, { replace: true });
  }, [navigate, view, isHubView, hubTab]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [gens, setGens] = useState<Gen[]>([]);
  const [wonJobs, setWonJobs] = useState<WonJob[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [repNames, setRepNames] = useState<string[]>([]);
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

  // Three independent reads rather than one Promise.all: a failing /users or
  // /preconstruction/workspaces used to reject the whole chain and leave the app
  // rendering a legitimate-looking "no records" state for the entire pipeline.
  const dashApi = useApi<DashboardPayload>('/dashboard', { enabled: !!user });
  const usersApi = useApi<Array<{ name: string }>>('/users', { enabled: !!user });
  const workspacesApi = useApi<Array<Record<string, unknown>>>('/preconstruction/workspaces', { enabled: !!user });

  useEffect(() => {
    if (!dashApi.data) return;
    setBids(dashApi.data.bids);
    setGens(dashApi.data.gens);
    setWonJobs(dashApi.data.wonJobs);
    setActivity(dashApi.data.activity);
  }, [dashApi.data]);

  useEffect(() => {
    if (!usersApi.data) return;
    setRepNames(usersApi.data.map(u => u.name));
  }, [usersApi.data]);

  useEffect(() => {
    const bidsData = dashApi.data?.bids;
    const workspaceRows = workspacesApi.data;
    if (!bidsData || !workspaceRows) return;
    {
        // Restore persisted workspace state
        const restored: Record<string, PcWorkspace> = {};
        // 'compare' tab was retired from the workspace tab bar (Task 12) — Compare now
        // lives only in the Bid Hub. A workspace saved before that move may still carry
        // active_tab='compare'; coerce anything not in the current tab list back to
        // 'overview' so restoring an old workspace never lands on a dead tab.
        const validTabs = new Set(PC_TABS.map(t => t.key as string));
        for (const row of workspaceRows) {
          const bid = bidsData.find(b => b.id === row.bid_id);
          if (!bid) continue;
          const persistedTab = row.active_tab as string | undefined;
          restored[bid.id] = {
            bidId:             bid.id,
            bidName:           bid.name,
            amount:            bid.amount ?? 0,
            step:              (row.step as PcWorkspace['step']) || 'intake',
            activeTab:         (persistedTab && validTabs.has(persistedTab) ? persistedTab : 'overview') as PcWorkspace['activeTab'],
            notes:             (row.notes as string) || '',
            scope:             (row.scope as Record<string, string>) || {},
            rfis:              (row.rfis as PcWorkspace['rfis']) || [],
            files:             (row.files as PcWorkspace['files']) || [],
            aiDone:            !!(row.ai_done),
            proposalGenerated: !!(row.proposal_generated),
            confirmedService:  (row.confirmed_service as ConfirmedService | null) ?? undefined,
            aiRunning:         false,
            aiLog:             [],
            // Intentionally pristine defaults, not the estimator's real pricing state —
            // bid_workspaces (this restore's source) never carried estimateOverrides /
            // overheadPct / profitPct; that state lives in bid_estimates instead.
            // PcWorkspaceView's saved-estimate hydration effect (see estimateHydrate.ts)
            // detects this exact pristine shape and overwrites it with the real
            // overhead_pct / profit_pct / line-item overrides once bid_estimates loads,
            // the same way it already restores confirmedService from a different table.
            // Do not "fix" this by threading real values through here — a bid without a
            // saved estimate yet has no real values to restore, and this is the correct
            // starting point for the hydration effect's pristine check either way.
            estimateOverrides: {},
            overheadPct:       10,
            profitPct:         15,
          };
        }
        setPcData(restored);
    }
  }, [dashApi.data, workspacesApi.data]);

  // Keep the Intake Inbox sidebar badge live (unread bids) regardless of the open page:
  // fetch on login and poll every 60s. Local actions (opening/importing) also update it
  // immediately via the page's onUnreadChange callback.
  // optional: a failed badge poll is not worth interrupting the user for — the
  // count simply keeps its previous value until the next tick succeeds.
  const intakeApi = useApi<{ unread?: number }>('/intake/unread-count', { enabled: !!user });
  useEffect(() => {
    if (intakeApi.data) setIntakeCount(intakeApi.data.unread ?? 0);
  }, [intakeApi.data]);
  const reloadIntakeUnread = intakeApi.reload;
  useEffect(() => {
    if (!user) return;
    const t = setInterval(reloadIntakeUnread, 60_000);
    return () => clearInterval(t);
  }, [user, reloadIntakeUnread]);

  // The api client fires crm:unauthorized instead of hard-navigating, so an
  // expired session becomes a client-side route change that remembers where the
  // user was. Registered once, above the !user early return.
  // The bootstrap fires several requests in parallel, so an expired session
  // produces a BURST of 401s. Only the first one still knows where the user
  // was — by the time the second arrives the path is already /login, and it
  // computed an empty `next` and replaced the good one away. Latch on the first
  // event and ignore the rest until a fresh sign-in.
  const ejectedRef = useRef(false);
  // The router's location, not window.location: the listener's deps are kept
  // stable so it does not resubscribe on every navigation, and a ref is how it
  // still reads the current page. (It also makes the eject testable under
  // MemoryRouter, where window.location never moves.)
  const herePathRef = useRef('');
  herePathRef.current = location.pathname + location.search;
  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      if (ejectedRef.current) return;
      ejectedRef.current = true;
      const detail = (e as CustomEvent<UnauthorizedDetail>).detail ?? {};
      const next = detail.next ?? herePathRef.current;
      const params = new URLSearchParams();
      if (next && next !== '/' && !next.startsWith('/login')) params.set('next', next);
      if (detail.error) params.set('error', detail.error);
      logout();
      navigate('/login' + (params.toString() ? '?' + params.toString() : ''), { replace: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [logout, navigate]);

  // Re-arm once a session exists again, so a later expiry still ejects.
  useEffect(() => { if (user) ejectedRef.current = false; }, [user]);

  const handleLogin = async (email: string, password: string) => {
    await login(email, password);
    // Honour ?next= so an expired session returns the user to the page that
    // bounced them, not to the dashboard.
    const next = new URLSearchParams(window.location.search).get('next');
    navigate(next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/dashboard');
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
  // `setView` is guarded, but arming the modal was not: answering "Keep
  // editing" still left Add Bid queued to open on the next visit. Both halves
  // now happen only if the navigation is actually allowed to proceed.
  const openNewBid = useCallback((gc?: string) => {
    confirmLeave(() => {
      setAddBidGc(gc);
      navigate('/electrical/bids');
      setOpenAddBid(true);
    });
  }, [confirmLeave, navigate]);

  // The dashboard payload is what every board and stat reads from, so it alone
  // gates first paint; /users and /preconstruction/workspaces enrich the shell.
  const loading = dashApi.loading;

  // A failed /users or /preconstruction/workspaces degrades one feature each
  // (the rep filter, restored estimator workspaces) and must not blank the app,
  // but the user still has to be told the page is not showing everything.
  const partialFailures = [
    usersApi.error ? 'the salesperson list' : null,
    workspacesApi.error ? 'saved estimating workspaces' : null,
  ].filter(Boolean) as string[];
  const [warningDismissed, setWarningDismissed] = useState(false);
  useEffect(() => { if (partialFailures.length === 0) setWarningDismissed(false); }, [partialFailures.length]);

  const retryBootstrap = useCallback(() => {
    dashApi.reload();
    usersApi.reload();
    workspacesApi.reload();
  }, [dashApi.reload, usersApi.reload, workspacesApi.reload]);

  // Record-level pages set their own title; everything else comes from the view.
  // NOTE: every hook in this component must stay ABOVE the `if (!user)` return
  // below. Signing in and being ejected by a 401 both flip `user` in place, so
  // a hook below it changes the hook count between renders and React throws
  // "Rendered more/fewer hooks than during the previous render" — which would
  // take out the very 401 eject the api client exists to deliver.
  usePageTitle(user && view !== 'bid' ? (VIEW_TITLES[view] ?? null) : null);

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
    // Old flat view URLs redirect permanently to their new hub path — checked
    // first, before the loading gate, so a stale bookmark never flashes the
    // "coming soon" default case.
    if (legacyTarget) return <Navigate to={legacyTarget} replace/>;
    if (loading) {
      return (
        <div className="scroll view-enter">
          <div style={{ padding: 32, color: 'var(--text3)' }}>Loading…</div>
        </div>
      );
    }
    switch (view) {
      case 'dashboard':
        return <CommandCenterPage bids={bids} gens={gens} wonJobs={wonJobs} repNames={repNames} onNav={setView}
          onEditGen={g => { setEditGen(g); setView('builder'); }}
          onConverted={gen => setGens(prev => prev.some(g => g.id === gen.id) ? prev : [gen, ...prev])} />;
      case 'generators':
        return (
          <GeneratorsHubPage
            tab={coerceGenTab(hubTab)}
            recordId={hubRecordId}
            onSelectTab={key => setView('generators/' + key)}
            onClearParam={clearParam}
            onNav={setView}
            gens={gens} setGens={setGens}
            wonJobs={wonJobs} setWonJobs={setWonJobs}
            flashId={flashId}
            onOpenBuilder={() => { setEditGen(null); setView('builder'); }}
            onEditGen={g => { setEditGen(g); setView('builder'); }}
            onConverted={gen => setGens(prev => prev.some(g => g.id === gen.id) ? prev : [gen, ...prev])}
          />
        );
      case 'electrical':
        return (
          <ElectricalHubPage
            tab={coerceElecTab(hubTab)}
            recordId={hubRecordId}
            onSelectTab={key => setView('electrical/' + key)}
            onClearParam={clearParam}
            bids={bids} setBids={setBids}
            wonJobs={wonJobs} setWonJobs={setWonJobs}
            onOpenBid={(id, tab) => confirmLeave(
              () => navigate('/bid/' + encodeURIComponent(id) + (tab ? '?tab=' + tab : '')),
            )}
            flashId={flashId}
            openAddBid={openAddBid}
            onAddBidHandled={() => { setOpenAddBid(false); setAddBidGc(undefined); }}
            initialGc={addBidGc}
            onBidAccepted={(bid) => { setBids(prev => [bid, ...prev]); setView('electrical/bids'); }}
            onUnreadChange={setIntakeCount}
          />
        );
      case 'sales-by-rep':
        return <SalesByRepPage wonJobs={wonJobs} userRole={user.role}/>;
      case 'builder':
        return (
          <BuilderPage
            setGens={setGens}
            setWonJobs={setWonJobs}
            onSaved={() => { setEditGen(null); setView('generators/pipeline'); }}
            editGen={editGen}
          />
        );
      case 'bid':
        if (!viewParam) return <NotFound path={view} onHome={() => setView('dashboard')}/>;
        return (
          <BidHubPage
            bidId={viewParam}
            bids={bids} setBids={setBids} wonJobs={wonJobs} setWonJobs={setWonJobs}
            pcData={pcData} onPcUpdate={handlePcUpdate} onBidUpdated={handleBidUpdated}
            // Post-review B4 — true once /preconstruction/workspaces has
            // settled at least once (same signal the restore effect above
            // gates on), so BidHubPage can tell "no workspace row exists
            // yet" apart from "the list hasn't loaded yet" instead of
            // treating both as "seed a blank one now."
            pcDataLoaded={workspacesApi.data !== null}
            onNav={setView}
          />
        );
      case 'contacts':
        return <ContactsPage onNewBid={openNewBid} onNav={setView}/>;
      case 'calendar':
        return <CalendarPage bids={bids} gens={gens} wonJobs={wonJobs}/>;
      case 'followups':
        return <FollowupsPage onCountChange={setFollowupCount}/>;
      case 'comms':
        return <CommsPage bids={bids} gens={gens} activity={activity}/>;
      case 'docs':
        return <DocsPage bids={bids} gens={gens}/>;
      case 'admin':
        if (!isPrivileged(user)) {
          return (
            <div className="scroll view-enter">
              <div style={{ padding: 32, color: 'var(--text2)', fontSize: 15 }}>
                <b>Settings</b> — you don't have permission to view this page. Contact an owner or administrator.
              </div>
            </div>
          );
        }
        return <SettingsPage/>;
      default:
        return <NotFound path={view} onHome={() => setView('dashboard')}/>;
    }
  };

  // The dashboard is the app's data; without it there is nothing honest to
  // render, so it replaces the shell rather than emptying it.
  if (dashApi.error) {
    return (
      <>
        <BootError message={dashApi.error + '.'} onRetry={retryBootstrap} retrying={dashApi.loading}/>
        {toast && <Toast toast={toast}/>}
      </>
    );
  }

  const warningBar = partialFailures.length > 0 && !warningDismissed && (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px',
      background: 'var(--amber-soft)', borderBottom: '1px solid rgba(224,165,59,.3)',
      color: 'var(--amber)', fontSize: 12.5, fontWeight: 600,
    }}>
      <Icon name="alert" size={15} stroke={2}/>
      <span style={{ flex: 1 }}>
        Some of this page didn't load: {partialFailures.join(' and ')}. Everything else is up to date.
      </span>
      <button onClick={retryBootstrap}
        style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>
        Retry
      </button>
      <button onClick={() => setWarningDismissed(true)} aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', padding: 2 }}>
        <Icon name="x" size={14} stroke={2}/>
      </button>
    </div>
  );

  const shell = (
    <AppProviders user={user} showToast={showToast} settings={settings} reloadSettings={reloadSettings}>
      <AppShell
        view={view}
        onNav={setView}
        onLogout={() => confirmLeave(logout)}
        genProposalCount={genProposalCount}
        elecProposalCount={elecProposalCount}
        genProjectCount={genProjectCount}
        elecProjectCount={elecProjectCount}
        intakeUnread={intakeCount}
        followupCount={followupCount}
        onNewProposal={() => setView('builder')}
        onNewBid={() => openNewBid()}
        bids={bids} gens={gens}
        showToast={showToast}
      >
        {warningBar}
        {/* A second boundary, inside the shell: a render crash in one page keeps
            the nav and the rest of the app usable (audit code #19). The root
            boundary in main.tsx still catches anything above this. ErrorBoundary
            wraps Suspense (not the other way around) so a chunk-load failure —
            React.lazy's import() rejecting, not just a slow fetch — throws
            during render and is caught here rather than crashing the whole app. */}
        <ErrorBoundary variant="page" resetKey={location.pathname}>
          <Suspense fallback={<PageLoadingFallback/>}>
            {renderView()}
          </Suspense>
        </ErrorBoundary>
      </AppShell>
      {toast && <Toast toast={toast}/>}
    </AppProviders>
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
