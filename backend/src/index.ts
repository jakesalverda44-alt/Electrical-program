import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { runMigrations } from './migrate';
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

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
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
