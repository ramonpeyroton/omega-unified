import { useState, useEffect } from 'react';
import { ArrowLeft, Bell, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { recipientRolesFor } from '../../../shared/lib/notifications';
import LoadingSpinner from '../components/LoadingSpinner';

export default function Notifications({ user, onNavigate, darkMode }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.role]);

  async function load() {
    // Scope to this user's recipient_role(s) so Gabriel doesn't see
    // sales-only alerts (e.g. a visit Rafaela booked for Attila).
    const roles = recipientRolesFor(user?.role);
    let q = supabase
      .from('notifications')
      .select('*, jobs(client_name, service)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (roles) q = q.in('recipient_role', roles);
    const { data } = await q;
    setNotifications(data || []);
    setLoading(false);
    // Mark only this user's unseen notifications as seen.
    let upd = supabase.from('notifications').update({ seen: true }).eq('seen', false);
    if (roles) upd = upd.in('recipient_role', roles);
    await upd;
  }

  const formatTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-gray-900' : 'bg-omega-cloud'}`}>
      <div className="bg-omega-charcoal px-5 pt-12 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={() => onNavigate('dashboard')} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white font-bold text-lg">Notifications</h1>
        </div>
      </div>

      <div className="px-4 py-5">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Bell className="w-12 h-12 text-omega-fog mb-3" />
            <p className={`font-semibold ${darkMode ? 'text-white' : 'text-omega-charcoal'}`}>No notifications</p>
            <p className="text-sm text-omega-stone mt-1">You're all caught up</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className={`p-4 rounded-2xl border transition-all ${!n.seen ? (darkMode ? 'bg-omega-orange/10 border-omega-orange/30' : 'bg-omega-pale border-omega-orange/20') : (darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200')}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${!n.seen ? 'bg-omega-orange' : 'bg-gray-100'}`}>
                    <Bell className={`w-4 h-4 ${!n.seen ? 'text-white' : 'text-omega-stone'}`} />
                  </div>
                  <div className="flex-1">
                    {n.jobs && <p className="text-xs font-semibold text-omega-orange mb-0.5">{n.jobs.client_name}</p>}
                    <p className={`text-sm ${darkMode ? 'text-white' : 'text-omega-charcoal'}`}>{n.message}</p>
                    <p className="text-xs text-omega-stone mt-1">{formatTime(n.created_at)}</p>
                  </div>
                  {!n.seen && <div className="w-2 h-2 rounded-full bg-omega-orange flex-shrink-0 mt-1.5" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
