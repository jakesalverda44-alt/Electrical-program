import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import dotenv from 'dotenv';
import { runMigrations } from './migrate';
import { pool } from './db/pool';
import { requireAuth, AuthRequest } from './middleware/auth';
import authRouter from './routes/auth';
import dashboardRouter from './routes/dashboard';
import bidsRouter from './routes/bids';
import gensRouter from './routes/gens';
import wonJobsRouter from './routes/wonJobs';
import usersRouter from './routes/users';
import commsRouter from './routes/comms';
import preconRouter from './routes/preconstruction';
import projectsRouter from './routes/projects';
import documentsRouter from './routes/documents';
import settingsRouter from './routes/settings';

dotenv.config();

const app = express();

// Security headers. In production the frontend is served from the same origin as the
// API, so the default CSP is fine; disable it in dev where Vite runs on a separate port.
app.use(helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false }));

// CORS allowlist. Comma-separated origins from CORS_ORIGIN/FRONTEND_URL.
// In production the SPA is same-origin (served by this process), so cross-origin requests
// are only allowed for explicitly configured origins — never a blanket '*'.
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
  .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);
if (process.env.NODE_ENV !== 'production' && !allowedOrigins.length) {
  allowedOrigins.push('http://localhost:3000', 'http://localhost:5173');
}
app.use(cors({
  origin(origin, cb) {
    // Allow same-origin / non-browser requests (no Origin header) and configured origins.
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/bids', bidsRouter);
app.use('/api/gens', gensRouter);
app.use('/api/won-jobs', wonJobsRouter);
app.use('/api/users', usersRouter);
app.use('/api/comms', commsRouter);
app.use('/api/preconstruction', preconRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/settings', settingsRouter);

// AI usage today — per-user analysis count for the current day
app.get('/api/ai/usage/today', requireAuth, async (_req: AuthRequest, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await pool.query(`
    SELECT u.id, u.name, u.role, COUNT(a.id)::int AS count
    FROM users u
    LEFT JOIN activity a ON a.user_id = u.id AND a.kind = 'ai_analysis' AND a.created_at::date = $1::date
    WHERE u.status = 'active'
    GROUP BY u.id, u.name, u.role
    ORDER BY count DESC
  `, [today]);
  res.json(rows);
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve compiled React app in production
if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(staticPath));
  app.get('*', (_req, res) => res.sendFile(path.join(staticPath, 'index.html')));
}

const port = Number(process.env.PORT) || 3001;

runMigrations()
  .then(() => {
    app.listen(port, () => console.log(`Backend running on :${port}`));
  })
  .catch(err => {
    console.error('Migration failed, aborting startup:', err);
    process.exit(1);
  });
