import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';

export interface AuthRequest extends Request {
  user?: { id: string; name: string; email: string; role: string };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'dev_secret') as any;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

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
      console.error('[ai-permission]', err);
      next(); // fail open to avoid breaking non-AI flows
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
  } catch {
    next(); // fail open
  }
}
