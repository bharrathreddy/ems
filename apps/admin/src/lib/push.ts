import { api } from './api';

export type PushGroup = 'absence' | 'notices' | 'results' | 'approvals';
export interface DeviceState { subscribed: boolean; prefs: Partial<Record<PushGroup, boolean>>; devices: number }

export const GROUP_LABEL: Record<PushGroup, [string, string]> = {
  absence: ['Absence and leave', 'When a child is marked absent, and when leave is approved or not'],
  notices: ['Notices and homework', 'School notices, homework and class diary notes'],
  results: ['Results and fees', 'Exam results, mark corrections and fee reminders'],
  approvals: ['Waiting for you', 'Leave requests, expenses to approve and new admission enquiries'],
};

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
/** Web push needs a service worker, the Push API and (on iPhone) the app added to the Home Screen. */
export function pushSupport(): 'ok' | 'ios-install' | 'unsupported' | 'insecure' {
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  return 'ok';
}

const keyBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration() {
  const r = await navigator.serviceWorker.getRegistration('/');
  return r ?? navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  if (pushSupport() !== 'ok') return null;
  const r = await registration();
  return r.pushManager.getSubscription();
}

export const deviceName = () => {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : isIOS() ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${br ? ` · ${br}` : ''}`;
};

/** Asks the browser for permission and registers this phone. */
export async function enablePush(): Promise<DeviceState> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.' : 'Notifications were not allowed.');
  const { data } = await api<{ publicKey: string }>('/push/key');
  const r = await registration();
  let sub = await r.pushManager.getSubscription();
  if (sub && sub.options.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== data.publicKey) {
    await sub.unsubscribe(); sub = null;
  }
  sub ??= await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.publicKey) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return (await api<DeviceState>('/push/subscribe', { method: 'POST', body: { endpoint: j.endpoint, keys: j.keys, device: deviceName() } })).data;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/** Used on log out: this phone should stop getting this person's alerts. */
export async function forgetPushOnLogout() {
  try { await disablePush(); } catch { /* best effort */ }
}
