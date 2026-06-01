import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Bell, Mail, FileSignature, GitBranch, DollarSign,
  AlertCircle, Clock, Eye, Filter,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { recipientRolesFor, renderNotificationText } from '../../../shared/lib/notifications';
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

export default function Notifications({ onNavigate, user }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true);
    try {
      // Pull only notifications scoped to this role + 'all'.
      // Before this fix the screen showed every row in the table —
      // which is why Attila was seeing Inácio's daily nags.
      const roles = recipientRolesFor(user?.role || 'sales') || ['sales', 'all'];
      let query = supabase
        .from('notifications')
        .select('*, jobs(client_name, service)')
        .order('created_at', { ascending: false })
        .limit(80);
      query = query.in('recipient_role', roles);
      const { data } = await query;
      setNotifications(data || []);
      // Mark fetched rows as seen (only the previously-unseen ones).
      const unseenIds = (data || []).filter((n) => !n.seen).map((n) => n.id);
      if (unseenIds.length > 0) {
        await supabase.from('notifications').update({ seen: true, read: true }).in('id', unseenIds);
      }
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications;
    return notifications.filter((n) => n.type === filter);
  }, [notifications, filter]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read && !n.seen).length,
    [notifications]
  );

  return (
    <div className="min-h-screen bg-omega-cloud">
      <div className="bg-omega-charcoal px-5 pt-12 pb-5 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('home')}
            className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-bold text-lg leading-tight">Notifications</h1>
            <p className="text-[11px] text-white/70 mt-0.5">
              {loading
                ? 'Loading…'
                : `${notifications.length} total${unreadCount > 0 ? ` · ${unreadCount} new` : ''}`}
            </p>
          </div>
        </div>

        {/* Type filter pills — sticky in the dark header so it's always
            within thumb reach on phone. Horizontally scrollable for
            narrow screens. */}
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
                    ? 'bg-white text-omega-charcoal'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    active ? 'bg-omega-charcoal text-white' : 'bg-white/20 text-white'
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
              return (
                <div
                  key={n.id}
                  className={`p-4 rounded-2xl border transition-all ${
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

                      {/* Title (now visible — was hidden before) */}
                      {n.title && (
                        <p className="text-[14px] font-semibold text-omega-charcoal leading-snug">
                          {n.title}
                        </p>
                      )}
                      {/* Body — rendered through renderNotificationText so
                          new-style {type, payload} rows surface live data
                          and old-style rows keep working from `message`. */}
                      {(() => {
                        const text = renderNotificationText(n);
                        if (!text) return null;
                        return (
                          <p className="text-[12.5px] text-omega-slate mt-0.5 leading-snug">
                            {text}
                          </p>
                        );
                      })()}
                    </div>

                    {isUnread && (
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${meta.dot}`} aria-hidden />
                    )}
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
