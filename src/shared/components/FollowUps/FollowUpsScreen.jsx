// Follow Up screen (sales + owner) — every follow-up on the calendar,
// grouped by urgency:
//   red    = the day passed and nobody marked it done → reschedule it
//   yellow = this week (Mon–Sun), today included
//   green  = later
// Done ones sit in a collapsed list at the bottom (last 30 days).
// Adding / editing goes through the calendar's EventForm, so the list and
// the calendar are always the same data.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PhoneCall, Plus, CheckCircle2, CalendarClock, Pencil, Trash2, Phone, Loader2,
  AlertTriangle, ChevronDown, ChevronRight, RotateCcw, X,
} from 'lucide-react';
import EventForm from '../Calendar/EventForm';
import { isoDateCT } from '../../lib/calendar';
import { serviceBadgeLabel } from '../../data/services';
import {
  loadFollowUps, followUpBucket, isToday, markFollowUpDone, reopenFollowUp,
  rescheduleFollowUp, removeFollowUp, formatFollowUpWhen,
} from '../../lib/followUps';

const BUCKETS = {
  overdue: { title: 'Overdue — reschedule', dot: 'bg-red-500',     border: '#EF4444', chip: 'bg-red-50 text-red-700 border-red-200' },
  week:    { title: 'This week',            dot: 'bg-amber-400',   border: '#F59E0B', chip: 'bg-amber-50 text-amber-800 border-amber-200' },
  later:   { title: 'Coming up',            dot: 'bg-emerald-500', border: '#10B981', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  done:    { title: 'Done (last 30 days)',  dot: 'bg-gray-400',    border: '#9CA3AF', chip: 'bg-gray-50 text-omega-stone border-gray-200' },
};

function prettyPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (raw || '');
}

export default function FollowUpsScreen({ user, onOpenJob }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);         // { initialEvent? } — EventForm open
  const [doneFor, setDoneFor] = useState(null);
  const [moveFor, setMoveFor] = useState(null);
  const [removeFor, setRemoveFor] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setRows(await loadFollowUps()); }
    catch (e) { setError(e?.message || 'Failed to load follow-ups'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const now = new Date();
    const cutoff = Date.now() - 30 * 86_400_000;
    const g = { overdue: [], week: [], later: [], done: [] };
    for (const r of rows) {
      const b = followUpBucket(r, now);
      if (b === 'done' && (Date.parse(r.done_at || r.starts_at) || 0) < cutoff) continue;
      g[b].push(r);
    }
    g.done.sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || '')));
    return g;
  }, [rows]);

  const empty = !loading && !error && !groups.overdue.length && !groups.week.length && !groups.later.length;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {['overdue', 'week', 'later'].map((k) => (
            <span key={k} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${BUCKETS[k].chip}`}>
              <span className={`w-2 h-2 rounded-full ${BUCKETS[k].dot}`} />
              {k === 'overdue' ? 'Overdue' : k === 'week' ? 'This week' : 'Later'} · {groups[k].length}
            </span>
          ))}
          <button
            onClick={() => setForm({})}
            className="ml-auto inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold"
          >
            <Plus className="w-4 h-4" /> New follow up
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-omega-stone py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading follow-ups…
          </div>
        )}
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
          </div>
        )}
        {empty && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-10 text-center">
            <PhoneCall className="w-8 h-8 text-omega-stone mx-auto" />
            <p className="mt-3 font-bold text-omega-charcoal">No follow-ups scheduled</p>
            <p className="text-sm text-omega-stone mt-1">Add one here or pick "Follow Up" when creating a calendar event.</p>
          </div>
        )}

        {groups.overdue.length > 0 && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span><strong>{groups.overdue.length}</strong> follow-up{groups.overdue.length > 1 ? 's' : ''} passed without being marked done. Mark them done or pick a new date.</span>
          </div>
        )}

        {['overdue', 'week', 'later'].map((k) => groups[k].length > 0 && (
          <Section key={k} bucket={k} count={groups[k].length}>
            {groups[k].map((r) => (
              <FollowUpCard
                key={r.id} ev={r} bucket={k}
                onOpenJob={onOpenJob}
                onDone={() => setDoneFor(r)}
                onMove={() => setMoveFor(r)}
                onEdit={() => setForm({ initialEvent: r })}
                onRemove={() => setRemoveFor(r)}
              />
            ))}
          </Section>
        ))}

        {groups.done.length > 0 && (
          <div>
            <button
              onClick={() => setShowDone((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-omega-stone hover:text-omega-charcoal"
            >
              {showDone ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {BUCKETS.done.title} · {groups.done.length}
            </button>
            {showDone && (
              <div className="mt-3 space-y-2">
                {groups.done.map((r) => (
                  <FollowUpCard
                    key={r.id} ev={r} bucket="done"
                    onOpenJob={onOpenJob}
                    onReopen={async () => { try { await reopenFollowUp(r, user); load(); } catch (e) { setError(e?.message || 'Failed'); } }}
                    onRemove={() => setRemoveFor(r)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {form && (
        <EventForm
          user={user}
          initialKind="follow_up"
          initialEvent={form.initialEvent}
          initialIso={isoDateCT(new Date(Date.now() + 86_400_000))}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); }}
        />
      )}
      {doneFor && (
        <DoneModal
          ev={doneFor}
          onClose={() => setDoneFor(null)}
          onSave={async (note) => { await markFollowUpDone(doneFor, user, note); setDoneFor(null); load(); }}
        />
      )}
      {moveFor && (
        <RescheduleModal
          ev={moveFor}
          onClose={() => setMoveFor(null)}
          onSave={async (dateKey, hhmm) => { await rescheduleFollowUp(moveFor, user, dateKey, hhmm); setMoveFor(null); load(); }}
        />
      )}
      {removeFor && (
        <ConfirmRemove
          ev={removeFor}
          onClose={() => setRemoveFor(null)}
          onConfirm={async () => { await removeFollowUp(removeFor, user); setRemoveFor(null); load(); }}
        />
      )}
    </div>
  );
}

function Section({ bucket, count, children }) {
  const b = BUCKETS[bucket];
  return (
    <section>
      <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-omega-stone mb-2">
        <span className={`w-2.5 h-2.5 rounded-full ${b.dot}`} /> {b.title} · {count}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function FollowUpCard({ ev, bucket, onOpenJob, onDone, onMove, onEdit, onRemove, onReopen }) {
  const j = ev.job;
  const name = j?.client_name || String(ev.title || '').split(' — ')[0] || 'Client';
  const service = serviceBadgeLabel(j?.service);
  const sub = [service && service.charAt(0).toUpperCase() + service.slice(1), j?.city].filter(Boolean).join(' · ');
  const today = bucket === 'week' && isToday(ev);
  return (
    <div
      className={`bg-white rounded-2xl border border-gray-100 shadow-card p-4 ${bucket === 'done' ? 'opacity-75' : ''}`}
      style={{ borderLeftWidth: 5, borderLeftColor: BUCKETS[bucket].border }}
    >
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => j && onOpenJob?.(j)}
              className="font-bold text-omega-charcoal text-base hover:text-omega-orange text-left"
              title="Open the client card"
            >
              {name}
            </button>
            {today && <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-400 text-white">Today</span>}
            {bucket === 'overdue' && <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500 text-white">Overdue</span>}
          </div>
          <p className="text-xs text-omega-stone mt-0.5">
            <span className="font-semibold text-omega-charcoal">{formatFollowUpWhen(ev)}</span>
            {sub && <> · {sub}</>}
          </p>
          {j?.client_phone && (
            <a href={`tel:${j.client_phone}`} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange mt-1">
              <Phone className="w-3 h-3" /> {prettyPhone(j.client_phone)}
            </a>
          )}
          {ev.notes && <p className="text-sm text-omega-charcoal mt-2 whitespace-pre-wrap">{ev.notes}</p>}
          {bucket === 'done' && (
            <p className="text-xs text-omega-stone mt-2">
              ✓ Done{ev.done_by ? ` by ${ev.done_by}` : ''}{ev.done_at ? ` · ${new Date(ev.done_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
              {ev.done_note && <span className="block text-omega-charcoal mt-0.5">“{ev.done_note}”</span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {bucket === 'done' ? (
            <>
              <ActionBtn icon={RotateCcw} label="Reopen" onClick={onReopen} />
              <ActionBtn icon={Trash2} label="Remove" onClick={onRemove} danger />
            </>
          ) : (
            <>
              {bucket === 'overdue'
                ? <ActionBtn icon={CalendarClock} label="Reschedule" onClick={onMove} primary />
                : <ActionBtn icon={CheckCircle2} label="Done" onClick={onDone} primary />}
              {bucket === 'overdue'
                ? <ActionBtn icon={CheckCircle2} label="Done" onClick={onDone} />
                : <ActionBtn icon={CalendarClock} label="Reschedule" onClick={onMove} />}
              <ActionBtn icon={Pencil} label="Edit" onClick={onEdit} />
              <ActionBtn icon={Trash2} label="Remove" onClick={onRemove} danger />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick, primary, danger }) {
  const cls = primary
    ? 'bg-omega-orange hover:bg-omega-dark text-white border-omega-orange'
    : danger
      ? 'bg-white text-red-600 border-red-200 hover:bg-red-50'
      : 'bg-white text-omega-charcoal border-gray-200 hover:border-omega-orange';
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl border text-xs font-bold ${cls}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <p className="font-bold text-omega-charcoal">{title}</p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        <div className="p-5 border-t border-gray-200 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

function useSaver(fn) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (...args) => {
    setBusy(true); setErr('');
    try { await fn(...args); } catch (e) { setErr(e?.message || 'Failed to save'); setBusy(false); }
  };
  return { busy, err, run };
}

const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-gray-200 text-base sm:text-sm bg-white focus:outline-none focus:border-omega-orange';

function DoneModal({ ev, onClose, onSave }) {
  const [note, setNote] = useState('');
  const { busy, err, run } = useSaver(onSave);
  return (
    <Modal
      title={`Follow-up done — ${ev.job?.client_name || 'client'}`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 min-h-[40px] rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
        <button onClick={() => run(note)} disabled={busy} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl bg-omega-orange text-white text-sm font-bold disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Mark done
        </button>
      </>}
    >
      <label className="block text-[10px] font-semibold text-omega-stone uppercase tracking-wider">What happened? (optional)</label>
      <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} resize-none`}
        placeholder='e.g. "Spoke with him, will decide in December"' />
      <p className="text-[11px] text-omega-stone">Need another call later? Mark this one done and add a new follow-up.</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </Modal>
  );
}

function RescheduleModal({ ev, onClose, onSave }) {
  const tomorrow = isoDateCT(new Date(Date.now() + 86_400_000));
  const [dateKey, setDateKey] = useState(tomorrow);
  const [anyTime, setAnyTime] = useState(!!ev.all_day);
  const [hhmm, setHhmm] = useState(() => {
    if (ev.all_day) return '10:00';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ev.starts_at));
  });
  const { busy, err, run } = useSaver(onSave);
  return (
    <Modal
      title={`Reschedule — ${ev.job?.client_name || 'client'}`}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 min-h-[40px] rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
        <button onClick={() => run(dateKey, anyTime ? null : hhmm)} disabled={busy || !dateKey} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl bg-omega-orange text-white text-sm font-bold disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />} Save new date
        </button>
      </>}
    >
      <p className="text-xs text-omega-stone">Was: {formatFollowUpWhen(ev)}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-omega-stone uppercase tracking-wider mb-1">New date</label>
          <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-omega-stone uppercase tracking-wider mb-1">Time</label>
          <input type="time" value={hhmm} disabled={anyTime} onChange={(e) => setHhmm(e.target.value)} className={`${inputCls} disabled:bg-gray-50`} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-omega-charcoal">
        <input type="checkbox" checked={anyTime} onChange={(e) => setAnyTime(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-omega-orange" />
        Any time that day
      </label>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </Modal>
  );
}

function ConfirmRemove({ ev, onClose, onConfirm }) {
  const { busy, err, run } = useSaver(onConfirm);
  return (
    <Modal
      title="Remove follow-up?"
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 min-h-[40px] rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
        <button onClick={() => run()} disabled={busy} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Remove
        </button>
      </>}
    >
      <p className="text-sm text-omega-charcoal">
        This removes the follow-up with <strong>{ev.job?.client_name || 'this client'}</strong> ({formatFollowUpWhen(ev)}) from the list and the calendar.
      </p>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </Modal>
  );
}
