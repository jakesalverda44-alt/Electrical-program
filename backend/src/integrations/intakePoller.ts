import { logger } from '../utils/logger';
import { ingestTaggedBidEmails } from './intakeEmailIngest';

// Background poller that pulls "new bid"-tagged Outlook emails into the Intake Inbox every
// ~20 minutes. Mirrors the reminder scheduler's concurrency-guarded pattern. Disabled in
// tests and when INTAKE_POLL_DISABLED=true (or when Graph isn't configured, ingest no-ops).

const POLL_MS = 20 * 60 * 1000; // 20 minutes
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startIntakeInboxPoller(): void {
  if (process.env.NODE_ENV === 'test' || process.env.INTAKE_POLL_DISABLED === 'true') return;
  if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET) {
    logger.info('[intake-poller] GRAPH_* not configured — inbox polling disabled');
    return;
  }
  if (timer) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await ingestTaggedBidEmails();
    } catch (err) {
      logger.error({ err }, '[intake-poller] tick failed');
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 45_000);          // first run shortly after startup
  timer = setInterval(tick, POLL_MS); // then every 20 minutes
  logger.info('[intake-poller] started (every 20m)');
}
