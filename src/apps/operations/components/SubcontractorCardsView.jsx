import { useMemo } from 'react';
import { Plus, HardHat, Phone, Mail, MapPin, CheckCircle2, Clock, DollarSign, Edit3 } from 'lucide-react';
import COIBadge, { getCoiState } from './COIBadge';
import { subDisplayNames } from '../../../shared/lib/subcontractor';

// Agreement status palette mirrors the chip style used elsewhere.
const AGR_STATUS_META = {
  draft:     { label: 'DRAFT',     cls: 'bg-gray-200 text-gray-700' },
  sent:      { label: 'SENT',      cls: 'bg-blue-100 text-blue-700' },
  accepted:  { label: 'ACCEPTED',  cls: 'bg-green-100 text-green-700' },
  rejected:  { label: 'REJECTED',  cls: 'bg-red-100 text-red-700' },
  signed:    { label: 'SIGNED',    cls: 'bg-emerald-600 text-white' },
  completed: { label: 'DONE',      cls: 'bg-emerald-700 text-white' },
};

function paymentLabel(plan) {
  if (!Array.isArray(plan) || plan.length === 0) return 'TBD';
  if (plan.length === 1) return '100% on completion';
  if (plan.length === 2 && Number(plan[0]?.percent) === 50) return '50 / 50';
  return plan.map((p) => `${p.percent}%`).join(' / ');
}

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// One big card per sub, listing every agreement (job assignment)
// underneath. Brenda asked for this layout so she can see at a glance
// what each sub has done, what is pending, and how each one is being
// paid:
//   Ramon Glass
//     • 484 Bridgeport Ave: Install shower glass — DONE — multiple — $4,200
//     • 902 Black Rock: Install window glass — TODO — 50/50 — $1,800
export default function SubcontractorCardsView({ subs, agreements, jobs, onAddSub, onAddAgreement, onEditSub }) {
  const jobsById = useMemo(() => {
    const map = new Map();
    (jobs || []).forEach((j) => map.set(j.id, j));
    return map;
  }, [jobs]);

  // Group agreements by sub_id so each card shows only its own jobs.
  const agreementsBySub = useMemo(() => {
    const map = new Map();
    (agreements || []).forEach((a) => {
      const list = map.get(a.subcontractor_id) || [];
      list.push(a);
      map.set(a.subcontractor_id, list);
    });
    // Newest job at the top of each card.
    for (const [k, list] of map) {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      map.set(k, list);
    }
    return map;
  }, [agreements]);

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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-omega-stone">
          {subs.length} {subs.length === 1 ? 'subcontractor' : 'subcontractors'}
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

      {subs.map((sub) => {
        const subAgreements = agreementsBySub.get(sub.id) || [];
        const totalValue = subAgreements.reduce((sum, a) => sum + (Number(a.their_estimate) || 0), 0);
        const completedCount = subAgreements.filter((a) => a.status === 'completed' || a.status === 'signed').length;
        // Per Ramon: contact name is what the field crew recognizes day
        // to day, so it leads the card. Company name (if any) drops to
        // a secondary line below in muted text.
        const { primary, secondary } = subDisplayNames(sub);

        return (
          <div key={sub.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Sub header */}
            <div className="px-5 py-4 border-b border-gray-100 bg-omega-cloud/40">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold text-omega-charcoal">{primary}</h3>
                    {sub.trade && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-omega-stone bg-white border border-gray-200 px-2 py-0.5 rounded">
                        {sub.trade}
                      </span>
                    )}
                    <COIBadge expiryDate={sub.coi_expiry_date} />
                  </div>
                  {secondary && (
                    <p className="text-xs text-omega-stone mt-0.5 truncate">{secondary}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-omega-stone flex-wrap">
                    {sub.phone && (
                      <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {sub.phone}</span>
                    )}
                    {sub.email && (
                      <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> {sub.email}</span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-omega-stone">Total assigned</div>
                  <div className="text-xl font-black text-omega-charcoal tabular-nums">{money(totalValue)}</div>
                  <div className="text-[10px] text-omega-stone mt-0.5">
                    {completedCount} of {subAgreements.length} {subAgreements.length === 1 ? 'job' : 'jobs'} done
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => onEditSub(sub)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 hover:border-omega-orange text-xs font-bold text-omega-charcoal"
                >
                  <Edit3 className="w-3 h-3" /> Edit Sub
                </button>
              </div>
            </div>

            {/* Assignment rows */}
            {subAgreements.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-omega-stone">
                <Clock className="w-5 h-5 text-omega-fog mx-auto mb-2" />
                No assignments yet.
              </div>
            )}

            {subAgreements.map((agr) => {
              const job = jobsById.get(agr.job_id);
              const meta = AGR_STATUS_META[agr.status] || { label: (agr.status || 'DRAFT').toUpperCase(), cls: 'bg-gray-200 text-gray-700' };
              const isDone = agr.status === 'completed' || agr.status === 'signed';
              const address = job?.address || 'Unknown address';
              const clientName = job?.client_name || '';

              return (
                <div key={agr.id} className="px-5 py-3 border-t border-gray-100 hover:bg-omega-pale/20">
                  <div className="flex items-start gap-3">
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Clock className="w-5 h-5 text-omega-stone flex-shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-omega-charcoal inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-omega-stone" /> {address}
                          {clientName && (
                            <span className="text-omega-stone font-normal">— {clientName}</span>
                          )}
                        </p>
                        <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-xs text-omega-slate mt-0.5 whitespace-pre-line line-clamp-2">{agr.scope_of_work}</p>
                      <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-omega-stone">
                        {agr.their_estimate > 0 && (
                          <span className="inline-flex items-center gap-1 font-bold text-omega-charcoal">
                            <DollarSign className="w-3 h-3" /> {money(agr.their_estimate)}
                          </span>
                        )}
                        <span>Payment: <strong className="text-omega-charcoal">{paymentLabel(agr.payment_plan)}</strong></span>
                        {agr.signed_at && (
                          <span>Signed {new Date(agr.signed_at).toLocaleDateString()}</span>
                        )}
                        {agr.start_date && (
                          <span>Start {new Date(agr.start_date).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
