// Event categories — single source of truth for color, label and icon
// of every kind of calendar/job event in the app. Used by:
//   - <CategoryBadge> (labels in lists and the calendar grid)
//   - new Calendar dashboard (event pills, legend, mini-calendar)
//   - upcoming-events widgets in the right panels
//
// IMPORTANT: the keys below are the design-system keys. The actual
// values stored in `calendar_events.event_type` (migration 008) may
// differ. Whoever wires the Calendar screen to real data should pass
// the DB value through `normalizeCategoryKey()` so colors stay stable
// even if the DB uses 'sales-visit' / 'salesVisit' / etc.

import { Briefcase, Hammer, Wrench, Search, Users } from 'lucide-react';

export const EVENT_CATEGORIES = {
  sales_visit: {
    key: 'sales_visit',
    label: 'Sales Visit',
    icon: Briefcase,
    bg: 'bg-omega-event-sales-bg',
    text: 'text-omega-event-sales',
    bullet: 'bg-omega-event-sales',
  },
  job_start: {
    key: 'job_start',
    label: 'Job Start',
    icon: Hammer,
    bg: 'bg-omega-event-job-bg',
    text: 'text-omega-event-job',
    bullet: 'bg-omega-event-job',
  },
  service_day: {
    key: 'service_day',
    label: 'Service Day',
    icon: Wrench,
    bg: 'bg-omega-event-service-bg',
    text: 'text-omega-event-service',
    bullet: 'bg-omega-event-service',
  },
  inspection: {
    key: 'inspection',
    label: 'Inspection',
    icon: Search,
    bg: 'bg-omega-event-inspect-bg',
    text: 'text-omega-event-inspect',
    bullet: 'bg-omega-event-inspect',
  },
  meeting: {
    key: 'meeting',
    label: 'Meeting',
    icon: Users,
    bg: 'bg-omega-event-meeting-bg',
    text: 'text-omega-event-meeting',
    bullet: 'bg-omega-event-meeting',
  },
};

// Order used in legends and category pickers.
export const CATEGORY_ORDER = [
  'sales_visit',
  'job_start',
  'service_day',
  'inspection',
  'meeting',
];

// Normalize a DB-side value (sales-visit, salesVisit, "Sales Visit") into
// one of the canonical keys above. Falls back to sales_visit if unknown
// — log it server-side and add a new category here if it sticks.
export function normalizeCategoryKey(raw) {
  if (!raw) return 'sales_visit';
  const k = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return EVENT_CATEGORIES[k] ? k : 'sales_visit';
}

export function getEventCategory(rawOrKey) {
  return EVENT_CATEGORIES[normalizeCategoryKey(rawOrKey)];
}
