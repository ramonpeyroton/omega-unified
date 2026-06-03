// PageHeader — single header used across every secondary screen in
// each role app. Replaces the four different headers Sales had grown
// over time (white-thin with back, dark charcoal, custom per screen,
// no header at all).
//
// Layout (left to right):
//   [back]  [icon] [title] [subtitle]                       [actions]
//
// Behaviour:
//   · onBack renders an ArrowLeft → Home button when provided. Hidden
//     on the main screen (e.g. dashboard).
//   · icon renders a small chip (uses IconChip's color tokens) so the
//     screen identity is scannable from the corner of the eye.
//   · subtitle is optional, displayed under the title on desktop and
//     hidden on phone (header height stays tight).
//   · actions slot on the right for any per-screen buttons.
//   · sticky top-0 so it stays visible on scroll.

import { ArrowLeft } from 'lucide-react';

export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  onBack,
  backLabel = 'Home',
  actions,
  // Sticky by default. Callers that already own a separate sticky element
  // below the header (e.g. PipelineKanban's sticky search) pass false so the
  // header scrolls away and doesn't sit on top of that element.
  sticky = true,
  className = '',
}) {
  return (
    <header
      className={`${sticky ? 'sticky top-0' : ''} z-20 bg-white border-b border-omega-cloud px-4 sm:px-6 py-3 flex items-center gap-3 ${className}`}
    >
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm font-semibold text-omega-stone hover:text-omega-charcoal transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> {backLabel}
        </button>
      )}

      {Icon && (
        <div className="w-9 h-9 rounded-xl bg-omega-pale text-omega-orange flex items-center justify-center flex-shrink-0 ml-1">
          <Icon className="w-4 h-4" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <h1 className="text-base sm:text-lg font-bold text-omega-charcoal truncate leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="hidden sm:block text-xs text-omega-stone mt-0.5 truncate">
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
