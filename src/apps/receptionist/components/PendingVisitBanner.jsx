import { CalendarPlus, X } from 'lucide-react';

// Sticky banner that surfaces when the receptionist created a lead but
// hasn't scheduled a visit yet. The banner persists across screens so
// closing the EventForm by mistake (or clicking out of the calendar)
// doesn't lose the context. It only goes away when the receptionist
// (a) successfully schedules the visit, or (b) explicitly dismisses it.
export default function PendingVisitBanner({ job, onContinue, onDismiss }) {
  if (!job) return null;
  const name = job.client_name || job.name || 'this lead';
  const service = job.service || '';
  const address = job.address || '';

  return (
    <div className="bg-omega-orange text-white px-4 sm:px-6 py-2.5 flex items-center gap-3 border-b border-omega-dark">
      <CalendarPlus className="w-5 h-5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold truncate">
          Schedule visit for {name}
        </p>
        <p className="text-[11px] opacity-90 truncate">
          {[service, address].filter(Boolean).join(' · ') || 'Click "Continue scheduling" to pick a time'}
        </p>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-omega-dark text-xs font-bold hover:bg-omega-pale transition-colors flex-shrink-0"
      >
        <CalendarPlus className="w-3.5 h-3.5" /> Continue scheduling
      </button>
      <button
        type="button"
        onClick={onContinue}
        className="sm:hidden inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-omega-dark text-xs font-bold flex-shrink-0"
        aria-label="Continue scheduling"
      >
        <CalendarPlus className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="p-1.5 rounded-lg hover:bg-white/20 transition-colors flex-shrink-0"
        title="Dismiss"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
