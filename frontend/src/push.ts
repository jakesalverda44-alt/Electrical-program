// Web Push (PWA) client helpers. Wraps the service worker + PushManager dance so the
// Settings toggle can stay declarative. All functions are safe to call on browsers that
// don't support push — isPushSupported() gates the UI.
import api from './api/client';

export function isPushSupported(): boolean {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;
}

/** True only when running as an installed PWA (required for push on iOS). */
export function isStandalone(): boolean {
  // iOS exposes navigator.standalone; everyone else uses the display-mode media query.
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  const mq = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || mq;
}

/** Rough iOS detection so we can show the "Add to Home Screen first" hint. */
export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    // iPadOS 13+ reports as Mac; disambiguate by touch support.
    || (navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1);
}

export function permission(): NotificationPermission {
  return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/sw.js');
  return existing ?? navigator.serviceWorker.register('/sw.js');
}

/** Is this device currently subscribed? */
export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) return false;
    return !!(await reg.pushManager.getSubscription());
  } catch { return false; }
}

/**
 * Register the SW, ask for permission, subscribe, and store the subscription on the
 * server. Throws with a friendly message the UI can surface on failure.
 */
export async function enablePush(): Promise<void> {
  if (!isPushSupported()) throw new Error('This browser does not support push notifications.');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were blocked. Enable them in your browser settings.');

  const reg = await getRegistration();
  await navigator.serviceWorker.ready;

  const { data } = await api.get('/push/public-key');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.key) as BufferSource,
  });

  await api.post('/push/subscribe', sub.toJSON());
}

/** Unsubscribe this device and forget it on the server. */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}
