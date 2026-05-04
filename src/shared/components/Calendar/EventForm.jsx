import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, Loader2, AlertTriangle, CheckCircle2, Clock, User as UserIcon, CalendarDays, MapPin, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  EVENT_KIND_OPTIONS, EVENT_KIND_META,
  VISIT_STATUS_META, VISIT_STATUS_ORDER, getVisitStatusMeta,
  composeCTDateTime, findConflict, createEvent, updateEvent,
  formatDateLongCT, formatTimeCT, eventDisplayMeta,
  buildMonthGrid, formatMonthCT, isoDateCT,
} from '../../lib/calendar';
import { logAudit } from '../../lib/audit';

const DURATION_OPTIONS = [
  { value: 15,  label: '15 minutes' },
  { value: 30,  label: '30 minutes' },
  { value: 45,  label: '45 minutes' },
  { value: 60,  label: '1 hour' },
  { value: 90,  label: '1.5 hours' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3 hours' },
  { value: 240, label: '4 hours' },
  { value: 480, label: 'All day (8h)' },
];

const DEFAULT_DURATION = 60;

function minutesBetween(a, b) {
  return Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000));
}

/**
 * Create or edit a calendar event. Validates conflicts for sales_visit
 * before saving and fires notifications (email via Resend + in-app +
 * SMS via Twilio if available) unless "Skip notifications" is checked.
 */
export default function EventForm({ user, initialIso, initialEvent, prefillJob, onClose, onSaved }) {
  const editing = !!initialEvent;

  const [kind,         setKind]         = useState(initialEvent?.kind || (prefillJob ? 'sales_visit' : 'sales_visit'));
  const [title,        setTitle]        = useState(initialEvent?.title || '');
  const [dateIso,      setDateIso]      = useState(() =>
    initialEvent?.starts_at
      ? isoCT(new Date(initialEvent.starts_at))
      : (initialIso || isoCT(new Date()))
  );
  const [timeHHMM,     setTimeHHMM]     = useState(() =>
    initialEvent?.starts_at ? hhmmCT(new Date(initialEvent.starts_at)) : '10:00'
  );
  const [durationMin,  setDurationMin]  = useState(() =>
    initialEvent
      ? minutesBetween(initialEvent.starts_at, initialEvent.ends_at)
      : DEFAULT_DURATION
  );
  // Multi-assign: an array of names. Backward compat — when editing
  // an old event we hydrate from `assigned_to_names` (new array column,
  // migration 036) if present, otherwise from the scalar
  // `assigned_to_name`. New events with a prefilled job inherit that
  // job's salesperson; otherwise the form starts empty so the user
  // explicitly picks who's going.
  const [assignedToList, setAssignedToList] = useState(() => {
    if (Array.isArray(initialEvent?.assigned_to_names) && initialEvent.assigned_to_names.length) {
      return initialEvent.assigned_to_names.filter(Boolean);
    }
    if (initialEvent?.assigned_to_name) return [initialEvent.assigned_to_name];
    if (prefillJob?.assigned_to)        return [prefillJob.assigned_to];
    return [];
  });
  // Convenience derived value used in conflict messages and the role
  // lookup. Empty string when nobody is selected.
  const assignedTo = assignedToList[0] || '';
  const [location,     setLocation]     = useState(
    initialEvent?.location || prefillJob?.address || ''
  );
  const [notes,        setNotes]        = useState(initialEvent?.notes || '');
  const [jobId,        setJobId]        = useState(initialEvent?.job_id || prefillJob?.id || null);
  const [skipNotify,   setSkipNotify]   = useState(false);
  // Sales-visit status — only meaningful when kind === 'sales_visit'.
  // Defaults to 'to_do' for new visits. Old rows that predate
  // migration 029 may not have the column populated; getVisitStatusMeta
  // falls back to 'to_do' for null/undefined.
  const [visitStatus,  setVisitStatus]  = useState(initialEvent?.visit_status || 'to_do');

  const [saving,       setSaving]       = useState(false);
  const [conflict,     setConflict]     = useState(null);
  const [toast,        setToast]        = useState(null);

  // "Existing client" picker — only used when the form was opened
  // from "+ New Event" (no prefillJob, no editing). Lists every job
  // in the catalog so the receptionist (or anyone else) can attach
  // the new event to an already-known client without re-typing
  // their name + address.
  const [jobs, setJobs] = useState([]);
  const [clientPick, setClientPick] = useState('');

  // Active staff list — drives the "Assigned to" picker. Replaces the
  // old hardcoded "Attila" placeholder so a sales visit (or any other
  // event) can be booked for whoever is the right person on the day.
  // We pull from `users` instead of hardcoding so admin-managed
  // additions show up here automatically.
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('name, role, active')
          .eq('active', true)
          .neq('role', 'admin')      // admin is hidden from public surfaces
          .order('name', { ascending: true });
        if (active) setStaff(data || []);
      } catch {
        if (active) setStaff([]);
      }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (prefillJob || editing) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, name, client_name, address, city, service')
        .order('client_name', { ascending: true })
        .limit(500);
      if (active) setJobs(data || []);
    })();
    return () => { active = false; };
  }, [prefillJob, editing]);

  function jobLabel(job) {
    const name = job.client_name || job.name || 'Untitled';
    const addr = [job.address, job.city].filter(Boolean).join(', ');
    return addr ? `${name} — ${addr}` : name;
  }

  function handlePickExistingClient(value) {
    setClientPick(value);
    if (!value) { setJobId(null); return; }
    const job = jobs.find((j) => jobLabel(j) === value);
    if (!job) return;
    setJobId(job.id);
    // Pre-fill location if user hasn't typed one yet — keeps the form
    // consistent with how prefillJob behaves.
    if (!location) setLocation(job.address || '');
    if (autoTitle) {
      const kindLabel = EVENT_KIND_META[kind]?.label || kind;
      const name = job.client_name || job.name || '';
      setTitle(name ? `${name} — ${kindLabel}` : kindLabel);
    }
  }

  // Day-schedule sidebar — events on the selected date, so Rafa can
  // see what's already booked while she fills out the form. Updates
  // whenever `dateIso` or the assignee list changes; falls back to
  // "all events for that day" when nobody is selected yet.
  const [dayEvents, setDayEvents] = useState([]);
  const [dayLoading, setDayLoading] = useState(false);
  useEffect(() => {
    if (!dateIso) { setDayEvents([]); return; }
    let active = true;
    (async () => {
      setDayLoading(true);
      try {
        // Range = full CT day, expressed as UTC iso strings.
        const startUtc = composeCTDateTime(dateIso, '00:00');
        // 24h later. We compute it without re-using composeCTDateTime
        // on '24:00' (invalid) by adding 24h to the start instant.
        const endUtc = new Date(new Date(startUtc).getTime() + 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from('calendar_events')
          .select('*')
          .gte('starts_at', startUtc)
          .lt('starts_at', endUtc)
          .order('starts_at', { ascending: true });
        if (active) setDayEvents((data || []).filter((e) => e.id !== initialEvent?.id));
      } catch {
        if (active) setDayEvents([]);
      } finally {
        if (active) setDayLoading(false);
      }
    })();
    return () => { active = false; };
  }, [dateIso, initialEvent?.id]);

  // Filter the day list down to the assignees the form is targeting,
  // so Rafa sees Attila's day when she's booking for Attila — but if
  // multiple assignees are checked, show their union. With nobody
  // assigned yet (default state for a brand-new event), keep
  // everything visible to surface any office-wide conflicts.
  const visibleDayEvents = useMemo(() => {
    if (!assignedToList.length) return dayEvents;
    const wanted = new Set(assignedToList);
    return dayEvents.filter((e) => {
      if (e.assigned_to_name && wanted.has(e.assigned_to_name)) return true;
      if (Array.isArray(e.assigned_to_names) && e.assigned_to_names.some((n) => wanted.has(n))) return true;
      return false;
    });
  }, [dayEvents, assignedToList]);

  // Auto-title when the user changes kind / job — but only if they
  // haven't typed a custom title themselves yet.
  const [autoTitle, setAutoTitle] = useState(!editing && !initialEvent?.title);

  useEffect(() => {
    if (!autoTitle) return;
    const kindLabel = EVENT_KIND_META[kind]?.label || kind;
    // Put the client name FIRST so it survives truncation on tablets
    // and is the thing the eye lands on in the month grid.
    const namePart = prefillJob
      ? (prefillJob.client_name || prefillJob.name || '')
      : '';
    setTitle(namePart ? `${namePart} — ${kindLabel}` : kindLabel);
  }, [kind, prefillJob, autoTitle]);

  async function submit() {
    if (!title.trim()) { setToast({ type: 'error', message: 'Title is required' }); return; }
    if (!dateIso || !timeHHMM) { setToast({ type: 'error', message: 'Pick a date and time' }); return; }

    setSaving(true);
    setConflict(null);
    try {
      const startsAt = composeCTDateTime(dateIso, timeHHMM);
      const endsAt   = new Date(new Date(startsAt).getTime() + durationMin * 60000).toISOString();

      // Conflict check — only for people-scheduled events (sales_visit).
      // Multi-assign: returns the first conflict across ANY of the
      // checked names so we don't silently double-book one person.
      if (kind === 'sales_visit' && assignedToList.length) {
        const hit = await findConflict({
          startsAt, endsAt,
          assignedToNames: assignedToList,
          ignoreId: initialEvent?.id,
        });
        if (hit) {
          setConflict(hit);
          setSaving(false);
          return;
        }
      }

      // For sales visits, the persisted color follows the visit_status
      // so any old read paths (calendar_events.color, etc.) stay in sync
      // with what the calendar renders. Other kinds keep their kind color.
      const persistedColor = kind === 'sales_visit'
        ? getVisitStatusMeta(visitStatus).color
        : (EVENT_KIND_META[kind]?.color || null);

      const payload = {
        kind,
        title: title.trim(),
        starts_at: startsAt,
        ends_at:   endsAt,
        all_day:   durationMin >= 480,
        job_id:    jobId || null,
        // Primary assignee (first checked) keeps the legacy column
        // populated so old filters / lookups still work. Full roster
        // goes into the new array column. Empty array → null so the
        // DB default behaves the same as "no one assigned".
        assigned_to_name:  assignedToList[0] || null,
        assigned_to_names: assignedToList.length ? assignedToList : null,
        // Role of the PRIMARY assignee, resolved from the loaded
        // staff list. Downstream targeting (notifications, jarvis
        // filters) still scopes off this single role; the additional
        // people get notified by name via assigned_to_names.
        assigned_to_role: (staff.find((u) => u.name === assignedToList[0])?.role) || null,
        location:  location || null,
        notes:     notes    || null,
        color:     persistedColor,
        // Always write visit_status — the column has a NOT NULL default
        // of 'to_do' (migration 029) so we mirror that here. Non-visit
        // events still carry the column but its value is ignored on
        // render (eventDisplayMeta short-circuits unless kind ===
        // 'sales_visit').
        visit_status: kind === 'sales_visit' ? visitStatus : 'to_do',
        created_by_name: user?.name || null,
        created_by_role: user?.role || null,
      };

      const saved = editing
        ? await updateEvent(initialEvent.id, payload)
        : await createEvent(payload);

      logAudit({
        user,
        action: editing ? 'calendar.event.update' : 'calendar.event.create',
        entityType: 'calendar_event',
        entityId: saved.id,
        details: { kind, starts_at: startsAt, assigned_to: assignedToList, job_id: jobId },
      });

      // In-app notifications — one row per assigned role so each
      // person's notification bell picks it up. Roles are de-duped
      // (e.g. two sales people on the same visit only triggers one
      // role-scoped notification).
      if (!skipNotify && assignedToList.length) {
        const roles = Array.from(new Set(
          assignedToList
            .map((n) => staff.find((u) => u.name === n)?.role)
            .filter(Boolean)
        ));
        try {
          await Promise.all(roles.map((r) =>
            supabase.from('notifications').insert([{
              job_id: jobId || null,
              recipient_role: r,
              type: 'calendar',
              title: `New ${EVENT_KIND_META[kind]?.label || 'event'}`,
              message: `${saved.title} — ${formatDateLongCT(new Date(startsAt))} at ${formatTimeCT(new Date(startsAt))}`,
              seen: false,
            }])
          ));
        } catch { /* non-fatal */ }
      }

      // Email notifications via Resend (both assignee + client if job present)
      if (!skipNotify && kind === 'sales_visit') {
        try {
          await fetch('/api/send-visit-notification', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-omega-role': user?.role || '',
              'x-omega-user': user?.name || '',
            },
            body: JSON.stringify({ eventId: saved.id }),
          });
        } catch { /* non-fatal — user sees success anyway */ }
      }

      onSaved?.(saved);
    } catch (err) {
      setToast({ type: 'error', message: err?.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-md lg:max-w-4xl max-h-[92vh] overflow-hidden shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-white p-5 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-omega-stone font-bold">Calendar</p>
            <p className="font-bold text-omega-charcoal text-base">
              {editing ? 'Edit event' : 'Add event'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-omega-charcoal" />
          </button>
        </div>

        {/* Two-column layout on desktop / iPad landscape: form on the
            left, day schedule sidebar on the right so Rafa can see
            what's already booked for the picked date without leaving
            the modal. Stacks below the form on narrow screens. */}
        <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="p-5 space-y-4">
          {prefillJob && (
            <div className="px-3 py-2 rounded-lg bg-omega-pale/60 border border-omega-orange/30">
              <p className="text-[10px] uppercase tracking-wider text-omega-orange font-bold">Job</p>
              <p className="text-sm font-bold text-omega-charcoal truncate">
                {prefillJob.client_name || prefillJob.name || 'Untitled'}
              </p>
              {prefillJob.service && (
                <p className="text-xs text-omega-stone">{prefillJob.service}</p>
              )}
            </div>
          )}

          <Field label="Event type">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={inputCls}
            >
              {EVENT_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          {/* Visit status — only meaningful when kind === 'sales_visit'.
              The receptionist tags every visit so the calendar reads at
              a glance: orange = to do, lime = pending, sky = completed,
              slate = cancelled. */}
          {kind === 'sales_visit' && (
            <Field label="Visit status">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {VISIT_STATUS_ORDER.map((s) => {
                  const meta = VISIT_STATUS_META[s];
                  const active = visitStatus === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setVisitStatus(s)}
                      className={`px-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${active ? 'text-white' : 'text-omega-charcoal hover:bg-gray-50'}`}
                      style={{
                        background: active ? meta.color : 'white',
                        border: `2px solid ${meta.color}`,
                      }}
                      title={meta.label}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {/* Existing-client picker — only when not coming in with a
              prefilled job and not in edit mode. Uses an HTML5 datalist
              so it behaves like a typical autocomplete on every browser
              and on iPad without extra deps. */}
          {!prefillJob && !editing && (
            <Field label="Existing client (optional)">
              <input
                list="omega-existing-clients"
                value={clientPick}
                onChange={(e) => handlePickExistingClient(e.target.value)}
                placeholder="Type a client name to attach to an existing job…"
                className={inputCls}
              />
              <datalist id="omega-existing-clients">
                {jobs.map((j) => (
                  <option key={j.id} value={jobLabel(j)} />
                ))}
              </datalist>
              {jobId && (
                <p className="text-[10px] text-omega-stone mt-1">
                  Linked to an existing job — title and location auto-filled.
                </p>
              )}
            </Field>
          )}

          <Field label="Title">
            <input
              value={title}
              onChange={(e) => { setAutoTitle(false); setTitle(e.target.value); }}
              className={inputCls}
              placeholder="Visit — Client Name"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <DatePickerWithDots
                value={dateIso}
                onChange={setDateIso}
                inputCls={inputCls}
              />
            </Field>
            <Field label="Time (CT)">
              <input
                type="time"
                value={timeHHMM}
                onChange={(e) => setTimeHHMM(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Duration">
            <select
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className={inputCls}
            >
              {DURATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Assigned to">
            {/* Multi-select. Active staff are loaded from the users
                table on mount, so cadastrar um user novo em Admin →
                Users já o coloca aqui automaticamente. Tap a chip to
                add/remove — the same event can be assigned to two or
                more people (e.g. Inácio + Ramon, or Attila + Gabriel).
                The first checked name persists into the legacy
                `assigned_to_name` column so old read paths keep
                working; the full list goes into `assigned_to_names`. */}
            <div className="flex flex-wrap gap-1.5 p-1">
              {staff.map((u) => {
                const checked = assignedToList.includes(u.name);
                return (
                  <button
                    key={u.name}
                    type="button"
                    onClick={() => {
                      setAssignedToList((prev) =>
                        prev.includes(u.name)
                          ? prev.filter((n) => n !== u.name)
                          : [...prev, u.name]
                      );
                    }}
                    className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
                      checked
                        ? 'bg-omega-orange text-white border-omega-orange'
                        : 'bg-white text-omega-charcoal border-gray-200 hover:border-omega-orange'
                    }`}
                  >
                    {u.name}
                    {u.role && (
                      <span className={`ml-1 text-[10px] font-semibold ${checked ? 'text-white/80' : 'text-omega-stone'}`}>
                        · {u.role}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {assignedToList.length > 0 && (
              <p className="text-[11px] text-omega-stone mt-1.5">
                {assignedToList.length === 1
                  ? `Assigned to ${assignedToList[0]}.`
                  : `${assignedToList.length} people assigned: ${assignedToList.join(', ')}.`}
              </p>
            )}
          </Field>

          <Field label="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Pre-filled from job address if applicable"
              className={inputCls}
            />
          </Field>

          <Field label="Notes (optional)">
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the assignee should know"
              className={`${inputCls} resize-none`}
            />
          </Field>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipNotify}
              onChange={(e) => setSkipNotify(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-omega-orange focus:ring-omega-orange"
            />
            <span className="text-xs text-omega-stone">
              Skip notifications (no email or SMS will be sent)
            </span>
          </label>

          {conflict && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-800">
                <p className="font-bold">Time conflict</p>
                <p className="mt-1">
                  {assignedTo} already has <strong>{conflict.title}</strong> on{' '}
                  {formatDateLongCT(new Date(conflict.starts_at))} at{' '}
                  {formatTimeCT(new Date(conflict.starts_at))}. Pick another slot.
                </p>
              </div>
            </div>
          )}

          {toast && (
            <div className={`flex items-start gap-2 p-3 rounded-xl text-xs ${
              toast.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {toast.type === 'success'
                ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
              <p className="font-semibold">{toast.message}</p>
            </div>
          )}
        </div>

        {/* ─── Right-side day schedule sidebar ─────────────────── */}
        <DaySchedule
          dateIso={dateIso}
          events={visibleDayEvents}
          loading={dayLoading}
          assignedTo={assignedToList}
        />
        </div>

        <div className="bg-white p-5 border-t border-gray-200 flex justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} disabled={saving} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-bold"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : <><Save className="w-4 h-4" /> {editing ? 'Save Changes' : 'Create Event'}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── small helpers ────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-omega-stone uppercase tracking-wider mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:border-omega-orange';

function isoCT(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal').map((p) => p.value).join('-');
}
function hhmmCT(d) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

// ─── Day schedule sidebar ────────────────────────────────────────
// Shows the existing events for the selected date with time +
// assignee + location, so Rafa can size up the day at a glance
// while she fills out the form.
function DaySchedule({ dateIso, events, loading, assignedTo }) {
  // Pretty-format the date title using the ISO without bouncing
  // through Date — avoids the same midnight-UTC pitfall that bit us
  // in MonthView. Builds a noon-UTC date so the CT formatter agrees.
  const titleDate = useMemo(() => {
    if (!dateIso) return null;
    const [y, m, d] = dateIso.split('-').map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  }, [dateIso]);

  return (
    <aside className="border-t lg:border-t-0 lg:border-l border-gray-200 bg-omega-cloud/40 p-4 flex flex-col min-h-[200px] lg:min-h-0">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="w-4 h-4 text-omega-orange" />
        <p className="text-xs font-bold uppercase tracking-wider text-omega-stone">
          {titleDate
            ? new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(titleDate)
            : 'Pick a date'}
        </p>
      </div>

      {assignedTo.length > 0 && (
        <p className="text-[10px] text-omega-stone mb-2">
          Showing for: {assignedTo.join(', ')}
        </p>
      )}

      {loading && (
        <p className="text-xs text-omega-stone italic py-2">Loading…</p>
      )}

      {!loading && events.length === 0 && (
        <p className="text-xs text-omega-stone italic py-2">
          Nothing scheduled.
        </p>
      )}

      {!loading && events.length > 0 && (
        <ul className="flex-1 overflow-auto space-y-1.5 pr-1">
          {events.map((e) => {
            const meta = eventDisplayMeta(e);
            const start = new Date(e.starts_at);
            const end = e.ends_at ? new Date(e.ends_at) : null;
            const names = Array.isArray(e.assigned_to_names) && e.assigned_to_names.length
              ? e.assigned_to_names
              : (e.assigned_to_name ? [e.assigned_to_name] : []);
            return (
              <li
                key={e.id}
                className="px-2 py-1.5 rounded-lg bg-white border border-gray-100"
                style={{ borderLeftWidth: 3, borderLeftColor: meta.color }}
              >
                <div className="inline-flex items-center gap-1.5 text-[10px] font-bold tabular-nums text-omega-stone">
                  <Clock className="w-3 h-3" />
                  {formatTimeCT(start)}
                  {end && <> – {formatTimeCT(end)}</>}
                </div>
                <p className="text-[12px] font-semibold text-omega-charcoal truncate mt-0.5">
                  {e.title || meta.label}
                </p>
                {names.length > 0 && (
                  <p className="inline-flex items-center gap-1 text-[10px] text-omega-stone mt-0.5">
                    <UserIcon className="w-2.5 h-2.5" />
                    {names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`}
                  </p>
                )}
                {e.location && (
                  <p className="inline-flex items-start gap-1 text-[10px] text-omega-stone mt-0.5">
                    <MapPin className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                    <span className="break-words">{e.location}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

// ─── Custom date picker with per-day event-count dots ───────────
// Replaces the native <input type="date">. The native browser
// picker can't be customized, but Rafa wanted to see at a glance
// which days are busy. This popover renders a Sun-first month grid
// where each cell shows up to 3 dots (the kinds of events booked
// that day, color-coded by EVENT_KIND_META). Days with 4+ events
// show "+N" so she knows it's piling up. Clicking a day fires
// onChange with the canonical YYYY-MM-DD ISO string.
function DatePickerWithDots({ value, onChange, inputCls }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Picker month / year — initialised from `value` so the popover
  // opens on the same month the input shows. Tracked in component
  // state so the user can navigate to other months without changing
  // the selected date.
  const initial = useMemo(() => {
    if (value) {
      const [y, m] = value.split('-').map(Number);
      if (y && m) return { year: y, monthIndex: m - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  }, [value]);
  const [pickerYear, setPickerYear] = useState(initial.year);
  const [pickerMonth, setPickerMonth] = useState(initial.monthIndex);

  // Re-sync the picker view if `value` changes externally (e.g.
  // user picks via prefillJob — though uncommon).
  useEffect(() => {
    if (value) {
      const [y, m] = value.split('-').map(Number);
      if (y && m) { setPickerYear(y); setPickerMonth(m - 1); }
    }
  }, [value]);

  // Click-outside-to-close.
  useEffect(() => {
    if (!open) return;
    function onDocClick(ev) {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Fetch every event in the visible month (CT) so we can render
  // dots. Only when the picker is open — no need to load otherwise.
  const [monthEvents, setMonthEvents] = useState([]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      const firstIso  = `${pickerYear}-${String(pickerMonth + 1).padStart(2, '0')}-01`;
      // First day of NEXT month — gives us the exclusive upper bound.
      const ny = pickerMonth === 11 ? pickerYear + 1 : pickerYear;
      const nm = pickerMonth === 11 ? 0 : pickerMonth + 1;
      const nextIso = `${ny}-${String(nm + 1).padStart(2, '0')}-01`;
      try {
        const startUtc = composeCTDateTime(firstIso, '00:00');
        const endUtc   = composeCTDateTime(nextIso, '00:00');
        const { data } = await supabase
          .from('calendar_events')
          .select('id, starts_at, kind')
          .gte('starts_at', startUtc)
          .lt('starts_at', endUtc);
        if (active) setMonthEvents(data || []);
      } catch {
        if (active) setMonthEvents([]);
      }
    })();
    return () => { active = false; };
  }, [open, pickerYear, pickerMonth]);

  // Map { iso → array of kind strings, max 3 kept for dot rendering }.
  const eventsByIso = useMemo(() => {
    const map = {};
    for (const e of monthEvents) {
      const iso = isoDateCT(new Date(e.starts_at));
      (map[iso] = map[iso] || []).push(e.kind);
    }
    return map;
  }, [monthEvents]);

  const cells = useMemo(() => buildMonthGrid(pickerYear, pickerMonth), [pickerYear, pickerMonth]);
  const title = formatMonthCT(new Date(Date.UTC(pickerYear, pickerMonth, 15)));
  const todayIso = isoDateCT(new Date());

  function prevMonth() {
    if (pickerMonth === 0) { setPickerYear(pickerYear - 1); setPickerMonth(11); }
    else setPickerMonth(pickerMonth - 1);
  }
  function nextMonth() {
    if (pickerMonth === 11) { setPickerYear(pickerYear + 1); setPickerMonth(0); }
    else setPickerMonth(pickerMonth + 1);
  }

  // Pretty display in the trigger button — same format the native
  // picker would show, so the visual change is minimal.
  const displayLabel = useMemo(() => {
    if (!value) return 'Pick a date';
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return value;
    const date = new Date(Date.UTC(y, m - 1, d, 12));
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }, [value]);

  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} text-left inline-flex items-center justify-between`}
      >
        <span className="truncate">{displayLabel}</span>
        <CalendarDays className="w-4 h-4 text-omega-stone flex-shrink-0 ml-2" />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 left-0 w-72 bg-white rounded-xl shadow-xl border border-gray-200 p-3"
          // Stop propagation so clicks inside don't hit the modal-
          // close (the outer modal listens to backdrop clicks).
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1 rounded-md hover:bg-omega-cloud text-omega-stone"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="text-sm font-bold text-omega-charcoal">{title}</p>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1 rounded-md hover:bg-omega-cloud text-omega-stone"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DOW.map((d, i) => (
              <div key={i} className="text-[9px] font-bold uppercase text-center text-omega-stone py-0.5">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c) => {
              const kinds = eventsByIso[c.iso] || [];
              const isToday = c.iso === todayIso;
              const isSelected = c.iso === value;
              const dotKinds = kinds.slice(0, 3);
              const extra = Math.max(0, kinds.length - 3);
              return (
                <button
                  type="button"
                  key={c.iso}
                  onClick={() => { onChange(c.iso); setOpen(false); }}
                  className={`aspect-square flex flex-col items-center justify-start pt-1 rounded-md text-[11px] font-semibold tabular-nums transition relative ${
                    isSelected
                      ? 'bg-omega-orange text-white'
                      : isToday
                        ? 'bg-omega-pale text-omega-orange ring-1 ring-omega-orange'
                        : c.isCurrentMonth
                          ? 'text-omega-charcoal hover:bg-omega-cloud'
                          : 'text-omega-fog hover:bg-omega-cloud'
                  }`}
                >
                  <span>{c.day}</span>
                  {/* Dot row — colors come from EVENT_KIND_META so a
                      sales visit (orange), job start (green), inspection
                      (amber), etc. read at a glance. Inverted to white
                      on selected day to stay visible against orange. */}
                  {kinds.length > 0 && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {dotKinds.map((k, i) => (
                        <span
                          key={i}
                          className="w-1 h-1 rounded-full"
                          style={{ background: isSelected ? '#fff' : (EVENT_KIND_META[k]?.color || '#9CA3AF') }}
                        />
                      ))}
                      {extra > 0 && (
                        <span className={`text-[8px] font-bold ${isSelected ? 'text-white' : 'text-omega-stone'}`}>
                          +{extra}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
