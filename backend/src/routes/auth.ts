import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, getJwtSecret, TOKEN_TTL } from '../middleware/auth';
import { Resend } from 'resend';
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

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
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

// Step 1 — redirect to Microsoft login
router.get('/microsoft', (_req, res) => {
  const clientId = MS_CLIENT_ID();
  if (!clientId) return res.status(503).send('Microsoft login not configured. Add MICROSOFT_CLIENT_ID to environment.');
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  msRedirectUri(),
    response_mode: 'query',
    scope:         'openid email profile User.Read',
    prompt:        'select_account',
  });
  res.redirect(`https://login.microsoftonline.com/${MS_TENANT_ID()}/oauth2/v2.0/authorize?${params}`);
});

// Step 2 — Microsoft redirects back with ?code=...
router.get('/microsoft/callback', async (req, res) => {
  const { code, error, error_description } = req.query as Record<string, string>;
  const frontendBase = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://electrical-program.onrender.com';

  if (error) {
    console.error('[ms-oauth]', error, error_description);
    return res.redirect(`${frontendBase}/login?error=${encodeURIComponent('Microsoft login failed: ' + (error_description || error))}`);
  }
  if (!code) return res.redirect(`${frontendBase}/login?error=missing_code`);

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
      'SELECT * FROM users WHERE LOWER(email)=$1 AND status!=\'inactive\'',
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

    // Redirect to frontend with token
    res.redirect(`${frontendBase}/?mstoken=${appToken}`);
  } catch (err) {
    console.error('[ms-oauth] callback error:', err);
    res.redirect(`${frontendBase}/login?error=${encodeURIComponent('Microsoft login failed. Please try again.')}`);
  }
});

// Password reset — generates a short-lived token and emails a reset link
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const { rows } = await pool.query('SELECT id, name FROM users WHERE email=$1', [email.toLowerCase()]);
  // Always respond OK to avoid user enumeration
  if (!rows.length) return res.json({ ok: true });
  const user = rows[0];

  const token = jwt.sign(
    { id: user.id, purpose: 'reset' },
    getJwtSecret(),
    { expiresIn: '1h' }
  );
  await pool.query('UPDATE users SET reset_token=$1, reset_token_expires=now()+interval\'1 hour\' WHERE id=$2', [token, user.id]);

  const [apiKey, fromAddress, fromName, frontendUrl] = await Promise.all([
    getSetting('email_resend_api_key'),
    getSetting('email_from_address'),
    getSetting('email_from_name'),
    getSetting('frontend_url'),
  ]);
  const base = frontendUrl || 'https://electrical-program.onrender.com';
  const link = `${base}/reset-password?token=${token}`;
  const subject = 'Password Reset — Accurate Power & Technology';
  const html = `<p>Hi ${user.name},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email.</p>`;

  // Prefer Microsoft Graph (app-only); fall back to Resend only if Graph isn't configured.
  if (isGraphMailConfigured()) {
    await graphSendMail({ to: email.toLowerCase(), subject, html }).catch(() => {});
  } else if (apiKey) {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
      to: email.toLowerCase(),
      subject,
      html,
      text: `Hi ${user.name},\n\nReset your password: ${link}\n\nExpires in 1 hour.`,
    }).catch(() => {});
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
      'SELECT id FROM users WHERE id=$1 AND reset_token=$2 AND reset_token_expires > now()',
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
