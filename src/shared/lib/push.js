// push.js — client-side Web Push helpers (subscribe / unsubscribe / status).
//
// The VAPID *public* key is not secret; it ships in the bundle via
// VITE_VAPID_PUBLIC_KEY. Saving the subscription is a plain Supabase insert
// (anon key, permissive RLS) — no serverless function needed. Sending pushes is
// server-side (api/daily-owner-update.js) with the private key.

import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

// ─── Capability / platform detection ──────────────────────────────
export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; detect touch
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// True when the app is running as an installed PWA (added to Home Screen).
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}

// On iOS, push only works inside the installed PWA. This says whether the user
// still needs to "Add to Home Screen" first.
export function iosNeedsInstall() {
  return isIOS() && !isStandalone();
}

export function permissionState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function isSubscribed() {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

// ─── Subscribe ────────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Returns { ok, error }. Requires user gesture (call from a click handler) so
// the permission prompt is allowed.
export async function subscribeUser(user) {
  if (!isPushSupported()) return { ok: false, error: 'Push not supported on this device.' };
  if (!VAPID_PUBLIC_KEY)  return { ok: false, error: 'Push not configured (missing VAPID key).' };
  if (iosNeedsInstall())  return { ok: false, error: 'Add Omega to your Home Screen first, then open it from there.' };

  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'Notification permission was not granted.' };

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = sub.toJSON();
    const row = {
      user_id:    user?.id || null,
      user_name:  user?.name || null,
      endpoint:   json.endpoint,
      p256dh:     json.keys?.p256dh,
      auth:       json.keys?.auth,
      user_agent: navigator.userAgent.slice(0, 300),
      last_seen_at: new Date().toISOString(),
    };

    // Upsert by endpoint so re-subscribing the same device updates the owner.
    const { error } = await supabase
      .from('user_push_subscriptions')
      .upsert(row, { onConflict: 'endpoint' });
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not subscribe.' };
  }
}

// ─── Unsubscribe ──────────────────────────────────────────────────
export async function unsubscribeUser() {
  if (!isPushSupported()) return { ok: true };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await supabase.from('user_push_subscriptions').delete().eq('endpoint', endpoint);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not unsubscribe.' };
  }
}
