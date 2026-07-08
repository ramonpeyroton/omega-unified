import { useEffect, useState, useMemo, useRef } from 'react';
import { Bell, X, Check, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { recipientRolesFor, renderNotificationText, dedupeNotifications } from '../lib/notifications';

// Maps notification.type to the JobFullView tab to land on when the
// user taps the notification. Centralised so the popover and the
// full-screen Notifications screen behave identically.
export function tabForNotification(type) {
  switch (type) {
    case 'estimate':     return 'estimate';
    case 'contract':     return 'estimate';   // contracts live inside the estimate tab
    case 'change_order': return 'financials';   // CO panel lives in the Financials tab
    case 'finance':
    case 'payment':      return 'financials';
    case 'pipeline':     return 'daily';
    default:             return 'daily';
  }
}

export default function NotificationsBell({ user, dark = false, onOpenJob }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  // Each instance gets its OWN channel name. The Sales app renders TWO
  // bells (mobile header + desktop header) and Supabase Realtime rejects
  // duplicate subscribers on the same channel name — that was crashing
  // the Sales dashboard to a blank screen.
  const channelIdRef = useRef(
    `notifications-bell-${Math.random().toString(36).slice(2, 10)}`
  );

  useEffect(() => {
    load();
    const channel = supabase
      .channel(channelIdRef.current)
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
        // Join the linked job so renderNotificationText can swap the
        // baked client_name for the current one (audit #9).
        .select('*, jobs(client_name)')
        .order('created_at', { ascending: false })
        .limit(60);
      if (roles) query = query.in('recipient_role', roles);
      const { data } = await query;
      // Collapse the per-role fan-out so the owner (who sees every role's
      // row) sees each event once.
      setItems(dedupeNotifications(data || []));
    } catch {
      setItems([]);
    }
  }

  const unreadCount = useMemo(() => items.filter((n) => !n.read && !n.seen).length, [items]);

  // Scope a query to ALL per-role sibling rows of one event (same
  // type + job_id + created_at). The owner sees a single deduped item,
  // but the DB has 3 rows — marking/deleting must hit all of them or the
  // item reappears on the next load. Falls back to id when incomplete.
  function scopeToEvent(q, row) {
    if (row?.type && row?.job_id && row?.created_at) {
      return q.eq('type', row.type).eq('job_id', row.job_id).eq('created_at', row.created_at);
    }
    return q.eq('id', row?.id);
  }

  async function markRead(row) {
    try {
      await scopeToEvent(supabase.from('notifications').update({ read: true, seen: true }), row);
      setItems((prev) => prev.map((n) => (n.id === row?.id ? { ...n, read: true, seen: true } : n)));
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    const unread = items.filter((n) => !n.read && !n.seen);
    if (unread.length === 0) return;
    try {
      await Promise.all(unread.map((n) =>
        scopeToEvent(supabase.from('notifications').update({ read: true, seen: true }), n)));
      setItems((prev) => prev.map((n) => (!n.read && !n.seen ? { ...n, read: true, seen: true } : n)));
    } catch { /* ignore */ }
  }

  // Open the linked job at the right tab and dismiss the notification.
  // The bell does the job lookup itself so each host app just needs to
  // wire its existing fullView handler into onOpenJob(job, tab).
  // Falls back to mark-as-read when there's no host handler or job_id.
  async function handleClick(n) {
    await markRead(n);
    if (n.job_id && typeof onOpenJob === 'function') {
      try {
        const { data: job } = await supabase
          .from('jobs').select('*').eq('id', n.job_id).maybeSingle();
        if (job) {
          onOpenJob(job, tabForNotification(n.type));
          setOpen(false);
        }
      } catch { /* ignore */ }
    }
  }

  async function deleteOne(row, e) {
    e?.stopPropagation();
    try {
      await scopeToEvent(supabase.from('notifications').delete(), row);
      setItems((prev) => prev.filter((n) => n.id !== row?.id));
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
            className="absolute top-0 right-0 bottom-0 w-full sm:w-[400px] bg-white shadow-2xl flex flex-col animate-[slideInRight_0.2s_ease-out]"
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
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Bell className="w-8 h-8 text-omega-fog" />
                  <p className="text-sm text-omega-stone">No notifications yet.</p>
                </div>
              )}
              {items.map((n) => {
                const unread = !n.read && !n.seen;
                const canNavigate = !!n.job_id && typeof onOpenJob === 'function';
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleClick(n)}
                    className={`group w-full text-left p-4 border-b border-gray-100 hover:bg-omega-cloud transition-colors cursor-pointer ${unread ? 'bg-omega-pale/30' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {unread && <span className="w-2 h-2 rounded-full bg-omega-orange mt-1.5 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-omega-charcoal">{n.title || '—'}</p>
                        {(() => {
                          const text = renderNotificationText(n);
                          return text ? <p className="text-xs text-omega-slate mt-0.5">{text}</p> : null;
                        })()}
                        <p className="text-[10px] text-omega-stone mt-1">
                          {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                          {n.type && ` · ${n.type}`}
                          {canNavigate && <span className="ml-1 text-omega-orange">· tap to open</span>}
                        </p>
                      </div>
                      <div className="flex items-start gap-1 flex-shrink-0 mt-1">
                        {!unread && <Check className="w-3.5 h-3.5 text-omega-success" />}
                        <button
                          onClick={(e) => deleteOne(n, e)}
                          className="opacity-60 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-omega-stone hover:text-red-600"
                          title="Delete notification"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
