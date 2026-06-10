import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { ownScopeId, isPrivileged } from '../middleware/auth';
import { parseDueDays } from '../utils/dueDate';
import { advanceToContacted } from '../routes/leads';
import {
  fetchUnreadInbox, fetchInboxSince, isKohlerNotification, BID_CATEGORY,
  GraphMailMessage,
} from '../integrations/outlookMail';
import { fetchTodayEvents, TodayEvent } from '../integrations/outlookCalendar';

// ── Shared response contract (mirrored in frontend/src/types/index.ts) ──────────────────

export type BriefChip = 'Elec' | 'Gen' | 'Call';

export interface BriefAttentionItem {
  id: string;                          // 'email:<id>' | 'lead:<uuid>' | 'bid:<uuid>' | 'task:<uuid>' | 'stale:<uuid>'
  type: 'email' | 'lead-call' | 'bid' | 'task' | 'lead-stale';
  chips: BriefChip[];
  title: string;
  subtitle: string;
  receivedAt: string | null;          // ISO, for "2h ago" + sorting
  briefing: string;                   // drawer body text
  cta: { webLink?: string; tel?: string; navTo?: string; leadId?: string };
}

export interface BriefPayload {
  generatedAt: string;
  graphEnabled: boolean;
  kpis: {
    activeBids: number; activeBidsValue: number;
    activeGens: number; activeGensValue: number;
    wonThisMonth: number; wonThisMonthValue: number;
    leadsNeedingCall: number; unreadEmails: number;
  };
  attention: BriefAttentionItem[];
  kohlerFunnel: {
    received: number; notAccepted: number; accepted: number; replied: number; needCall: number;
    newToday: number; newYesterday: number;
  };
  intake: { unread: number; newToday: number; newYesterday: number };
  todayEvents: TodayEvent[];
  briefBullets: string[];
}

// ── Graph snapshot cache (single mailbox → a module-level cache is correct) ──────────────

interface GraphSnapshot { unread: GraphMailMessage[]; monthInbox: GraphMailMessage[]; events: TodayEvent[] }
let snap: { at: number; data: GraphSnapshot } | null = null;
let inflight: Promise<GraphSnapshot> | null = null;
const TTL_MS = 90_000;

function graphConfigured(): boolean {
  return !!(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);
}

/** First day of the current month in Eastern time, as an ISO instant. */
function monthStartIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  return `${y}-${m}-01T00:00:00Z`;
}

/** Calendar date (YYYY-MM-DD) of an instant in Eastern time, for today/yesterday tallies. */
export function etDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function loadGraphSnapshot(): Promise<GraphSnapshot> {
  if (snap && Date.now() - snap.at < TTL_MS) return snap.data;
  if (inflight) return inflight;            // collapse concurrent loads onto one fetch
  inflight = (async () => {
    // Window covers both the month-to-date funnel and the "yesterday" tallies
    // (matters on the 1st/2nd of the month, when yesterday precedes month start).
    const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
    const ms = monthStartIso();
    const [unread, monthInbox, events] = await Promise.all([
      fetchUnreadInbox(50),
      fetchInboxSince(twoDaysAgo < ms ? twoDaysAgo : ms, 200),
      fetchTodayEvents(),
    ]);
    const data: GraphSnapshot = { unread, monthInbox, events };
    snap = { at: Date.now(), data };
    return data;
  })();
  try { return await inflight; }
  finally { inflight = null; }
}

// ── Reply auto-log: inbound emails from known leads → lead_activity (deduped) ────────────

let autologRunning = false;

async function autologInboundLeadEmails(unread: GraphMailMessage[]): Promise<void> {
  if (autologRunning) return;
  autologRunning = true;
  try {
    for (const msg of unread) {
      if (!msg.from) continue;
      const { rows } = await pool.query(
        `SELECT id, stage FROM leads
          WHERE deleted_at IS NULL AND first_contact_sent_at IS NOT NULL AND lower(email) = lower($1)`,
        [msg.from]
      );
      for (const lead of rows) {
        const ins = await pool.query(
          `INSERT INTO lead_activity (lead_id, kind, direction, created_by, text, graph_message_id)
           VALUES ($1,'email','in','System',$2,$3)
           ON CONFLICT (graph_message_id) WHERE graph_message_id IS NOT NULL DO NOTHING`,
          [lead.id, `Email reply received: "${msg.subject || '(no subject)'}"`, msg.id]
        );
        if ((ins.rowCount ?? 0) > 0 && lead.stage === 'new') {
          await advanceToContacted(lead.id, 'System');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, '[brief] autolog inbound lead emails failed');
  } finally {
    autologRunning = false;
  }
}

// ── Bullet composer (pure, unit-testable) ───────────────────────────────────────────────

export function composeBullets(p: Omit<BriefPayload, 'briefBullets'>): string[] {
  const out: string[] = [];
  const f = p.kohlerFunnel;
  if (p.intake.newToday > 0) out.push(`${p.intake.newToday} new bid${p.intake.newToday === 1 ? '' : 's'} came in today — review them in the Intake Inbox`);
  if (p.intake.newYesterday > 0) out.push(`${p.intake.newYesterday} new bid${p.intake.newYesterday === 1 ? '' : 's'} came in yesterday`);
  if (f.newToday > 0) out.push(`${f.newToday} new Kohler lead${f.newToday === 1 ? '' : 's'} came in today`);
  if (f.newYesterday > 0) out.push(`${f.newYesterday} new Kohler lead${f.newYesterday === 1 ? '' : 's'} came in yesterday`);
  if (f.received > 0) out.push(`${f.received} Kohler lead${f.received === 1 ? '' : 's'} received this month — ${f.notAccepted} not yet accepted`);
  if (f.needCall > 0) out.push(`${f.needCall} lead${f.needCall === 1 ? '' : 's'} waiting on a call`);
  if (f.replied > 0) out.push(`${f.replied} Kohler lead${f.replied === 1 ? '' : 's'} replied to your first message`);
  const dueSoon = p.attention.filter(a => a.type === 'bid').length;
  if (dueSoon > 0) out.push(`${dueSoon} bid${dueSoon === 1 ? '' : 's'} due within 3 days`);
  const tasksDue = p.attention.filter(a => a.type === 'task').length;
  if (tasksDue > 0) out.push(`${tasksDue} follow-up${tasksDue === 1 ? '' : 's'} due today or overdue`);
  const stale = p.attention.filter(a => a.type === 'lead-stale').length;
  if (stale > 0) out.push(`${stale} lead${stale === 1 ? ' has' : 's have'} never responded since being added — nudge them`);
  if (p.kpis.unreadEmails > 0) out.push(`${p.kpis.unreadEmails} unread email${p.kpis.unreadEmails === 1 ? '' : 's'} from known contacts`);
  if (p.kpis.wonThisMonthValue > 0) out.push(`$${Math.round(p.kpis.wonThisMonthValue).toLocaleString()} won this month`);
  if (p.todayEvents.length > 0) {
    const first = p.todayEvents[0];
    out.push(`First today: ${first.subject}${first.location ? ` · ${first.location}` : ''}`);
  }
  if (!out.length) out.push('All clear — nothing needs you right now.');
  return out;
}

// ── Main aggregator ─────────────────────────────────────────────────────────────────────

const digits = (s: string | null) => (s || '').replace(/[^\d+]/g, '');

export async function buildBrief(user: { id: string; role: string }): Promise<BriefPayload> {
  const scope = ownScopeId(user);
  const useGraph = graphConfigured() && isPrivileged(user);
  const monthStart = monthStartIso();

  // CRM SQL (always fresh; scoped per-rep). Run in parallel.
  const scopeAnd = scope ? ' AND salesperson_id = $1' : '';
  const sp: unknown[] = scope ? [scope] : [];
  const [bidsKpi, gensKpi, wonKpi, needCallRows, dueSoonRows, kohlerAccepted, intakeCounts, dueTasks, staleLeads, knownContacts] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS v FROM bids WHERE deleted_at IS NULL AND closed_at IS NULL AND stage IN ('due','submitted')${scopeAnd}`, sp),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS v FROM generator_proposals WHERE deleted_at IS NULL AND stage IN ('building','sent')${scopeAnd}`, sp),
    pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(value),0)::float AS v FROM won_jobs WHERE deleted_at IS NULL AND date_won >= $${sp.length + 1}${scopeAnd}`, [...sp, monthStart]),
    pool.query(
      `SELECT id, name, phone, email, source, stage, notes, last_activity_at, first_contact_sent_at
         FROM leads
        WHERE deleted_at IS NULL AND stage NOT IN ('lost','converted')
          AND (needs_call = true OR (contact_method='phone' AND first_contact_sent_at IS NULL AND stage='new'))${scopeAnd}
        ORDER BY created_at ASC LIMIT 10`, sp),
    pool.query(`SELECT id, name, gc, due, source_email_link FROM bids WHERE deleted_at IS NULL AND closed_at IS NULL AND stage IN ('due','submitted')${scopeAnd}`, sp),
    pool.query(`SELECT COUNT(*)::int AS n,
                       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM lead_activity a WHERE a.lead_id=leads.id AND a.kind='email' AND a.direction='in'))::int AS replied
                  FROM leads WHERE source='kohler' AND deleted_at IS NULL AND created_at >= $1`, [monthStart]),
    // Intake inbox counts (shared inbox — not rep-scoped, same as the sidebar badge).
    // "Today"/"yesterday" use Eastern-time day boundaries.
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread,
              COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'America/New_York')::date = (now() AT TIME ZONE 'America/New_York')::date)::int AS today,
              COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'America/New_York')::date = (now() AT TIME ZONE 'America/New_York')::date - 1)::int AS yesterday
         FROM intake_items`),
    // Follow-up tasks due today or overdue (the Follow-ups view, condensed). Reps see their own.
    pool.query(
      `SELECT id, title, linked_type, linked_id, linked_name,
              ((now() AT TIME ZONE 'America/New_York')::date - due_date)::int AS overdue_days
         FROM tasks
        WHERE status='open' AND due_date IS NOT NULL
          AND due_date <= (now() AT TIME ZONE 'America/New_York')::date
          ${scope ? 'AND assigned_to = $1' : ''}
        ORDER BY due_date ASC LIMIT 10`, sp),
    // Ghosted leads: first contact went out 2+ days ago and they have never replied or
    // picked up — no inbound activity at all since the lead was added.
    pool.query(
      `SELECT id, name, phone, email, source, stage, notes,
              EXTRACT(DAY FROM now() - created_at)::int AS age_days
         FROM leads
        WHERE deleted_at IS NULL AND stage NOT IN ('won','lost')
          AND needs_call = false
          AND first_contact_sent_at IS NOT NULL
          AND first_contact_sent_at < now() - interval '2 days'
          AND NOT EXISTS (SELECT 1 FROM lead_activity a WHERE a.lead_id = leads.id AND a.direction = 'in')${scopeAnd}
        ORDER BY first_contact_sent_at ASC LIMIT 10`, sp),
    // Known human contacts (for matching unread senders). Not rep-scoped: the mailbox is
    // shared. Intake/plan-room senders (BuildingConnected, PlanHub, …) are intentionally
    // not included — those are filtered into the Intake Inbox, not the respond queue.
    useGraph
      ? pool.query(
          `SELECT lower(email) AS email, 'lead' AS kind, id::text AS ref, name AS label FROM leads WHERE email IS NOT NULL AND email <> '' AND deleted_at IS NULL
           UNION ALL SELECT lower(email), 'customer', id::text, name FROM customers WHERE email IS NOT NULL AND email <> ''`)
      : Promise.resolve({ rows: [] as Array<{ email: string; kind: string; ref: string; label: string }> }),
  ]);

  // Graph snapshot (cached). Skipped entirely when not configured / not privileged.
  let unread: GraphMailMessage[] = [];
  let monthInbox: GraphMailMessage[] = [];
  let events: TodayEvent[] = [];
  if (useGraph) {
    const g = await loadGraphSnapshot();
    unread = g.unread; monthInbox = g.monthInbox; events = g.events;
    // Fire-and-forget: log any lead replies sitting in the unread set.
    autologInboundLeadEmails(unread).catch(() => {});
  }

  // ── Attention: calls to make ──
  const attention: BriefAttentionItem[] = [];
  for (const l of needCallRows.rows) {
    const last = l.last_activity_at ? `last activity ${new Date(l.last_activity_at).toLocaleDateString()}` : 'never contacted';
    const reason = l.first_contact_sent_at ? 'no reply yet' : 'new — needs first contact';
    attention.push({
      id: `lead:${l.id}`,
      type: 'lead-call',
      chips: ['Gen', 'Call'],
      title: l.name,
      subtitle: `${l.source === 'kohler' ? 'Kohler lead' : 'Lead'}${l.phone ? ` · ${l.phone}` : ' · no phone'} · ${reason}`,
      receivedAt: l.last_activity_at ? new Date(l.last_activity_at).toISOString() : null,
      briefing: `${l.name} is ${l.stage}. ${l.phone ? `Call ${l.phone}.` : 'No phone on file.'} ${last}.${l.notes ? ` Notes: ${l.notes}` : ''}`,
      cta: { tel: l.phone ? `tel:${digits(l.phone)}` : undefined, navTo: 'gen-leads', leadId: l.id },
    });
  }

  // ── Attention: follow-up tasks due today / overdue ──
  for (const t of dueTasks.rows) {
    const od = t.overdue_days as number;
    attention.push({
      id: `task:${t.id}`,
      type: 'task',
      chips: ['Call'],
      title: t.title,
      subtitle: `${t.linked_name ? `${t.linked_name} · ` : ''}${od > 0 ? `overdue ${od} day${od === 1 ? '' : 's'}` : 'due today'}`,
      receivedAt: null,
      briefing: `Follow-up "${t.title}"${t.linked_name ? ` for ${t.linked_name}` : ''} is ${od > 0 ? `${od} day${od === 1 ? '' : 's'} overdue` : 'due today'}. Knock it out and check it off in Follow-ups.`,
      cta: t.linked_type === 'lead' && t.linked_id
        ? { navTo: 'gen-leads', leadId: t.linked_id }
        : { navTo: 'followups' },
    });
  }

  // ── Attention: ghosted leads (no response at all since they were added) ──
  for (const l of staleLeads.rows) {
    const age = l.age_days as number;
    const src = l.source === 'kohler' ? 'Kohler lead' : 'Lead';
    attention.push({
      id: `stale:${l.id}`,
      type: 'lead-stale',
      chips: ['Gen', 'Call'],
      title: l.name,
      subtitle: `${src} · added ${age} day${age === 1 ? '' : 's'} ago · no response yet`,
      receivedAt: null,
      briefing: `${l.name} hasn't responded at all since being added ${age} day${age === 1 ? '' : 's'} ago — your first contact went out but nothing came back. ${l.phone ? `Call ${l.phone} or send a nudge.` : 'No phone on file — send a nudge email.'}${l.notes ? ` Notes: ${l.notes}` : ''}`,
      cta: { tel: l.phone ? `tel:${digits(l.phone)}` : undefined, navTo: 'gen-leads', leadId: l.id },
    });
  }

  // ── Attention: unread emails from real human contacts only. Automated notifications —
  // new-bid invitations (tagged → Intake Inbox) and Kohler new-lead alerts — are excluded
  // here and surfaced as arrival tallies instead. ──
  const contactByEmail = new Map<string, { kind: string; ref: string; label: string }>();
  for (const c of knownContacts.rows) if (c.email) contactByEmail.set(c.email, { kind: c.kind, ref: c.ref, label: c.label });
  const wantedCat = BID_CATEGORY.toLowerCase();
  // Automated/plan-room senders never belong in the respond queue, even if their address
  // somehow ends up on a lead or customer record.
  const NOISE_SENDER = /no-?reply|do-?not-?reply|notification|mailer|automated|@buildingconnected\.|@planhub\./i;
  let unreadMatched = 0;
  for (const m of unread) {
    const tagged = (m.categories || []).some(c => c.trim().toLowerCase() === wantedCat);
    if (tagged || isKohlerNotification(m)) continue;
    const from = (m.from || '').toLowerCase();
    if (!from || NOISE_SENDER.test(from)) continue;
    const match = contactByEmail.get(from);
    if (!match) continue;
    unreadMatched++;
    const chips: BriefChip[] = match.kind === 'lead' ? ['Gen'] : ['Elec'];
    const navTo = match.kind === 'lead' ? 'gen-leads' : undefined;
    attention.push({
      id: `email:${m.id}`,
      type: 'email',
      chips,
      title: m.subject || '(no subject)',
      subtitle: `${m.fromName || m.from || 'Unknown'} · ${match.label}`,
      receivedAt: m.receivedDateTime,
      briefing: m.bodyPreview || 'No preview available.',
      cta: { webLink: m.webLink || undefined, navTo },
    });
  }

  // ── Attention: bids due within 3 days ──
  for (const b of dueSoonRows.rows) {
    const dd = parseDueDays(String(b.due || ''));
    if (dd < 0 || dd > 3) continue;
    attention.push({
      id: `bid:${b.id}`,
      type: 'bid',
      chips: ['Elec'],
      title: b.name,
      subtitle: `${b.gc || '—'} · due in ${dd} day${dd === 1 ? '' : 's'}`,
      receivedAt: null,
      briefing: `${b.name} for ${b.gc || 'an unnamed GC'} is due in ${dd} day${dd === 1 ? '' : 's'}. Make sure the estimate is finalized and submitted.`,
      cta: { navTo: 'pipeline', webLink: b.source_email_link || undefined },
    });
  }

  // Sort: deadline bids, then overdue follow-ups, calls, ghosted leads, then emails (newest).
  const order = { bid: 0, task: 1, 'lead-call': 2, 'lead-stale': 3, email: 4 } as const;
  attention.sort((a, b) => order[a.type] - order[b.type]
    || String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));

  // ── Kohler funnel + arrival tallies (ET day boundaries) ──
  const kohlerMail = useGraph ? monthInbox.filter(isKohlerNotification) : [];
  const etToday = etDateStr(new Date());
  const etYesterday = etDateStr(new Date(Date.now() - 86_400_000));
  const received = kohlerMail.filter(m => m.receivedDateTime >= monthStart).length;
  const notAccepted = kohlerMail.filter(m => !m.isRead).length;
  const kohlerNewToday = kohlerMail.filter(m => etDateStr(new Date(m.receivedDateTime)) === etToday).length;
  const kohlerNewYesterday = kohlerMail.filter(m => etDateStr(new Date(m.receivedDateTime)) === etYesterday).length;

  const payloadNoBullets: Omit<BriefPayload, 'briefBullets'> = {
    generatedAt: new Date().toISOString(),
    graphEnabled: useGraph,
    kpis: {
      activeBids: bidsKpi.rows[0].n, activeBidsValue: bidsKpi.rows[0].v,
      activeGens: gensKpi.rows[0].n, activeGensValue: gensKpi.rows[0].v,
      wonThisMonth: wonKpi.rows[0].n, wonThisMonthValue: wonKpi.rows[0].v,
      leadsNeedingCall: needCallRows.rows.length,
      unreadEmails: unreadMatched,
    },
    attention,
    kohlerFunnel: {
      received, notAccepted,
      accepted: kohlerAccepted.rows[0].n,
      replied: kohlerAccepted.rows[0].replied,
      needCall: needCallRows.rows.length,
      newToday: kohlerNewToday, newYesterday: kohlerNewYesterday,
    },
    intake: {
      unread: intakeCounts.rows[0].unread,
      newToday: intakeCounts.rows[0].today,
      newYesterday: intakeCounts.rows[0].yesterday,
    },
    todayEvents: events,
  };
  return { ...payloadNoBullets, briefBullets: composeBullets(payloadNoBullets) };
}
