// DailyLogsList — list-only daily logs surface that expands inline
// in each app's sidebar when the user clicks the Daily Logs nav
// item. Slack-style: every project the user is a chat member of
// renders as a `# slug` row with bold + dot for unread + numeric
// badge for @ mentions. Click → opens JobFullView with the chat
// tab selected.
//
// The parent sidebar owns the open/close state; this component is
// rendered conditionally and is deliberately scrollable to handle
// the 50+ active projects Ramon's pipeline can hold.

import { useEffect, useMemo, useState } from 'react';
import { Search, BellRing } from 'lucide-react';
import { supabase } from '../lib/supabase';

const ACTIVE_PHASES = new Set([
  'new_lead',
  'estimate_draft',
  'estimate_sent',
  'estimate_negotiating',
  'estimate_approved',
  'contract_sent',
  'contract_signed',
  'in_progress',
]);

// Slack-style channel slug from a client name.
function slugify(name) {
  return (name || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
}

export default function DailyLogsList({ user, onOpenJob }) {
  const [jobs, setJobs]       = useState([]);
  const [reads, setReads]     = useState({});
  const [latest, setLatest]   = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const userName = user?.name || '';

  useEffect(() => {
    if (!userName) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data: js } = await supabase
          .from('jobs')
          .select('id, client_name, pipeline_status, address, city, chat_members')
          .contains('chat_members', [userName])
          .order('client_name', { ascending: true })
          .limit(500);
        const filtered = (js || []).filter((j) =>
          ACTIVE_PHASES.has(j.pipeline_status || 'new_lead')
        );
        if (active) setJobs(filtered);

        const ids = filtered.map((j) => j.id);
        if (ids.length === 0) {
          if (active) { setReads({}); setLatest({}); }
          return;
        }

        const { data: rs } = await supabase
          .from('chat_reads')
          .select('job_id, last_read_at')
          .eq('user_name', userName)
          .in('job_id', ids);
        const readMap = {};
        for (const r of (rs || [])) readMap[r.job_id] = r.last_read_at;
        if (active) setReads(readMap);

        const { data: ms } = await supabase
          .from('chat_messages')
          .select('id, job_id, body, mentions, created_at, author_name')
          .in('job_id', ids)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(2000);
        const latestMap = {};
        for (const m of (ms || [])) {
          if (!latestMap[m.job_id]) latestMap[m.job_id] = m;
        }
        if (active) setLatest(latestMap);
      } catch {
        /* keep empty state */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [userName]);

  // Realtime — refresh latest map on every chat_messages INSERT.
  useEffect(() => {
    if (jobs.length === 0) return;
    const ids = new Set(jobs.map((j) => j.id));
    const channel = supabase
      .channel(`daily-logs-list:${userName}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new;
          if (!m || !ids.has(m.job_id)) return;
          setLatest((prev) => ({ ...prev, [m.job_id]: m }));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [jobs, userName]);

  const decorated = useMemo(() => {
    return jobs.map((j) => {
      const last = latest[j.id];
      const lastReadIso = reads[j.id];
      const isUnread = last && (!lastReadIso || new Date(last.created_at) > new Date(lastReadIso));
      const isMentioned = isUnread && Array.isArray(last.mentions) && last.mentions.includes(userName);
      return { ...j, last, isUnread: !!isUnread, isMentioned: !!isMentioned, slug: slugify(j.client_name) };
    });
  }, [jobs, latest, reads, userName]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let out = decorated;
    if (needle) {
      out = out.filter((j) =>
        (j.client_name || '').toLowerCase().includes(needle) ||
        (j.slug || '').toLowerCase().includes(needle)
      );
    }
    if (unreadOnly) out = out.filter((j) => j.isUnread);
    if (unreadOnly) {
      out = [...out].sort((a, b) => {
        const ta = a.last ? new Date(a.last.created_at).getTime() : 0;
        const tb = b.last ? new Date(b.last.created_at).getTime() : 0;
        return tb - ta;
      });
    } else {
      out = [...out].sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''));
    }
    return out;
  }, [decorated, search, unreadOnly]);

  return (
    <div className="px-2 pb-2 space-y-0.5 max-h-[55vh] overflow-y-auto">
      <div className="flex items-center gap-1 sticky top-0 bg-omega-charcoal pt-1 pb-1.5 z-10">
        <div className="relative flex-1">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="w-full pl-6 pr-2 py-1 text-[11px] rounded bg-white/5 text-white placeholder-white/30 border border-white/10 focus:border-omega-orange focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setUnreadOnly((u) => !u)}
          title={unreadOnly ? 'Showing unread only' : 'Show unread only'}
          className={`p-1 rounded transition-colors ${
            unreadOnly
              ? 'bg-omega-orange text-white'
              : 'bg-white/5 text-white/60 hover:bg-white/10'
          }`}
        >
          <BellRing className="w-3 h-3" />
        </button>
      </div>

      {loading && (
        <p className="text-[10px] text-white/40 italic px-2 py-1">Loading…</p>
      )}

      {!loading && visible.length === 0 && (
        <p className="text-[10px] text-white/40 italic px-2 py-1">
          {unreadOnly ? 'No unread.' : 'No projects yet.'}
        </p>
      )}

      {!loading && visible.map((j) => (
        <button
          key={j.id}
          type="button"
          onClick={() => onOpenJob?.(j)}
          className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded text-[11px] transition-colors ${
            j.isUnread
              ? 'text-white font-bold hover:bg-white/10'
              : 'text-white/70 hover:bg-white/5'
          }`}
          title={j.client_name}
        >
          <span className="text-white/40 flex-shrink-0">#</span>
          <span className="flex-1 truncate">{j.slug}</span>
          {j.isMentioned && (
            <span className="text-[9px] font-bold text-white bg-omega-orange px-1.5 py-0.5 rounded-full">
              @
            </span>
          )}
          {j.isUnread && !j.isMentioned && (
            <span className="w-1.5 h-1.5 rounded-full bg-omega-orange flex-shrink-0" />
          )}
        </button>
      ))}
    </div>
  );
}
