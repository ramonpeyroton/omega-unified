// ProjectChat — read-only Slack chat surface that lives inside the
// "Daily Logs" tab of JobFullView. Renders messages from the Slack
// channel linked to the current job (jobs.slack_channel_id).
//
// Sprint 3 of the chat-per-project roadmap. Read-only on purpose:
// posting messages + uploading files come in Sprint 4 (the message
// input is intentionally absent here to keep the surface small while
// the rest of the loop bakes).
//
// What this component does:
//   * Polls /api/slack/get-messages every 30s while mounted.
//   * Shows a "Channel not connected" empty state with a small picker
//     when jobs.slack_channel_id is null. Saving the input writes back
//     to Supabase directly (anon key + permissive RLS — same pattern
//     the rest of the app uses for editable fields).
//   * Renders messages oldest-first in a chat timeline.
//   * Parses the credit line that send-message.js prepends
//     (`*Name (role)*\n…`) so bot posts show the human author instead
//     of "Omega Bot".
//   * Tiny Slack-mrkdwn pass: `*bold*`, `_italic_`, `~strike~`. Good
//     enough for what the team writes; not a full parser.
//
// What this component does NOT do (yet):
//   * No message input — Sprint 4.
//   * No file uploads — Sprint 4.
//   * No Slack user-id → real-name lookup. A direct (human-posted)
//     Slack message shows up as "U0123…". Bot posts that go through
//     send-message.js are fine because of the credit line.

import { useEffect, useMemo, useState, useRef, Fragment } from 'react';
import {
  Loader2, AlertCircle, MessageCircle, Link2, RefreshCw, Paperclip, Send,
  Image as ImageIcon, X, ExternalLink, UserPlus, UserMinus, Hash, Pin,
} from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { supabase } from '../lib/supabase';
import Avatar, { colorFromName } from './ui/Avatar';

// Backend wraps resolved Slack mentions / channel refs / keywords with
// these BMP Private Use chars so we can find them later. Built with
// String.fromCharCode so the source file stays printable in any editor.
const MENTION_OPEN  = String.fromCharCode(0xE000);
const MENTION_CLOSE = String.fromCharCode(0xE001);

const POLL_MS = 30_000;

// Slack channel/group IDs are uppercase letter + base32-ish suffix.
// We accept C (channel) and G (private group). DMs (D…) don't make
// sense for a per-project chat.
const CHANNEL_ID_RE = /^[CG][A-Z0-9]{8,}$/;

export default function ProjectChat({ job, user, onJobUpdated }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notSetUp, setNotSetUp] = useState(false);
  const [channelId, setChannelId] = useState(job?.slack_channel_id || null);

  // Channel-connector state (only used when notSetUp = true).
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Keep the latest values around so the polling effect doesn't
  // restart on every render but always reads the current job/channel.
  const jobIdRef = useRef(job?.id);
  jobIdRef.current = job?.id;

  async function fetchMessages({ silent = false } = {}) {
    if (!jobIdRef.current) return;
    if (!silent) setRefreshing(true);
    try {
      const r = await fetch('/api/slack/get-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobIdRef.current }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error || 'Could not load messages.');
        setLoading(false);
        return;
      }
      setError('');
      setNotSetUp(!!data.notSetUp);
      setChannelId(data.channelId || null);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setLoading(false);
    } catch (err) {
      setError(err?.message || 'Network error.');
      setLoading(false);
    } finally {
      if (!silent) setRefreshing(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    fetchMessages({ silent: true });
    const id = setInterval(() => fetchMessages({ silent: true }), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  async function handleConnectChannel(e) {
    e?.preventDefault?.();
    const v = inputValue.trim().toUpperCase();
    if (!CHANNEL_ID_RE.test(v)) {
      setInputError('Should look like C0123ABCDEF (capital C + 8+ chars).');
      return;
    }
    setInputError('');
    setConnecting(true);
    try {
      const { data: updated, error: dbErr } = await supabase
        .from('jobs')
        .update({ slack_channel_id: v })
        .eq('id', job.id)
        .select()
        .single();
      if (dbErr) throw dbErr;
      onJobUpdated?.(updated);
      setChannelId(v);
      setNotSetUp(false);
      // Pull fresh messages right away so the user sees the chat live.
      await fetchMessages({ silent: false });
    } catch (err) {
      setInputError(err?.message || 'Could not save the channel.');
    } finally {
      setConnecting(false);
    }
  }

  // ─── Empty state: channel not connected ────────────────────────
  if (!loading && (notSetUp || !channelId)) {
    return (
      <div className="flex flex-col items-center text-center py-10 px-4">
        <div className="w-14 h-14 rounded-2xl bg-omega-pale flex items-center justify-center mb-3">
          <Link2 className="w-7 h-7 text-omega-orange" />
        </div>
        <p className="text-base font-bold text-omega-charcoal">
          No Slack channel connected yet
        </p>
        <p className="text-sm text-omega-stone mt-1 max-w-sm">
          Paste the Slack channel ID for this project. In Slack, right-click
          the channel → <em>View channel details</em> → copy the ID at the
          bottom (looks like <code>C0123ABCDEF</code>).
        </p>
        <form onSubmit={handleConnectChannel} className="mt-5 w-full max-w-sm flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); setInputError(''); }}
            placeholder="C0123ABCDEF"
            className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm font-mono uppercase tracking-wide focus:border-omega-orange focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            disabled={connecting || !inputValue.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark disabled:opacity-50 transition"
          >
            {connecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Link2 className="w-4 h-4" />
            )}
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </form>
        {inputError && (
          <p className="text-xs text-red-600 mt-2">{inputError}</p>
        )}
        <p className="text-[11px] text-omega-stone mt-4">
          The Omega Bot must already be a member of that channel.
          {' '}If the test fails with <code>not_in_channel</code>, type{' '}
          <code>/invite @Omega Bot</code> in the channel and try again.
        </p>
      </div>
    );
  }

  // ─── Loading first time ────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-omega-stone gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading conversation…
      </div>
    );
  }

  // ─── Error ────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center text-center py-8 px-4">
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mb-3">
          <AlertCircle className="w-6 h-6 text-red-600" />
        </div>
        <p className="text-sm font-semibold text-omega-charcoal">
          Couldn't load Slack messages.
        </p>
        <p className="text-xs text-red-700 mt-1 max-w-sm font-mono">{error}</p>
        <button
          onClick={() => { setLoading(true); fetchMessages({ silent: false }); }}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  // ─── Message list ─────────────────────────────────────────────
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-omega-stone uppercase tracking-wider font-bold">
          Channel <code className="ml-1 text-omega-charcoal">{channelId}</code>
        </p>
        <button
          onClick={() => fetchMessages({ silent: false })}
          disabled={refreshing}
          className="inline-flex items-center gap-1 text-[11px] text-omega-stone hover:text-omega-orange disabled:opacity-50 transition"
        >
          {refreshing
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {/* Composer sits ABOVE the message list — the list now renders
          newest-first, so the seller types where the newest stuff is
          rather than scrolling past the entire history to reach it. */}
      <MessageComposer
        jobId={job.id}
        user={user}
        onSent={() => fetchMessages({ silent: false })}
      />

      {messages.length === 0 ? (
        <div className="flex flex-col items-center text-center py-8 text-omega-stone">
          <MessageCircle className="w-6 h-6 text-omega-fog mb-2" />
          <p className="text-sm">No messages in this channel yet.</p>
          <p className="text-xs mt-1">
            Anything posted in the Slack channel will appear here within ~30 seconds.
          </p>
        </div>
      ) : (
        <MessageList messages={messages} />
      )}

      <p className="pt-3 text-[10px] text-omega-fog text-center">
        Auto-refreshes every 30s · Images auto-compressed before upload
      </p>
    </div>
  );
}

// ─── Date separator chip ──────────────────────────────────────────
// Slack-style "Friday, April 17th" / "Today" / "Yesterday" pill that
// appears between message groups when the calendar day changes.
function DateSeparator({ ts }) {
  const label = useMemo(() => formatDateChip(ts), [ts]);
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex-1 h-px bg-gray-200" />
      <span className="px-3 py-1 rounded-full bg-white border border-gray-200 text-[11px] font-semibold text-omega-stone shadow-sm whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-gray-200" />
    </li>
  );
}

// True when both Slack timestamps fall on the same calendar day in
// the user's local timezone. We compare year/month/day on local
// Date objects so a midnight rollover hops the chip cleanly.
function sameDayCT(ts1, ts2) {
  if (!ts1 || !ts2) return false;
  const d1 = new Date(parseFloat(ts1) * 1000);
  const d2 = new Date(parseFloat(ts2) * 1000);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatDateChip(ts) {
  if (!ts) return '';
  const d = new Date(parseFloat(ts) * 1000);
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const month   = d.toLocaleDateString('en-US', { month: 'long' });
  const day     = d.getDate();
  const ord     = ordinalSuffix(day);
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${weekday}, ${month} ${day}${ord}${sameYear ? '' : `, ${d.getFullYear()}`}`;
}

function ordinalSuffix(n) {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

// ─── File attachment (image inline / chip fallback) ──────────────
// Images render as a clickable thumbnail using the local proxy
// endpoint (api/slack/file-proxy) so the browser can load the bytes
// without seeing the Slack token. Anything non-image keeps the
// pre-existing chip look.
function FileAttachment({ file }) {
  const [broken, setBroken] = useState(false);
  const isImage = (file.mimetype || '').startsWith('image/');
  const proxySrc = file.proxy_url || (file.id ? `/api/slack/file-proxy?id=${encodeURIComponent(file.id)}` : null);
  const openHref = file.permalink || file.url || proxySrc || '#';

  if (isImage && proxySrc && !broken) {
    return (
      <a
        href={openHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-xl overflow-hidden border border-gray-200 hover:border-omega-orange transition"
        title={file.name || 'image'}
      >
        <img
          src={proxySrc}
          alt={file.name || ''}
          loading="lazy"
          onError={() => setBroken(true)}
          className="block max-w-[320px] max-h-[240px] w-auto h-auto object-contain bg-omega-cloud"
        />
      </a>
    );
  }

  // Non-image OR image that failed to load — keep the chip.
  return (
    <a
      href={openHref}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-omega-cloud text-xs font-medium text-omega-charcoal hover:text-omega-orange hover:bg-omega-pale/60 transition"
    >
      <Paperclip className="w-3 h-3" /> {file.name || 'attachment'}
    </a>
  );
}

// ─── Message composer ─────────────────────────────────────────────
// Textarea + paperclip + send. Enter sends, Shift+Enter inserts a
// newline. The paperclip opens a file picker restricted to images
// (jpg/png/webp/heic). A picked image shows up as a preview chip
// above the input, with remove. Compression comes in mini-passo 3.

const ACCEPTED_FILE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ACCEPTED_FILE_INPUT = '.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif';
// Target after compression. 2 MB keeps quality high while staying well
// below the Vercel body limit. Anything still bigger than 4 MB after
// compression is rejected — the user is asked for a smaller photo.
const COMPRESS_TARGET_MB = 2;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// Cap image dimensions so a 12,000-px iPhone shot doesn't take 30s in
// the compressor. Long side capped at 2400 — still enough resolution
// for site photos when zoomed in.
const COMPRESS_MAX_DIMENSION = 2400;
const COMPRESS_QUALITY = 0.8;

function MessageComposer({ jobId, user, onSent }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);          // post-compression File
  const [originalSize, setOriginalSize] = useState(0); // bytes BEFORE compression
  const [preview, setPreview] = useState(null);    // object-URL for thumbnail
  const [compressing, setCompressing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const taRef = useRef(null);
  const fileInputRef = useRef(null);

  // Revoke the object-URL whenever the file changes so we don't leak.
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function clearFile() {
    setFile(null);
    setOriginalSize(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function pickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');

    // HEIC files sometimes report empty mimetype in browsers that
    // don't natively decode them — accept by extension as a backup.
    const looksImage =
      ACCEPTED_FILE_MIMES.includes(f.type) ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
    if (!looksImage) {
      setError('Only images: JPG, PNG, WEBP or HEIC.');
      e.target.value = '';
      return;
    }

    // Compress in a Web Worker so the UI stays responsive even on
    // 10MB+ iPhone shots. We always run it (even on small files)
    // for consistency and to strip Photos metadata.
    setCompressing(true);
    setOriginalSize(f.size);
    try {
      let compressed;
      try {
        compressed = await imageCompression(f, {
          maxSizeMB: COMPRESS_TARGET_MB,
          maxWidthOrHeight: COMPRESS_MAX_DIMENSION,
          initialQuality: COMPRESS_QUALITY,
          useWebWorker: true,
          // Strip orientation EXIF; the lib applies it to pixels first.
          fileType: 'image/jpeg',
        });
      } catch (compressionErr) {
        // Most likely failure mode: HEIC on a non-Safari browser. Fall
        // back to the original file IF it's already small enough — the
        // server will reject anything over 4MB, so the user still gets
        // a clean error instead of a silent corruption.
        if (f.size <= MAX_FILE_BYTES) {
          compressed = f;
        } else {
          throw compressionErr;
        }
      }

      // Server enforces the same 4MB cap. Mirror it client-side so the
      // user sees the message before the upload round-trip.
      if (compressed.size > MAX_FILE_BYTES) {
        setError(`Even after compression the image is ${(compressed.size / 1024 / 1024).toFixed(1)} MB — over the 4 MB limit. Try a smaller photo.`);
        e.target.value = '';
        return;
      }

      setFile(compressed);
    } catch (err) {
      // Surfaced when HEIC/HEIF fails AND fallback isn't possible.
      const msg = /heic|heif/i.test(err?.message || '')
        ? 'Could not read this HEIC photo in your browser. Try Safari, or convert to JPG first.'
        : `Could not process this image: ${err?.message || 'unknown error'}`;
      setError(msg);
      e.target.value = '';
    } finally {
      setCompressing(false);
    }
  }

  async function send() {
    // Defensive sanitization: if the user pasted rich-text from a
    // rendered chat (or anywhere else with anchor tags in the
    // clipboard), reduce <a href="X">...</a> back to bare X so the
    // Slack post reads naturally instead of dumping HTML markup.
    // Also un-double-escape the typical &amp;amp; sequence that
    // creeps into URLs through round-trips of the rendered chat.
    // We don't strip ALL tags — that would mangle messages with
    // legitimate angle brackets (e.g. "I'll be there <- 5pm"). Only
    // anchors get rewritten.
    const cleaned = text
      .replace(
        /<a\s+[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi,
        (_, href) => href.replace(/&amp;amp;/g, '&').replace(/&amp;/g, '&'),
      )
      .trim();
    if ((!cleaned && !file) || sending) return;
    setSending(true);
    setError('');
    const trimmed = cleaned;
    try {
      // Branch: multipart when there's a file, JSON otherwise. Each
      // path goes to the SAME endpoint — the server detects which by
      // Content-Type. Don't set Content-Type manually for FormData;
      // the browser adds the boundary string for us.
      let r;
      if (file) {
        const fd = new FormData();
        fd.append('jobId', jobId);
        fd.append('text', trimmed);
        fd.append('file', file, file.name);
        r = await fetch('/api/slack/send-message', {
          method: 'POST',
          headers: {
            'x-omega-user': user?.name || '',
            'x-omega-role': user?.role || '',
          },
          body: fd,
        });
      } else {
        r = await fetch('/api/slack/send-message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-omega-user': user?.name || '',
            'x-omega-role': user?.role || '',
          },
          body: JSON.stringify({ jobId, text: trimmed }),
        });
      }
      const data = await r.json();
      if (!data.ok) {
        setError(data.error || 'Could not send the message.');
        return;
      }
      // Reset and refocus.
      setText('');
      clearFile();
      taRef.current?.focus();
      onSent?.();
    } catch (err) {
      setError(err?.message || 'Network error.');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Force plain-text paste, with an extra pass for HTML hidden inside
  // the clipboard's text/plain entry.
  //
  // Two failure modes we need to defuse:
  //   1. Clipboard has both text/plain and text/html. Browsers prefer
  //      HTML and end up inserting <a href="..."> markup. Solved by
  //      reading text/plain explicitly.
  //   2. Clipboard's text/plain LOOKS LIKE HTML — happens when the
  //      user selects a previously-broken chat row (one that's
  //      showing the raw <a href...> as text) and copies it. The
  //      "plain" copy IS the HTML literal. Detect that pattern and
  //      reduce <a href="X">label</a> back to bare X.
  function handlePaste(e) {
    const plain = e.clipboardData?.getData('text/plain') || '';
    const html  = e.clipboardData?.getData('text/html')  || '';
    const looksLikeHtml = /<a\s+[^>]*href=/i.test(plain);
    if (!html && !looksLikeHtml) return;

    e.preventDefault();

    let final = plain;
    if (looksLikeHtml) {
      final = plain
        .replace(
          /<a\s+[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi,
          (_, href) => href.replace(/&amp;amp;/g, '&').replace(/&amp;/g, '&'),
        );
    } else if (!plain && html) {
      // Edge case: only HTML in clipboard. Strip tags via the DOM.
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      final = tmp.textContent || '';
    }

    const ta = e.currentTarget;
    const start = ta.selectionStart ?? text.length;
    const end   = ta.selectionEnd   ?? text.length;
    setText(text.slice(0, start) + final + text.slice(end));
    requestAnimationFrame(() => {
      const pos = start + final.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  const busy = sending || compressing;
  const canSend = (text.trim().length > 0 || !!file) && !busy;
  const compressionRatio = file && originalSize
    ? Math.max(0, 1 - (file.size / originalSize))
    : 0;

  return (
    <div className="border-t border-gray-100 mt-3 pt-3">
      {/* Compression in progress chip. */}
      {compressing && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-omega-pale/50 border border-omega-pale">
          <Loader2 className="w-4 h-4 text-omega-orange animate-spin flex-shrink-0" />
          <p className="text-xs font-semibold text-omega-charcoal">
            Compressing image…
          </p>
          {originalSize > 0 && (
            <p className="text-[10px] text-omega-stone ml-auto">
              {(originalSize / 1024 / 1024).toFixed(1)} MB
            </p>
          )}
        </div>
      )}

      {/* File preview chip — only shown when a compressed image is ready. */}
      {file && !compressing && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-xl bg-omega-cloud border border-gray-200 max-w-full">
          {preview ? (
            <img
              src={preview}
              alt=""
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-omega-pale flex items-center justify-center flex-shrink-0">
              <ImageIcon className="w-4 h-4 text-omega-orange" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-omega-charcoal truncate">{file.name}</p>
            <p className="text-[10px] text-omega-stone">
              {(file.size / 1024 / 1024).toFixed(2)} MB
              {compressionRatio > 0.05 && (
                <span className="text-omega-orange font-semibold ml-1.5">
                  −{Math.round(compressionRatio * 100)}%
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={clearFile}
            disabled={sending}
            className="p-1 rounded-md text-omega-stone hover:text-red-600 hover:bg-white transition disabled:opacity-40"
            aria-label="Remove attachment"
            title="Remove attachment"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          rows={2}
          value={text}
          onChange={(e) => { setText(e.target.value); if (error) setError(''); }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={file ? 'Add a caption (optional)…' : 'Write a message…'}
          disabled={busy}
          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm resize-none focus:border-omega-orange focus:outline-none disabled:opacity-50"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_INPUT}
          className="hidden"
          onChange={pickFile}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || !!file}
          title={file ? 'Remove the current image first' : 'Attach an image'}
          aria-label="Attach image"
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-gray-200 text-omega-stone hover:border-omega-orange hover:text-omega-orange disabled:opacity-50 transition flex-shrink-0"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <button
          onClick={send}
          disabled={!canSend}
          title="Send (Enter)"
          aria-label="Send"
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-omega-orange text-white hover:bg-omega-dark disabled:opacity-50 transition flex-shrink-0"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600 mt-1.5">{error}</p>
      )}
      <p className="text-[10px] text-omega-stone mt-1.5">
        <kbd className="px-1 py-0.5 rounded bg-omega-cloud border border-gray-200 font-mono">Enter</kbd> to send · <kbd className="px-1 py-0.5 rounded bg-omega-cloud border border-gray-200 font-mono">Shift+Enter</kbd> for new line · <kbd className="px-1 py-0.5 rounded bg-omega-cloud border border-gray-200 font-mono">📎</kbd> images auto-compressed (~2 MB target, 4 MB max)
      </p>
    </div>
  );
}

// ─── Message list (handles date separators + outbound-link modal) ─
function MessageList({ messages }) {
  // External-link confirmation. Clicking any link inside a rendered
  // message body opens this modal asking whether to leave the app
  // (it's a small "you're being redirected" guard the field crew
  // requested). "Yes" pops a new tab; "No" cancels.
  const [pendingLink, setPendingLink] = useState(null);

  // Render newest-first: most recent message at the top of the tab.
  // The backend (api/slack/get-messages.js) hands us oldest-first
  // (chat-style), so we reverse here for display. The date separator
  // logic below still works in either direction — it only checks
  // "is the previous rendered message on a different calendar day"
  // — so an "Hoje" / "Yesterday" / "April 17th" pill still appears
  // exactly once at the start of each day's group.
  const displayed = useMemo(() => [...messages].reverse(), [messages]);

  function handleBodyClick(e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    setPendingLink(href);
  }

  return (
    <>
      <ul onClick={handleBodyClick}>
        {displayed.map((m, idx) => {
          const prev = idx > 0 ? displayed[idx - 1] : null;
          const showDate = !prev || !sameDayCT(m.ts, prev.ts);
          const showBorder = !showDate && idx > 0;
          return (
            <Fragment key={m.ts}>
              {showDate && <DateSeparator ts={m.ts} />}
              {isSystemMessage(m)
                ? <SystemRow message={m} />
                : <MessageRow message={m} withBorder={showBorder} />}
            </Fragment>
          );
        })}
      </ul>
      {pendingLink && (
        <ExternalLinkConfirm
          href={pendingLink}
          onCancel={() => setPendingLink(null)}
          onConfirm={() => {
            window.open(pendingLink, '_blank', 'noopener,noreferrer');
            setPendingLink(null);
          }}
        />
      )}
    </>
  );
}

// ─── System message row (channel_join, pinned_item, etc.) ─────────
// Slack-style centered hairline-flanked notice. Strips the resolved
// mention markers so the chip reads as plain text.
function SystemRow({ message }) {
  const Icon = systemIconFor(message.subtype);
  const text = (message.text || '')
    .replaceAll(MENTION_OPEN, '')
    .replaceAll(MENTION_CLOSE, '');
  return (
    <li className="flex items-center justify-center gap-2 py-1.5 text-[11px] text-omega-stone">
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="italic">{text || message.subtype?.replace(/_/g, ' ')}</span>
    </li>
  );
}

// ─── Outbound-link confirmation modal ─────────────────────────────
function ExternalLinkConfirm({ href, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div className="bg-white rounded-2xl shadow-card-hover max-w-sm w-full overflow-hidden">
        <div className="px-5 pt-5 pb-2 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
            <ExternalLink className="w-5 h-5 text-omega-orange" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-omega-charcoal">
              Leaving the app
            </h3>
            <p className="text-xs text-omega-stone mt-1">
              You're being redirected to a page outside Omega. Anything
              you do on the destination is your responsibility. Continue?
            </p>
            <p className="mt-2 text-[11px] text-omega-stone font-mono break-all line-clamp-2">
              {href}
            </p>
          </div>
        </div>
        <div className="px-5 pb-4 pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold text-omega-charcoal hover:bg-omega-cloud border border-gray-200 transition"
          >
            No, stay
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold text-white bg-omega-orange hover:bg-omega-dark transition"
          >
            <ExternalLink className="w-4 h-4" />
            Yes, open
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Message row ──────────────────────────────────────────────────
function MessageRow({ message, withBorder = true }) {
  const { author, body } = useMemo(() => parseAuthorAndBody(message), [message]);
  const when = useMemo(() => formatSlackTimestamp(message.ts), [message.ts]);
  const html = useMemo(() => renderSlackMrkdwn(body), [body]);

  // Color the avatar from the resolved author name so each person
  // in the channel gets a stable, distinct hue. Anonymous rows fall
  // back to muted fog (handled by colorFromName itself). When the
  // backend resolved a profile photo for this author (matched by
  // name in the app's users table), use it instead of the initial.
  const avatarColor = colorFromName(author);

  return (
    <li className={`flex items-start gap-3 py-3 ${withBorder ? 'border-t border-gray-100' : ''}`}>
      <Avatar
        name={author || '?'}
        size="sm"
        color={avatarColor}
        photoUrl={message.author_photo_url || undefined}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-semibold text-omega-charcoal">{author || 'Slack user'}</p>
          <span className="text-[11px] text-omega-stone">{when}</span>
        </div>
        <div
          className="text-sm text-omega-charcoal whitespace-pre-wrap break-words mt-0.5"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {Array.isArray(message.files) && message.files.length > 0 && (
          <ul className="mt-2 space-y-2">
            {message.files.map((f) => (
              <li key={f.id}>
                <FileAttachment file={f} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

// send-message.js prepends a credit line before the user's text.
// Pull that out so the row shows the human author + clean body.
//
// Three sources of "who said this" are tried, in order of trust:
//   1. Sprint 4+ credit line  "Ramon Peyroton: hello"
//   2. Sprint 3 legacy credit line  "*Ramon Peyroton (sales)*\nhello"
//   3. Backend-resolved Slack user name (message.user_name) — for posts
//      typed directly inside Slack with no prefix.
//
// The Sprint 4 regex MUST start with a capital letter (a real person's
// first name). Without that guard, a Slack-wrapped URL like
// "<https://drive.google.com/...>" would get parsed as
//   author = "<https"
//   body   = "//drive.google.com/..."
// because there's a colon in the URL. The capital-letter prefix kills
// that misread cleanly — URLs always start with the lowercase scheme.
//
// Empty body is allowed so a credit-only message (image attached, no
// caption: "Brenda:") still extracts the author correctly.
function parseAuthorAndBody(message) {
  const text = message.text || '';

  // Sprint 4 format — strict. First char must be a Latin uppercase
  // letter, then up to 59 more chars that are letters / spaces /
  // periods / apostrophes / hyphens (covers names like "Mr. Silva",
  // "Mary-Anne", "D'Souza"). Then a colon and optional body.
  const newFmt = text.match(/^([A-Z][A-Za-zÀ-ÿ.'\- ]{0,59}):\s*([\s\S]*)$/);
  if (newFmt) {
    return { author: newFmt[1].trim(), body: newFmt[2] };
  }

  // Sprint 3 legacy format.
  const oldFmt = text.match(/^\*([^*]+)\*\n([\s\S]*)$/);
  if (oldFmt) {
    return { author: stripRoleSuffix(oldFmt[1].trim()), body: oldFmt[2] };
  }

  // No credit line — fall back to the Slack user-id → real-name lookup
  // the backend resolved via users.list (requires users:read scope).
  return { author: message.user_name || '', body: text };
}

// "Pedro Silva (sales)" → "Pedro Silva". Keeps the avatar initial nice.
function stripRoleSuffix(s) {
  return s.replace(/\s*\([^)]*\)\s*$/, '');
}

function formatSlackTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(parseFloat(ts) * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7)  return `${diffDay}d ago`;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// Tiny Slack-mrkdwn → HTML. Handles only the basics + escapes < > &
// so we never inject raw markup. Safe for dangerouslySetInnerHTML.
//
// Order matters here:
//   1. Escape & first so we don't double-encode existing entities.
//   2. Pull Slack's <url|label> and <url> out BEFORE escaping <
//      and > — those are the only legitimate uses of angle brackets
//      Slack sends, and we want them to land in the output as real
//      <a> tags. Anything else (like a literal "<" the user typed)
//      gets escaped on the next pass.
//   3. Bare-URL detection (https://...) catches links that came in
//      without the angle-bracket wrapper — happens when the user
//      paste-types a URL or copies one from another app.
//   4. Finally apply the *bold* / _italic_ / ~strike~ / `code` shorthand.

const LINK_CLASS = 'text-omega-orange underline hover:text-omega-dark break-all';

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Mention pill class — neutral blue-tinted bg with bolded text. Same
// look the field crew is used to from Slack, but using the brand
// orange family for color consistency with the rest of the app.
const MENTION_CLASS = 'inline-flex items-baseline px-1.5 rounded bg-omega-pale text-omega-dark font-semibold';

// Decode HTML entities up to N rounds. Slack escapes <, > and & in
// the API payload, so a previously-poisoned message comes back with
// "&lt;a href=&quot;...&quot;&gt;...&lt;/a&gt;" — plus the URL inside
// often carries a double-escaped &amp;amp; from when it was copied
// out of an already-rendered chat row. Two rounds is enough to peel
// both layers without touching content that legitimately contains
// HTML-entity-looking text.
function decodeEntities(s, rounds = 2) {
  let out = String(s || '');
  for (let i = 0; i < rounds; i++) {
    if (!/&(amp|lt|gt|quot|#39);/i.test(out)) break;
    out = out
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  return out;
}

// Heal messages that came in carrying literal HTML in the body — the
// paste-of-rendered-HTML scenario from before the paste-handler fix.
//
// Strategy is intentionally aggressive after a stretch of regex misses
// in the wild: hand the body to the browser's own HTML parser via
// DOMParser, find every <a href="..."> element (no matter how the
// attributes are ordered, quoted or wrapped), replace each one with
// a text node that contains JUST the URL, then take the resulting
// textContent. Anything else in the body — plain words, mrkdwn like
// *bold*, Slack-angle-bracket URLs <https://...> — is preserved
// because text content is left untouched, and the URL pass downstream
// turns the bare URLs into clickable links.
//
// We only invoke the DOM parser when there's an actual "<a" trace in
// the input. That short-circuit keeps regular messages out of the
// parser's quirky HTML5 token-soup behavior — e.g. it would otherwise
// silently drop a stray "<-" used inside a sentence.
function unwrapLiteralAnchors(text) {
  let s = decodeEntities(text);

  if (!/<a\b/i.test(s)) return s;

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    // SSR / non-DOM env. Best-effort regex strip.
    return s.replace(/<a\b[\s\S]*?<\/a\s*>/gi, (match) => {
      const hrefMatch = match.match(/href\s*=\s*["']?([^"'\s>]+)/i);
      return hrefMatch ? hrefMatch[1] : '';
    });
  }

  try {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><body><div id="root">${s}</div></body>`,
      'text/html',
    );
    const root = doc.getElementById('root');
    if (!root) return s;

    // Replace each <a href="X"> element with a plain text node
    // containing X. We don't keep the label because it's almost always
    // identical to the URL anyway and the URL pass downstream will
    // make it clickable again with the brand styling.
    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      a.replaceWith(doc.createTextNode(href));
    });
    // Strip remaining <a> tags without href (rare).
    root.querySelectorAll('a').forEach((a) => {
      a.replaceWith(doc.createTextNode(a.textContent || ''));
    });

    return root.textContent || s;
  } catch {
    return s; // Best effort
  }
}

// NUL chars are used as placeholder boundaries while building the
// final HTML. Slack messages don't contain U+0000 in practice, so this
// is a safe sentinel.
const TOK_OPEN  = ' ';
const TOK_CLOSE = ' ';

function renderSlackMrkdwn(text) {
  // Pre-pass: collapse any leftover <a> tags into bare URLs so the
  // URL detector below picks them up cleanly as real links.
  let s = unwrapLiteralAnchors(text).replace(/&/g, '&amp;');

  // Stash table: every <a> we generate is set aside under an integer
  // token while the rest of the pipeline does its thing. Without this,
  // the "escape any leftover < and >" pass below would escape OUR OWN
  // <a> tags into &lt;a&gt; — which is the bug that had the chat
  // showing literal markup all afternoon.
  const stash = [];
  function park(html) {
    const id = stash.length;
    stash.push(html);
    return `${TOK_OPEN}L${id}${TOK_CLOSE}`;
  }

  // Slack-supplied URLs come in already &-escaped after the step above
  // (https://x.com/?a=1&b=2 became &amp;), but a real <a href> needs
  // bare ampersands so the browser can recompose entities at paint time.
  function fixHref(u) {
    return u.replace(/&amp;/g, '&');
  }

  // Slack <url|label> — label can contain spaces but no '>' or '|'.
  s = s.replace(
    /<(https?:\/\/[^|\s>]+)\|([^>]+)>/g,
    (_, url, label) =>
      park(`<a href="${htmlEscape(fixHref(url))}" target="_blank" rel="noopener noreferrer" class="${LINK_CLASS}">${htmlEscape(label)}</a>`),
  );

  // Slack <url> — no label.
  s = s.replace(
    /<(https?:\/\/[^|\s>]+)>/g,
    (_, url) =>
      park(`<a href="${htmlEscape(fixHref(url))}" target="_blank" rel="noopener noreferrer" class="${LINK_CLASS}">${htmlEscape(url)}</a>`),
  );

  // Bare URLs (no angle brackets). Run BEFORE the < > escape so we can
  // still match the literal scheme. Trailing punctuation excluded.
  s = s.replace(
    /(?<!href=")(?<!\bL\d{1,5} )(https?:\/\/[^\s<]+?)(?=[)\].,!?]*(?:\s|$))/g,
    (m) => park(`<a href="${htmlEscape(fixHref(m))}" target="_blank" rel="noopener noreferrer" class="${LINK_CLASS}">${htmlEscape(m)}</a>`),
  );

  // Now safe to escape any remaining angle brackets the user typed —
  // every <a> we care about is stashed away as a token.
  s = s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Mention pills. Backend wrapped the resolved label with U+E000 ..
  // U+E001 so we can find it without ambiguity.
  const mentionRe = new RegExp(
    `${MENTION_OPEN}([^${MENTION_OPEN}${MENTION_CLOSE}]+)${MENTION_CLOSE}`,
    'g',
  );
  s = s.replace(mentionRe, (_, label) =>
    `<span class="${MENTION_CLASS}">${label}</span>`,
  );

  // mrkdwn formatting now that links are out of the way.
  s = s
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<del>$1</del>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Finally, restore the parked <a> tags as real HTML.
  s = s.replace(new RegExp(`${TOK_OPEN}L(\\d+)${TOK_CLOSE}`, 'g'), (_, id) => stash[Number(id)]);

  return s;
}

// Slack subtypes that represent a system / housekeeping event rather
// than a person's message. Rendered as a thin centered chip instead
// of a normal row.
const SYSTEM_SUBTYPES = new Set([
  'channel_join', 'channel_leave', 'channel_topic',
  'channel_purpose', 'channel_name', 'channel_archive',
  'channel_unarchive', 'pinned_item', 'unpinned_item',
  'bot_add', 'bot_remove',
]);

function isSystemMessage(message) {
  return !!message?.subtype && SYSTEM_SUBTYPES.has(message.subtype);
}

function systemIconFor(subtype) {
  switch (subtype) {
    case 'channel_join': return UserPlus;
    case 'channel_leave': return UserMinus;
    case 'pinned_item':
    case 'unpinned_item': return Pin;
    default: return Hash;
  }
}
