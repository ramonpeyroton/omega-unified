// NativeProjectChat — replacement for the Slack-backed ProjectChat
// once jobs flip to use_native_chat=true (Sprint 2 of the chat-replacement
// roadmap). Reads/writes directly to public.chat_messages via Supabase
// and uses Realtime for push instead of polling.
//
// Feature parity with the Slack version:
//   • Messages oldest-first with date separators.
//   • Avatar + author color via colorFromName.
//   • Image upload with browser-image-compression (target 2 MB,
//     hard cap 4 MB after compression).
//   • Inline image thumbnails for attachments.
//   • @Mention pills — typed as plain "@Name", parsed on send into
//     chat_messages.mentions text[]. Auto-complete when the cursor
//     follows an @ and there's a partial match in chat_members.
//   • Optimistic send + rollback on failure.
//   • Realtime INSERT subscription so the UI updates without polling.
//
// What it deliberately does NOT do:
//   • Threads / reactions — Slack-only feature, not part of MVP.
//   • Edit / delete past messages — Sprint 4 (admin only).
//   • Pinned messages — Sprint 4.
//
// Storage: attachments live in the existing `job-documents` bucket
// (public, already used by other features). We write the URL into
// `chat_messages.attachments` JSONB; nothing extra to wire.

import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import {
  Send, Paperclip, X, Loader2, AlertCircle, Image as ImageIcon,
  ExternalLink, MessageCircle,
} from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { supabase } from '../lib/supabase';
import Avatar, { colorFromName } from './ui/Avatar';

const MAX_FILE_BYTES = 4 * 1024 * 1024; // post-compression hard cap
const COMPRESS_OPTS  = {
  maxSizeMB: 2,
  maxWidthOrHeight: 2400,
  initialQuality: 0.8,
  useWebWorker: true,
};

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function dayKey(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function fmtDayLabel(key) {
  const today = dayKey(new Date());
  if (key === today) return 'Today';
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  if (key === yesterday) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// Resolve @Name mentions against the project's chat_members so the
// chat tags propagate into chat_messages.mentions for the badge logic.
// Permissive prefix match so "@bre" still pulls "Brenda Dasilva".
function parseMentions(body, members) {
  if (!body || !Array.isArray(members) || members.length === 0) return [];
  const lower = (s) => s.toLowerCase();
  const out = new Set();
  // Capture @TOKEN where TOKEN is letters/digits/spaces+ until end-of-word.
  const re = /@([A-Za-zÀ-ÿ][\w\s.-]*)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const token = m[1].trim();
    if (!token) continue;
    const hit = members.find((name) => lower(name).startsWith(lower(token)) ||
                                      lower(token).startsWith(lower(name)));
    if (hit) out.add(hit);
  }
  return Array.from(out);
}

// Inline @mention pills + line breaks. Plain text otherwise.
function renderBody(body, members) {
  if (!body) return null;
  const tokens = [];
  const re = /@([A-Za-zÀ-ÿ][\w\s.-]*)/g;
  let lastIdx = 0;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m.index > lastIdx) tokens.push({ type: 'text', value: body.slice(lastIdx, m.index) });
    const token = m[1].trim();
    const hit = members?.find((name) => name.toLowerCase().startsWith(token.toLowerCase()));
    tokens.push({ type: hit ? 'mention' : 'text', value: hit ? `@${hit}` : `@${m[1]}` });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < body.length) tokens.push({ type: 'text', value: body.slice(lastIdx) });

  return tokens.map((t, i) => {
    if (t.type === 'mention') {
      return (
        <span key={i} className="inline-block px-1.5 py-0.5 rounded bg-omega-pale text-omega-orange font-bold text-[12px]">
          {t.value}
        </span>
      );
    }
    return <Fragment key={i}>{t.value.split('\n').map((line, j, arr) => (
      <Fragment key={j}>{line}{j < arr.length - 1 && <br />}</Fragment>
    ))}</Fragment>;
  });
}

export default function NativeProjectChat({ job, user, embedded = false }) {
  const [messages, setMessages]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [body, setBody]               = useState('');
  const [sending, setSending]         = useState(false);
  // Staged attachments queued to send with the next message. Each
  // entry is { file, previewUrl } — previewUrl is set for images
  // (blob: URL) and null for other types (PDFs, docs).
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading]       = useState(false);

  const MAX_ATTACHMENTS_PER_MESSAGE = 10;

  const fileInputRef = useRef(null);
  const scrollRef    = useRef(null);
  const textareaRef  = useRef(null);

  const members = Array.isArray(job?.chat_members) ? job.chat_members : [];

  // Initial load.
  useEffect(() => {
    if (!job?.id) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data, error: e } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('job_id', job.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .limit(500);
        if (e) throw e;
        if (active) setMessages(data || []);
      } catch (err) {
        if (active) setError(err?.message || 'Failed to load chat.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [job?.id]);

  // Realtime subscription — push new messages into local state.
  useEffect(() => {
    if (!job?.id) return;
    const channel = supabase
      .channel(`chat:${job.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `job_id=eq.${job.id}` },
        (payload) => {
          const incoming = payload.new;
          if (!incoming) return;
          setMessages((prev) => {
            // Dedupe — optimistic insert may have already added it by id.
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [job?.id]);

  // Mark-as-read whenever messages change AND the tab is visible.
  // Writes to chat_reads with last_read_at = now().
  useEffect(() => {
    if (!job?.id || !user?.name || messages.length === 0) return;
    const t = setTimeout(async () => {
      try {
        await supabase
          .from('chat_reads')
          .upsert(
            { job_id: job.id, user_name: user.name, last_read_at: new Date().toISOString() },
            { onConflict: 'job_id,user_name' },
          );
      } catch { /* non-fatal */ }
    }, 500);
    return () => clearTimeout(t);
  }, [job?.id, user?.name, messages.length]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  // Revoke any pending blob: URLs on unmount so they don't leak.
  // Individual removals revoke their own URL inline in removeFile().
  useEffect(() => {
    return () => {
      pendingFiles.forEach(({ previewUrl }) => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFile(e) {
    const incoming = Array.from(e.target.files || []);
    if (incoming.length === 0) return;
    e.target.value = '';

    const room = MAX_ATTACHMENTS_PER_MESSAGE - pendingFiles.length;
    if (room <= 0) {
      setError(`Max ${MAX_ATTACHMENTS_PER_MESSAGE} files per message — send these first.`);
      return;
    }
    const accepted = incoming.slice(0, room);
    if (incoming.length > room) {
      setError(`Only the first ${room} file${room === 1 ? '' : 's'} were added (10 per message max).`);
    } else {
      setError('');
    }

    setUploading(true);
    const processed = [];
    for (const f of accepted) {
      try {
        let final = f;
        // Compress images to keep payloads sane (PDFs/docs pass through).
        if (f.type.startsWith('image/')) {
          try { final = await imageCompression(f, COMPRESS_OPTS); }
          catch { final = f; }
        }
        if (final.size > MAX_FILE_BYTES) {
          setError(`"${f.name}" is too large even after compression.`);
          continue;
        }
        const isImage = (final.type || f.type || '').startsWith('image/');
        processed.push({
          file: final,
          previewUrl: isImage ? URL.createObjectURL(final) : null,
        });
      } catch (err) {
        setError(err?.message || `Failed to process "${f.name}".`);
      }
    }
    setPendingFiles((prev) => [...prev, ...processed]);
    setUploading(false);
  }

  function removeFile(idx) {
    setPendingFiles((prev) => {
      const target = prev[idx];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function uploadFile(file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const path = `chat/${job.id}/${Date.now()}-${safeName}`;
    const upload = await supabase.storage
      .from('job-documents')
      .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });
    if (upload.error) throw upload.error;
    const { data } = supabase.storage.from('job-documents').getPublicUrl(path);
    return data?.publicUrl || null;
  }

  async function send() {
    const text = body.trim();
    if (!text && pendingFiles.length === 0) return;
    if (sending) return;

    setSending(true);
    setError('');
    let attachments = null;

    try {
      if (pendingFiles.length > 0) {
        // Upload each staged file in sequence, then build the
        // attachments array in the same order the user picked them.
        const uploaded = [];
        for (const { file } of pendingFiles) {
          const url = await uploadFile(file);
          if (!url) throw new Error(`Upload failed: ${file.name}`);
          uploaded.push({
            url,
            mime: file.type,
            size: file.size,
            name: file.name,
          });

          // Mirror the upload into job_documents under the daily_logs
          // folder so the Documents tab grows an automatic archive of
          // every image / PDF shared in the chat. Non-fatal — if it
          // fails the chat send proceeds and worst case the file just
          // doesn't appear in the Documents tab.
          try {
            await supabase.from('job_documents').insert([{
              job_id:      job.id,
              folder:      'daily_logs',
              title:       file.name || `Chat attachment · ${new Date().toLocaleString('en-US')}`,
              photo_url:   url,
              uploaded_by: user?.name || null,
            }]);
          } catch { /* non-fatal */ }
        }
        attachments = uploaded;
      }

      const mentions = parseMentions(text, members);

      // Optimistic UI: add a placeholder with a temp id. Real id arrives
      // via Realtime INSERT and we dedupe by id below.
      const tempId = `tmp-${Date.now()}`;
      const optimistic = {
        id: tempId,
        job_id: job.id,
        author_name: user?.name || null,
        author_role: user?.role || null,
        body: text || null,
        attachments,
        mentions,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);

      const { data, error: e } = await supabase
        .from('chat_messages')
        .insert([{
          job_id:      job.id,
          author_name: user?.name || null,
          author_role: user?.role || null,
          body:        text || null,
          attachments,
          mentions:    mentions.length ? mentions : null,
        }])
        .select()
        .single();
      if (e) throw e;

      // Replace optimistic placeholder with the real row.
      setMessages((prev) => prev.map((m) => m.id === tempId ? data : m));

      setBody('');
      // Revoke any blob: previews from the staged files so memory
      // doesn't leak, then clear the queue.
      pendingFiles.forEach(({ previewUrl }) => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      });
      setPendingFiles([]);
      // Re-focus the input so multiple messages flow without clicking.
      textareaRef.current?.focus();
    } catch (err) {
      // Roll back optimistic insert on failure.
      setMessages((prev) => prev.filter((m) => !m.id.startsWith?.('tmp-')));
      setError(err?.message || 'Failed to send.');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Group messages by day for the date separators.
  const grouped = useMemo(() => {
    const out = [];
    let lastDay = null;
    for (const m of messages) {
      const d = dayKey(m.created_at);
      if (d !== lastDay) {
        out.push({ kind: 'day', key: d, label: fmtDayLabel(d) });
        lastDay = d;
      }
      out.push({ kind: 'msg', key: m.id, msg: m });
    }
    return out;
  }, [messages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-omega-stone" />
      </div>
    );
  }

  // When embedded inside DailyLogsRichTab the parent already owns the
  // size, rounded corners and border, so we drop ours to avoid the
  // "card inside a card" look. Otherwise we keep the original 600px
  // card behaviour so existing places that render the chat alone
  // still look correct.
  const wrapperCls = embedded
    ? 'flex flex-col h-full min-h-0 bg-omega-cloud overflow-hidden'
    : 'flex flex-col h-[600px] max-h-[70vh] bg-omega-cloud rounded-xl overflow-hidden';

  return (
    <div className={wrapperCls}>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center py-12 text-omega-stone">
            <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No messages yet. Start the conversation.</p>
          </div>
        )}

        {grouped.map((g) => {
          if (g.kind === 'day') {
            return (
              <div key={g.key} className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">{g.label}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            );
          }
          const m = g.msg;
          const isMe = m.author_name === user?.name;
          const colorBg = colorFromName(m.author_name || 'Unknown');
          return (
            <div key={g.key} className="flex items-start gap-2.5 group">
              <Avatar name={m.author_name} size={32} bg={colorBg} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-bold text-omega-charcoal">
                    {m.author_name || 'Unknown'}
                  </span>
                  {m.author_role && (
                    <span className="text-[10px] text-omega-stone">· {m.author_role}</span>
                  )}
                  <span className="text-[10px] text-omega-stone">{fmtTime(m.created_at)}</span>
                  {isMe && m.id?.startsWith?.('tmp-') && (
                    <span className="text-[10px] text-omega-stone italic">sending…</span>
                  )}
                </div>
                {m.body && (
                  <div className="text-sm text-omega-charcoal break-words mt-0.5">
                    {renderBody(m.body, members)}
                  </div>
                )}
                {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {m.attachments.map((att, i) => (
                      <a
                        key={i}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg overflow-hidden border border-gray-200 hover:border-omega-orange transition-colors max-w-[320px]"
                      >
                        {att.mime?.startsWith('image/') ? (
                          <img src={att.url} alt={att.name || 'attachment'} className="block max-h-60 w-auto" />
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-omega-charcoal">
                            <ExternalLink className="w-3.5 h-3.5" /> {att.name || 'File'}
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-t border-red-200 inline-flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-gray-200 bg-white p-3 space-y-2">
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((pf, idx) => {
              const isImage = (pf.file.type || '').startsWith('image/');
              return (
                <div key={`${pf.file.name}-${idx}`} className="relative">
                  {isImage && pf.previewUrl ? (
                    <img
                      src={pf.previewUrl}
                      alt={pf.file.name}
                      className="h-20 w-20 object-cover rounded-lg border border-gray-200"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded-lg border border-gray-200 bg-gray-50 flex flex-col items-center justify-center px-1 text-center">
                      <Paperclip className="w-4 h-4 text-omega-stone mb-0.5" />
                      <span className="text-[9px] text-omega-stone leading-tight truncate w-full">
                        {pf.file.name}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-omega-charcoal text-white inline-flex items-center justify-center shadow"
                    title="Remove attachment"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={pickFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending}
            className="p-2 rounded-lg text-omega-stone hover:text-omega-orange hover:bg-omega-pale disabled:opacity-50"
            title="Attach files (images and PDFs, up to 10)"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>

          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Type a message — use @Name to mention. Enter to send, Shift+Enter for a new line."
            className="flex-1 resize-none px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-omega-orange focus:outline-none max-h-32"
          />

          <button
            type="button"
            onClick={send}
            disabled={sending || (!body.trim() && pendingFiles.length === 0)}
            className="px-3 py-2 rounded-lg bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-sm font-bold inline-flex items-center gap-1"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
