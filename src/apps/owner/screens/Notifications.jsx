import { useState, useEffect } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from('notifications')
      .select('*, jobs(client_name, service)')
      .order('created_at', { ascending: false })
      .limit(100);
    setNotifications(data || []);
    setLoading(false);
    await supabase.from('notifications').update({ seen: true }).eq('seen', false);
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ seen: true }).eq('seen', false);
    setNotifications((p) => p.map((n) => ({ ...n, seen: true })));
  }

  const formatTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const unseen = notifications.filter((n) => !n.seen).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-omega-charcoal">Notifications</h1>
          <p className="text-xs text-omega-stone">{unseen > 0 ? `${unseen} unread` : 'All caught up'}</p>
        </div>
        {unseen > 0 && (
          <button onClick={markAllRead} className="flex items-center gap-2 text-sm text-omega-orange font-semibold hover:text-omega-dark transition-colors">
            <CheckCheck className="w-4 h-4" />Mark all read
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size={32} /></div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <Bell className="w-12 h-12 text-omega-fog mb-3" />
            <p className="font-semibold text-omega-charcoal">No notifications</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className={`flex items-start gap-4 p-4 rounded-xl border transition-all ${!n.seen ? 'bg-omega-pale border-omega-orange/20' : 'bg-white border-gray-200'}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${!n.seen ? 'bg-omega-orange' : 'bg-gray-100'}`}>
                  <Bell className={`w-4 h-4 ${!n.seen ? 'text-white' : 'text-omega-stone'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  {n.jobs && <p className="text-xs font-semibold text-omega-orange mb-0.5">{n.jobs.client_name} · {n.jobs.service}</p>}
                  <p className="text-sm text-omega-charcoal">{n.message}</p>
                  <p className="text-xs text-omega-stone mt-1">{formatTime(n.created_at)}</p>
                </div>
                {!n.seen && <div className="w-2 h-2 rounded-full bg-omega-orange flex-shrink-0 mt-2" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
