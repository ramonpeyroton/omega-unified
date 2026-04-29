// PillToggle — segmented control with a soft track and a raised "active"
// pill (Apple-style). Used for view switchers like Month / Week / Timeline.
//
// Usage:
//   <PillToggle
//     options={[
//       { value: 'month', label: 'Month' },
//       { value: 'week',  label: 'Week' },
//       { value: 'timeline', label: 'Timeline' },
//     ]}
//     value={view}
//     onChange={setView}
//   />

export default function PillToggle({
  options = [],
  value,
  onChange,
  className = '',
}) {
  return (
    <div
      className={`inline-flex items-center bg-omega-cloud rounded-xl p-1 border border-black/[0.04] ${className}`}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(opt.value)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${
              active
                ? 'bg-white text-omega-charcoal shadow-pill'
                : 'text-omega-stone hover:text-omega-charcoal'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
