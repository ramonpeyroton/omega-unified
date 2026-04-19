import { useEffect, useState } from 'react';
import { Plus, Edit3, X, Eye, EyeOff, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { logAudit } from '../../../shared/lib/audit';

const ROLES = ['sales', 'manager', 'operations', 'owner', 'admin'];

const ROLE_LABEL = {
  sales: 'Sales',
  manager: 'Manager',
  operations: 'Operations',
  owner: 'Owner',
  admin: 'Admin',
};

function emptyForm() {
  return { name: '', role: 'sales', pin: '' };
}

export default function UsersAccess({ user }) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null); // user row being edited or 'new'
  const [form, setForm] = useState(emptyForm());
  const [showPin, setShowPin] = useState(false);
  const [saving, setSaving] = useState(false);

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

  function openNew() { setEditing('new'); setForm(emptyForm()); setShowPin(false); }
  function openEdit(u) { setEditing(u); setForm({ name: u.name || '', role: u.role || 'sales', pin: u.pin || '' }); setShowPin(false); }
  function close() { setEditing(null); setForm(emptyForm()); }

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
        active: editing === 'new' ? true : (editing.active ?? true),
      };
      if (editing === 'new') {
        const { data, error } = await supabase.from('users').insert([payload]).select().single();
        if (error) throw error;
        setUsers((prev) => [data, ...prev]);
        logAudit({ user, action: 'user.create', entityType: 'user', entityId: data.id, details: { name: data.name, role: data.role } });
      } else {
        const { data, error } = await supabase.from('users').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        setUsers((prev) => prev.map((u) => u.id === data.id ? data : u));
        logAudit({ user, action: 'user.update', entityType: 'user', entityId: data.id, details: { name: data.name, role: data.role } });
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
                <th className="px-4 py-3 text-left">PIN</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-omega-stone">
                    No users yet. The hardcoded PINs (9012, 5678, 1234, 3456, 0000) continue to work until you add users here.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-omega-cloud/40">
                  <td className="px-4 py-3 font-medium text-omega-charcoal">{u.name}</td>
                  <td className="px-4 py-3">{ROLE_LABEL[u.role] || u.role}</td>
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
          <div className="bg-white rounded-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">{editing === 'new' ? 'Add User' : 'Edit User'}</p>
              <button onClick={close}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Name</label>
                <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">PIN (4-6 digits)</label>
                <div className="relative mt-1">
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
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={close} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
