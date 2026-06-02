// DailyLogsRichTab — Slack-style chat surface that replaces the plain
// NativeProjectChat inside the JobFullView Daily Logs tab. The left
// rail keeps the channel list always visible so the user can hop
// between projects without going back to the sidebar cascade.
//
// Layout:
//   ┌──────────────┬─────────────────────────────────┐
//   │ filters      │ NativeProjectChat for `job`     │
//   │ search       │                                 │
//   │ chat list    │                                 │
//   └──────────────┴─────────────────────────────────┘
//
// Clicking another chat in the left list calls onSwitchJob(newJob),
// which the host (each app's App.jsx) wires to setFullViewJob. The
// outer JobFullView re-renders with the new job — tabs stay open, the
// header swaps to the new client, and this tab keeps showing chat.
//
// Filters: All / Mentions / Unread / Starred / Files.
// Star toggle hits chat_reads.is_starred (migration 067).

import { useEffect, useMemo, useState } from 'react';
import {
  Search, Star, Hash, Bell, FolderOpen, AtSign, MessageSquare,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import NativeProjectChat from './NativeProjectChat';

// Phases that count as "active" for the chat list. Closed / lost jobs
// stay hidden so the list doesn't fill up with dead conversations.
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

// "BrendaDasilva - 855 MainSt" — CamelCase the client name, then the
// first comma segment of the address (street line only).
function fmtChatLabel(client, address) {
  const camel = (s) => (s || '')
    .replace(/[^\w\s]+/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');
  const clientPart = camel(client) || 'Untitled';
  const street = (address || '').split(',')[0].trim();
  if (!street) return clientPart;
  const tokens = street.split(/\s+/);
  const first = tokens[0];
  const restCC = tokens.slice(1)
    .map((t) => (t[0] ? t[0].toUpperCase() + t.slice(1).toLowerCase() : ''))
    .join('');
  return restCC ? `${clientPart} - ${first} ${restCC}` : `${clientPart} - ${first}`;
}

const FILTER_ITEMS = [
  { id: 'all',      label: 'All chats',   icon: MessageSquare },
  { id: 'mentions', label: 'Mentions',    icon: AtSign },
  { id: 'unread',   label: 'Unread',      icon: Bell },
  { id: 'starred',  label: 'Starred',     icon: Star },
  { id: 'files',    label: 'Files',       icon: FolderOpen },
];

export default function DailyLogsRichTab({ job, user, onSwitchJob }) {
  const [jobs, setJobs]       = useState([]);
  const [reads, setReads]     = useState({}); // { jobId: { last_read_at, is_starred } }
  const [latest, setLatest]   = useState({}); // { jobId: latestMessageRow }
  const [filter, setFilter]   = useState('all');
  const [search, setSearch]   = useState('');

  const userName = user?.name || '';

  // ─── LOAD ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userName) return;
    let active = true;
    (async () => {
      try {
        // The job list itself. Stays lean — only columns we render,
        // none of the new ones from migrations 066/067 to avoid the
        // entire query exploding if those haven't been run yet.
        const { data: js, error: jobsErr } = await supabase
          .from('jobs')
          .select('id, client_name, address, service, pipeline_status, chat_members')
          .contains('chat_members', [userName])
          .order('client_name', { ascending: true })
          .limit(500);
        if (jobsErr) console.warn('[DailyLogsRichTab] jobs query failed:', jobsErr);
        const filtered = (js || []).filter((j) =>
          ACTIVE_PHASES.has(j.pipeline_status || 'new_lead')
        );
        if (!active) return;
        setJobs(filtered);

        const ids = filtered.map((j) => j.id);
        if (ids.length === 0) {
          setReads({}); setLatest({});
          return;
        }

        // Try with is_starred first (migration 067). If the column
        // doesn't exist yet we retry without it so starring is just
        // a no-op rather than breaking the whole panel.
        let rs = null;
        try {
          const r = await supabase
            .from('chat_reads')
            .select('job_id, last_read_at, is_starred')
            .eq('user_name', userName)
            .in('job_id', ids);
          if (r.error) throw r.error;
          rs = r.data;
        } catch {
          const r2 = await supabase
            .from('chat_reads')
            .select('job_id, last_read_at')
            .eq('user_name', userName)
            .in('job_id', ids);
          rs = r2.data;
        }
        const readsMap = {};
        for (const r of (rs || [])) readsMap[r.job_id] = r;
        if (active) setReads(readsMap);

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
      } catch (err) {
        console.warn('[DailyLogsRichTab] load failed:', err);
      }
    })();
    return () => { active = false; };
  }, [userName]);

  // ─── REALTIME ────────────────────────────────────────────────────
  useEffect(() => {
    if (jobs.length === 0) return;
    const ids = new Set(jobs.map((j) => j.id));
    const channel = supabase
      .channel(`daily-logs-rich:${userName}:${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const m = payload.new;
        if (!m || !ids.has(m.job_id)) return;
        setLatest((prev) => ({ ...prev, [m.job_id]: m }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [jobs, userName]);

  // ─── DECORATIONS ─────────────────────────────────────────────────
  const decorated = useMemo(() => {
    return jobs.map((j) => {
      const last = latest[j.id];
      const lastReadIso = reads[j.id]?.last_read_at;
      const isStarred = !!reads[j.id]?.is_starred;
      const isUnread = !!(last && (!lastReadIso || new Date(last.created_at) > new Date(lastReadIso)));
      const isMentioned = isUnread && Array.isArray(last?.mentions) && last.mentions.includes(userName);
      return {
        ...j,
        last,
        isUnread,
        isMentioned,
        isStarred,
        label: fmtChatLabel(j.client_name, j.address),
      };
    });
  }, [jobs, latest, reads, userName]);

  // ─── VISIBLE LIST ────────────────────────────────────────────────
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let out = decorated;

    if (needle) {
      out = out.filter((j) =>
        (j.client_name || '').toLowerCase().includes(needle) ||
        (j.label || '').toLowerCase().includes(needle) ||
        (j.address || '').toLowerCase().includes(needle)
      );
    }

    if (filter === 'mentions') out = out.filter((j) => j.isMentioned);
    if (filter === 'unread')   out = out.filter((j) => j.isUnread);
    if (filter === 'starred')  out = out.filter((j) => j.isStarred);
    // 'files' doesn't filter the list — the right column flips instead.

    return [...out].sort((a, b) => {
      // Always show the job currently open at the top so the user
      // doesn't lose it after a filter change.
      if (a.id === job?.id) return -1;
      if (b.id === job?.id) return 1;
      // Then starred, then most-recent activity.
      if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
      const ta = a.last ? new Date(a.last.created_at).getTime() : 0;
      const tb = b.last ? new Date(b.last.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [decorated, search, filter, job?.id]);

  // ─── ACTIONS ─────────────────────────────────────────────────────
  async function toggleStar(jobId) {
    const current = !!reads[jobId]?.is_starred;
    const next = !current;
    setReads((prev) => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || {}), is_starred: next },
    }));
    try {
      await supabase.from('chat_reads').upsert({
        job_id: jobId,
        user_name: userName,
        is_starred: next,
        last_read_at: reads[jobId]?.last_read_at || new Date().toISOString(),
      });
    } catch {
      setReads((prev) => ({
        ...prev,
        [jobId]: { ...(prev[jobId] || {}), is_starred: current },
      }));
    }
  }

  // ─── RENDER ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 rounded-xl border border-omega-orange/20 overflow-hidden bg-omega-pale">
      {/* ═══ LEFT RAIL ═══════════════════════════════════════════ */}
      <aside className="w-96 flex-shrink-0 flex flex-col border-r border-omega-orange/15">
        {/* Filters (grey-circle area in Ramon's screenshot) */}
        <nav className="px-2 pt-3 pb-2 space-y-0.5 border-b border-omega-orange/15">
          {FILTER_ITEMS.map((f) => {
            const Icon = f.icon;
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-colors ${
                  active
                    ? 'bg-omega-orange text-white font-semibold'
                    : 'text-omega-charcoal hover:bg-white'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left">{f.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Search */}
        <div className="px-3 py-2 border-b border-omega-orange/15">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter chats…"
              className="w-full pl-7 pr-2 py-1.5 text-[12px] rounded bg-white text-omega-charcoal placeholder-omega-stone border border-omega-orange/15 focus:border-omega-orange focus:outline-none"
            />
          </div>
        </div>

        {/* List of chats */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {visible.length === 0 ? (
            <p className="text-[12px] text-omega-stone italic px-2 py-2">
              {filter === 'all' ? 'No chats yet.' : 'No chats match this filter.'}
            </p>
          ) : (
            visible.map((j) => {
              const isSelected = j.id === job?.id;
              return (
                <div
                  key={j.id}
                  onClick={() => {
                    if (j.id !== job?.id && typeof onSwitchJob === 'function') {
                      supabase
                        .from('jobs').select('*').eq('id', j.id).maybeSingle()
                        .then(({ data }) => { if (data) onSwitchJob(data); });
                    }
                  }}
                  className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-[13px] mb-0.5 ${
                    isSelected
                      ? 'bg-omega-orange text-white'
                      : 'text-omega-charcoal hover:bg-white'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleStar(j.id); }}
                    className={`flex-shrink-0 transition-opacity ${
                      j.isStarred
                        ? 'text-yellow-500 opacity-100'
                        : `${isSelected ? 'text-white/60' : 'text-omega-stone'} opacity-0 group-hover:opacity-100`
                    }`}
                    title={j.isStarred ? 'Remove from starred' : 'Add to starred'}
                  >
                    <Star className="w-3 h-3" fill={j.isStarred ? 'currentColor' : 'none'} />
                  </button>
                  <Hash className={`w-3 h-3 flex-shrink-0 ${
                    isSelected ? 'text-white' : (j.isUnread ? 'text-omega-charcoal' : 'text-omega-stone')
                  }`} />
                  <span className={`flex-1 min-w-0 truncate ${j.isUnread && !isSelected ? 'font-bold' : ''}`}>
                    {j.label}
                  </span>
                  {j.isMentioned && (
                    <span
                      className={`flex-shrink-0 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold rounded-full ${
                        isSelected ? 'bg-white text-omega-orange' : 'bg-omega-orange text-white'
                      }`}
                      title="You were mentioned"
                    >
                      @
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ═══ RIGHT COLUMN — chat or files ═══════════════════════
          min-h-0 + overflow-hidden so the NativeProjectChat's own
          flex container can clamp its height and pin the composer
          to the bottom. Without these, the children grow past the
          parent and the input scrolls out of view. */}
      <main className="flex-1 min-w-0 min-h-0 bg-omega-cloud flex flex-col overflow-hidden">
        {filter === 'files' ? (
          <FilesView userName={userName} jobs={jobs} />
        ) : (
          <NativeProjectChat job={job} user={user} embedded />
        )}
      </main>
    </div>
  );
}

// ─── Right column when "Files" is active ──────────────────────────
function FilesView({ userName, jobs }) {
  const [files, setFiles]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const ids = jobs.map((j) => j.id);
        if (ids.length === 0) {
          if (active) setFiles([]);
          return;
        }
        const { data } = await supabase
          .from('chat_messages')
          .select('id, job_id, attachments, author_name, created_at, jobs(client_name)')
          .in('job_id', ids)
          .not('attachments', 'is', null)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(300);
        if (!active) return;
        const flat = [];
        for (const m of (data || [])) {
          for (const a of (m.attachments || [])) {
            if (!a?.url) continue;
            flat.push({
              key: `${m.id}-${a.url}`,
              url: a.url,
              mime: a.mime || '',
              name: a.name || '',
              size: a.size || 0,
              job_id: m.job_id,
              client_name: m.jobs?.client_name || '—',
              author_name: m.author_name || '—',
              created_at: m.created_at,
            });
          }
        }
        setFiles(flat);
      } catch { /* ignore */ }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [jobs, userName]);

  if (loading) return <p className="p-6 text-omega-stone text-sm">Loading files…</p>;
  if (files.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center text-omega-stone p-6">
      <FolderOpen className="w-10 h-10 mb-2 opacity-40" />
      <p className="text-sm">No files have been shared in any chat yet.</p>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="text-lg font-bold text-omega-charcoal mb-4">All shared files</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {files.map((f) => {
          const isImg = (f.mime || '').startsWith('image/');
          return (
            <a
              key={f.key}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-omega-orange hover:shadow-md transition-all"
            >
              {isImg ? (
                <img src={f.url} alt="" className="w-full h-32 object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-32 bg-gray-50 flex items-center justify-center">
                  <FolderOpen className="w-8 h-8 text-omega-stone" />
                </div>
              )}
              <div className="px-3 py-2">
                <p className="text-[12px] font-semibold text-omega-charcoal truncate">{f.client_name}</p>
                <p className="text-[10px] text-omega-stone truncate">
                  {f.author_name} · {new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
