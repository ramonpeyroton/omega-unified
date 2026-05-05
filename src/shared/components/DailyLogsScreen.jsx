import { useEffect, useMemo, useState } from 'react';
import {
  MessageCircle, Search, BellRing, Clock, MapPin, Image as ImageIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Avatar, { colorFromName } from './ui/Avatar';

// DailyLogsScreen — full-page version of the Daily Logs surface.
// Replaces the squeezed sidebar cascade so the section gets the
// real-estate Ramon wanted: a grid of project cards with last
// message + author + age, scannable at a glance.
//
// Same data model as the cascade was using: pulls jobs whose
// chat_members array contains user.name (active phases only),
// joins last messages from chat_messages, and decorates each row
// with isUnread / isMentioned. Realtime subscription keeps the
// counters fresh without polling.

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

const PIPELINE_LABEL = {
  new_lead:             'New Lead',
  estimate_draft:       'Estimate Draft',
  estimate_sent:        'Estimate Sent',
  estimate_negotiating: 'Negotiating',
  estimate_approved:    'Approved',
  contract_sent:        'Contract Sent',
  contract_signed:      'Contract Signed',
  in_progress:          'In Progress',
};

const PIPELINE_TINT = {
  new_lead:             'bg-gray-100 text-gray-700',
  estimate_draft:       'bg-slate-100 text-slate-700',
  estimate_sent:        'bg-blue-100 text-blue-700',
  estimate_negotiating: 'bg-violet-100 text-violet-700',
  estimate_approved:    'bg-emerald-100 text-emerald-700',
  contract_sent:        'bg-amber-100 text-amber-800',
  contract_signed:      'bg-emerald-200 text-emerald-900',
  in_progress:          'bg-emerald-300 text-emerald-900',
};

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function DailyLogsScreen({ user, onOpenJob }) {
  const [jobs, setJobs]   = useState([]);
  const [reads, setReads] = useState({});       // {job_id: last_read_at}
  const [latest, setLatest] = useState({});     // {job_id: message}
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const userName = user?.name || '';

  useEffect(() => {
    if (!userName) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        // 1. Jobs the user has access to.
        const { data: js } = await supabase
          .from('jobs')
          .select('id, client_name, pipeline_status, address, city, chat_members, cover_photo_url')
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

        // 2. Read pointers for the user.
        const { data: rs } = await supabase
          .from('chat_reads')
          .select('job_id, last_read_at')
          .eq('user_name', userName)
          .in('job_id', ids);
        const readMap = {};
        for (const r of (rs || [])) readMap[r.job_id] = r.last_read_at;
        if (active) setReads(readMap);

        // 3. Latest message per job — same trick as the cascade had:
        // single query bounded by message count, reduce locally.
        const { data: ms } = await supabase
          .from('chat_messages')
          .select('id, job_id, body, mentions, attachments, created_at, author_name')
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

  // Realtime — re-resolve latest per job on every INSERT.
  useEffect(() => {
    if (jobs.length === 0) return;
    const ids = new Set(jobs.map((j) => j.id));
    const channel = supabase
      .channel(`daily-logs-screen:${userName}`)
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
      return { ...j, last, isUnread: !!isUnread, isMentioned: !!isMentioned };
    });
  }, [jobs, latest, reads, userName]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let out = decorated;
    if (needle) {
      out = out.filter((j) =>
        (j.client_name || '').toLowerCase().includes(needle) ||
        (j.address || '').toLowerCase().includes(needle)
      );
    }
    if (unreadOnly) {
      out = out.filter((j) => j.isUnread);
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

  const totalUnread   = decorated.filter((d) => d.isUnread).length;
  const totalMentions = decorated.filter((d) => d.isMentioned).length;

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <header className="bg-white border-b border-gray-200 px-6 md:px-8 py-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal inline-flex items-center gap-2">
              <MessageCircle className="w-6 h-6 text-omega-orange" /> Daily Logs
            </h1>
            <p className="text-sm text-omega-stone mt-1">
              All active project chats you can see.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-3 py-1.5 rounded-lg bg-omega-pale border border-omega-orange/30 text-omega-orange font-bold inline-flex items-center gap-1.5">
              <BellRing className="w-3.5 h-3.5" /> {totalUnread} unread
            </span>
            {totalMentions > 0 && (
              <span className="px-3 py-1.5 rounded-lg bg-omega-orange text-white font-bold">
                @ {totalMentions}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="bg-white border-b border-gray-200 px-6 md:px-8 py-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client or address…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-omega-cloud focus:bg-white focus:border-omega-orange focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setUnreadOnly((u) => !u)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
            unreadOnly
              ? 'bg-omega-orange text-white border border-omega-orange'
              : 'bg-white text-omega-charcoal border border-gray-200 hover:border-omega-orange'
          }`}
        >
          <BellRing className="w-3.5 h-3.5" /> {unreadOnly ? 'Showing unread' : 'Show unread'}
        </button>
        <span className="ml-auto text-xs text-omega-stone">
          {visible.length} project{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      <main className="p-4 md:p-8">
        {loading && <p className="text-sm text-omega-stone py-12 text-center">Loading…</p>}

        {!loading && visible.length === 0 && (
          <div className="text-center py-16">
            <MessageCircle className="w-10 h-10 mx-auto text-omega-stone opacity-40 mb-3" />
            <p className="text-sm text-omega-stone">
              {unreadOnly
                ? "All caught up — no unread messages."
                : "No project chats yet. As Brenda adds you to projects, they'll show up here."}
            </p>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((j) => (
              <ProjectCard key={j.id} project={j} onClick={() => onOpenJob?.(j)} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard({ project, onClick }) {
  const last = project.last;
  const tint = PIPELINE_TINT[project.pipeline_status] || PIPELINE_TINT.new_lead;
  const label = PIPELINE_LABEL[project.pipeline_status] || project.pipeline_status;

  // Body preview — strip @mention markers down for the snippet.
  const preview = last?.body
    ? last.body.replace(/\s+/g, ' ').slice(0, 120)
    : (Array.isArray(last?.attachments) && last.attachments.length > 0
      ? `${last.attachments.length} attachment${last.attachments.length === 1 ? '' : 's'}`
      : '');

  return (
    <button
      onClick={onClick}
      className={`bg-white rounded-2xl border ${
        project.isUnread ? 'border-omega-orange/50 ring-1 ring-omega-orange/30' : 'border-gray-100'
      } shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all p-4 text-left group relative overflow-hidden`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className={`text-base ${
            project.isUnread ? 'font-black text-omega-charcoal' : 'font-bold text-omega-charcoal'
          } truncate`}>
            {project.client_name || 'Untitled'}
          </h3>
          {(project.address || project.city) && (
            <p className="text-[11px] text-omega-stone truncate inline-flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" />
              {[project.address, project.city].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
        {project.isMentioned && (
          <span className="text-[10px] font-bold text-white bg-omega-orange px-2 py-0.5 rounded-full flex-shrink-0">
            @ you
          </span>
        )}
        {project.isUnread && !project.isMentioned && (
          <span className="w-2.5 h-2.5 rounded-full bg-omega-orange flex-shrink-0 mt-1.5" />
        )}
      </div>

      <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${tint} mb-3`}>
        {label}
      </span>

      {last ? (
        <div className="flex items-start gap-2 pt-2 border-t border-gray-100">
          <Avatar
            name={last.author_name || 'Unknown'}
            size={28}
            color={colorFromName(last.author_name || 'Unknown')}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-omega-charcoal truncate">
              {last.author_name || 'Unknown'}
            </p>
            {preview && (
              <p className={`text-xs ${project.isUnread ? 'text-omega-charcoal' : 'text-omega-stone'} line-clamp-2`}>
                {preview}
              </p>
            )}
            {Array.isArray(last.attachments) && last.attachments.length > 0 && (
              <p className="inline-flex items-center gap-1 text-[10px] text-omega-stone mt-0.5">
                <ImageIcon className="w-3 h-3" /> {last.attachments.length} attachment{last.attachments.length === 1 ? '' : 's'}
              </p>
            )}
            <p className="text-[10px] text-omega-stone mt-0.5 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {timeAgo(last.created_at)}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-omega-stone italic pt-2 border-t border-gray-100">
          No messages yet.
        </p>
      )}
    </button>
  );
}
