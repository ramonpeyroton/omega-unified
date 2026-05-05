// ChatMembersModal — owner / operations / admin tool for managing
// who has access to a project's Daily Logs chat. Drives the
// jobs.chat_members text[] column from migration 043.
//
// Triggered from a small "Members" button rendered next to the
// chat header inside JobFullView's Daily Logs tab. Other roles
// can SEE the current member list (read-only) but the modal only
// opens for the three privileged roles.
//
// Shows every active user as a togglable chip — easy multi-select
// without nested menus. Saves on click.

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Check, AlertCircle, UsersRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';

export default function ChatMembersModal({ job, user, onClose, onUpdated }) {
  const [staff, setStaff]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [members, setMembers] = useState(() => Array.isArray(job?.chat_members) ? [...job.chat_members] : []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Active users only; admin is hidden because it's not a real
        // person on the team (matches the receptionist-side filters
        // in NewLead and the EventForm assignee picker).
        const { data, error: e } = await supabase
          .from('users')
          .select('name, role, active')
          .eq('active', true)
          .neq('role', 'admin')
          .order('name', { ascending: true });
        if (e) throw e;
        if (active) setStaff(data || []);
      } catch (err) {
        if (active) setError(err?.message || 'Failed to load users.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  function toggle(name) {
    setMembers((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const { data, error: e } = await supabase
        .from('jobs')
        .update({ chat_members: members })
        .eq('id', job.id)
        .select()
        .single();
      if (e) throw e;

      logAudit({
        user, action: 'chat.members_update', entityType: 'job',
        entityId: job.id, details: { members },
      });

      onUpdated?.(data);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  // Group staff by role so the modal is visually organized — admins
  // typically scan by role ("which manager is on this?") rather than
  // by name.
  const grouped = useMemo(() => {
    const g = {};
    for (const u of staff) {
      const k = u.role || 'other';
      (g[k] = g[k] || []).push(u);
    }
    return g;
  }, [staff]);

  const roleOrder = ['owner', 'operations', 'sales', 'manager', 'receptionist', 'marketing', 'other'];

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="inline-flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-omega-pale inline-flex items-center justify-center">
              <UsersRound className="w-4 h-4 text-omega-orange" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-omega-charcoal">Chat members</h3>
              <p className="text-[11px] text-omega-stone truncate max-w-[220px]">
                {job?.client_name || 'Project'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-omega-stone"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-4">
          <p className="text-xs text-omega-stone">
            Pick who can see this project's chat. Tap a name to toggle.
            Members marked here see this card in their Daily Logs sidebar.
          </p>

          {loading && (
            <p className="inline-flex items-center gap-2 text-xs text-omega-stone py-4">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </p>
          )}

          {!loading && roleOrder.map((role) => {
            const list = grouped[role];
            if (!list || list.length === 0) return null;
            return (
              <div key={role}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone mb-1.5">
                  {role}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((u) => {
                    const checked = members.includes(u.name);
                    return (
                      <button
                        key={u.name}
                        type="button"
                        onClick={() => toggle(u.name)}
                        className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-colors inline-flex items-center gap-1 ${
                          checked
                            ? 'bg-omega-orange text-white border-omega-orange'
                            : 'bg-white text-omega-charcoal border-gray-200 hover:border-omega-orange'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3" />}
                        {u.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700 inline-flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-2 bg-gray-50">
          <p className="text-[11px] text-omega-stone">
            {members.length} {members.length === 1 ? 'person' : 'people'} selected
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-white text-sm font-bold text-omega-charcoal disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-bold"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
