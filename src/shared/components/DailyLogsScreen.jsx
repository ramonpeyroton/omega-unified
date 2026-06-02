// DailyLogsScreen — full-screen Slack-style chat surface.
//
// Two columns:
//   Left  → quick filters (All / Mentions / Unread / Starred / Files)
//           on top, then a search box, then the list of jobs the user
//           is a chat_members of, ordered by most-recent activity.
//           Each row shows a # slug, optional star, and a small badge
//           when the user has been @mentioned in unread messages.
//   Right → the NativeProjectChat for the selected job (default
//           = first row in the list). When the "Files" filter is
//           active the right column flips to a grid of every file
//           shared across all chats the user can see.
//
// Replaces the old DailyLogsList cascade in each app's sidebar.
//
// Realtime: subscribes to chat_messages INSERT so the list re-sorts
// and a new "unread" badge appears the moment a teammate posts —
// no polling.

import { useEffect, useMemo, useState } from 'react';
import {
  Search, Star, Hash, Bell, FolderOpen, AtSign, MessageSquare,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import NativeProjectChat from './NativeProjectChat';

// Phases that count as "active" for the chat list. Closed/lost jobs
// are out so the list doesn't fill up with dead conversations.
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

// "BrendaDasilva - 855 MainSt" — CamelCase client name, then the
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

export default function DailyLogsScreen({ user, onOpenJob, onBack }) {
  const [jobs, setJobs]         = useState([]);
  const [reads, setReads]       = useState({}); // { jobId: { last_read_at, is_starred } }
  const [latest, setLatest]     = useState({}); // { jobId: latestMessageRow }
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');
  const [selectedJobId, setSelectedJobId] = useState(null);

  const userName = user?.name || '';

  // ─── LOAD ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userName) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data: js } = await supabase
          .from('jobs')
          .select('id, client_name, address, service, pipeline_status, last_chat_message_at, chat_members')
          .contains('chat_members', [userName])
          .order('client_name', { ascending: true })
          .limit(500);
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

        const { data: rs } = await supabase
          .from('chat_reads')
          .select('job_id, last_read_at, is_starred')
          .eq('user_name', userName)
          .in('job_id', ids);
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
      } catch { /* swallow — empty state is fine */ }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [userName]);

  // ─── REALTIME ────────────────────────────────────────────────────
  useEffect(() => {
    if (jobs.length === 0) return;
    const ids = new Set(jobs.map((j) => j.id));
    const channel = supabase
      .channel(`daily-logs-screen:${userName}`)
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

    // Sort: starred first, then by latest activity DESC.
    return [...out].sort((a, b) => {
      if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
      const ta = a.last ? new Date(a.last.created_at).getTime() : 0;
      const tb = b.last ? new Date(b.last.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [decorated, search, filter]);

  // Auto-select first row on first load / when current selection
  // disappears from the filtered list.
  useEffect(() => {
    if (visible.length === 0) return;
    if (!selectedJobId || !visible.find((j) => j.id === selectedJobId)) {
      setSelectedJobId(visible[0].id);
    }
  }, [visible, selectedJobId]);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) || null,
    [jobs, selectedJobId],
  );

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
      // Rollback on failure.
      setReads((prev) => ({
        ...prev,
        [jobId]: { ...(prev[jobId] || {}), is_starred: current },
      }));
    }
  }

  // ─── RENDER ──────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-full bg-omega-charcoal overflow-hidden">
      {/* ═══ LEFT COLUMN ═══════════════════════════════════════ */}
      <aside className="w-72 flex-shrink-0 flex flex-col border-r border-white/10">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/10 flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1.5 -ml-1 rounded text-white/60 hover:text-white hover:bg-white/10"
              title="Back"
            >
              <ExternalLink className="w-4 h-4 rotate-180" />
            </button>
          )}
          <h1 className="text-white font-bold text-base flex-1">Daily Logs</h1>
        </div>

        {/* Filter buttons (the grey-circle area in Ramon's screenshot) */}
        <nav className="px-2 pt-2 pb-2 space-y-0.5 border-b border-white/10">
          {FILTER_ITEMS.map((f) => {
            const Icon = f.icon;
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-colors ${
                  active
                    ? 'bg-white/15 text-white font-semibold'
                    : 'text-white/70 hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left">{f.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Search */}
        <div className="px-3 py-2 border-b border-white/10">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter chats…"
              className="w-full pl-7 pr-2 py-1.5 text-[12px] rounded bg-white/5 text-white placeholder-white/30 border border-white/10 focus:border-omega-orange focus:outline-none"
            />
          </div>
        </div>

        {/* List of chats (red-circle area in Ramon's screenshot) */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {loading ? (
            <p className="text-[12px] text-white/40 italic px-2 py-2">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-[12px] text-white/40 italic px-2 py-2">
              {filter === 'all' ? 'No chats yet.' : 'No chats match this filter.'}
            </p>
          ) : (
            visible.map((j) => {
              const isSelected = j.id === selectedJobId;
              return (
                <div
                  key={j.id}
                  onClick={() => setSelectedJobId(j.id)}
                  className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-[13px] mb-0.5 ${
                    isSelected
                      ? 'bg-white/15 text-white'
                      : 'text-white/80 hover:bg-white/5'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleStar(j.id); }}
                    className={`flex-shrink-0 transition-opacity ${
                      j.isStarred
                        ? 'text-yellow-400 opacity-100'
                        : 'text-white/30 opacity-0 group-hover:opacity-100'
                    }`}
                    title={j.isStarred ? 'Remove from starred' : 'Add to starred'}
                  >
                    <Star className="w-3 h-3" fill={j.isStarred ? 'currentColor' : 'none'} />
                  </button>
                  <Hash className={`w-3 h-3 flex-shrink-0 ${j.isUnread ? 'text-white' : 'text-white/40'}`} />
                  <span className={`flex-1 min-w-0 truncate ${j.isUnread ? 'font-bold' : ''}`}>
                    {j.label}
                  </span>
                  {/* Mention badge (green-circle in Ramon's screenshot) */}
                  {j.isMentioned && (
                    <span
                      className="flex-shrink-0 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold bg-omega-orange text-white rounded-full"
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

      {/* ═══ RIGHT COLUMN ═══════════════════════════════════════ */}
      <main className="flex-1 min-w-0 bg-omega-cloud flex flex-col">
        {filter === 'files' ? (
          <FilesView userName={userName} jobs={jobs} />
        ) : selectedJob ? (
          <ChatPane
            job={selectedJob}
            user={user}
            onOpenJob={onOpenJob}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-omega-stone">
            <p className="text-sm">Select a chat from the left.</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Right pane: the actual chat for the selected job ─────────────
function ChatPane({ job, user, onOpenJob }) {
  return (
    <>
      {/* Sub-header — # name, job address, and the "Open job card"
          shortcut. Equivalent to Slack's channel header. */}
      <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-omega-charcoal truncate inline-flex items-center gap-1">
            <Hash className="w-4 h-4 text-omega-stone" />
            {job.client_name}
          </p>
          {job.address && (
            <p className="text-[11px] text-omega-stone truncate">{job.address}</p>
          )}
        </div>
        {onOpenJob && (
          <button
            onClick={() => onOpenJob(job)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:border-omega-orange text-omega-charcoal text-xs font-semibold transition-colors"
            title="Open the full job card"
          >
            Open job <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* The chat component itself — same one that lives inside the
          JobFullView Daily Logs tab, so the conversation appears in
          both surfaces at once. */}
      <div className="flex-1 overflow-hidden">
        <NativeProjectChat job={job} user={user} />
      </div>
    </>
  );
}

// ─── Right pane: Files filter ─────────────────────────────────────
// Lists every attachment ever shared across the user's chats, newest
// first. Image attachments render as thumbnails; everything else as
// a generic file card. Clicking opens the file in a new tab.
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
