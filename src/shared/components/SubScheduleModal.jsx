import { useEffect, useMemo, useState } from 'react';
import { X, Send, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sendMessage, normalizePhone } from '../lib/twilio';
import { planRows } from '../lib/phasePlan';
import { logAudit } from '../lib/audit';
import { subDisplayNames } from '../lib/subcontractor';
import { subLanguage, SUB_LANGUAGES, subScheduleMessage, prettyPhone } from '../lib/subMessages';

// Phases → "Send schedule to subs". One SMS per sub with all of its phases
// and dates on this job, in the sub's primary language, sent from the
// Twilio number. That number can't take replies, so the message is signed
// by the owner (Inácio — Ramon, 03/10) and asks the sub to answer on his
// cell. The cell comes from the owner's profile (Admin → Users), never
// from the code — the repo is public. Each text can be edited, copied (to
// send by hand) or left out before sending.
const SIGNER = 'Inácio';

// Every sub planned on the job, with its slots in date order.
function groupBySub(phases, subs) {
  const groups = new Map();
  for (const ph of phases || []) {
    for (const r of planRows(ph)) {
      if (!r.sub_id && !r.sub_name) continue;
      const key = r.sub_id || `name:${r.sub_name}`;
      if (!groups.has(key)) {
        const sub = subs.find((s) => s.id === r.sub_id) || { name: r.sub_name, contact_name: r.sub_name };
        groups.set(key, { key, sub, entries: [] });
      }
      groups.get(key).entries.push({ phase: ph.name, start_date: r.start_date, end_date: r.end_date });
    }
  }
  const first = (g) => g.entries.map((e) => e.start_date).filter(Boolean).sort()[0] || '9999';
  for (const g of groups.values()) {
    g.entries.sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'));
  }
  return [...groups.values()].sort((a, b) => first(a).localeCompare(first(b)));
}

export default function SubScheduleModal({ job, phases, subs, user, onClose }) {
  const groups = useMemo(() => groupBySub(phases, subs), [phases, subs]);
  const [replyPhone, setReplyPhone] = useState('');
  const [edited, setEdited] = useState({});      // key → text typed by hand
  const [skip, setSkip] = useState(() => new Set(groups.filter((g) => !normalizePhone(g.sub.phone)).map((g) => g.key)));
  const [status, setStatus] = useState({});      // key → 'sending' | 'sent' | error text
  const [copied, setCopied] = useState(null);
  const [sendingAll, setSendingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.from('users').select('phone').eq('role', 'owner').eq('active', true).limit(1)
      .then(({ data }) => { if (!cancelled && data?.[0]?.phone) setReplyPhone((v) => v || prettyPhone(data[0].phone)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !sendingAll) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, sendingAll]);

  const textFor = (g) => edited[g.key] ?? subScheduleMessage({
    sub: g.sub, job, entries: g.entries, signer: SIGNER, replyPhone,
  });
  const replyOk = !!normalizePhone(replyPhone);

  async function sendOne(g) {
    const to = normalizePhone(g.sub.phone);
    if (!to || !replyOk) return false;
    setStatus((s) => ({ ...s, [g.key]: 'sending' }));
    const body = textFor(g);
    const r = await sendMessage({
      to, body, channel: 'sms', user,
      meta: { jobId: job.id, subId: g.sub.id || null, kind: 'sub.schedule' },
    });
    setStatus((s) => ({ ...s, [g.key]: r.ok ? 'sent' : (r.error || 'Failed') }));
    if (r.ok) {
      logAudit({
        user, action: 'sub.schedule.sms', entityType: 'job', entityId: job.id,
        details: { sub: subDisplayNames(g.sub).primary, language: subLanguage(g.sub), phases: g.entries.map((e) => e.phase) },
      });
    }
    return r.ok;
  }

  const pending = groups.filter((g) => !skip.has(g.key) && status[g.key] !== 'sent' && normalizePhone(g.sub.phone));

  async function sendAll() {
    if (!pending.length || !replyOk) return;
    if (!window.confirm(`Send the schedule by SMS to ${pending.length} sub${pending.length === 1 ? '' : 's'}?`)) return;
    setSendingAll(true);
    for (const g of pending) await sendOne(g); // one at a time — easy on Twilio
    setSendingAll(false);
  }

  async function copy(g) {
    try {
      await navigator.clipboard.writeText(textFor(g));
      setCopied(g.key);
      setTimeout(() => setCopied((k) => (k === g.key ? null : k)), 1500);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="fixed inset-0 z-[55] bg-black/60 flex items-center justify-center p-0 sm:p-4" onClick={() => !sendingAll && onClose()}>
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-2xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-omega-stone font-semibold">Send schedule to subs</p>
            <p className="font-bold text-omega-charcoal text-lg truncate">{job.client_name}</p>
            <p className="text-xs text-omega-stone">
              SMS from the Omega number, signed by {SIGNER}, each in the sub's primary language.
            </p>
          </div>
          <button onClick={onClose} disabled={sendingAll} className="p-2 rounded-xl bg-gray-100 text-omega-stone hover:bg-gray-200 disabled:opacity-50" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-200 bg-omega-cloud/60">
          <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-1">
            {SIGNER}'s cell — where subs should reply
          </label>
          <input
            value={replyPhone}
            onChange={(e) => setReplyPhone(e.target.value)}
            placeholder="(203) 555-0100"
            inputMode="tel"
            className="w-full sm:w-64 px-3 h-10 rounded-lg border border-gray-200 bg-white text-base sm:text-sm focus:border-omega-orange focus:outline-none"
          />
          {!replyOk && (
            <p className="mt-1 text-xs text-red-600">
              Add the cell number to send — the Omega number can't receive replies. (Tip: save it in {SIGNER}'s profile under Admin → Users.)
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!groups.length && (
            <p className="text-sm text-omega-stone">No subs planned on this job yet — pick a sub on each phase first.</p>
          )}
          {groups.map((g) => {
            const { primary, secondary } = subDisplayNames(g.sub);
            const phone = normalizePhone(g.sub.phone);
            const st = status[g.key];
            const included = !skip.has(g.key);
            const lang = SUB_LANGUAGES.find((l) => l.value === subLanguage(g.sub));
            return (
              <div key={g.key} className={`rounded-xl border p-3 sm:p-4 ${st === 'sent' ? 'border-green-200 bg-green-50/50' : 'border-gray-200'} ${included ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                  <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={included}
                      disabled={!phone || st === 'sent'}
                      onChange={() => setSkip((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.key)) next.delete(g.key); else next.add(g.key);
                        return next;
                      })}
                      className="w-4 h-4 accent-omega-orange"
                    />
                    <span className="font-semibold text-omega-charcoal truncate">{primary}</span>
                    {secondary && <span className="text-xs text-omega-stone truncate">{secondary}</span>}
                  </label>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-omega-stone">{lang?.short}</span>
                  <span className={`text-xs ${phone ? 'text-omega-stone' : 'text-red-600 font-semibold'}`}>
                    {phone ? prettyPhone(g.sub.phone) : 'No phone on file'}
                  </span>
                  <span className="flex-1" />
                  {st === 'sent' && <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700"><Check className="w-4 h-4" /> Sent</span>}
                  {st && st !== 'sent' && st !== 'sending' && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600"><AlertTriangle className="w-3.5 h-3.5" /> {st}</span>
                  )}
                </div>
                <textarea
                  value={textFor(g)}
                  onChange={(e) => setEdited((m) => ({ ...m, [g.key]: e.target.value }))}
                  rows={Math.min(14, textFor(g).split('\n').length + 1)}
                  disabled={st === 'sent'}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-base sm:text-sm leading-snug text-omega-charcoal focus:border-omega-orange focus:outline-none disabled:bg-white"
                />
                <div className="flex flex-wrap justify-end gap-2 mt-2">
                  <button
                    onClick={() => copy(g)}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-omega-slate hover:border-omega-orange hover:text-omega-orange"
                  >
                    {copied === g.key ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                  <button
                    onClick={() => sendOne(g)}
                    disabled={!phone || !replyOk || st === 'sending' || st === 'sent' || sendingAll}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-omega-charcoal text-white text-xs font-bold hover:bg-black disabled:opacity-40"
                  >
                    {st === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    {st === 'sent' ? 'Sent' : 'Send SMS'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-200">
          <p className="flex-1 text-xs text-omega-stone">
            Untick a sub to leave them out (e.g. to text them yourself — use Copy).
          </p>
          <button
            onClick={sendAll}
            disabled={!pending.length || !replyOk || sendingAll}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-sm font-bold"
          >
            {sendingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send to {pending.length} sub{pending.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
