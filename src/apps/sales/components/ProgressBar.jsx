export default function ProgressBar({ current, total, label }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between mb-1.5">
          <span className="text-xs font-medium text-omega-stone">{label}</span>
          <span className="text-xs font-semibold text-omega-orange">{pct}%</span>
        </div>
      )}
      <div className="h-1.5 bg-omega-fog/30 rounded-full overflow-hidden">
        <div
          className="h-full bg-omega-orange rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
