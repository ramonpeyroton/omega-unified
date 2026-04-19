import { useState, useRef, useEffect, useMemo } from 'react';
import { Sparkles, X, Send } from 'lucide-react';
import { chatWithGroqTools } from '../lib/groq';
import { toolImplementations, getToolsForRole } from '../lib/jarvisTools';

// ─── System prompt (role-aware) ─────────────────────────────────────
function buildSystemPrompt(user) {
  const role = user?.role || 'user';
  const name = user?.name || 'there';

  const common = `You are Jarvis, the AI assistant for Omega Development LLC, a premium construction and renovation company in Fairfield County, Connecticut.

Address the user as ${JSON.stringify(name)} when natural. Never invent other names.

Language: Detect the user's language automatically and respond in the same language (English or Portuguese). Match their language naturally.

Tone: Professional but warm, concise, confident. Avoid corporate fluff.

You have tools to query the Omega Supabase database. ALWAYS use a tool when the user asks about specific jobs, clients, subs, contracts, payments or operational data. Never invent numbers or IDs.

If a tool returns empty or errors, be transparent about what you looked for and offer to try a different search.`;

  // Role-scoped behavior rules
  const scopes = {
    admin:
      'You are talking to the platform Admin. Admin has full read access, including the audit log, user management, and all financial data.',
    owner:
      `You are talking to Inácio, the owner. He has full read access to jobs, subs, contracts, change orders, payments, audit log, and financial reports.`,
    operations:
      `You are talking to Brenda (Operations). She has full read access to jobs, subcontractors, contracts, change orders, payments, and margin data. She does NOT manage users.`,
    sales:
      `You are talking to a salesperson (${name}). They can ONLY see their own jobs — never another salesperson's work. If they ask about jobs that don't belong to them, explain you only have access to their own pipeline. No financial tools available.`,
    manager:
      `You are talking to Gabriel (Project Manager). He runs field operations. He sees only jobs currently in progress. He does NOT have access to money, contracts, or estimates — if asked about prices, deposits, margins, or contracts, politely say that's outside your scope for him and suggest he speak to Operations or Owner.`,
    screen:
      `You are talking to a display/kiosk user. Keep responses short. No financial data. Read-only pipeline overview only.`,
    marketing:
      `You are talking to a marketing user. Keep responses concise. You can discuss jobs, services offered, city breakdowns, but NOT financials, contracts, or payments.`,
  };

  return `${common}\n\n${scopes[role] || 'Unknown role — keep responses conservative and read-only.'}`;
}

// ─── Markdown renderer ──────────────────────────────────────────────
function renderInline(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="px-1 py-0.5 rounded bg-zinc-200 text-zinc-800 text-[12px] font-mono">{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function renderMarkdown(content) {
  if (!content) return null;
  const lines = String(content).split('\n');
  const blocks = [];
  let bullets = [];
  function flushBullets() {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-none space-y-1 my-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-blue-600 flex-shrink-0 select-none">•</span>
              <span>{renderInline(b)}</span>
            </li>
          ))}
        </ul>
      );
      bullets = [];
    }
  }
  lines.forEach((line, idx) => {
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (m) bullets.push(m[1]);
    else if (line.trim() === '') { flushBullets(); blocks.push(<div key={`br-${idx}`} className="h-2" />); }
    else { flushBullets(); blocks.push(<p key={`p-${idx}`}>{renderInline(line)}</p>); }
  });
  flushBullets();
  return <div className="space-y-1">{blocks}</div>;
}

function Message({ role, content }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser ? 'bg-blue-600 text-white rounded-br-md whitespace-pre-wrap'
                 : 'bg-zinc-100 text-zinc-900 rounded-bl-md'
        }`}
      >
        {isUser ? content : renderMarkdown(content)}
      </div>
    </div>
  );
}

function greeting(user) {
  const role = user?.role;
  const name = user?.name || 'there';
  if (role === 'owner') return `Hi ${name} — I'm Jarvis. Ask me about your jobs, subs, contracts, margin, audit log — anything on the Omega DB.`;
  if (role === 'operations') return `Hi ${name} — I'm Jarvis. I can pull contracts, change orders, payments, COI status, and any job or sub data you need.`;
  if (role === 'sales') return `Hi ${name} — I'm Jarvis. I can help with YOUR jobs: find a client, check phases, list your pipeline.`;
  if (role === 'manager') return `Hi ${name} — I'm Jarvis. I help with in-progress jobs, phases, subs and field ops. Ask away.`;
  if (role === 'admin') return `Admin session. All tools available including audit log and user activity.`;
  if (role === 'screen') return `Hi — I'm Jarvis. Read-only overview of active work.`;
  if (role === 'marketing') return `Hi ${name} — I'm Jarvis. I can help with service breakdowns, city distribution, and job-level context.`;
  return `Hi — I'm Jarvis. Ask me anything about Omega.`;
}

export default function JarvisChat({ user }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => [
    { role: 'assistant', content: greeting(user) },
  ]);
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const systemPrompt = useMemo(() => buildSystemPrompt(user), [user]);
  const tools = useMemo(() => getToolsForRole(user?.role), [user]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 220);
  }, [open]);

  async function handleSend() {
    const text = input.trim();
    if (!text || typing) return;
    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setTyping(true);

    const payload = [
      { role: 'system', content: systemPrompt },
      ...nextMessages.slice(-20),
    ];
    const reply = await chatWithGroqTools(payload, tools, toolImplementations, { user });
    setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    setTyping(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Jarvis"
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/40 flex items-center justify-center transition-all active:scale-95"
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}

      {open && (
        <aside
          className="fixed top-0 right-0 h-screen w-full sm:w-[420px] bg-white z-50 shadow-2xl flex flex-col border-l border-zinc-200 animate-[jarvisSlideIn_0.22s_ease-out]"
          role="dialog"
          aria-label="Jarvis chat"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 bg-white">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-sm shadow-blue-600/30 flex-shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-zinc-900 leading-none">Jarvis</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">Omega AI Assistant · {user?.role || 'user'}</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close Jarvis"
              className="w-8 h-8 rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-zinc-50">
            {messages.map((m, i) => <Message key={i} role={m.role} content={m.content} />)}
            {typing && (
              <div className="flex justify-start">
                <div className="bg-zinc-100 text-zinc-500 text-sm px-4 py-2.5 rounded-2xl rounded-bl-md inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '240ms' }} />
                  <span className="ml-1 text-xs">Jarvis is thinking…</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-200 p-3 bg-white">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Jarvis anything…"
                className="flex-1 resize-none px-3 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors max-h-32"
                disabled={typing}
              />
              <button
                onClick={handleSend}
                disabled={typing || !input.trim()}
                aria-label="Send"
                className="w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-zinc-400 mt-2 text-center">Powered by Llama 3.3 via Groq</p>
          </div>
        </aside>
      )}

      <style>{`
        @keyframes jarvisSlideIn {
          from { transform: translateX(32px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}
