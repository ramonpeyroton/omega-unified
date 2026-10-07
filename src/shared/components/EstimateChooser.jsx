// First step of the Estimate tab: start a NEW estimate or pick an existing
// one. Before this, the builder always opened the job's latest estimate and
// the only way to start another was "Bundle with another service" — which
// tied new work to an already-approved estimate (Anthony Wills, 07/10).
//
// Approved / signed estimates are listed view-only: the client signed that
// version, so the builder never opens them for editing from here.

import { Plus, Lock, Eye, PencilLine, FileText } from 'lucide-react';

// The client already signed (or the row was replaced by a newer one) —
// the builder shows it read-only and never saves over it.
export function isEstimateLocked(e) {
  return !!e && (e.status === 'approved' || e.status === 'signed' || e.status === 'superseded' || !!e.signed_at);
}

const MODE_LABEL = { breakdown: 'Breakdown Price', section: 'Price by Section', single: 'Single Price' };

const STATUS_LOOK = {
  draft:             { text: 'Draft',             cls: 'bg-omega-pale text-omega-orange' },
  sent:              { text: 'Sent',              cls: 'bg-blue-50 text-blue-700' },
  changes_requested: { text: 'Changes requested', cls: 'bg-amber-50 text-amber-700' },
  rejected:          { text: 'Rejected',          cls: 'bg-gray-100 text-omega-stone' },
  superseded:        { text: 'Superseded',        cls: 'bg-gray-100 text-omega-stone' },
  approved:          { text: 'Approved',          cls: 'bg-green-50 text-green-700' },
};

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function shortDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// What to call an estimate in the list: its bundle / option name, else the
// top description, else its first line items.
function estimateTitle(e) {
  if (e.bundle_label) return e.bundle_label;
  if (e.option_label && e.option_label !== 'Option 1') return e.option_label;
  const desc = (e.header_description || '').trim().replace(/\s+/g, ' ');
  if (desc) return desc.length > 60 ? `${desc.slice(0, 57)}…` : desc;
  const items = (e.sections || [])
    .flatMap((s) => (s.items || []).map((it) => (it.description || '').trim()))
    .filter(Boolean);
  if (items.length) return items.slice(0, 4).join(', ') + (items.length > 4 ? '…' : '');
  return 'Untitled estimate';
}

function statusOf(e) {
  if (e.status === 'superseded') return STATUS_LOOK.superseded;
  if (isEstimateLocked(e)) return STATUS_LOOK.approved;
  return STATUS_LOOK[e.status] || STATUS_LOOK.draft;
}

// One row per estimate — except alternatives (same group) and multi-service
// bundles, which are sent together and show as a single row.
export function buildEstimateEntries(estimates) {
  const list = estimates || [];
  const count = (field, value) => list.filter((e) => e[field] === value).length;
  const byKey = new Map();
  for (const e of list) {
    const key = e.bundle_id && count('bundle_id', e.bundle_id) > 1 ? `b:${e.bundle_id}`
      : e.group_id && count('group_id', e.group_id) > 1 ? `g:${e.group_id}`
      : `e:${e.id}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }

  return [...byKey.entries()].map(([key, rawMembers]) => {
    const kind = key[0] === 'b' ? 'bundle' : key[0] === 'g' ? 'options' : 'single';
    const members = [...rawMembers].sort((a, b) =>
      kind === 'options'
        ? (a.option_order ?? 0) - (b.option_order ?? 0)
        : String(a.created_at).localeCompare(String(b.created_at)));
    const first = members[0];
    const lockedCount = members.filter(isEstimateLocked).length;
    // Alternatives close as soon as the client signs one of them; bundle
    // members are approved one by one.
    const locked = kind === 'options' ? lockedCount > 0 : lockedCount === members.length;
    const lastActivity = members
      .map((m) => m.updated_at || m.created_at || '')
      .sort()
      .pop();

    let title; let status; let total; let detail; let viewUrl;
    if (kind === 'single') {
      title = estimateTitle(first);
      status = statusOf(first);
      total = money(first.total_amount);
      detail = isEstimateLocked(first) && first.status !== 'superseded'
        ? `Approved${first.signed_by ? ` by ${first.signed_by}` : ''} · ${shortDate(first.signed_at || first.approved_at)}`
        : `Last saved ${shortDate(first.updated_at || first.created_at)}`;
      detail = `${MODE_LABEL[first.display_mode] || MODE_LABEL.breakdown} · ${detail}`;
      viewUrl = `/estimate-view/${first.id}`;
    } else if (kind === 'options') {
      title = `${members.length} options — ${members.map((m) => m.option_label || '—').join(' / ')}`;
      status = locked ? STATUS_LOOK.approved : statusOf(first);
      const totals = members.map((m) => Number(m.total_amount) || 0);
      const lo = Math.min(...totals); const hi = Math.max(...totals);
      total = lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
      const chosen = members.find(isEstimateLocked);
      detail = chosen ? `Client chose ${chosen.option_label || 'an option'}` : 'Client picks one';
      viewUrl = `/estimate-options/${first.group_id}`;
    } else {
      title = `${members.length} services — ${members.map((m) => m.bundle_label || `#${m.estimate_number}`).join(', ')}`;
      status = locked
        ? STATUS_LOOK.approved
        : lockedCount
          ? { text: `${lockedCount} of ${members.length} approved`, cls: 'bg-amber-50 text-amber-700' }
          : statusOf(first);
      total = money(members.reduce((s, m) => s + (Number(m.total_amount) || 0), 0));
      detail = 'Bundle — client approves each service on its own';
      viewUrl = `/estimate-bundle/${first.bundle_id}`;
    }

    return {
      key,
      kind,
      numbers: members.map((m) => (m.estimate_number ? `#${m.estimate_number}` : 'No #')).join(kind === 'bundle' ? ' + ' : ' / '),
      title,
      status,
      total,
      detail,
      locked,
      viewUrl,
      // Open the first member that can still be edited.
      openId: (members.find((m) => !isEstimateLocked(m)) || first).id,
      lastActivity,
    };
  }).sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)));
}

export default function EstimateChooser({ estimates, onNew, onOpen }) {
  const entries = buildEstimateEntries(estimates);
  const anyLocked = entries.some((e) => e.locked);

  return (
    <div className="bg-white rounded-xl border-2 border-omega-orange p-4 sm:p-5">
      <p className="text-[11px] font-bold text-omega-charcoal uppercase tracking-wider inline-flex items-center gap-1.5 flex-wrap">
        <span className="w-5 h-5 rounded-full bg-omega-orange text-white text-[10px] font-black inline-flex items-center justify-center">✦</span>
        Estimates for this job
        <span className="text-omega-orange font-semibold normal-case tracking-normal">— start a new one or pick one to continue</span>
      </p>

      <button
        type="button"
        onClick={onNew}
        className="mt-4 w-full flex items-center gap-4 p-4 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-left transition-colors"
      >
        <span className="w-11 h-11 rounded-xl bg-white/20 inline-flex items-center justify-center flex-shrink-0">
          <Plus className="w-6 h-6" />
        </span>
        <span className="flex-1">
          <span className="block text-base font-black">New Estimate</span>
          <span className="block text-xs text-white/85 mt-0.5">
            A separate estimate for new work on this job — its own number, sent and approved on its own.
          </span>
        </span>
      </button>

      <p className="mt-5 mb-2 text-[10px] font-bold text-omega-stone uppercase tracking-wider">Existing estimates</p>
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
        {entries.map((e) => (
          <div
            key={e.key}
            className={`flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 py-3 ${e.locked ? 'bg-gray-50' : 'bg-white'}`}
          >
            <span className={`w-10 h-10 rounded-lg inline-flex items-center justify-center flex-shrink-0 ${
              e.locked ? 'bg-green-50 text-green-700' : 'bg-omega-pale text-omega-orange'
            }`}>
              {e.locked ? <Lock className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-omega-charcoal">
                {e.numbers} · {e.title}
                <span className={`ml-2 align-middle px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${e.status.cls}`}>
                  {e.status.text}
                </span>
              </p>
              <p className="text-xs text-omega-stone mt-0.5">{e.detail}</p>
            </div>
            <p className="text-base font-black text-omega-charcoal tabular-nums ml-14 sm:ml-0 whitespace-nowrap">{e.total}</p>
            {e.locked ? (
              <a
                href={e.viewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-bold text-omega-slate hover:border-omega-orange w-full sm:w-44 justify-center"
                title="Open the version the client signed"
              >
                <Eye className="w-4 h-4" /> View
              </a>
            ) : (
              <button
                type="button"
                onClick={() => onOpen(e.openId)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 border-omega-orange text-omega-orange hover:bg-omega-pale text-sm font-bold w-full sm:w-44 justify-center"
              >
                <PencilLine className="w-4 h-4" /> Continue editing
              </button>
            )}
          </div>
        ))}
      </div>
      {anyLocked && (
        <p className="mt-2 text-[11px] text-omega-stone inline-flex items-center gap-1.5">
          <Lock className="w-3 h-3 flex-shrink-0" /> Approved estimates are locked — the client signed that version. Use New Estimate for extra work.
        </p>
      )}
    </div>
  );
}
