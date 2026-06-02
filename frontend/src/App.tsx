import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useToast } from './hooks/useToast';
import LoginPage from './features/auth/LoginPage';
import AppShell from './features/layout/AppShell';
import DashboardPage from './features/dashboard/DashboardPage';
import Toast from './components/Toast';
import api from './api/client';
import { Bid, Gen, WonJob, Activity } from './types';

function StubPage({ title }: { title: string }) {
  return <div className="scroll view-enter"><div style={{ padding:32, color:'var(--text2)' }}>{title} — coming soon</div></div>;
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

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api.get('/dashboard').then(r => {
      setBids(r.data.bids);
      setGens(r.data.gens);
      setWonJobs(r.data.wonJobs);
      setActivity(r.data.activity);
    }).finally(() => setLoading(false));
  }, [user]);

  const handleLogin = async (email: string, password: string) => {
    await login(email, password);
    navigate('/');
  };

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
    if (loading) return <div className="scroll view-enter"><div style={{ padding:32, color:'var(--text3)' }}>Loading…</div></div>;
    switch (view) {
      case 'dashboard':
        return <DashboardPage bids={bids} gens={gens} wonJobs={wonJobs} activity={activity} onNav={setView} onNewProposal={() => setView('builder')}/>;
      default:
        return <StubPage title={view}/>;
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
        newIncoming={2}
        dashFilter={dashFilter}
        onDashFilter={setDashFilter}
        onNewProposal={() => setView('builder')}
        onNewBid={() => {}}
      >
        {renderView()}
      </AppShell>
      {toast && <Toast toast={toast}/>}
    </>
  );
}
