// IconChip — small rounded square holding a Lucide icon, tinted with a
// soft pastel background. Used to mark sections in the new dashboards
// (e.g. the calendar header tile, "Today" widget tile, etc.).
//
// Pass any Lucide icon as the `icon` prop. Pick a `color` from the
// palette; defaults to brand orange.

export default function IconChip({
  icon: Icon,
  color = 'orange',
  size = 'md',
  className = '',
}) {
  const palettes = {
    orange:  'bg-omega-pale text-omega-orange',
    green:   'bg-omega-event-job-bg text-omega-event-job',
    blue:    'bg-omega-event-service-bg text-omega-event-service',
    yellow:  'bg-omega-event-inspect-bg text-omega-event-inspect',
    purple:  'bg-omega-event-meeting-bg text-omega-event-meeting',
    neutral: 'bg-omega-cloud text-omega-charcoal',
  };
  const sizes = {
    sm: 'w-8 h-8 rounded-lg',
    md: 'w-10 h-10 rounded-xl',
    lg: 'w-12 h-12 rounded-2xl',
  };
  const iconSizes = { sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-6 h-6' };
  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 ${
        sizes[size] ?? sizes.md
      } ${palettes[color] ?? palettes.orange} ${className}`}
    >
      {Icon ? <Icon className={iconSizes[size] ?? iconSizes.md} /> : null}
    </div>
  );
}
