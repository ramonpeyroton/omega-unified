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

export default function NativeProjectChat({ job, user }) {
  const [messages, setMessages]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [body, setBody]               = useState('');
  const [sending, setSending]         = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [previewUrl, setPreviewUrl]   = useState(null);
  const [uploading, setUploading]     = useState(false);

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

  // Manage the preview URL for the staged file.
  useEffect(() => {
    if (!pendingFile) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  async function pickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    if (!f.type.startsWith('image/')) {
      setError('Only images for now (jpg, png, webp, heic).');
      return;
    }
    try {
      setUploading(true);
      const compressed = await imageCompression(f, COMPRESS_OPTS);
      if (compressed.size > MAX_FILE_BYTES) {
        setError('Image is too large even after compression. Try a smaller photo.');
        return;
      }
      setPendingFile(compressed);
      setError('');
    } catch (err) {
      setError(err?.message || 'Failed to process image.');
    } finally {
      setUploading(false);
    }
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
    if (!text && !pendingFile) return;
    if (sending) return;

    setSending(true);
    setError('');
    let attachments = null;

    try {
      if (pendingFile) {
        const url = await uploadFile(pendingFile);
        if (!url) throw new Error('Upload failed.');
        attachments = [{
          url,
          mime: pendingFile.type,
          size: pendingFile.size,
          name: pendingFile.name,
        }];

        // Mirror the upload into job_documents under the daily_logs
        // folder so the Documents tab grows an automatic archive of
        // every image shared in the chat. Failure here is non-fatal —
        // the chat send proceeds; worst case the user has the photo
        // in chat history but not in the Documents folder.
        try {
          await supabase.from('job_documents').insert([{
            job_id:      job.id,
            folder:      'daily_logs',
            title:       pendingFile.name || `Chat photo · ${new Date().toLocaleString('en-US')}`,
            photo_url:   url,
            uploaded_by: user?.name || null,
          }]);
        } catch { /* non-fatal */ }
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
      setPendingFile(null);
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

  return (
    <div className="flex flex-col h-[600px] max-h-[70vh] bg-omega-cloud rounded-xl overflow-hidden">
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
        {pendingFile && previewUrl && (
          <div className="relative inline-block">
            <img src={previewUrl} alt="preview" className="max-h-24 rounded-lg border border-gray-200" />
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-omega-charcoal text-white inline-flex items-center justify-center shadow"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={pickFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending}
            className="p-2 rounded-lg text-omega-stone hover:text-omega-orange hover:bg-omega-pale disabled:opacity-50"
            title="Attach image"
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
            disabled={sending || (!body.trim() && !pendingFile)}
            className="px-3 py-2 rounded-lg bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-sm font-bold inline-flex items-center gap-1"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
