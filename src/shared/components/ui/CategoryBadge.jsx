// CategoryBadge — colored pill that labels what kind of calendar event
// (or job, or visit) something is. Pulls cosmetics from EVENT_CATEGORIES
// in src/shared/lib/eventCategories.js so the colors stay consistent
// across dashboards, lists, and the calendar grid.
//
// Usage:
//   <CategoryBadge category="sales_visit" />            // uses default label
//   <CategoryBadge category="job_start" label="Start" /> // override label
//   <CategoryBadge category="meeting" size="sm" />

import { getEventCategory } from '../../lib/eventCategories';

export default function CategoryBadge({
  category,
  label,
  size = 'md',
  className = '',
}) {
  const cat = getEventCategory(category);
  const sizes = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-[11px] px-2.5 py-0.5 gap-1.5',
    lg: 'text-xs px-3 py-1 gap-1.5',
  };
  const dotSizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-1.5 h-1.5',
    lg: 'w-2 h-2',
  };
  return (
    <span
      className={`inline-flex items-center font-semibold uppercase tracking-wide rounded-full ${
        sizes[size] ?? sizes.md
      } ${cat.bg} ${cat.text} ${className}`}
    >
      <span className={`rounded-full ${cat.bullet} ${dotSizes[size] ?? dotSizes.md}`} />
      {label ?? cat.label}
    </span>
  );
}
