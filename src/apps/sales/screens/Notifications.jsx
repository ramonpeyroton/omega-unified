import { useState, useEffect, useMemo } from 'react';
import {
  Bell, Mail, FileSignature, GitBranch, DollarSign,
  AlertCircle, Clock, Check, Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { recipientRolesFor, renderNotificationText } from '../../../shared/lib/notifications';
import { tabForNotification } from '../../../shared/components/NotificationsBell';
import PageHeader from '../../../shared/components/ui/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';

// Per-type visual treatment. Picks an icon + tinted card so Attila
// can scan the feed at a glance: contracts amber, estimates purple,
// pipeline blue, finance green, change orders red, system gray.
//
// Picked from Lucide so it matches the rest of the app. The `chip`
// classes are applied to the icon tile; `card` is the row background
// (only when the notification is unread).
const TYPE_STYLE = {
  estimate:    { Icon: Mail,          chip: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500',  card: 'bg-purple-50/60',  label: 'Estimate' },
  contract:    { Icon: FileSignature, chip: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500',   card: 'bg-amber-50/60',   label: 'Contract' },
  pipeline:    { Icon: GitBranch,     chip: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500',    card: 'bg-blue-50/60',    label: 'Pipeline' },
  finance:     { Icon: DollarSign,    chip: 'bg-green-100 text-green-700',   dot: 'bg-green-500',   card: 'bg-green-50/60',   label: 'Finance' },
  change_order:{ Icon: AlertCircle,   chip: 'bg-red-100 text-red-700',       dot: 'bg-red-500',     card: 'bg-red-50/60',     label: 'Change Order' },
  daily_update_reminder: { Icon: Clock, chip: 'bg-gray-100 text-gray-600',   dot: 'bg-gray-400',    card: 'bg-gray-50/60',    label: 'Reminder' },
  default:     { Icon: Bell,          chip: 'bg-gray-100 text-gray-600',     dot: 'bg-gray-400',    card: 'bg-gray-50/60',    label: 'Update' },
};

function styleFor(type) { return TYPE_STYLE[type] || TYPE_STYLE.default; }

function formatTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'estimate', label: 'Estimates' },
  { id: 'contract', label: 'Contracts' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'finance',  label: 'Finance' },
];

export default function Notifications({ onNavigate, user, onOpenJob }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  // Default to UNREAD so Attila lands on what actually needs attention.
  // The "All" pill swaps in the historical view including read items.
  const [readFilter, setReadFilter] = useState('unread');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true);
    try {
      // Pull only notifications scoped to this role + 'all'.
      const roles = recipientRolesFor(user?.role || 'sales') || ['sales', 'all'];
      const { data } = await supabase
        .from('notifications')
        .select('*, jobs(client_name, service)')
        .in('recipient_role', roles)
        .order('created_at', { ascending: false })
        .limit(200);
      setNotifications(data || []);
      // We deliberately do NOT auto-mark as seen here — Attila controls
      // that himself with "Mark all read" / clicking individual rows.
      // The previous auto-mark was hiding alerts before he could act.
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id) {
    try {
      await supabase.from('notifications').update({ read: true, seen: true }).eq('id', id);
      setNotifications((prev) => prev.map((n) =>
        n.id === id ? { ...n, read: true, seen: true } : n
      ));
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    const ids = notifications.filter((n) => !n.read && !n.seen).map((n) => n.id);
    if (ids.length === 0) return;
    try {
      await supabase.from('notifications').update({ read: true, seen: true }).in('id', ids);
      setNotifications((prev) => prev.map((n) =>
        ids.includes(n.id) ? { ...n, read: true, seen: true } : n
      ));
    } catch { /* ignore */ }
  }

  async function deleteOne(id, e) {
    e?.stopPropagation();
    try {
      await supabase.from('notifications').delete().eq('id', id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch { /* ignore */ }
  }

  async function clearAllRead() {
    const ids = notifications.filter((n) => n.read || n.seen).map((n) => n.id);
    if (ids.length === 0) return;
    if (!window.confirm(`Permanently delete ${ids.length} read notification${ids.length === 1 ? '' : 's'}?`)) return;
    try {
      await supabase.from('notifications').delete().in('id', ids);
      setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
    } catch { /* ignore */ }
  }

  async function handleClick(n) {
    await markRead(n.id);
    if (n.job_id && typeof onOpenJob === 'function') {
      try {
        const { data: job } = await supabase
          .from('jobs').select('*').eq('id', n.job_id).maybeSingle();
        if (job) onOpenJob(job, tabForNotification(n.type));
      } catch { /* ignore */ }
    }
  }

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (readFilter === 'unread' && (n.read || n.seen)) return false;
      if (filter !== 'all' && n.type !== filter) return false;
      return true;
    });
  }, [notifications, filter, readFilter]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read && !n.seen).length,
    [notifications]
  );
  const readCount = useMemo(
    () => notifications.filter((n) => n.read || n.seen).length,
    [notifications]
  );

  return (
    <div className="min-h-screen bg-omega-cloud">
      <PageHeader
        icon={Bell}
        title="Notifications"
        subtitle={loading ? 'Loading…' : `${notifications.length} total${unreadCount > 0 ? ` · ${unreadCount} new` : ''}`}
        onBack={() => onNavigate('home')}
        actions={(
          <>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-omega-charcoal hover:border-omega-orange text-[12px] font-semibold transition-colors"
                title="Mark every unread notification as read"
              >
                <Check className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
            {readCount > 0 && (
              <button
                onClick={clearAllRead}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-omega-stone hover:border-red-300 hover:text-red-600 text-[12px] font-semibold transition-colors"
                title="Permanently delete every notification you've already read"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear read ({readCount})
              </button>
            )}
          </>
        )}
      />

      {/* Sub-header bar — filters + mobile bulk actions on a clean
          white strip below the page header. Same chrome as everything
          else in the Sales app now. */}
      <div className="bg-white border-b border-omega-cloud px-4 sm:px-6 py-3 sticky top-[52px] sm:top-[60px] z-10">
        {/* Mobile bulk-action bar (desktop has them in the header actions slot) */}
        {(unreadCount > 0 || readCount > 0) && (
          <div className="sm:hidden flex gap-2 mb-3">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-omega-charcoal text-[12px] font-semibold"
              >
                <Check className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
            {readCount > 0 && (
              <button
                onClick={clearAllRead}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-omega-stone text-[12px] font-semibold"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear ({readCount})
              </button>
            )}
          </div>
        )}

        {/* Unread / All toggle */}
        <div className="inline-flex bg-omega-cloud rounded-full p-0.5">
          {[
            { id: 'unread', label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
            { id: 'all',    label: `All (${notifications.length})` },
          ].map((opt) => {
            const active = readFilter === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setReadFilter(opt.id)}
                className={`px-3 py-1 rounded-full text-[12px] font-semibold transition-colors ${
                  active ? 'bg-white text-omega-charcoal shadow-sm' : 'text-omega-stone hover:text-omega-charcoal'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Type filter pills */}
        <div className="mt-3 -mx-1 px-1 flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const count = f.id === 'all'
              ? notifications.length
              : notifications.filter((n) => n.type === f.id).length;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-omega-orange text-white'
                    : 'bg-omega-cloud text-omega-stone hover:text-omega-charcoal'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    active ? 'bg-white/20 text-white' : 'bg-white text-omega-stone'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-5">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Bell className="w-12 h-12 text-omega-fog mb-3" />
            <p className="font-semibold text-omega-charcoal">
              {filter === 'all' ? 'No notifications' : `No ${filter} notifications`}
            </p>
            <p className="text-sm text-omega-stone mt-1">
              {filter === 'all' ? "You're all caught up" : 'Try another filter'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((n) => {
              const meta = styleFor(n.type);
              const Icon = meta.Icon;
              const isUnread = !n.read && !n.seen;
              const client = n.jobs?.client_name;
              const canNavigate = !!n.job_id && typeof onOpenJob === 'function';
              return (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`group p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md ${
                    isUnread
                      ? `${meta.card} border-omega-orange/30 shadow-sm`
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon tile — colored per type */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.chip}`}>
                      <Icon className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Type tag + client + time */}
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.chip}`}>
                          {meta.label}
                        </span>
                        {client && (
                          <span className="text-[12px] font-bold text-omega-charcoal truncate max-w-[14rem]">
                            {client}
                          </span>
                        )}
                        <span className="text-[10px] text-omega-stone ml-auto whitespace-nowrap">
                          {formatTime(n.created_at)}
                        </span>
                      </div>

                      {n.title && (
                        <p className="text-[14px] font-semibold text-omega-charcoal leading-snug">
                          {n.title}
                        </p>
                      )}
                      {(() => {
                        const text = renderNotificationText(n);
                        if (!text) return null;
                        return (
                          <p className="text-[12.5px] text-omega-slate mt-0.5 leading-snug">
                            {text}
                          </p>
                        );
                      })()}
                      {canNavigate && (
                        <p className="text-[10px] text-omega-orange font-semibold mt-1">
                          Tap to open job →
                        </p>
                      )}
                    </div>

                    {/* Right rail — unread dot + delete button */}
                    <div className="flex items-start gap-2 flex-shrink-0">
                      {isUnread && (
                        <div className={`w-2 h-2 rounded-full mt-1.5 ${meta.dot}`} aria-hidden />
                      )}
                      <button
                        onClick={(e) => deleteOne(n.id, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-omega-stone hover:text-red-600"
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
        )}
      </div>
    </div>
  );
}
