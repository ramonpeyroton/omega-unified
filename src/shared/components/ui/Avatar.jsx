// Avatar — circular initial avatar used in the redesigned sidebars and
// people lists. Defaults to a brand-orange background with a single
// uppercase initial; override `color` for variations.
//
// Two ways to set the color:
//   1. Pass a key from the palette below ("orange", "blue", "fog", …).
//   2. For chat-style "one color per person" UX, pass colorFromName(name)
//      — a deterministic hash that maps a string to one of 8 stable
//      hues. Same name → same color across renders / sessions.
//
// Usage:
//   <Avatar name="Inacio" size="md" />
//   <Avatar name="Brenda" color="charcoal" size="lg" />
//   <Avatar name={user.name} color={colorFromName(user.name)} />

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
    // Brand / utility colors.
    orange:   'bg-omega-orange text-white',
    charcoal: 'bg-omega-charcoal text-white',
    fog:      'bg-omega-fog text-white',
    pale:     'bg-omega-pale text-omega-orange',
    // Distinct hues used by colorFromName(). Picked for accessible
    // contrast against white text and good differentiation from each
    // other at a glance — the chat lists 5–10 people, this is enough
    // bandwidth to spot "this row is a different person" instantly.
    blue:     'bg-blue-500 text-white',
    green:    'bg-emerald-500 text-white',
    purple:   'bg-violet-500 text-white',
    pink:     'bg-pink-500 text-white',
    teal:     'bg-teal-500 text-white',
    amber:    'bg-amber-500 text-white',
    indigo:   'bg-indigo-500 text-white',
    red:      'bg-red-500 text-white',
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

// Palette used by colorFromName. Order matters — adding a new entry
// in the middle would shuffle every existing user's color, so always
// append to the end.
const NAME_PALETTE = [
  'orange', 'blue', 'green', 'purple',
  'pink', 'teal', 'amber', 'indigo',
];

/**
 * Map a name (or any string) to a stable color key from the palette
 * above. Same input always returns the same color. djb2-ish hash
 * keeps it tiny and dependency-free.
 *
 * Empty / non-string input falls back to "fog" so anonymous rows
 * (no author resolved yet) read as muted instead of taking up a
 * "real person" hue slot.
 */
export function colorFromName(name) {
  if (!name || typeof name !== 'string') return 'fog';
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return 'fog';
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) {
    h = ((h << 5) - h) + trimmed.charCodeAt(i);
    h |= 0; // force int32
  }
  return NAME_PALETTE[Math.abs(h) % NAME_PALETTE.length];
}
