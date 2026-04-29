// Avatar — circular initial avatar used in the redesigned sidebars and
// people lists. Defaults to a brand-orange background with a single
// uppercase initial; override `color` for variations.
//
// Usage:
//   <Avatar name="Inacio" size="md" />
//   <Avatar name="Brenda" color="charcoal" size="lg" />

export default function Avatar({
  name = '',
  size = 'md',
  color = 'orange',
  className = '',
}) {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const sizes = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-12 h-12 text-base',
  };
  const colors = {
    orange:   'bg-omega-orange text-white',
    charcoal: 'bg-omega-charcoal text-white',
    fog:      'bg-omega-fog text-white',
    pale:     'bg-omega-pale text-omega-orange',
  };
  return (
    <div
      className={`inline-flex items-center justify-center font-bold rounded-full flex-shrink-0 ${
        sizes[size] ?? sizes.md
      } ${colors[color] ?? colors.orange} ${className}`}
    >
      {initial}
    </div>
  );
}
