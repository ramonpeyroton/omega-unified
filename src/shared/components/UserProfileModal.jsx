// UserProfileModal — pops up when the user clicks their own name in
// the sidebar. Shows the profile photo, name, role, phone and address;
// the photo, phone and address are editable. Name + role are read-only
// (those are managed in Admin → Users & Access).
//
// Storage:
//   * Photo bytes go to the public `user-profiles` Supabase bucket.
//   * Photo URL + phone + address go to the `users` row matching the
//     current session's user.id (added by migration 024).
//
// Eligibility:
//   * The Profile modal only edits when the session user has a real
//     `id` from the `users` table — i.e. they were authenticated
//     against the DB row, not the hardcoded PIN_TO_ROLE fallback in
//     Login.jsx. Sessions that came in via the fallback see a
//     friendly message asking to be registered by the admin first.
//     Sprint 4 Fase 3 (auth hardening) removes that fallback.
//
// Image upload:
//   * Reuses `browser-image-compression` (already in package.json
//     for Sprint 4) — same Web Worker pipeline, same 2 MB target.
//   * Hard 4 MB cap after compression.

import { useEffect, useRef, useState } from 'react';
import { X, Camera, Loader2, Phone, MapPin, User as UserIcon, Save, Bell, BellOff } from 'lucide-react';
import {
  isPushSupported, isSubscribed, permissionState, iosNeedsInstall,
  subscribeUser, unsubscribeUser,
} from '../lib/push';
import imageCompression from 'browser-image-compression';
import { supabase } from '../lib/supabase';
import Avatar, { colorFromName } from './ui/Avatar';

const PHOTO_BUCKET = 'user-profiles';
const COMPRESS_TARGET_MB = 2;
const COMPRESS_MAX_DIMENSION = 1024;
const COMPRESS_QUALITY = 0.8;
const MAX_BYTES = 4 * 1024 * 1024;

const ACCEPTED_FILE_INPUT = '.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif';

export default function UserProfileModal({ open, onClose, user, onUserUpdated }) {
  const [loaded, setLoaded] = useState(false);
  const [row, setRow] = useState(null);          // current user row from DB
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const eligibleId = row?.id || null;

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  // Load the row from `users` when the modal opens. We fetch on every
  // open so the form reflects the latest values even if another tab
  // edited them, and so a fresh session that didn't have a row before
  // can be picked up if the admin registered it in the meantime.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoaded(false);
    setError('');
    (async () => {
      // Match strategy: prefer user.id when the session carries one,
      // fall back to (case-insensitive) name match — covers fallback
      // logins that don't carry a row id.
      let q = supabase.from('users').select('id, name, role, phone, address, profile_photo_url');
      if (user?.id) q = q.eq('id', user.id);
      else if (user?.name) q = q.ilike('name', user.name.trim());
      else { if (active) { setRow(null); setLoaded(true); } return; }
      const { data } = await q.maybeSingle();
      if (!active) return;
      setRow(data || null);
      setPhone(data?.phone || '');
      setAddress(data?.address || '');
      setPhotoUrl(data?.profile_photo_url || null);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, [open, user?.id, user?.name]);

  if (!open) return null;

  async function handlePickPhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    if (!eligibleId) {
      setError('Profile is read-only until the admin registers your account.');
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      // Compress (smaller dimension cap than chat photos — these are
      // tiny avatars, no need for 2400px source).
      let compressed;
      try {
        compressed = await imageCompression(f, {
          maxSizeMB: COMPRESS_TARGET_MB,
          maxWidthOrHeight: COMPRESS_MAX_DIMENSION,
          initialQuality: COMPRESS_QUALITY,
          useWebWorker: true,
          fileType: 'image/jpeg',
        });
      } catch {
        if (f.size <= MAX_BYTES) compressed = f;
        else throw new Error('Could not process this image');
      }
      if (compressed.size > MAX_BYTES) {
        throw new Error(`Even after compression the image is ${(compressed.size / 1024 / 1024).toFixed(1)} MB. Try a smaller photo.`);
      }

      const safeName = (compressed.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
      const path = `${eligibleId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, compressed, { upsert: false, contentType: compressed.type || 'image/jpeg' });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      const newUrl = pub?.publicUrl;
      if (!newUrl) throw new Error('Could not resolve public URL.');

      // Persist immediately so even a "Cancel" without Save keeps the
      // photo (matches expectations from the JobCoverPhotoUpload UX).
      const { data: updated, error: dbErr } = await supabase
        .from('users')
        .update({ profile_photo_url: newUrl })
        .eq('id', eligibleId)
        .select()
        .single();
      if (dbErr) throw dbErr;

      setPhotoUrl(updated.profile_photo_url);
      setRow(updated);
      onUserUpdated?.(updated);
    } catch (err) {
      setError(err?.message || 'Could not upload the photo.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSave() {
    if (!eligibleId) {
      setError('Profile is read-only until the admin registers your account.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const patch = {
        phone: phone.trim() || null,
        address: address.trim() || null,
      };
      const { data: updated, error: dbErr } = await supabase
        .from('users')
        .update(patch)
        .eq('id', eligibleId)
        .select()
        .single();
      if (dbErr) throw dbErr;
      setRow(updated);
      onUserUpdated?.(updated);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const displayName = row?.name || user?.name || '';
  const displayRole = (row?.role || user?.role || '').toString();
  const avatarColor = colorFromName(displayName);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="bg-white rounded-2xl shadow-card-hover max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-omega-charcoal">Your Profile</h3>
          <button
            onClick={onClose}
            className="p-2.5 rounded-lg text-omega-stone hover:bg-omega-cloud hover:text-omega-charcoal transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Avatar with click-to-change */}
          <div className="flex flex-col items-center">
            <div className="relative">
              <Avatar
                name={displayName}
                photoUrl={photoUrl || undefined}
                color={avatarColor}
                size="xl"
              />
              {eligibleId && (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="Change photo"
                    className="absolute bottom-0 right-0 w-10 h-10 rounded-full bg-omega-charcoal text-white flex items-center justify-center shadow-card hover:bg-black disabled:opacity-50 transition border-2 border-white"
                  >
                    {uploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_FILE_INPUT}
                    className="hidden"
                    onChange={handlePickPhoto}
                  />
                </>
              )}
            </div>
            <p className="mt-3 text-base font-bold text-omega-charcoal">{displayName || '—'}</p>
            <p className="text-[11px] text-omega-stone uppercase tracking-wider font-semibold mt-0.5">
              {displayRole || ''}
            </p>
          </div>

          {!loaded ? (
            <div className="flex items-center justify-center py-4 text-omega-stone gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : !eligibleId ? (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">
                Profile is read-only
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Your account isn't registered in <em>Users &amp; Access</em>. Ask the admin to register you so phone, address and photo can be saved.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Phone" icon={Phone}>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(203) 555-1234"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-omega-orange focus:outline-none transition"
                  disabled={saving}
                />
              </Field>
              <Field label="Address" icon={MapPin}>
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, city, ZIP"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-none focus:border-omega-orange focus:outline-none transition"
                  disabled={saving}
                />
              </Field>
              <Field label="Name" icon={UserIcon}>
                <input
                  value={displayName}
                  readOnly
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-omega-cloud text-sm text-omega-stone cursor-not-allowed"
                />
                <p className="text-[10px] text-omega-stone mt-1">
                  Managed in Admin → Users &amp; Access.
                </p>
              </Field>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 px-1">{error}</p>
          )}

          <PushSection user={user} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-omega-cloud/40">
          <button
            type="button"
            onClick={onClose}
            disabled={saving || uploading}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold text-omega-charcoal hover:bg-white border border-gray-200 disabled:opacity-50 transition"
          >
            Close
          </button>
          {eligibleId && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || uploading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold text-white bg-omega-orange hover:bg-omega-dark disabled:opacity-50 transition"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Push notifications opt-in. iOS users must first install the PWA (Add to Home
// Screen); we detect that and show the install steps instead of the Enable
// button until they're running standalone.
function PushSection({ user }) {
  const [supported, setSupported] = useState(false);
  const [perm, setPerm] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const refresh = async () => {
    setSupported(isPushSupported());
    setPerm(permissionState());
    setNeedsInstall(iosNeedsInstall());
    setSubscribed(await isSubscribed());
  };

  useEffect(() => { refresh(); }, []);

  const enable = async () => {
    setBusy(true); setMsg(null);
    const res = await subscribeUser(user);
    if (!res.ok) setMsg(res.error);
    await refresh();
    setBusy(false);
  };
  const disable = async () => {
    setBusy(true); setMsg(null);
    await unsubscribeUser();
    await refresh();
    setBusy(false);
  };

  return (
    <div className="border-t border-gray-100 pt-4 mt-1">
      <div className="flex items-center gap-2 mb-2">
        <Bell className="w-4 h-4 text-omega-orange" />
        <p className="text-sm font-bold text-omega-charcoal">Push notifications</p>
      </div>

      {!supported ? (
        <p className="text-xs text-omega-stone">Not supported on this device or browser.</p>
      ) : needsInstall ? (
        <div className="text-xs text-omega-stone space-y-1 bg-omega-cloud rounded-xl p-3">
          <p className="font-semibold text-omega-charcoal">Install Omega first (iPhone):</p>
          <p>1. Tap the <strong>Share</strong> button in Safari.</p>
          <p>2. Choose <strong>Add to Home Screen</strong>.</p>
          <p>3. Open <strong>Omega</strong> from your Home Screen, then come back here to enable.</p>
        </div>
      ) : perm === 'denied' ? (
        <p className="text-xs text-omega-stone">
          Notifications are blocked. Enable them for Omega in your device settings, then reopen the app.
        </p>
      ) : subscribed ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-emerald-700 font-semibold inline-flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" /> On for this device.
          </p>
          <button
            onClick={disable}
            disabled={busy}
            className="text-xs font-semibold text-omega-stone hover:text-red-600 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellOff className="w-3.5 h-3.5" />} Turn off
          </button>
        </div>
      ) : (
        <button
          onClick={enable}
          disabled={busy}
          className="flex w-full sm:w-auto sm:inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold text-white bg-omega-orange hover:bg-omega-dark disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />} Enable notifications
        </button>
      )}

      {msg && <p className="text-xs text-red-600 mt-2">{msg}</p>}
    </div>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </label>
      {children}
    </div>
  );
}
