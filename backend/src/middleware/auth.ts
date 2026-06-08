import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { logger } from '../utils/logger';
import { DEFAULT_ORG_ID } from '../utils/scope';

export interface AuthRequest extends Request {
  user?: { id: string; name: string; email: string; role: string; org_id: string };
}

// The signing/verification secret. Resolved at startup via initJwtSecret().
// Outside production a dev fallback is available immediately so tests/local work.
let jwtSecret: string | null = process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production' ? 'dev_secret' : null);

export function getJwtSecret(): string {
  if (!jwtSecret) throw new Error('JWT secret not initialized — call initJwtSecret() at startup.');
  return jwtSecret;
}

/**
 * Resolve the JWT secret at startup, preferring the JWT_SECRET env var. If it is
 * not set, generate a strong secret once and persist it in app_settings so it is
 * reused across restarts/deploys (keeping sessions stable) rather than falling back
 * to a publicly-known default. This guarantees the service starts even when the env
 * var is missing, instead of crashing and taking the whole site down.
 * Call once after migrations have run (app_settings must exist).
 */
export async function initJwtSecret(): Promise<void> {
  if (process.env.JWT_SECRET) { jwtSecret = process.env.JWT_SECRET; return; }
  try {
    const generated = crypto.randomBytes(48).toString('base64url');
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('jwt_secret', $1) ON CONFLICT (key) DO NOTHING`,
      [generated]
    );
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'jwt_secret'`);
    jwtSecret = rows[0]?.value || generated;
    if (process.env.NODE_ENV === 'production') {
      logger.warn('JWT_SECRET is not set; using a generated secret persisted in app_settings. Set JWT_SECRET in your environment as a best practice.');
    }
  } catch (err) {
    // Last resort: an ephemeral per-process secret so the app still serves.
    jwtSecret = jwtSecret || crypto.randomBytes(48).toString('base64url');
    logger.error({ err }, 'Could not load/persist jwt_secret; using an ephemeral secret for this process');
  }
}

// How long an issued access token stays valid (kept short; refresh tokens are a Phase 2 item).
export const TOKEN_TTL = '12h';

// Re-exported from utils/scope so route handlers can keep importing tenant/scope
// helpers from the middleware.
export { ownScopeId, orgScope, DEFAULT_ORG_ID } from '../utils/scope';

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(header.slice(7), getJwtSecret()) as any;
    // Tokens minted before multi-tenancy lack an org claim; resolve them to the
    // default organization so existing sessions keep working after deploy.
    req.user = { ...payload, org_id: payload.org_id ?? DEFAULT_ORG_ID };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/** Constant-time comparison so a wrong key can't be guessed by timing the response. */
function apiKeyMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Accepts EITHER a valid JWT bearer token (frontend) OR a valid X-API-Key header
 * matching AUTOMATION_API_KEY (external automation / browser extension). Use this
 * only on routes meant to be reachable by automation — currently just lead
 * creation. When the key matches we attach a synthetic automation principal; the
 * lead-create handler does not rely on a real user record. If AUTOMATION_API_KEY
 * is unset, the API-key path is disabled and only JWT is accepted.
 */
export function requireAuthOrApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  const provided = req.headers['x-api-key'];
  const expected = process.env.AUTOMATION_API_KEY;
  if (typeof provided === 'string' && expected && apiKeyMatches(provided, expected)) {
    req.user = { id: 'automation', name: 'Automation', email: '', role: 'api', org_id: DEFAULT_ORG_ID };
    return next();
  }
  return requireAuth(req, res, next);
}

// Roles with full administrative rights: user management, settings writes, and
// destructive deletes. `manager` is the legacy name for an admin-equivalent role
// and is treated as privileged so existing accounts are not locked out.
export const PRIVILEGED_ROLES = ['owner', 'administrator', 'manager'] as const;

export function isPrivileged(user?: { role?: string }): boolean {
  return !!user?.role && (PRIVILEGED_ROLES as readonly string[]).includes(user.role);
}

/**
 * Authorization guard. Use AFTER requireAuth. Rejects with 403 unless the
 * authenticated user's role is in the allowed list. Without this, authenticated
 * users could reach privileged endpoints (e.g. create an owner account).
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

// Convenience guard for the standard owner/administrator/manager privilege set.
export const requireAdmin = requireRole(...PRIVILEGED_ROLES);

type AIPermission = 'run_analysis' | 'view_results' | 'manage_settings';

const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<AIPermission, boolean>> = {
  owner:           { run_analysis: true,  manage_settings: true,  view_results: true  },
  administrator:   { run_analysis: true,  manage_settings: true,  view_results: true  },
  estimator:       { run_analysis: true,  manage_settings: false, view_results: true  },
  sales_manager:   { run_analysis: false, manage_settings: false, view_results: true  },
  salesperson:     { run_analysis: false, manage_settings: false, view_results: false },
  project_manager: { run_analysis: false, manage_settings: false, view_results: true  },
  technician:      { run_analysis: false, manage_settings: false, view_results: false },
  accounting:      { run_analysis: false, manage_settings: false, view_results: false },
  read_only:       { run_analysis: false, manage_settings: false, view_results: false },
  // Legacy role names
  manager:         { run_analysis: true,  manage_settings: true,  view_results: true  },
  salesperson_legacy: { run_analysis: false, manage_settings: false, view_results: false },
};

export function requireAIPermission(permission: AIPermission) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user!;

    try {
      // 1. Master kill switch
      const aiEnabled = await getSetting('ai_enabled');
      if (aiEnabled === 'false') {
        return res.status(503).json({ error: 'AI features are currently disabled by an administrator.' });
      }

      // 2. Analysis-specific kill switch
      if (permission === 'run_analysis') {
        const analysisEnabled = await getSetting('ai_analysis_enabled');
        if (analysisEnabled === 'false') {
          return res.status(503).json({ error: 'AI analysis is currently disabled.' });
        }
      }

      // 3. Per-user override takes priority over role
      const { rows } = await pool.query('SELECT ai_override FROM users WHERE id=$1', [user.id]);
      const override: Record<string, boolean> = rows[0]?.ai_override ?? {};

      if (override.suspended === true) {
        return res.status(403).json({ error: 'Your AI access has been suspended. Contact an administrator.' });
      }

      if (permission in override) {
        if (!override[permission]) {
          return res.status(403).json({ error: 'AI access denied for your account.' });
        }
        // Override explicitly grants access — skip role check
        if (permission === 'run_analysis') return checkDailyLimit(user.id, next, res);
        return next();
      }

      // 4. Role-based permissions
      let rolePerms: Record<string, Record<AIPermission, boolean>> = DEFAULT_ROLE_PERMISSIONS;
      try {
        const stored = await getSetting('ai_role_permissions');
        if (stored) rolePerms = { ...DEFAULT_ROLE_PERMISSIONS, ...JSON.parse(stored) };
      } catch { /* use defaults */ }

      const allowed = rolePerms[user.role]?.[permission] ?? false;
      if (!allowed) {
        return res.status(403).json({ error: `AI ${permission.replace('_', ' ')} is not available for your role.` });
      }

      // 5. Daily limit check for run_analysis
      if (permission === 'run_analysis') return checkDailyLimit(user.id, next, res);

      next();
    } catch (err) {
      // Fail CLOSED: a failure while evaluating an authorization decision must
      // deny access, never grant it. (Previously this called next(), which let
      // a transient DB error bypass the entire AI permission check.)
      logger.error({ err }, '[ai-permission] permission check failed; denying access');
      return res.status(500).json({ error: 'Could not verify AI permissions. Please try again.' });
    }
  };
}

async function checkDailyLimit(userId: string, next: NextFunction, res: Response) {
  try {
    const limitStr = await getSetting('ai_daily_limit_per_user');
    const limit = parseInt(limitStr || '10');
    const today = new Date().toISOString().split('T')[0];
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM activity WHERE kind='ai_analysis' AND user_id=$1 AND created_at::date=$2::date`,
      [userId, today]
    );
    const count = parseInt(rows[0]?.count ?? '0');
    if (count >= limit) {
      return res.status(429).json({ error: `Daily AI analysis limit (${limit} per day) reached. Try again tomorrow.` });
    }
    next();
  } catch (err) {
    // The daily limit is a soft quota, not an authorization boundary (the
    // run_analysis permission was already granted above), so a transient error
    // here fails open rather than blocking legitimate work.
    logger.warn({ err }, '[ai-permission] daily limit check failed; allowing this request');
    next();
  }
}
