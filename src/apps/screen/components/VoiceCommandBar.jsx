import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, X, Loader2, AlertTriangle, FileText, FileSignature, DollarSign, HardHat, Calendar } from 'lucide-react';
import { supabase } from '../../../shared/lib/supabase';

// Voice command bar designed for the TV dashboard. Targeted at the
// Firestick remote's voice button — the Alexa transcription lands
// in this input when it's focused, and Enter triggers our local
// parser + result card.
//
// Why an input + Enter loop instead of the Web Speech API? The page
// can't access the Firestick remote's microphone directly. Alexa's
// speech-to-text is what makes voice work, and that only writes into
// the currently focused field. So we keep the input always focused.
//
// Commands supported (regex-matched, case-insensitive, accent-stripped):
//   * "ultimo|last estimate (de|of|for|do|da) <name>"
//   * "ultimo|last contract (de|of|for|do|da) <name>"
//   * "obras|jobs (de|of) hoje|today|in progress|em andamento"
//   * "pagamentos atrasados|overdue payments|past due"
//   * "total a receber|outstanding|receivable"
//   * <name>          — bare name shows the client summary
// Anything else falls into "I didn't catch that" mode.

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function money(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Returns one of:
//   { kind: 'estimate_for', name }
//   { kind: 'contract_for', name }
//   { kind: 'today_jobs' }
//   { kind: 'overdue_payments' }
//   { kind: 'receivable_total' }
//   { kind: 'client_summary', name }
//   null
function parseCommand(raw) {
  const text = normalize(raw);
  if (!text) return null;

  // last/ultimo estimate ...
  const estMatch = text.match(/(?:last|ultimo|latest)\s+(?:estimate|estimates)\s+(?:de|do|da|of|for|para|pra)?\s*(.+)/);
  if (estMatch && estMatch[1]) return { kind: 'estimate_for', name: estMatch[1] };

  // last/ultimo contract ...
  const ctrMatch = text.match(/(?:last|ultimo|latest)\s+(?:contract|contracts|contrato|contratos)\s+(?:de|do|da|of|for|para|pra)?\s*(.+)/);
  if (ctrMatch && ctrMatch[1]) return { kind: 'contract_for', name: ctrMatch[1] };

  // jobs today / obras de hoje / in progress
  if (/\b(?:jobs?\s+today|obras?\s+(?:de\s+)?hoje|in\s+progress|em\s+andamento|today'?s?\s+jobs?)\b/.test(text)) {
    return { kind: 'today_jobs' };
  }

  // overdue payments / pagamentos atrasados / past due
  if (/\b(?:overdue|past\s+due|atrasad(?:os|as)|pagamentos?\s+atrasad)/.test(text)) {
    return { kind: 'overdue_payments' };
  }

  // total a receber / outstanding / receivable
  if (/\b(?:total\s+a\s+receber|outstanding|receivable|a\s+receber|recebimentos?)/.test(text)) {
    return { kind: 'receivable_total' };
  }

  // Just a name? Treat as client summary.
  return { kind: 'client_summary', name: text };
}

// Fuzzy-match a normalized name string against jobs.client_name.
// Returns up to 3 jobs whose normalized client_name contains every
// token of the query (no exact-substring requirement so word order
// is flexible). Names are tokenized so "yulia stanv" matches
// "Yuliya Stanvilaski" even with mis-transcribed surnames.
async function findClientJobs(nameQuery) {
  const tokens = normalize(nameQuery).split(' ').filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  // Pull a manageable slice — we filter client-side because Postgres
  // ILIKE doesn't strip accents and we want to be tolerant of those.
  const { data } = await supabase
    .from('jobs')
    .select('id, client_name, address, city, service, pipeline_status, salesperson_name, updated_at')
    .order('updated_at', { ascending: false })
    .limit(400);
  const rows = (data || []).filter((j) => {
    const hay = normalize(j.client_name || '');
    return tokens.every((t) => hay.includes(t));
  });
  // Boost: jobs whose first token matches the first name strongly.
  return rows.slice(0, 5);
}

export default function VoiceCommandBar() {
  const [text, setText]       = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult]   = useState(null); // { type, ... } or { error }
  const inputRef = useRef(null);
  const clearTimerRef = useRef(null);

  // Keep the input focused so the Firestick voice transcription lands
  // here. Re-focuses on result close / dismiss too.
  useEffect(() => {
    const f = () => inputRef.current?.focus();
    f();
    const t = setInterval(f, 4000); // gentle re-focus in case TV remote stole focus
    return () => clearInterval(t);
  }, []);

  // Auto-clear result after 45s so the TV stays useful.
  useEffect(() => {
    if (clearTimerRef.current) { clearTimeout(clearTimerRef.current); clearTimerRef.current = null; }
    if (!result) return;
    clearTimerRef.current = setTimeout(() => setResult(null), 45_000);
    return () => clearTimeout(clearTimerRef.current);
  }, [result]);

  async function runCommand(rawText) {
    const cmd = parseCommand(rawText);
    if (!cmd) {
      setResult({ kind: 'unknown', text: rawText });
      return;
    }
    setRunning(true);
    try {
      if (cmd.kind === 'estimate_for' || cmd.kind === 'contract_for' || cmd.kind === 'client_summary') {
        const jobs = await findClientJobs(cmd.name);
        if (jobs.length === 0) {
          setResult({ kind: 'not_found', name: cmd.name });
          return;
        }
        if (jobs.length > 1) {
          setResult({ kind: 'ambiguous', jobs, name: cmd.name });
          return;
        }
        const job = jobs[0];
        if (cmd.kind === 'estimate_for') {
          const { data: est } = await supabase
            .from('estimates').select('*').eq('job_id', job.id)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          setResult({ kind: 'estimate', job, est });
        } else if (cmd.kind === 'contract_for') {
          const { data: ctr } = await supabase
            .from('contracts').select('*').eq('job_id', job.id)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          setResult({ kind: 'contract', job, ctr });
        } else {
          const [{ data: est }, { data: ctr }] = await Promise.all([
            supabase.from('estimates').select('id, status, total_amount, signed_at').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('contracts').select('id, status, total_amount, signed_at, sent_at').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          ]);
          setResult({ kind: 'client', job, est, ctr });
        }
        return;
      }

      if (cmd.kind === 'today_jobs') {
        const { data } = await supabase
          .from('jobs')
          .select('id, client_name, address, city, pipeline_status, pm_name')
          .in('pipeline_status', ['in_progress', 'in-progress'])
          .order('updated_at', { ascending: false })
          .limit(20);
        setResult({ kind: 'today_jobs', rows: data || [] });
        return;
      }

      if (cmd.kind === 'overdue_payments') {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const { data } = await supabase
          .from('payment_milestones')
          .select('id, label, due_amount, received_amount, due_date, job_id, status')
          .neq('status', 'paid')
          .order('due_date', { ascending: true })
          .limit(50);
        const overdue = (data || []).filter((m) => {
          if (!m.due_date) return false;
          const d = new Date(m.due_date); d.setHours(0, 0, 0, 0);
          return d < today;
        });
        const jobIds = [...new Set(overdue.map((m) => m.job_id).filter(Boolean))];
        const { data: jobs } = jobIds.length
          ? await supabase.from('jobs').select('id, client_name').in('id', jobIds)
          : { data: [] };
        const jobsById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
        const total = overdue.reduce((s, m) => s + Math.max(0, Number(m.due_amount || 0) - Number(m.received_amount || 0)), 0);
        setResult({ kind: 'overdue', rows: overdue, jobsById, total });
        return;
      }

      if (cmd.kind === 'receivable_total') {
        const { data } = await supabase
          .from('payment_milestones')
          .select('due_amount, received_amount, status');
        const total = (data || []).reduce((s, m) => {
          if (m.status === 'paid') return s;
          return s + Math.max(0, Number(m.due_amount || 0) - Number(m.received_amount || 0));
        }, 0);
        setResult({ kind: 'receivable_total', total });
        return;
      }
    } catch (err) {
      setResult({ kind: 'error', message: err?.message || 'Lookup failed' });
    } finally {
      setRunning(false);
    }
  }

  function onSubmit(ev) {
    ev?.preventDefault();
    const raw = text.trim();
    if (!raw) return;
    void runCommand(raw);
  }

  function dismiss() {
    setText('');
    setResult(null);
    inputRef.current?.focus();
  }

  // Esc clears the result without losing focus.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') dismiss(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="bg-omega-charcoal/95 backdrop-blur border-b border-white/10 px-6 py-4">
      <form onSubmit={onSubmit} className="flex items-center gap-3 max-w-5xl mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-omega-orange/20 border border-omega-orange flex items-center justify-center flex-shrink-0">
          <Mic className="w-6 h-6 text-omega-orange" />
        </div>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Press the mic on the Firestick remote and speak…  (e.g., 'last estimate Yulia')"
          className="flex-1 px-5 py-3 rounded-2xl bg-white/5 border-2 border-white/10 focus:border-omega-orange text-2xl text-white placeholder:text-white/40 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        {text && (
          <button
            type="button"
            onClick={() => { setText(''); inputRef.current?.focus(); }}
            className="px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white/70"
          >
            <X className="w-5 h-5" />
          </button>
        )}
        <button
          type="submit"
          disabled={running || !text.trim()}
          className="px-6 py-3 rounded-2xl bg-omega-orange hover:bg-omega-dark text-white text-lg font-bold disabled:opacity-50"
        >
          {running ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Go'}
        </button>
      </form>

      {result && (
        <div className="mt-4 max-w-5xl mx-auto">
          <ResultCard result={result} onDismiss={dismiss} />
        </div>
      )}
    </div>
  );
}

function ResultCard({ result, onDismiss }) {
  const baseCls = 'relative rounded-3xl bg-white text-omega-charcoal shadow-2xl p-6';

  const close = (
    <button
      onClick={onDismiss}
      className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 inline-flex items-center justify-center text-omega-stone"
    >
      <X className="w-4 h-4" />
    </button>
  );

  if (result.kind === 'unknown') {
    return (
      <div className={`${baseCls} bg-amber-50`}>
        {close}
        <AlertTriangle className="w-6 h-6 text-amber-600 mb-2" />
        <p className="text-xl font-bold">I didn't catch that.</p>
        <p className="text-sm text-omega-stone mt-1">Heard: "{result.text}"</p>
        <p className="text-sm text-omega-stone mt-3">
          Try: <em>"last estimate Yulia"</em>, <em>"jobs today"</em>, <em>"overdue payments"</em>, <em>"total receivable"</em>.
        </p>
      </div>
    );
  }

  if (result.kind === 'not_found') {
    return (
      <div className={`${baseCls} bg-red-50`}>
        {close}
        <p className="text-xl font-bold text-red-900">No client found matching "{result.name}"</p>
        <p className="text-sm text-red-800/70 mt-1">Try the first name, or check the spelling.</p>
      </div>
    );
  }

  if (result.kind === 'ambiguous') {
    return (
      <div className={`${baseCls}`}>
        {close}
        <p className="text-xl font-bold">Multiple matches for "{result.name}"</p>
        <ul className="mt-3 space-y-1 text-base">
          {result.jobs.map((j) => (
            <li key={j.id} className="text-omega-charcoal">• {j.client_name} <span className="text-omega-stone text-sm">— {j.address || j.city || '—'}</span></li>
          ))}
        </ul>
        <p className="text-xs text-omega-stone mt-3">Add the last name or city to narrow down.</p>
      </div>
    );
  }

  if (result.kind === 'estimate') {
    const { job, est } = result;
    return (
      <div className={baseCls}>
        {close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center">
            <FileText className="w-5 h-5 text-omega-orange" />
          </div>
          <div>
            <p className="text-3xl font-bold leading-none">{job.client_name}</p>
            <p className="text-sm text-omega-stone mt-1">{job.address || job.city || '—'}</p>
          </div>
        </div>
        {est ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <KpiBlock label="Estimate #" value={est.estimate_number ? `OM-${est.estimate_number}` : 'OM-—'} />
            <KpiBlock label="Total" value={money(est.total_amount)} accent />
            <KpiBlock label="Status" value={(est.status || '—').toUpperCase()} />
            <KpiBlock label="Created" value={fmtDate(est.created_at)} />
            <KpiBlock label="Sent" value={fmtDate(est.sent_at)} />
            <KpiBlock label="Signed" value={est.signed_at ? fmtDate(est.signed_at) : '—'} />
          </div>
        ) : (
          <p className="text-base text-omega-stone mt-4">No estimate found for this client yet.</p>
        )}
      </div>
    );
  }

  if (result.kind === 'contract') {
    const { job, ctr } = result;
    return (
      <div className={baseCls}>
        {close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center">
            <FileSignature className="w-5 h-5 text-omega-orange" />
          </div>
          <div>
            <p className="text-3xl font-bold leading-none">{job.client_name}</p>
            <p className="text-sm text-omega-stone mt-1">{job.address || job.city || '—'}</p>
          </div>
        </div>
        {ctr ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <KpiBlock label="Total" value={money(ctr.total_amount)} accent />
            <KpiBlock label="Deposit" value={money(ctr.deposit_amount)} />
            <KpiBlock label="Status" value={(ctr.status || '—').toUpperCase()} />
            <KpiBlock label="Sent" value={fmtDate(ctr.sent_at)} />
            <KpiBlock label="Signed" value={ctr.signed_at ? fmtDate(ctr.signed_at) : '—'} />
            <KpiBlock label="DocuSign" value={(ctr.docusign_status || '—').toUpperCase()} />
          </div>
        ) : (
          <p className="text-base text-omega-stone mt-4">No contract yet for this client.</p>
        )}
      </div>
    );
  }

  if (result.kind === 'client') {
    const { job, est, ctr } = result;
    return (
      <div className={baseCls}>
        {close}
        <p className="text-3xl font-bold leading-none">{job.client_name}</p>
        <p className="text-sm text-omega-stone mt-1">
          {job.address || job.city || '—'}
          {job.service && ` · ${job.service}`}
          {job.salesperson_name && ` · ${job.salesperson_name}`}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <KpiBlock label="Last Estimate" value={est?.total_amount ? money(est.total_amount) : '—'} sub={est?.signed_at ? `Signed ${fmtDate(est.signed_at)}` : (est?.status || '').toUpperCase()} accent={!!est?.signed_at} />
          <KpiBlock label="Contract" value={ctr?.total_amount ? money(ctr.total_amount) : '—'} sub={ctr?.signed_at ? `Signed ${fmtDate(ctr.signed_at)}` : (ctr?.status || '').toUpperCase()} accent={!!ctr?.signed_at} />
          <KpiBlock label="Pipeline" value={(job.pipeline_status || '—').replace(/_/g, ' ').toUpperCase()} />
        </div>
      </div>
    );
  }

  if (result.kind === 'today_jobs') {
    return (
      <div className={baseCls}>
        {close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center">
            <HardHat className="w-5 h-5 text-omega-orange" />
          </div>
          <p className="text-3xl font-bold leading-none">Jobs in progress · {result.rows.length}</p>
        </div>
        {result.rows.length === 0 ? (
          <p className="text-base text-omega-stone mt-3">No jobs currently in progress.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-2 text-base">
            {result.rows.slice(0, 10).map((j) => (
              <li key={j.id} className="px-4 py-2 rounded-xl bg-omega-cloud">
                <p className="font-bold">{j.client_name}</p>
                <p className="text-xs text-omega-stone">{j.address || j.city || '—'}{j.pm_name && ` · PM: ${j.pm_name}`}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (result.kind === 'overdue') {
    return (
      <div className={baseCls}>
        {close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-3xl font-bold leading-none">Overdue · {money(result.total)}</p>
            <p className="text-sm text-omega-stone mt-1">{result.rows.length} milestone{result.rows.length === 1 ? '' : 's'} past due</p>
          </div>
        </div>
        {result.rows.length === 0 ? (
          <p className="text-base text-omega-success mt-3">No overdue payments. 🎉</p>
        ) : (
          <ul className="mt-3 space-y-1 text-base">
            {result.rows.slice(0, 6).map((m) => (
              <li key={m.id} className="flex justify-between items-center px-3 py-1.5 rounded bg-red-50">
                <span><strong>{result.jobsById[m.job_id]?.client_name || '—'}</strong> · {m.label}</span>
                <span className="font-bold text-red-700">{money((Number(m.due_amount) || 0) - (Number(m.received_amount) || 0))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (result.kind === 'receivable_total') {
    return (
      <div className={baseCls}>
        {close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-green-700" />
          </div>
          <p className="text-3xl font-bold leading-none">Outstanding receivable</p>
        </div>
        <p className="text-7xl font-extrabold mt-4 text-omega-charcoal tabular-nums">{money(result.total)}</p>
        <p className="text-sm text-omega-stone mt-2">Sum of all unpaid milestones across active jobs.</p>
      </div>
    );
  }

  if (result.kind === 'error') {
    return (
      <div className={`${baseCls} bg-red-50`}>
        {close}
        <p className="text-xl font-bold text-red-900">Something went wrong</p>
        <p className="text-sm text-red-800/70 mt-1">{result.message}</p>
      </div>
    );
  }

  return null;
}

function KpiBlock({ label, value, sub, accent }) {
  return (
    <div className={`px-4 py-3 rounded-xl ${accent ? 'bg-omega-pale border border-omega-orange/30' : 'bg-omega-cloud'}`}>
      <p className="text-[10px] uppercase tracking-wider font-bold text-omega-stone">{label}</p>
      <p className={`text-2xl font-bold tabular-nums leading-tight mt-1 ${accent ? 'text-omega-orange' : 'text-omega-charcoal'}`}>{value}</p>
      {sub && <p className="text-[10px] text-omega-stone mt-0.5 truncate">{sub}</p>}
    </div>
  );
}
