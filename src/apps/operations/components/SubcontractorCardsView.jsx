import { useMemo, useState } from 'react';
import { Plus, HardHat, Search, X, Trash2 } from 'lucide-react';
import COIBadge from './COIBadge';
import { subDisplayNames } from '../../../shared/lib/subcontractor';

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Compact one-line cards. Click a card to open the sub's full profile
// modal (handled by the parent screen — we just bubble the click via
// onSelectSub). Agreement details live on the Agreements tab now, so
// this view stays a quick directory + click-to-drill-in.
export default function SubcontractorCardsView({ subs, agreements, jobs, onAddSub, onAddAgreement, onSelectSub, onDeleteSub }) {
  // Free-text filter — matches against contact name, company name,
  // phone, email and trade so Brenda can find a sub by anything she
  // remembers about them.
  const [searchText, setSearchText] = useState('');

  // Quick lookup: subcontractor_id → list of agreements. Used only to
  // count jobs and sum totals on each card; the actual list of
  // agreements lives on the Agreements tab now.
  const agreementsBySub = useMemo(() => {
    const map = new Map();
    (agreements || []).forEach((a) => {
      const list = map.get(a.subcontractor_id) || [];
      list.push(a);
      map.set(a.subcontractor_id, list);
    });
    return map;
  }, [agreements]);

  // Sort alphabetically by the primary display name (contact, then
  // company), then apply the search filter. Sorting first keeps the
  // visible list ordered no matter what the user types.
  const visibleSubs = useMemo(() => {
    const sorted = [...(subs || [])].sort((a, b) => {
      const an = subDisplayNames(a).primary.toLowerCase();
      const bn = subDisplayNames(b).primary.toLowerCase();
      return an.localeCompare(bn);
    });
    const q = searchText.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((s) => {
      const { primary, secondary } = subDisplayNames(s);
      const hay = [
        primary,
        secondary || '',
        s.phone || '',
        s.email || '',
        s.trade || '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [subs, searchText]);

  if (!subs || subs.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <HardHat className="w-10 h-10 text-omega-fog mx-auto mb-3" />
        <p className="text-omega-charcoal font-bold">No subcontractors yet</p>
        <p className="text-sm text-omega-stone mt-1 mb-5">
          Add your first sub from the Roster tab to start assigning them to jobs.
        </p>
        <button
          onClick={onAddSub}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold"
        >
          <Plus className="w-4 h-4" /> Add Subcontractor
        </button>
      </div>
    );
  }

  const totalAssignments = (agreements || []).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-omega-stone">
          {visibleSubs.length} of {subs.length} {subs.length === 1 ? 'subcontractor' : 'subcontractors'}
          {' · '}
          {totalAssignments} total {totalAssignments === 1 ? 'assignment' : 'assignments'}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onAddAgreement}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange text-omega-charcoal text-xs font-bold"
          >
            <Plus className="w-3.5 h-3.5" /> New Assignment
          </button>
          <button
            onClick={onAddSub}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-xs font-bold"
          >
            <Plus className="w-3.5 h-3.5" /> Add Subcontractor
          </button>
        </div>
      </div>

      {/* Search — client-side, matches contact/company/phone/email/trade.
          Cleared via the X button on the right. */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-stone pointer-events-none" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search by name, company, phone, email or trade…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-omega-orange focus:outline-none transition"
        />
        {searchText && (
          <button
            onClick={() => setSearchText('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-omega-stone hover:text-omega-charcoal"
            title="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {visibleSubs.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-omega-stone">
          No subcontractors match "{searchText}".
        </div>
      )}

      {visibleSubs.map((sub) => {
        const subAgreements = agreementsBySub.get(sub.id) || [];
        const totalValue = subAgreements.reduce((sum, a) => sum + (Number(a.their_estimate) || 0), 0);
        const completedCount = subAgreements.filter((a) => a.status === 'completed' || a.status === 'signed').length;
        const { primary, secondary } = subDisplayNames(sub);

        // Whole card is clickable — opens the sub's profile. Edit Sub
        // moved into the profile modal so the card stays clean. Layout
        // per Ramon's spec:
        //   left  : contact (bold) · company (normal) · COI badge
        //   right : trade · total $ · jobs count
        // role="button" on a <div> instead of a real <button>: COIBadge
        // and the inner layout use <div>s and React warns at runtime when
        // <button> contains block-level descendants. Keyboard handler
        // mirrors a button so it stays accessible.
        return (
          <div
            key={sub.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectSub?.(sub)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectSub?.(sub); } }}
            className="cursor-pointer bg-white rounded-xl border border-gray-200 hover:border-omega-orange hover:shadow-sm transition-colors px-4 py-2.5 flex items-center gap-3"
          >
            <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-omega-charcoal truncate">{primary}</span>
              {secondary && (
                <span className="text-sm text-omega-stone truncate">{secondary}</span>
              )}
              <COIBadge expiryDate={sub.coi_expiry_date} />
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {sub.trade && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-omega-stone bg-omega-cloud border border-gray-200 px-1.5 py-0.5 rounded">
                  {sub.trade}
                </span>
              )}
              <div className="text-right">
                <div className="text-sm font-black text-omega-charcoal tabular-nums leading-tight">{money(totalValue)}</div>
                <div className="text-[10px] text-omega-stone leading-tight">
                  {completedCount}/{subAgreements.length} {subAgreements.length === 1 ? 'job' : 'jobs'}
                </div>
              </div>
              {onDeleteSub && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteSub(sub); }}
                  className="p-1.5 rounded-lg text-omega-stone hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Delete subcontractor"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
