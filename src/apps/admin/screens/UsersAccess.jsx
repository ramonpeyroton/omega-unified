import { useEffect, useRef, useState } from 'react';
import {
  Plus, Edit3, X, Eye, EyeOff, Save, Camera, Loader2,
  Phone as PhoneIcon, MapPin, User as UserIcon,
} from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { logAudit } from '../../../shared/lib/audit';
import Avatar, { colorFromName } from '../../../shared/components/ui/Avatar';

const ROLES = ['sales', 'manager', 'operations', 'owner', 'admin'];

const ROLE_LABEL = {
  sales: 'Sales',
  manager: 'Manager',
  operations: 'Operations',
  owner: 'Owner',
  admin: 'Admin',
};

// Photo upload — same pipeline as UserProfileModal so a fresh user
// added by Admin gets an avatar saved exactly the same way the user
// would later in their own profile modal.
const PHOTO_BUCKET = 'user-profiles';
const COMPRESS_TARGET_MB = 2;
const COMPRESS_MAX_DIMENSION = 1024;
const COMPRESS_QUALITY = 0.8;
const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPTED_FILE_INPUT =
  '.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif';

function emptyForm() {
  return {
    name: '',
    role: 'sales',
    pin: '',
    phone: '',
    address: '',
    profile_photo_url: null,
  };
}

export default function UsersAccess({ user }) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null); // user row being edited or 'new'
  const [form, setForm] = useState(emptyForm());
  const [showPin, setShowPin] = useState(false);
  const [saving, setSaving] = useState(false);
  // Pending photo file when adding a new user — uploaded after insert
  // (so the storage path can use the real user ID).
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('role')
        .order('name');
      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  }

  function openNew() {
    setEditing('new');
    setForm(emptyForm());
    setShowPin(false);
    setPendingPhotoFile(null);
  }
  function openEdit(u) {
    setEditing(u);
    setForm({
      name: u.name || '',
      role: u.role || 'sales',
      pin: u.pin || '',
      phone: u.phone || '',
      address: u.address || '',
      profile_photo_url: u.profile_photo_url || null,
    });
    setShowPin(false);
    setPendingPhotoFile(null);
  }
  function close() {
    setEditing(null);
    setForm(emptyForm());
    setPendingPhotoFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Compress + upload to user-profiles/<userId>/<timestamp>-<name>.
  // Returns the public URL or throws.
  async function uploadPhoto(userId, rawFile) {
    let compressed;
    try {
      compressed = await imageCompression(rawFile, {
        maxSizeMB: COMPRESS_TARGET_MB,
        maxWidthOrHeight: COMPRESS_MAX_DIMENSION,
        initialQuality: COMPRESS_QUALITY,
        useWebWorker: true,
        fileType: 'image/jpeg',
      });
    } catch {
      if (rawFile.size <= MAX_BYTES) compressed = rawFile;
      else throw new Error('Could not process this image');
    }
    if (compressed.size > MAX_BYTES) {
      throw new Error(
        `Even after compression the image is ${(compressed.size / 1024 / 1024).toFixed(1)} MB. Try a smaller photo.`,
      );
    }
    const safeName = (compressed.name || 'photo.jpg')
      .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
    const path = `${userId}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, compressed, { upsert: false, contentType: compressed.type || 'image/jpeg' });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    if (!pub?.publicUrl) throw new Error('Could not resolve public URL.');
    return pub.publicUrl;
  }

  async function handlePickPhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    // For "new" users we don't have an ID yet — stash the file and
    // upload on save. Show an immediate preview via object URL.
    if (editing === 'new') {
      setPendingPhotoFile(f);
      try {
        const objectUrl = URL.createObjectURL(f);
        setForm((prev) => ({ ...prev, profile_photo_url: objectUrl }));
      } catch {
        // ignore preview error — actual upload still happens on save
      }
      return;
    }
    // Existing user — upload immediately like UserProfileModal does.
    setUploadingPhoto(true);
    try {
      const newUrl = await uploadPhoto(editing.id, f);
      const { data: updated, error: dbErr } = await supabase
        .from('users')
        .update({ profile_photo_url: newUrl })
        .eq('id', editing.id)
        .select()
        .single();
      if (dbErr) throw dbErr;
      setForm((prev) => ({ ...prev, profile_photo_url: updated.profile_photo_url }));
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setEditing(updated);
      logAudit({
        user, action: 'user.update', entityType: 'user', entityId: updated.id,
        details: { name: updated.name, profile_photo_url: !!updated.profile_photo_url },
      });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Could not upload photo.' });
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function save() {
    if (!form.name.trim()) { setToast({ type: 'warning', message: 'Name required' }); return; }
    if (!/^\d{4,6}$/.test(form.pin)) { setToast({ type: 'warning', message: 'PIN must be 4-6 digits' }); return; }
    if (!ROLES.includes(form.role)) { setToast({ type: 'warning', message: 'Pick a valid role' }); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        role: form.role,
        pin: form.pin,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        active: editing === 'new' ? true : (editing.active ?? true),
      };
      let saved;
      if (editing === 'new') {
        const { data, error } = await supabase.from('users').insert([payload]).select().single();
        if (error) throw error;
        saved = data;
        // Now that we have a real ID, upload the pending photo (if any)
        // and patch the row. Failure here is non-fatal — the user is
        // already created, just without a photo.
        if (pendingPhotoFile) {
          try {
            const url = await uploadPhoto(saved.id, pendingPhotoFile);
            const { data: withPhoto, error: upErr } = await supabase
              .from('users')
              .update({ profile_photo_url: url })
              .eq('id', saved.id)
              .select()
              .single();
            if (upErr) throw upErr;
            saved = withPhoto;
          } catch (err) {
            setToast({
              type: 'warning',
              message: `User created but photo upload failed: ${err.message || 'unknown error'}`,
            });
          }
        }
        setUsers((prev) => [saved, ...prev]);
        logAudit({
          user, action: 'user.create', entityType: 'user', entityId: saved.id,
          details: { name: saved.name, role: saved.role },
        });
      } else {
        // Photo for existing users is uploaded on pick (above), so the
        // payload only carries text fields here.
        const { data, error } = await supabase
          .from('users').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        saved = data;
        setUsers((prev) => prev.map((u) => (u.id === saved.id ? saved : u)));
        logAudit({
          user, action: 'user.update', entityType: 'user', entityId: saved.id,
          details: { name: saved.name, role: saved.role },
        });
      }
      setToast({ type: 'success', message: 'User saved' });
      close();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u) {
    try {
      const { data, error } = await supabase
        .from('users')
        .update({ active: !u.active })
        .eq('id', u.id)
        .select().single();
      if (error) throw error;
      setUsers((prev) => prev.map((x) => x.id === data.id ? data : x));
      logAudit({ user, action: data.active ? 'user.activate' : 'user.deactivate', entityType: 'user', entityId: data.id, details: { name: data.name } });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed' });
    }
  }

  function maskPin(pin) {
    if (!pin) return '—';
    return '•'.repeat(Math.max(0, pin.length - 2)) + pin.slice(-2);
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Users & Access</h1>
            <p className="text-sm text-omega-stone mt-1">Manage PIN logins and role permissions</p>
          </div>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
          >
            <Plus className="w-4 h-4" /> Add User
          </button>
        </div>
      </header>

      <div className="p-6 md:p-8">
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">PIN</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-omega-stone">
                    No users yet. The hardcoded PINs (3333, 4444, 1111, 2222, 9999) continue to work until you add users here.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-omega-cloud/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        name={u.name || ''}
                        photoUrl={u.profile_photo_url || undefined}
                        color={colorFromName(u.name || '')}
                        size="sm"
                      />
                      <span className="font-medium text-omega-charcoal">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">{ROLE_LABEL[u.role] || u.role}</td>
                  <td className="px-4 py-3 text-omega-stone">{u.phone || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{maskPin(u.pin)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${
                      u.active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'
                    }`}>
                      {u.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button onClick={() => openEdit(u)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange hover:text-omega-dark">
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button onClick={() => toggleActive(u)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-slate hover:text-omega-charcoal">
                        {u.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {editing && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={close}>
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white z-10">
              <p className="font-bold text-omega-charcoal">{editing === 'new' ? 'Add User' : 'Edit User'}</p>
              <button onClick={close}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Photo */}
              <div className="flex flex-col items-center">
                <div className="relative">
                  <Avatar
                    name={form.name || ''}
                    photoUrl={form.profile_photo_url || undefined}
                    color={colorFromName(form.name || '')}
                    size="xl"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    title="Change photo"
                    className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-omega-charcoal text-white flex items-center justify-center shadow-card hover:bg-black disabled:opacity-50 transition border-2 border-white"
                  >
                    {uploadingPhoto ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_FILE_INPUT}
                    className="hidden"
                    onChange={handlePickPhoto}
                  />
                </div>
                {editing === 'new' && pendingPhotoFile && (
                  <p className="mt-2 text-[10px] text-omega-stone">
                    Photo will be uploaded after saving.
                  </p>
                )}
              </div>

              <Field label="Full Name" icon={UserIcon}>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Inácio Silva"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                />
              </Field>

              <Field label="Role">
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </Field>

              <Field label="Phone" icon={PhoneIcon}>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="(203) 555-1234"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                />
              </Field>

              <Field label="Address" icon={MapPin}>
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Street, city, ZIP"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none"
                />
              </Field>

              <Field label="PIN (4-6 digits)">
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    value={form.pin}
                    onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    className="w-full px-3 py-2 pr-10 rounded-lg border border-gray-200 text-sm font-mono tracking-[0.3em]"
                  />
                  <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-2 top-1/2 -translate-y-1/2 text-omega-stone">
                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button onClick={close} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving || uploadingPhoto} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-omega-stone uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </label>
      {children}
    </div>
  );
}
