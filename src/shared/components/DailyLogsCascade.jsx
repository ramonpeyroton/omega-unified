// DailyLogsCascade — collapsible Daily Logs section that drops into
// every app's sidebar. Lists the projects whose chat_members contains
// the logged-in user — the per-job ACL set in migration 043. Click a
// project → opens its JobFullView with the Daily Logs tab selected.
//
// Behavior:
//   • Bold + dot when there are unread messages for the current user.
//   • Numeric badge when the user is mentioned in any unread message.
//   • Default sort = alphabetical by client name.
//   • "Unread only" toggle reorders + hides the all-read entries.
//   • Realtime: subscribes to chat_messages INSERTs across the user's
//     visible projects so counters update without polling.

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, MessageCircle, Search, BellRing,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// Pipeline phases that count as "active" for the cascade. Cold,
// rejected, and completed projects are hidden so the list stays
// focused on what's in motion. Receptionist creates leads in
// 'new_lead' so we keep that visible too.
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

export default function DailyLogsCascade({ user, onOpenJob }) {
  // Defaulted to open per Ramon: he drew the blue rectangle around
  // this area expecting the list to be visible without an extra click.
  const [open, setOpen]         = useState(true);
  const [jobs, setJobs]         = useState([]);     // [{id, client_name, pipeline_status, ...}]
  const [reads, setReads]       = useState({});     // {job_id: last_read_at}
  const [latest, setLatest]     = useState({});     // {job_id: {created_at, mentions, body}}
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(false);

  const userName = user?.name || '';

  // ─── Initial load — runs when the section is first expanded so a
  // collapsed sidebar doesn't fire a query for every page render.
  useEffect(() => {
    if (!open || !userName) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        // 1. Jobs the user has access to.
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

        // 2. User's read pointers.
        const { data: rs } = await supabase
          .from('chat_reads')
          .select('job_id, last_read_at')
          .eq('user_name', userName)
          .in('job_id', ids);
        const readMap = {};
        for (const r of (rs || [])) readMap[r.job_id] = r.last_read_at;
        if (active) setReads(readMap);

        // 3. Latest message per job. We pull the most recent N
        // messages per job_id by using a window-style query — but
        // PostgREST doesn't support that, so we just grab the last
        // 1000 messages across all visible jobs and reduce locally.
        // Cheap enough at the user-visible sizes we care about.
        const { data: ms } = await supabase
          .from('chat_messages')
          .select('id, job_id, body, mentions, created_at, author_name')
          .in('job_id', ids)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1000);
        const latestMap = {};
        for (const m of (ms || [])) {
          if (!latestMap[m.job_id]) latestMap[m.job_id] = m;
        }
        if (active) setLatest(latestMap);
      } catch {
        /* fall through — empty state */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [open, userName]);

  // ─── Realtime — subscribe to INSERTs on chat_messages for the
  // user's visible jobs. We re-resolve the latest map on every event.
  useEffect(() => {
    if (!open || jobs.length === 0) return;
    const ids = jobs.map((j) => j.id);
    const channel = supabase
      .channel(`cascade:${userName}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new;
          if (!m || !ids.includes(m.job_id)) return;
          setLatest((prev) => ({ ...prev, [m.job_id]: m }));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, jobs, userName]);

  // Compute unread + mention state per job. Note: `latestMap` only
  // gives us the most recent message; for a precise mention count we
  // would need a count of mentions WHERE created_at > last_read_at.
  // To keep it simple, we set mention=1 if the latest message
  // mentions us AND it's unread. Good enough for the badge — Ramon
  // wanted "you were tagged" awareness, not a precise count.
  const decorated = useMemo(() => {
    const arr = jobs.map((j) => {
      const last = latest[j.id];
      const lastReadIso = reads[j.id];
      const isUnread = last && (!lastReadIso || new Date(last.created_at) > new Date(lastReadIso));
      const isMentioned = isUnread && Array.isArray(last.mentions) && last.mentions.includes(userName);
      return {
        ...j,
        last,
        isUnread: !!isUnread,
        isMentioned: !!isMentioned,
      };
    });
    return arr;
  }, [jobs, latest, reads, userName]);

  // Search + sort + filter
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let out = decorated;
    if (needle) {
      out = out.filter((j) => (j.client_name || '').toLowerCase().includes(needle));
    }
    if (unreadOnly) {
      out = out.filter((j) => j.isUnread);
      // Unread mode sorts by latest message time (most recent first),
      // which mirrors how Slack reorders busy channels.
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

  const totalUnread = decorated.filter((d) => d.isUnread).length;

  return (
    <div className="border-t border-white/10">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-white/60" />
          : <ChevronRight className="w-3.5 h-3.5 text-white/60" />}
        <MessageCircle className="w-4 h-4 text-white/80" />
        <span className="text-[11px] uppercase tracking-wider font-bold text-white/80 flex-1">
          Daily Logs
        </span>
        {totalUnread > 0 && (
          <span className="text-[9px] font-bold text-white bg-omega-orange px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
            {totalUnread}
          </span>
        )}
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-1 max-h-[40vh] overflow-y-auto">
          {/* Search + filter */}
          <div className="flex items-center gap-1 mb-1.5 sticky top-0 bg-omega-charcoal pt-1 pb-1.5 z-10">
            <div className="relative flex-1">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full pl-6 pr-2 py-1 text-[11px] rounded bg-white/5 text-white placeholder-white/30 border border-white/10 focus:border-omega-orange focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setUnreadOnly((u) => !u)}
              title={unreadOnly ? 'Showing unread only' : 'Showing all'}
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
              {unreadOnly ? 'No unread.' : 'No projects.'}
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
            >
              <span className="text-white/40">#</span>
              <span className="flex-1 truncate">{j.client_name || 'Untitled'}</span>
              {j.isMentioned && (
                <span className="text-[9px] font-bold text-white bg-omega-orange px-1.5 py-0.5 rounded-full">
                  @
                </span>
              )}
              {j.isUnread && !j.isMentioned && (
                <span className="w-1.5 h-1.5 rounded-full bg-omega-orange" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
