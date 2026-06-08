import 'express-async-errors';
import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import dotenv from 'dotenv';
import { pinoHttp } from 'pino-http';
import { runMigrations } from './migrate';
import { pool } from './db/pool';
import { logger } from './utils/logger';
import { asyncHandler } from './utils/asyncHandler';
import { startReminderScheduler } from './notifications/engine';
import { requireAuth, AuthRequest, initJwtSecret } from './middleware/auth';
import authRouter from './routes/auth';
import dashboardRouter from './routes/dashboard';
import bidsRouter from './routes/bids';
import gensRouter from './routes/gens';
import wonJobsRouter from './routes/wonJobs';
import usersRouter from './routes/users';
import commsRouter from './routes/comms';
import customersRouter from './routes/customers';
import tasksRouter from './routes/tasks';
import notificationsRouter from './routes/notifications';
import preconRouter from './routes/preconstruction';
import projectsRouter from './routes/projects';
import documentsRouter from './routes/documents';
import settingsRouter from './routes/settings';
import adminRouter from './routes/admin';
import intakeRouter from './routes/intake';
import leadsRouter from './routes/leads';
import estimatesRouter from './routes/estimates';

dotenv.config();

process.on('unhandledRejection', err => {
  logger.error({ err }, 'Unhandled promise rejection');
});

process.on('uncaughtException', err => {
  logger.fatal({ err }, 'Uncaught exception');
});

const app = express();

app.use(helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false }));

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
  .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);
if (process.env.NODE_ENV !== 'production' && !allowedOrigins.length) {
  allowedOrigins.push('http://localhost:3000', 'http://localhost:5173');
}
app.use(cors((req, cb) => {
  const origin = req.headers.origin;
  if (!origin) return cb(null, { origin: true });
  let sameOrigin = false;
  try { sameOrigin = new URL(origin).host === req.headers.host; } catch { /* malformed Origin */ }
  if (sameOrigin || allowedOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, { origin: true });
  cb(null, { origin: false });
}));
app.use(express.json());
app.use(pinoHttp({ logger, autoLogging: { ignore: req => req.url === '/api/health' } }));

app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/bids', bidsRouter);
app.use('/api/gens', gensRouter);
app.use('/api/won-jobs', wonJobsRouter);
app.use('/api/users', usersRouter);
app.use('/api/comms', commsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/preconstruction', preconRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/intake', intakeRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/estimates', estimatesRouter);

app.get('/api/ai/usage/today', requireAuth, asyncHandler(async (_req: AuthRequest, res) => {
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
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(staticPath));
  app.get('*', (_req, res) => res.sendFile(path.join(staticPath, 'index.html')));
}

app.use((err: Error & { code?: string; status?: number; statusCode?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err, path: req.path }, 'Unhandled request error');
  if (res.headersSent) return;
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large. Please upload a smaller file.' });
  }
  if (err.name === 'SyntaxError' && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request body' });
  }
  const status = err.status || err.statusCode || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status === 500 ? 'Server error' : err.message,
  });
});

const port = Number(process.env.PORT) || 3001;

export { app };

if (require.main === module) {
  runMigrations()
    .then(async () => {
      await initJwtSecret();
      app.listen(port, () => logger.info(`Backend running on :${port}`));
      startReminderScheduler();
    })
    .catch(err => {
      logger.error({ err }, 'Migration failed, aborting startup');
      process.exit(1);
    });
}