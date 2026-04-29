// MonthView — full month grid with the redesigned look:
//   • soft white card, rounded-2xl, no per-cell borders (just dividers)
//   • events render as soft "pills" tinted with the category color
//   • today gets a circular orange badge for its number plus an
//     orange ring on the cell itself
//   • header has a small calendar IconChip + month label + Today button + chevrons
//
// Public surface unchanged from the previous version: same props,
// same buildMonthGrid + EVENT_KIND_META imports. CalendarScreen
// can swap this in without touching its own logic.

import { useMemo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import {
  buildMonthGrid, formatMonthCT, EVENT_KIND_META, isoDateCT,
} from '../../lib/calendar';
import IconChip from '../ui/IconChip';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Parse "Client — Sales Visit" or "Sales Visit — Client" into a
// {primary, secondary} pair so the pill can show the client in bold
// and the kind label below in the category color.
function parseEventTitle(rawTitle, kindLabel) {
  const title = (rawTitle || '').trim();
  if (!kindLabel) return { primary: title, secondary: '' };
  const dash = ' — ';
  if (title.toLowerCase().startsWith(kindLabel.toLowerCase() + dash)) {
    return { primary: title.slice(kindLabel.length + dash.length), secondary: kindLabel };
  }
  if (title.toLowerCase().endsWith(dash + kindLabel.toLowerCase())) {
    return { primary: title.slice(0, -kindLabel.length - dash.length), secondary: kindLabel };
  }
  return { primary: title, secondary: '' };
}

// Wraps an event pill with the @dnd-kit draggable hook. Drag-and-drop
// is enabled through `canDragEvent` — when not allowed (the user's role
// can't edit that event's kind) the pill falls back to a plain div.
function DraggablePill({ event, canDrag, children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `evt:${event.id}`,
    data: { event },
    disabled: !canDrag,
  });
  const style = {
    touchAction: canDrag ? 'none' : undefined,
    cursor: canDrag ? (isDragging ? 'grabbing' : 'grab') : 'default',
    opacity: isDragging ? 0.4 : 1,
    ...(transform
      ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
      : {}),
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

// Wraps a day cell with the @dnd-kit droppable hook. Drag-over state
// adds a soft orange ring so the user can see which cell would receive
// the event if they let go right now.
function DroppableCell({ iso, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${iso}`, data: { iso } });
  return (
    <div ref={setNodeRef} className={isOver ? 'ring-2 ring-omega-orange ring-inset' : ''}>
      {children}
    </div>
  );
}

export default function MonthView({
  year, monthIndex, events, onDayClick, onPrevMonth, onNextMonth, onToday,
  canDragEvent = () => false,
}) {
  const cells = useMemo(() => buildMonthGrid(year, monthIndex), [year, monthIndex]);
  const todayIso = isoDateCT(new Date());

  const byDay = useMemo(() => {
    const map = {};
    for (const e of events || []) {
      const iso = isoDateCT(new Date(e.starts_at));
      (map[iso] = map[iso] || []).push(e);
    }
    // Sort each day's events by start time so the pills come out in order.
    for (const iso of Object.keys(map)) {
      map[iso].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    }
    return map;
  }, [events]);

  const title = formatMonthCT(new Date(Date.UTC(year, monthIndex, 15)));

  return (
    <div className="bg-white rounded-2xl shadow-card border border-black/[0.04] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <IconChip icon={CalendarDays} color="orange" size="sm" />
          <h2 className="text-base sm:text-lg font-bold text-omega-charcoal">{title}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToday}
            className="px-3 py-1.5 rounded-lg bg-omega-cloud text-xs font-semibold text-omega-charcoal hover:bg-omega-pale hover:text-omega-orange transition"
          >
            Today
          </button>
          <button
            onClick={onPrevMonth}
            aria-label="Previous month"
            className="p-1.5 rounded-lg text-omega-stone hover:bg-omega-cloud hover:text-omega-charcoal transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onNextMonth}
            aria-label="Next month"
            className="p-1.5 rounded-lg text-omega-stone hover:bg-omega-cloud hover:text-omega-charcoal transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-gray-100">
        {DOW.map((d) => (
          <div
            key={d}
            className="text-[10px] uppercase tracking-widest font-bold text-omega-stone text-center py-2.5"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((c, idx) => {
          const dayEvents = byDay[c.iso] || [];
          const visible = dayEvents.slice(0, 3);
          const extra = Math.max(0, dayEvents.length - visible.length);
          const isToday = c.iso === todayIso;

          // Subtle dividers between cells (right + bottom). Last column
          // and last row skip them so the card edge stays clean.
          const isLastCol = (idx + 1) % 7 === 0;
          const isLastRow = idx >= 35;

          return (
            <DroppableCell key={c.iso} iso={c.iso}>
              <div
                onClick={() => onDayClick?.(c.iso, dayEvents)}
                className={`group relative min-h-[92px] sm:min-h-[110px] p-2 text-left transition cursor-pointer ${
                  c.isCurrentMonth ? 'bg-white' : 'bg-omega-cloud/40'
                } ${isLastCol ? '' : 'border-r border-gray-100'} ${
                  isLastRow ? '' : 'border-b border-gray-100'
                } ${isToday ? 'ring-1 ring-inset ring-omega-orange/60' : 'hover:bg-omega-cloud/60'}`}
              >
              <div className="flex items-center justify-between">
                {isToday ? (
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-omega-orange text-white text-[11px] font-bold tabular-nums">
                    {c.day}
                  </span>
                ) : (
                  <span
                    className={`text-xs font-semibold tabular-nums ${
                      c.isCurrentMonth ? 'text-omega-charcoal' : 'text-omega-fog'
                    }`}
                  >
                    {c.day}
                  </span>
                )}
              </div>

              <div className="mt-1.5 space-y-1">
                {visible.map((e) => {
                  const meta = EVENT_KIND_META[e.kind] || { color: '#6B7280', label: e.kind };
                  const { primary, secondary } = parseEventTitle(e.title, meta.label);
                  return (
                    <DraggablePill key={e.id} event={e} canDrag={canDragEvent(e)}>
                      <div
                        className="flex items-start gap-1.5 px-1.5 py-1 rounded-md overflow-hidden"
                        style={{ background: meta.color + '1F' /* ~12% */ }}
                        title={e.title}
                      >
                      <span
                        className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: meta.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] leading-tight font-semibold text-omega-charcoal truncate">
                          {primary}
                        </p>
                        {secondary && (
                          <p
                            className="text-[9px] leading-tight font-bold uppercase tracking-wider truncate mt-0.5"
                            style={{ color: meta.color }}
                          >
                            {secondary}
                          </p>
                        )}
                      </div>
                      </div>
                    </DraggablePill>
                  );
                })}
                {extra > 0 && (
                  <p className="text-[10px] font-bold text-omega-orange pl-1">+{extra} more</p>
                )}
              </div>
              </div>
            </DroppableCell>
          );
        })}
      </div>
    </div>
  );
}
