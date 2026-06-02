import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useToast } from './hooks/useToast';
import LoginPage from './features/auth/LoginPage';
import AppShell from './features/layout/AppShell';
import DashboardPage from './features/dashboard/DashboardPage';
import ElecPipelinePage from './features/pipeline/ElecPipelinePage';
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

  const [view, setView] = useState('dashboard');
  const [dashFilter, setDashFilter] = useState('all');
  const [bids, setBids] = useState<Bid[]>([]);
  const [gens, setGens] = useState<Gen[]>([]);
  const [wonJobs, setWonJobs] = useState<WonJob[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerFlash = useCallback((id: string) => {
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1800);
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api.get('/dashboard')
      .then(r => {
        setBids(r.data.bids);
        setGens(r.data.gens);
        setWonJobs(r.data.wonJobs);
        setActivity(r.data.activity);
      })
      .finally(() => setLoading(false));
  }, [user]);

  const handleLogin = async (email: string, password: string) => {
    await login(email, password);
    navigate('/');
  };

  const handleNewBid = useCallback((bid: Bid) => {
    setBids(prev => [bid, ...prev]);
    triggerFlash(bid.id);
    showToast({ title: 'Bid added to pipeline', sub: bid.name });
  }, [triggerFlash, showToast]);

  const genProposalCount  = gens.filter(g => g.stage !== 'awarded').length;
  const elecProposalCount = bids.filter(b => b.stage === 'due' || b.stage === 'submitted').length;
  const genProjectCount   = gens.filter(g => g.stage === 'awarded').length;
  const elecProjectCount  = bids.filter(b => b.stage === 'awarded').length;

  if (!user) {
    return (
      <>
        <Routes>
          <Route path="/login" element={<LoginPage onLogin={handleLogin}/>}/>
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
            onNav={setView} onNewProposal={() => setView('builder')}
          />
        );
      case 'elec-proposals':
        return (
          <ElecPipelinePage
            bids={bids}
            setBids={setBids}
            setWonJobs={setWonJobs}
            showToast={showToast}
            onOpenPreconstruction={id => { setView('preconstruction'); }}
            flashId={flashId}
          />
        );
      default:
        return <StubPage title={view.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}/>;
    }
  };

  return (
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
        newIncoming={0}
        dashFilter={dashFilter}
        onDashFilter={setDashFilter}
        onNewProposal={() => setView('builder')}
        onNewBid={() => setView('elec-proposals')}
      >
        {renderView()}
      </AppShell>
      {toast && <Toast toast={toast}/>}
    </>
  );
}
