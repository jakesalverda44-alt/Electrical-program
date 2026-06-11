import webpush from 'web-push';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { logger } from '../utils/logger';

// Web Push (PWA) delivery. Notifications pop on a user's phone/desktop even when the
// CRM tab is closed, as long as they've opted in on that device (push_subscriptions).
//
// VAPID keys identify our server to the push services. They must stay stable across
// restarts, so we generate them once and persist in app_settings — zero config. The
// contact mailto is informational (push services may use it to reach us about abuse).

const VAPID_SUBJECT = 'mailto:JakeS@accuratepowerandtechnology.com';

let vapidPublicKey: string | null = null;
let configured = false;

/**
 * Load VAPID keys from app_settings, generating + persisting them on first run.
 * Idempotent; safe to call before every send. Returns the public key (for clients).
 */
export async function ensureVapid(): Promise<string> {
  if (configured && vapidPublicKey) return vapidPublicKey;

  let pub = await getSetting('vapid_public_key');
  let priv = await getSetting('vapid_private_key');

  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('vapid_public_key', $1), ('vapid_private_key', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [pub, priv]
    );
    logger.info('[web-push] generated and stored new VAPID key pair');
  }

  webpush.setVapidDetails(VAPID_SUBJECT, pub, priv);
  vapidPublicKey = pub;
  configured = true;
  return pub;
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Store (or refresh) a device subscription for a user. Endpoint is the dedupe key. */
export async function saveSubscription(userId: string, sub: PushSub, userAgent?: string): Promise<void> {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent ?? null]
  );
}

/** Remove a device subscription by endpoint (user disabled alerts / signed out). */
export async function deleteSubscription(endpoint: string): Promise<void> {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

export interface PushPayload {
  title: string;
  body: string;
  /** Front-end view to open on click (e.g. 'gen-leads', 'gen-proposals'). */
  view?: string;
  /** Optional record id, appended so the client can deep-link. */
  id?: string | null;
  /** Tag collapses repeat notifications for the same thing. */
  tag?: string;
}

/**
 * Send a push to every device of the given users. Dead endpoints (404/410) are pruned.
 * Fire-and-forget friendly: never throws. Returns the count actually delivered.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;

  try {
    await ensureVapid();
  } catch (err) {
    logger.error({ err }, '[web-push] VAPID init failed; skipping push');
    return 0;
  }

  const { rows } = await pool.query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])',
    [ids]
  );
  if (!rows.length) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(rows.map(async (r) => {
    try {
      await webpush.sendNotification(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        body
      );
      sent++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        // Subscription expired / unsubscribed — drop it so we stop trying.
        await deleteSubscription(r.endpoint).catch(() => {});
      } else {
        logger.error({ err, status }, '[web-push] send failed');
      }
    }
  }));
  return sent;
}
