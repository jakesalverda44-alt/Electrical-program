import React, { useState } from 'react';
import aptLogo from '../../assets/apt-logo.png';
import api from '../../api/client';

function MicrosoftLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
      <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
      <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
  );
}

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
}

function ForgotPasswordView({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try { await api.post('/auth/forgot-password', { email }); } catch { /* fail silently */ }
    finally { setLoading(false); setSent(true); }
  };

  if (sent) return (
    <div className="login-card">
      <div className="login-logo"><img src={aptLogo} alt="Accurate Power & Technology"/></div>
      <div className="login-title">Check your email</div>
      <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
        If an account exists for <strong>{email}</strong>, you'll receive a password reset link within a few minutes.
      </p>
      <button className="btn login-btn" onClick={onBack}>Back to Sign In</button>
    </div>
  );

  return (
    <div className="login-card">
      <div className="login-logo"><img src={aptLogo} alt="Accurate Power & Technology"/></div>
      <div className="login-title">Reset your password</div>
      <form onSubmit={submit} className="login-form">
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@accuratepower.com" required autoFocus/>
        </div>
        <button className="btn login-btn" type="submit" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <button onClick={onBack} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:13, marginTop:12, textDecoration:'underline' }}>
        Back to Sign In
      </button>
    </div>
  );
}

function ResetPasswordView({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Reset failed. The link may have expired.');
    } finally { setLoading(false); }
  };

  if (done) return (
    <div className="login-card">
      <div className="login-logo"><img src={aptLogo} alt="Accurate Power & Technology"/></div>
      <div className="login-title">Password updated</div>
      <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', marginBottom: 20 }}>Your password has been reset. You can now sign in.</p>
      <button className="btn login-btn" onClick={onDone}>Sign In</button>
    </div>
  );

  return (
    <div className="login-card">
      <div className="login-logo"><img src={aptLogo} alt="Accurate Power & Technology"/></div>
      <div className="login-title">Set a new password</div>
      <form onSubmit={submit} className="login-form">
        <div className="field">
          <label>New Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" required autoFocus/>
        </div>
        <div className="field">
          <label>Confirm Password</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password" required/>
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="btn login-btn" type="submit" disabled={loading}>
          {loading ? 'Updating…' : 'Set Password'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [screen, setScreen] = useState<'login' | 'forgot'>('login');

  // Handle /reset-password?token=... URL
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get('token');
  if (resetToken && window.location.pathname === '/reset-password') {
    return (
      <div className="login-page">
        <ResetPasswordView token={resetToken} onDone={() => { window.history.replaceState({}, '', '/login'); }}/>
      </div>
    );
  }

  // Handle ?error=... from failed Microsoft OAuth
  const oauthError = params.get('error');

  if (screen === 'forgot') {
    return <div className="login-page"><ForgotPasswordView onBack={() => setScreen('login')}/></div>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const msLoginUrl = `${import.meta.env.VITE_API_BASE || ''}/api/auth/microsoft`;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src={aptLogo} alt="Accurate Power & Technology"/>
        </div>
        <div className="login-title">Sign in to your account</div>

        {/* Microsoft SSO — primary */}
        <a href={msLoginUrl} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          width: '100%', padding: '11px 0', borderRadius: 11, border: '1px solid var(--border2)',
          background: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: 14,
          textDecoration: 'none', marginBottom: 16, transition: 'background .12s' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}>
          <MicrosoftLogo/>
          Sign in with Microsoft
        </a>

        {(error || oauthError) && (
          <div className="login-error" style={{ marginBottom: 12 }}>{error || decodeURIComponent(oauthError || '')}</div>
        )}

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
        </div>

        {/* Email/password fallback */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@accuratepower.com" required/>
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required/>
          </div>
          {error && !oauthError && <div className="login-error">{error}</div>}
          <button className="btn login-btn" type="submit" disabled={loading}
            style={{ background: 'var(--surface2)', color: 'var(--text2)', boxShadow: 'none', border: '1px solid var(--border)' }}>
            {loading ? 'Signing in…' : 'Sign in with password'}
          </button>
        </form>
        <button onClick={() => setScreen('forgot')}
          style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:13, marginTop:12, textDecoration:'underline' }}>
          Forgot your password?
        </button>
      </div>
    </div>
  );
}
