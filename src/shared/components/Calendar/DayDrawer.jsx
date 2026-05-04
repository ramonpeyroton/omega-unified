import { useEffect, useState } from 'react';
import { X, Plus, MapPin, Clock, Trash2, Edit3, User } from 'lucide-react';
import {
  EVENT_KIND_META, eventDisplayMeta, formatDateLongCT, formatTimeCT, deleteEvent, canCreateAnyEvent,
} from '../../lib/calendar';

/**
 * Slide-in drawer that lists every event for a single day + offers
 * create / edit / delete. Expects the parent to refresh its month
 * events after any mutation via `onChanged`.
 */
export default function DayDrawer({ iso, user, onClose, onCreate, onEdit, onChanged }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!iso) return;
    load();
    // eslint-disable-next-line
  }, [iso]);

  async function load() {
    setLoading(true);
    try {
      const { supabase } = await import('../../lib/supabase');
      const start = new Date(`${iso}T00:00:00-05:00`); // approximate — query is >=
      const end   = new Date(`${iso}T23:59:59-04:00`);
      const { data } = await supabase
        .from('calendar_events')
        .select('*')
        .gte('starts_at', start.toISOString())
        .lte('starts_at', end.toISOString())
        .order('starts_at', { ascending: true });
      setEvents(data || []);
    } catch { setEvents([]); }
    setLoading(false);
  }

  async function handleDelete(ev) {
    if (!confirm(`Delete "${ev.title}"?`)) return;
    try {
      await deleteEvent(ev.id);
      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
      onChanged?.();
    } catch { /* ignore */ }
  }

  // Use noon-UTC so the CT date rendering lands on the right day even
  // during DST transitions.
  const displayDate = new Date(`${iso}T12:00:00Z`);

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div
        className="w-full sm:w-[420px] h-full bg-white shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-omega-stone font-bold">Day</p>
            <p className="font-bold text-omega-charcoal text-base">{formatDateLongCT(displayDate)}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-omega-charcoal" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {canCreateAnyEvent(user?.role) && (
            <button
              onClick={() => onCreate?.(iso)}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark text-white font-bold text-sm"
            >
              <Plus className="w-4 h-4" /> Add event
            </button>
          )}

          {loading && <p className="text-sm text-omega-stone text-center py-10">Loading…</p>}

          {!loading && events.length === 0 && (
            <p className="text-sm text-omega-stone text-center py-8">No events scheduled this day.</p>
          )}

          <div className="space-y-2">
            {events.map((ev) => {
              // For sales visits, eventDisplayMeta returns the
              // visit_status color (orange/sky/lime/slate). For other
              // kinds it falls back to the kind palette.
              const meta = eventDisplayMeta(ev);
              const starts = new Date(ev.starts_at);
              const ends   = new Date(ev.ends_at);
              return (
                <div key={ev.id} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-start gap-2">
                    <span className="w-1 self-stretch rounded-full" style={{ background: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold text-omega-charcoal text-sm leading-tight">{ev.title}</p>
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded text-white flex-shrink-0"
                          style={{ background: meta.color }}
                          title={meta.statusLabel ? `${meta.label} · ${meta.statusLabel}` : meta.label}
                        >
                          {/* Show "Cancelled" / "Completed" / "Pending" instead
                              of "Sales Visit" once the receptionist tagged the
                              status — way more useful at a glance. */}
                          {meta.statusLabel || meta.label}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-omega-stone">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTimeCT(starts)} – {formatTimeCT(ends)}
                        </span>
                        {(() => {
                          // Prefer the multi-assign array (migration
                          // 036). Fall back to the scalar column for
                          // events written before that migration.
                          const names = Array.isArray(ev.assigned_to_names) && ev.assigned_to_names.length
                            ? ev.assigned_to_names
                            : (ev.assigned_to_name ? [ev.assigned_to_name] : []);
                          if (!names.length) return null;
                          return (
                            <span className="inline-flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {names.length === 1
                                ? names[0]
                                : `${names[0]} +${names.length - 1}`}
                            </span>
                          );
                        })()}
                      </div>

                      {ev.location && (
                        <p className="mt-1 text-xs text-omega-stone inline-flex items-start gap-1">
                          <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span className="break-words">{ev.location}</span>
                        </p>
                      )}
                      {ev.notes && (
                        <p className="mt-1 text-xs text-omega-slate whitespace-pre-wrap">{ev.notes}</p>
                      )}

                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => onEdit?.(ev)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-omega-charcoal hover:text-omega-orange"
                        >
                          <Edit3 className="w-3 h-3" /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(ev)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
