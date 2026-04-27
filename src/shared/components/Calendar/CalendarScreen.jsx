import { useCallback, useEffect, useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { loadEventsForMonth, EVENT_KIND_META } from '../../lib/calendar';
import MonthView from './MonthView';
import DayDrawer from './DayDrawer';
import EventForm from './EventForm';

/**
 * Full calendar screen composed of the month grid, a day drawer and
 * the create/edit form dialog. Drop it inside any role's main area.
 *
 * Props:
 *   user          the current session user (for permissions + audit)
 *   initialJobForVisit   if provided, opens the EventForm immediately
 *                         pre-filled with that job (used after New Lead)
 *   onVisitScheduled  optional callback fired when the EventForm saves
 *                     successfully — used by ReceptionistApp to clear
 *                     its pending-visit banner once the visit is in
 *                     the calendar.
 */
export default function CalendarScreen({ user, initialJobForVisit = null, onVisitScheduled = null }) {
  const today = new Date();
  const [year, setYear]       = useState(today.getFullYear());
  const [monthIndex, setMonth] = useState(today.getMonth());
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);

  const [drawerIso,   setDrawerIso]   = useState(null);
  const [formState,   setFormState]   = useState(null); // { iso, prefillJob, event }

  // Auto-open EventForm when arriving from "Schedule Visit" on New Lead
  useEffect(() => {
    if (initialJobForVisit) {
      setFormState({ iso: null, prefillJob: initialJobForVisit, event: null });
    }
  }, [initialJobForVisit]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const rows = await loadEventsForMonth(year, monthIndex);
    setEvents(rows);
    setLoading(false);
  }, [year, monthIndex]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: any change to calendar_events triggers a refresh.
  useEffect(() => {
    const chan = supabase
      .channel('calendar-screen')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' },
        () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(chan); };
  }, [refresh]);

  function gotoToday() {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth());
  }

  function prevMonth() {
    if (monthIndex === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(monthIndex - 1);
  }
  function nextMonth() {
    if (monthIndex === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(monthIndex + 1);
  }

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-omega-orange" />
          <h1 className="text-xl font-bold text-omega-charcoal">Calendar</h1>
        </div>
        <p className="text-xs text-omega-stone mt-0.5">All company events — visits, job starts, inspections, meetings.</p>
      </header>

      <div className="p-4 md:p-6 space-y-4">
        <MonthView
          year={year}
          monthIndex={monthIndex}
          events={events}
          onDayClick={(iso) => setDrawerIso(iso)}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          onToday={gotoToday}
        />

        {/* Kind legend */}
        <div className="flex items-center gap-3 flex-wrap px-1">
          {Object.entries(EVENT_KIND_META).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-omega-stone font-semibold">
              <span className="w-2 h-2 rounded-full" style={{ background: v.color }} />
              {v.label}
            </span>
          ))}
          {loading && <span className="ml-auto text-[11px] text-omega-stone">Loading…</span>}
        </div>
      </div>

      {drawerIso && (
        <DayDrawer
          iso={drawerIso}
          user={user}
          onClose={() => setDrawerIso(null)}
          onCreate={(iso) => {
            setDrawerIso(null);
            setFormState({ iso, prefillJob: null, event: null });
          }}
          onEdit={(event) => {
            setDrawerIso(null);
            setFormState({ iso: null, prefillJob: null, event });
          }}
          onChanged={refresh}
        />
      )}

      {formState && (
        <EventForm
          user={user}
          initialIso={formState.iso}
          initialEvent={formState.event}
          prefillJob={formState.prefillJob}
          onClose={() => setFormState(null)}
          onSaved={(saved) => {
            setFormState(null);
            refresh();
            // Notify the parent (e.g. ReceptionistApp) that a visit was
            // scheduled so it can drop its pending-visit banner.
            onVisitScheduled?.(saved);
          }}
        />
      )}
    </div>
  );
}
