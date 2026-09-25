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
import { startIntakeInboxPoller } from './integrations/intakePoller';
import { startLeadNudgeScheduler } from './integrations/leadNudge';
import { startProposalQuietSweep } from './services/proposalQuietSweep';
import { resetStuckIndexingOnBoot } from './estimating/sheets';
import { resetStuckJobProfilesOnBoot } from './services/jobProfileRun';
import { requireAuth, AuthRequest, initJwtSecret } from './middleware/auth';
import authRouter from './routes/auth';
import dashboardRouter from './routes/dashboard';
import briefRouter from './routes/brief';
import bidsRouter from './routes/bids';
import gensRouter from './routes/gens';
import wonJobsRouter from './routes/wonJobs';
import usersRouter from './routes/users';
import commsRouter from './routes/comms';
import customersRouter from './routes/customers';
import tasksRouter from './routes/tasks';
import notificationsRouter from './routes/notifications';
import preconRouter from './routes/preconstruction';
import sheetCheckRouter from './routes/sheetCheck';
import jobProfileRouter from './routes/jobProfile';
import projectsRouter from './routes/projects';
import documentsRouter from './routes/documents';
import settingsRouter from './routes/settings';
import accountRulesRouter from './routes/accountRules';
import adminRouter from './routes/admin';
import intakeRouter from './routes/intake';
import leadsRouter from './routes/leads';
import estimatesRouter from './routes/estimates';
import estimatingRouter from './routes/estimating';
import pushRouter from './routes/push';
import calendarRouter from './routes/calendar';
import clientErrorsRouter from './routes/clientErrors';

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
// Headers/methods advertised on preflight. X-API-Key lets the browser
// extension authenticate its cross-origin POST /api/leads call.
const corsHeaders = ['Content-Type', 'Authorization', 'X-API-Key'];
const corsMethods = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
app.use(cors((req, cb) => {
  const origin = req.headers.origin;
  const opts = { allowedHeaders: corsHeaders, methods: corsMethods };
  if (!origin) return cb(null, { ...opts, origin: true });
  // Browser extensions (the Kohler Lead Puller) call from a chrome-extension:// origin.
  if (origin.startsWith('chrome-extension://')) return cb(null, { ...opts, origin: true });
  let sameOrigin = false;
  try { sameOrigin = new URL(origin).host === req.headers.host; } catch { /* malformed Origin */ }
  if (sameOrigin || allowedOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, { ...opts, origin: true });
  cb(null, { ...opts, origin: false });
}));
app.use(express.json());

// Every JWT and the AUTOMATION_API_KEY value would otherwise be written to the
// log stream in plaintext at info level — a log leak becomes an
// account-takeover vector (audit: Ops #7 / Security #12, High). Exported so
// tests can verify the exact paths pino redacts, not a hand-copied duplicate.
export const LOG_REDACT_PATHS = [
  'req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie', 'res.headers["set-cookie"]',
];
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: req => req.url === '/api/health' },
  redact: LOG_REDACT_PATHS,
}));

// Behind Render's proxy, req.ip is the proxy's own address without this, so
// authLimiter (routes/auth.ts) becomes a single global bucket shared by every
// user instead of one per real client IP (audit: Ops #13, Medium).
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/brief', briefRouter);
app.use('/api/bids', bidsRouter);
app.use('/api/gens', gensRouter);
app.use('/api/won-jobs', wonJobsRouter);
app.use('/api/users', usersRouter);
app.use('/api/comms', commsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/preconstruction', sheetCheckRouter);
app.use('/api/preconstruction', jobProfileRouter);
app.use('/api/preconstruction', preconRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/account-rules', accountRulesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/intake', intakeRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/estimates', estimatesRouter);
app.use('/api/estimating', estimatingRouter);
app.use('/api/push', pushRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/client-errors', clientErrorsRouter);

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

// If the Postgres pool degrades post-boot (a dropped Supabase connection, an
// exhausted pool), a health check that never touches the DB reports healthy
// while the app is actually broken (audit: Ops #13, Medium).
app.get('/api/health', async (_req, res) => {
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('health check DB timeout')), 2000)),
    ]);
    res.json({ ok: true, db: true });
  } catch (err) {
    logger.error({ err }, '[health] DB check failed');
    res.status(503).json({ ok: false, db: false });
  }
});

if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(__dirname, '../../frontend/dist');
  // Content-hashed build assets (index-<hash>.js/.css) are immutable — cache them hard.
  // index.html must NEVER be cached: it points at the current asset hashes, so a stale
  // copy pins the browser to an old bundle and new deploys never appear (see the
  // "invisible tabs" incident). no-store forces a fresh fetch of index.html every load.
  app.use(express.static(staticPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(path.join(staticPath, 'index.html'));
  });
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
      // Fix round 2 / R2-B3 — before accepting any requests: every
      // est_document_index_status row still 'indexing' at this point
      // belongs to a job that died with whatever PREVIOUS process
      // instance claimed it (a redeploy, a restart, an OOM, ts-node-dev's
      // own --respawn) — reset it to 'pending' so the very first GET
      // /sheets after boot picks it back up, instead of the client
      // polling a stuck 'indexing' status for up to the stale-lease
      // timeout before it self-heals.
      await resetStuckIndexingOnBoot();
      // Job profile round 2 (R2-B2) — a sheet check / job profile left
      // running by the previous process is marked interrupted, never
      // waited on forever.
      await resetStuckJobProfilesOnBoot().catch(err => logger.warn({ err }, 'Failed to reset stuck job profiles on boot'));
      const server = app.listen(port, () => logger.info(`Backend running on :${port}`));
      startReminderScheduler();
      startIntakeInboxPoller();
      startLeadNudgeScheduler();
      startProposalQuietSweep();

      // On SIGTERM (Render redeploy), mark any stuck in-progress analyses as error
      // so the frontend poll sees a terminal state instead of spinning forever.
      process.on('SIGTERM', async () => {
        logger.info('SIGTERM received — marking in-progress analyses as interrupted');
        try {
          await pool.query(
            `UPDATE takeoff_results SET status='error', agent1_output=
              CASE WHEN agent1_output IS NULL THEN 'Analysis interrupted: server redeployed mid-run. Re-run the analysis.' ELSE agent1_output END
            WHERE status IN ('running','agent1_complete','agent2_running','agent2_complete','agent3_running')`
          );
        } catch (err) {
          logger.error({ err }, 'Failed to clean up in-progress analyses on shutdown');
        }
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000);
      });
    })
    .catch(err => {
      logger.error({ err }, 'Migration failed, aborting startup');
      process.exit(1);
    });
}