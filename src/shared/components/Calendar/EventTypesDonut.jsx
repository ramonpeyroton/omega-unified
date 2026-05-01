// EventTypesDonut — sidebar widget that breaks down events by kind
// (Sales Visit / Job Start / Service Day / Inspection / Meeting) for
// the picked time range. Donut chart on the left, legend with counts
// on the right. Pure SVG — no chart lib pulled in.
//
// Range options: This Month / This Week / Today. Each one filters
// the same `events` array the rest of the calendar already loaded.

import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import Card from '../ui/Card';
import { CATEGORY_ORDER, EVENT_CATEGORIES } from '../../lib/eventCategories';
import { EVENT_KIND_META, isoDateCT } from '../../lib/calendar';

const RANGE_OPTIONS = [
  { id: 'day',   label: 'Today' },
  { id: 'week',  label: 'This Week' },
  { id: 'month', label: 'This Month' },
];

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d;
}
function endOfWeek(date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return end;
}
function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

// Pure-SVG donut. Uses stroke-dasharray on a single circle per
// segment, rotated -90deg so the arcs start at 12 o'clock and run
// clockwise. `strokeWidth` controls the donut thickness.
function Donut({ segments, size = 132, strokeWidth = 20 }) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) {
    return (
      <div
        className="rounded-full border-[20px] border-gray-100"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }
  const r = (size - strokeWidth) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`translate(${size / 2} ${size / 2}) rotate(-90)`}>
        {/* Background ring so an empty / partial donut still looks like
            a donut, not a comet trail. */}
        <circle r={r} fill="none" stroke="#F3F4F6" strokeWidth={strokeWidth} />
        {segments.map((s, i) => {
          if (s.value <= 0) return null;
          const dash = (s.value / total) * C;
          const arc = (
            <circle
              key={i}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return arc;
        })}
      </g>
      <text
        x="50%" y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="font-black"
        style={{ fontSize: 22, fill: '#2C2C2A' }}
      >
        {total}
      </text>
    </svg>
  );
}

export default function EventTypesDonut({ events = [], referenceDate = new Date() }) {
  const [range, setRange] = useState('month');

  // Compute counts within the selected range.
  const segments = useMemo(() => {
    let from, to;
    if (range === 'day') {
      const todayIso = isoDateCT(referenceDate);
      from = new Date(`${todayIso}T00:00:00`);
      to   = new Date(`${todayIso}T23:59:59`);
    } else if (range === 'week') {
      from = startOfWeek(referenceDate);
      to   = endOfWeek(referenceDate);
    } else {
      from = startOfMonth(referenceDate);
      to   = endOfMonth(referenceDate);
    }
    const within = (events || []).filter((e) => {
      const t = new Date(e.starts_at).getTime();
      return t >= from.getTime() && t < to.getTime();
    });
    // Build one segment per category in the canonical order so the
    // donut + legend stay stable color-wise even if a kind has 0
    // events (it just contributes a 0-length arc).
    return CATEGORY_ORDER.map((key) => {
      const meta = EVENT_KIND_META[key] || EVENT_CATEGORIES[key] || { color: '#6B7280', label: key };
      const value = within.filter((e) => e.kind === key).length;
      return { key, label: meta.label || key, color: meta.color, value };
    });
  }, [events, range, referenceDate]);

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-omega-charcoal inline-flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-omega-orange" /> Event Types
        </p>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="text-[11px] font-semibold text-omega-stone bg-transparent border border-gray-200 rounded-md px-2 py-1 focus:border-omega-orange focus:outline-none"
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-4">
        <Donut segments={segments} />
        <ul className="flex-1 min-w-0 space-y-1.5">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: s.color }}
              />
              <span className="text-xs text-omega-charcoal truncate flex-1">{s.label}</span>
              <span className="text-xs font-bold text-omega-charcoal tabular-nums">{s.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
