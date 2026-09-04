import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, getJwtSecret, TOKEN_TTL } from '../middleware/auth';
import { getSetting } from '../db/getSetting';
import { graphSendMail, isGraphMailConfigured } from '../email/graphMailer';

const router = Router();

// Throttle credential endpoints to slow brute-force / enumeration attacks.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

// GET /microsoft is a browser navigation, not a credential guess — sharing
// authLimiter's 10/15min bucket with /login, /forgot-password, and
// /reset-password meant failed passwords could burn the whole office's SSO
// budget behind Render's `trust proxy 1` + a shared NAT (non-blocker,
// post-review re-review). Looser and separate: it only protects against the
// oauthStates map being grown pointlessly fast, not credential stuffing —
// there's no password to guess on this path.
const msLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND status = \'active\'', [email.toLowerCase()]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role, org_id: user.org_id },
      getJwtSecret(),
      { expiresIn: TOKEN_TTL }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, (req: AuthRequest, res) => {
  res.json(req.user);
});

// ── Microsoft OAuth (Entra ID / Azure AD) ─────────────────────────────────────

const MS_CLIENT_ID     = () => process.env.MICROSOFT_CLIENT_ID     || '';
const MS_CLIENT_SECRET = () => process.env.MICROSOFT_CLIENT_SECRET || '';
const MS_TENANT_ID     = () => process.env.MICROSOFT_TENANT_ID     || 'common';

function msRedirectUri() {
  const base = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://electrical-program.onrender.com';
  // Use the backend path (same origin in production, backend port in dev)
  return base.replace(/\/$/, '') + '/api/auth/microsoft/callback';
}

// CSRF state + one-time exchange code, both in-memory (audit: Security #8, High).
// In-memory rather than a signed cookie: this app runs as a single Node instance
// (render.yaml declares no numInstances/scaling), so there's no cross-process
// sharing to worry about, and it avoids adding cookie-parsing middleware for a
// value that's only ever read back within the same OAuth round trip. Each map
// is pruned opportunistically on the next write of its kind — traffic through
// this login is low enough that a background timer isn't warranted.
const oauthStates = new Map<string, number>(); // state -> expiresAt (ms)
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
// GET /microsoft is unauthenticated and mints one entry per call; without a
// cap an attacker could grow this map freely (non-blocker T7, post-review).
const OAUTH_STATE_MAX = 1000;

interface MsExchangeEntry {
  appToken: string;
  user: { id: string; name: string; email: string; role: string };
  expiresAt: number;
}
const msExchangeCodes = new Map<string, MsExchangeEntry>();
const MS_EXCHANGE_TTL_MS = 60 * 1000; // 60 seconds

function pruneOauthStates() {
  const now = Date.now();
  for (const [state, expiresAt] of oauthStates) if (expiresAt < now) oauthStates.delete(state);
  // Still over the cap after pruning expired entries — evict the oldest ones.
  // Map iteration order is insertion order, so the first key is the oldest.
  while (oauthStates.size >= OAUTH_STATE_MAX) {
    const oldest = oauthStates.keys().next().value;
    if (oldest === undefined) break;
    oauthStates.delete(oldest);
  }
}
function pruneMsExchangeCodes() {
  const now = Date.now();
  for (const [code, entry] of msExchangeCodes) if (entry.expiresAt < now) msExchangeCodes.delete(code);
}

// Step 1 — redirect to Microsoft login
router.get('/microsoft', msLoginLimiter, (_req, res) => {
  const clientId = MS_CLIENT_ID();
  if (!clientId) return res.status(503).send('Microsoft login not configured. Add MICROSOFT_CLIENT_ID to environment.');
  pruneOauthStates();
  const state = crypto.randomBytes(32).toString('hex');
  oauthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS);
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  msRedirectUri(),
    response_mode: 'query',
    scope:         'openid email profile User.Read',
    prompt:        'select_account',
    state,
  });
  res.redirect(`https://login.microsoftonline.com/${MS_TENANT_ID()}/oauth2/v2.0/authorize?${params}`);
});

// Step 2 — Microsoft redirects back with ?code=...&state=...
router.get('/microsoft/callback', async (req, res) => {
  const { code, error, error_description, state } = req.query as Record<string, string>;
  const frontendBase = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://electrical-program.onrender.com';

  if (error) {
    console.error('[ms-oauth]', error, error_description);
    return res.redirect(`${frontendBase}/login?error=${encodeURIComponent('Microsoft login failed: ' + (error_description || error))}`);
  }
  if (!code) return res.redirect(`${frontendBase}/login?error=missing_code`);

  // CSRF: the state must match one we minted for a /microsoft redirect and not
  // have expired, checked BEFORE any token exchange with Microsoft (audit:
  // Security #8, High). One-time use — delete on read either way.
  const stateExpiry = state ? oauthStates.get(state) : undefined;
  if (state) oauthStates.delete(state);
  if (!state || stateExpiry === undefined || stateExpiry < Date.now()) {
    // This fires on a browser navigation (Microsoft redirecting the user's
    // address bar), not an API call — a raw JSON 400 left the user staring at
    // it verbatim, e.g. after a backend restart mid-login drops the in-memory
    // state (non-blocker T7, post-review). Redirect to the login page instead.
    return res.redirect(`${frontendBase}/login?error=oauth_state`);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID()}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     MS_CLIENT_ID(),
        client_secret: MS_CLIENT_SECRET(),
        code,
        grant_type:    'authorization_code',
        redirect_uri:  msRedirectUri(),
        scope:         'openid email profile User.Read',
      }),
    });
    const tokens = await tokenRes.json() as Record<string, string>;
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    // Decode ID token to get email (no need to verify — we just exchanged a code with Microsoft directly)
    const idTokenParts = tokens.id_token?.split('.');
    if (!idTokenParts || idTokenParts.length < 2) throw new Error('Invalid id_token');
    const claims = JSON.parse(Buffer.from(idTokenParts[1], 'base64url').toString()) as Record<string, string>;
    const email = (claims.email || claims.preferred_username || '').toLowerCase();
    const name  = claims.name || email;

    if (!email) throw new Error('No email in Microsoft token');

    // Look up user by email
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE LOWER(email)=$1 AND status=\'active\'',
      [email]
    );
    if (!rows.length) {
      return res.redirect(`${frontendBase}/login?error=${encodeURIComponent(`No account found for ${email}. Contact an administrator to be added.`)}`);
    }
    const user = rows[0];

    // Update last_login
    await pool.query('UPDATE users SET last_login=now() WHERE id=$1', [user.id]);

    // Issue app JWT
    const appToken = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role, org_id: user.org_id },
      getJwtSecret(),
      { expiresIn: TOKEN_TTL }
    );

    // A bearer token in the URL lands in browser history and in the Referer of
    // any third-party asset the landing page loads. Hand back a one-time code
    // instead; the frontend exchanges it once via POST .../microsoft/exchange
    // (audit: Security #8, High).
    pruneMsExchangeCodes();
    const exchangeCode = crypto.randomBytes(32).toString('hex');
    msExchangeCodes.set(exchangeCode, {
      appToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      expiresAt: Date.now() + MS_EXCHANGE_TTL_MS,
    });

    res.redirect(`${frontendBase}/?mscode=${exchangeCode}`);
  } catch (err) {
    console.error('[ms-oauth] callback error:', err);
    res.redirect(`${frontendBase}/login?error=${encodeURIComponent('Microsoft login failed. Please try again.')}`);
  }
});

// Step 3 — one-time exchange: trades the short-lived code from the callback
// redirect for the real app token. Deletes the code immediately (whether found,
// expired, or not) so it can never be replayed (audit: Security #8, High).
router.post('/microsoft/exchange', (req, res) => {
  const { code } = req.body as { code?: string };
  if (!code) return res.status(400).json({ error: 'Code required' });
  const entry = msExchangeCodes.get(code);
  msExchangeCodes.delete(code);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(404).json({ error: 'Code expired or already used. Please sign in again.' });
  }
  res.json({ token: entry.appToken, user: entry.user });
});

// Password reset — generates a short-lived token and emails a reset link
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const { rows } = await pool.query('SELECT id, name FROM users WHERE email=$1 AND status=\'active\'', [email.toLowerCase()]);
  // Always respond OK to avoid user enumeration
  if (!rows.length) return res.json({ ok: true });
  const user = rows[0];

  const token = jwt.sign(
    { id: user.id, purpose: 'reset' },
    getJwtSecret(),
    { expiresIn: '1h' }
  );
  await pool.query('UPDATE users SET reset_token=$1, reset_token_expires=now()+interval\'1 hour\' WHERE id=$2', [token, user.id]);

  const frontendUrl = await getSetting('frontend_url');
  const base = frontendUrl || 'https://electrical-program.onrender.com';
  const link = `${base}/reset-password?token=${token}`;
  const subject = 'Password Reset — Accurate Power & Technology';
  const html = `<p>Hi ${user.name},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email.</p>`;

  // Mail goes out through Microsoft Graph (app-only) from the shared mailbox.
  if (isGraphMailConfigured()) {
    await graphSendMail({ to: email.toLowerCase(), subject, html }).catch(() => {});
  }
  res.json({ ok: true });
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8) return res.status(400).json({ error: 'Token and password (min 8 chars) required' });
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { id: string; purpose: string };
    if (payload.purpose !== 'reset') return res.status(400).json({ error: 'Invalid token' });
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE id=$1 AND reset_token=$2 AND reset_token_expires > now() AND status=\'active\'',
      [payload.id, token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Token expired or already used' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2', [hash, payload.id]);
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
});

export default router;
