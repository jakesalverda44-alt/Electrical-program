import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validateBody } from '../utils/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Sink for browser-side failures (audit frontend-code #15). `console` appears
 * exactly twice in non-test frontend code, so before this a production failure
 * left no trace anywhere: not in the UI, not in the console, not on a server.
 *
 * Deliberately not stored in the database: this is log-stream telemetry, and a
 * table would need retention, indexes and a purge job of its own (the audit
 * already flags six unbounded tables). One pino `warn` line is enough to see
 * that a page is throwing for a real user.
 */

// 8 KB. The stack is the only field that can be large, and 2 KB of it is all
// that gets logged, so anything bigger is either a bug or an abuse attempt.
const MAX_BODY_BYTES = 8 * 1024;

const clientErrorSchema = z.object({
  message: z.string().trim().min(1, 'message is required').max(2_000),
  stack: z.string().max(MAX_BODY_BYTES).optional(),
  /** Where in the app it happened, e.g. 'ErrorBoundary' or 'useApi /dashboard'. */
  context: z.string().trim().max(200).optional(),
  url: z.string().max(2_000).optional(),
  userAgent: z.string().max(500).optional(),
});

const clientErrorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // Keyed per user, not per IP: a whole office behind one NAT address must not
  // share a bucket, and the route is authenticated so a user id always exists.
  validate: { ip: false },
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? req.ip ?? 'unknown',
  message: { error: 'Too many client error reports.' },
});

/**
 * Rejects an oversized report before it is read for content. The app-level
 * `express.json()` in index.ts has already parsed the body by this point (with
 * its own 100 KB default), so this is the route's own, tighter contract rather
 * than a parser limit.
 */
function rejectOversized(req: AuthRequest, res: import('express').Response, next: import('express').NextFunction) {
  const declared = Number(req.headers['content-length'] ?? 0);
  const actual = req.body ? Buffer.byteLength(JSON.stringify(req.body), 'utf8') : 0;
  if (Math.max(declared, actual) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Error report too large' });
  }
  next();
}

router.post(
  '/',
  requireAuth,
  clientErrorLimiter,
  rejectOversized,
  validateBody(clientErrorSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const { message, stack, context, url, userAgent } = req.body as z.infer<typeof clientErrorSchema>;
    logger.warn({
      user: req.user!.id,
      context: context ?? null,
      message,
      url: url ?? null,
      userAgent: userAgent ?? null,
      stack: stack ? stack.slice(0, 2_000) : null,
    }, 'client error');
    // Nothing for the browser to do with a response; the call is fire-and-forget.
    res.status(204).end();
  }),
);

export default router;
