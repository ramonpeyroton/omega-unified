import { useEffect, useState, useMemo } from 'react';
import { Bell, X, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Maps app user role → which recipient_role values the user should receive.
// 'admin' and 'owner' see everything; others see their own bucket + 'all'.
function recipientRolesFor(role) {
  if (role === 'admin' || role === 'owner') return null; // null = no filter
  if (role === 'salesperson' || role === 'sales') return ['sales', 'all'];
  if (role === 'operations') return ['operations', 'all'];
  if (role === 'manager') return ['manager', 'all'];
  return ['all'];
}

export default function NotificationsBell({ user, dark = false }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('notifications-bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => load())
      .subscribe();
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line
  }, [user?.role]);

  async function load() {
    try {
      const roles = recipientRolesFor(user?.role);
      let query = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (roles) query = query.in('recipient_role', roles);
      const { data } = await query;
      setItems(data || []);
    } catch {
      setItems([]);
    }
  }

  const unreadCount = useMemo(() => items.filter((n) => !n.read && !n.seen).length, [items]);

  async function markRead(id) {
    try {
      await supabase.from('notifications').update({ read: true, seen: true }).eq('id', id);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true, seen: true } : n)));
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    const ids = items.filter((n) => !n.read && !n.seen).map((n) => n.id);
    if (ids.length === 0) return;
    try {
      await supabase.from('notifications').update({ read: true, seen: true }).in('id', ids);
      setItems((prev) => prev.map((n) => ids.includes(n.id) ? { ...n, read: true, seen: true } : n));
    } catch { /* ignore */ }
  }

  const btnCls = dark
    ? 'relative p-2 rounded-xl bg-white/10 text-omega-fog hover:bg-white/20 transition-colors'
    : 'relative p-2 rounded-xl bg-white border border-gray-200 text-omega-slate hover:border-omega-orange transition-colors';

  return (
    <>
      <button onClick={() => setOpen(true)} className={btnCls} aria-label="Notifications">
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-omega-orange text-white flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)}>
          <aside
            className="absolute top-0 right-0 bottom-0 w-full sm:w-[400px] bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <p className="text-xs uppercase text-omega-stone font-semibold">Notifications</p>
                <p className="font-bold text-omega-charcoal">{items.length} recent</p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs font-semibold text-omega-orange hover:text-omega-dark">
                    Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)}><X className="w-5 h-5 text-omega-stone" /></button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto">
              {items.length === 0 && (
                <div className="p-10 text-center text-omega-stone text-sm">
                  No notifications yet.
                </div>
              )}
              {items.map((n) => {
                const unread = !n.read && !n.seen;
                return (
                  <button
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className={`w-full text-left p-4 border-b border-gray-100 hover:bg-omega-cloud transition-colors ${unread ? 'bg-omega-pale/30' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {unread && <span className="w-2 h-2 rounded-full bg-omega-orange mt-1.5 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-omega-charcoal">{n.title || '—'}</p>
                        {n.message && <p className="text-xs text-omega-slate mt-0.5">{n.message}</p>}
                        <p className="text-[10px] text-omega-stone mt-1">
                          {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                          {n.type && ` · ${n.type}`}
                        </p>
                      </div>
                      {!unread && <Check className="w-3.5 h-3.5 text-omega-success flex-shrink-0 mt-1" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
