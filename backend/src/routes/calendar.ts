import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { fetchUpcomingEvents } from '../integrations/outlookCalendar';

const router = Router();

// GET /api/calendar/events
// A second, neutral read of the same mailbox `/gens/calendar-events` already reads —
// left untouched, since it feeds the Gen Pipeline's AI-extraction flow. This one feeds
// the mobile "Start Site Survey" picker, so each event is annotated with whether a
// lead already exists for it (linkedLeadId) instead of leaving the caller to guess and
// risk creating a second lead for the same appointment.
router.get('/events', requireAuth, asyncHandler(async (_req: AuthRequest, res) => {
  const events = await fetchUpcomingEvents(7, 7);

  const ids = events.map(e => e.id);
  const linkedByEventId = new Map<string, string>();
  if (ids.length) {
    const { rows } = await pool.query(
      'SELECT id, outlook_event_id FROM leads WHERE outlook_event_id = ANY($1) AND deleted_at IS NULL',
      [ids]
    );
    for (const row of rows) linkedByEventId.set(row.outlook_event_id, row.id);
  }

  res.json(events.map(e => ({ ...e, linkedLeadId: linkedByEventId.get(e.id) ?? null })));
}));

export default router;
