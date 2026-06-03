import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { Resend } from 'resend';
import { getSetting } from '../db/getSetting';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, (req: AuthRequest, res) => {
  res.json(req.user);
});

// Password reset — generates a short-lived token and emails a reset link
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const { rows } = await pool.query('SELECT id, name FROM users WHERE email=$1', [email.toLowerCase()]);
  // Always respond OK to avoid user enumeration
  if (!rows.length) return res.json({ ok: true });
  const user = rows[0];

  const token = jwt.sign(
    { id: user.id, purpose: 'reset' },
    process.env.JWT_SECRET || 'dev_secret',
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

  if (apiKey) {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
      to: email.toLowerCase(),
      subject: 'Password Reset — Accurate Power & Technology',
      html: `<p>Hi ${user.name},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      text: `Hi ${user.name},\n\nReset your password: ${link}\n\nExpires in 1 hour.`,
    }).catch(() => {});
  }
  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 6) return res.status(400).json({ error: 'Token and password (min 6 chars) required' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret') as { id: string; purpose: string };
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
