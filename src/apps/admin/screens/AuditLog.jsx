import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Search, Filter, Code2, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { PIPELINE_STEP_LABEL } from '../../../shared/config/phaseBreakdown';
import { FOLDER_LABELS } from '../../../shared/lib/documentClassifier';

// ─── Detail formatters ────────────────────────────────────────────
// Renders a row's `details` JSON as plain English instead of raw blob.
// We cover the high-frequency actions explicitly; everything else
// falls back to a tidy key:value chip layout.
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function phaseLabel(slug) { return PIPELINE_STEP_LABEL[slug] || slug || '—'; }
function folderLabel(slug) { return FOLDER_LABELS[slug] || slug || '—'; }
function quote(s) { return s ? `"${s}"` : ''; }

const FORMATTERS = {
  'user.login':   (d) => `Signed in${d?.role ? ` as ${d.role}` : ''}${d?.remember ? ' (remember me)' : ''}.`,
  'user.logout':  ()  => 'Signed out.',

  'job.move':     (d) => `Moved ${quote(d?.client) || 'job'} on the pipeline: ${phaseLabel(d?.from)} → ${phaseLabel(d?.to)}${d?.source ? ` · via ${d.source}` : ''}.`,
  'job.create':   (d) => `Created job for ${quote(d?.client_name) || 'a new client'}${d?.source ? ` · source: ${d.source}` : ''}.`,
  'job.delete':   (d) => `Deleted job for ${quote(d?.client) || 'a client'}${d?.service ? ` (${d.service})` : ''}${d?.pipeline_status ? ` · was at ${phaseLabel(d.pipeline_status)}` : ''}${d?.authorized_by ? ` · authorized by ${d.authorized_by}` : ''}.`,

  'document.move':    (d) => `Moved ${quote(d?.title) || 'a file'} from ${folderLabel(d?.from)} → ${folderLabel(d?.to)}.`,
  'document.delete':  (d) => `Deleted ${quote(d?.title) || 'a file'}${d?.folder ? ` from ${folderLabel(d.folder)}` : ''}.`,
  'document.create':  (d) => `Added ${quote(d?.title) || 'a file'}${d?.folder ? ` to ${folderLabel(d.folder)}` : ''}.`,
  'document.bulk_upload':        (d) => `Bulk uploaded ${d?.uploaded ?? 0}/${d?.attempted ?? 0} files.`,
  'document.legacy_bulk_import': (d) => `Legacy import: ${d?.uploaded ?? 0} files uploaded across ${d?.groupsMatched ?? 0} clients${d?.clientsCreated ? `, ${d.clientsCreated} new client${d.clientsCreated === 1 ? '' : 's'} created` : ''}${d?.errored ? ` · ${d.errored} errors` : ''}${d?.stoppedAtCap ? ' · stopped at cost cap' : ''}.`,

  'milestone.delete':  (d) => `Removed milestone ${quote(d?.label) || ''} (${money(d?.amount)}).`,
  'milestone.create':  (d) => `Added milestone ${quote(d?.label) || ''} (${money(d?.amount)}).`,
  'milestone.update':  (d) => `Updated milestone ${quote(d?.label) || ''}.`,
  'payment.received':  (d) => `Recorded payment of ${money(d?.amount)}${d?.newStatus ? ` · status now ${d.newStatus}` : ''}.`,
  'sub_payment.paid':  (d) => `Paid sub ${money(d?.amount)}${d?.newStatus ? ` · status ${d.newStatus}` : ''}.`,

  'invoice.sent':    (d) => `Sent invoice to client${d?.docId ? '.' : '.'}`,
  'invoice.resent':  ()  => 'Re-sent invoice to client.',

  'pipeline.transition': (d) => `Moved to ${phaseLabel(d?.to)}.`,
  'pipeline.complete':   ()  => 'All installments received — job marked completed.',

  'contract.send':           ()  => 'Contract sent via DocuSign.',
  'contract.sign':           ()  => 'Contract signed by client.',
  'contract.manual_sign':    ()  => 'Contract marked as signed manually.',
  'contract.invoice_sent':   (d) => `Deposit invoice sent (${money(d?.deposit)}).`,

  'estimate.approve':         (d) => `Approved estimate${d?.total ? ` (${money(d.total)})` : ''}.`,
  'estimate.reject':          ()  => 'Estimate marked as rejected.',
  'estimate.request_changes': (d) => `Requested changes${d?.text ? `: ${quote(d.text)}` : ''}.`,

  'bank_account.create':     (d) => `Created bank account ${quote(d?.name) || ''}.`,
  'bank_account.update':     (d) => `Updated bank account ${quote(d?.name) || ''}.`,
  'bank_account.deactivate': (d) => `Deactivated bank account ${quote(d?.name) || ''}.`,
  'bank_account.activate':   (d) => `Reactivated bank account ${quote(d?.name) || ''}.`,

  'receipt.capture': (d) => `Captured material receipt of ${money(d?.amount)}${d?.has_photo ? ' with a photo' : ''}.`,
};

// Generic fallback — renders details as compact chips. Skips a handful
// of noisy keys (PINs, remember, internal ids) that don't help a human.
const NOISY_KEYS = new Set(['remember', 'pin_used', 'authorized_by_role', 'job_id']);
function GenericDetails({ details }) {
  if (!details || typeof details !== 'object') return null;
  const entries = Object.entries(details).filter(([k, v]) => !NOISY_KEYS.has(k) && v !== null && v !== '');
  if (entries.length === 0) return <span className="text-omega-fog">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-omega-cloud text-[11px]">
          <span className="text-omega-stone">{k}:</span>
          <span className="font-mono text-omega-slate truncate max-w-[14rem]">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </span>
        </span>
      ))}
    </div>
  );
}

function FormattedDetails({ action, details }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!details) return <span className="text-omega-fog">—</span>;
  const fn = FORMATTERS[action];
  return (
    <div className="space-y-1">
      <div className="text-omega-charcoal text-[12px] leading-snug">
        {fn ? fn(details) : <GenericDetails details={details} />}
      </div>
      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] text-omega-stone hover:text-omega-charcoal"
        title="Toggle raw JSON for debugging"
      >
        <Code2 className="w-3 h-3" />
        {showRaw ? 'Hide raw' : 'Raw JSON'}
        <ChevronDown className={`w-3 h-3 transition-transform ${showRaw ? 'rotate-180' : ''}`} />
      </button>
      {showRaw && (
        <code className="block text-[10px] text-omega-slate break-all bg-omega-cloud rounded px-2 py-1 font-mono">
          {JSON.stringify(details)}
        </code>
      )}
    </div>
  );
}

const PAGE_SIZE = 100;

export default function AuditLog() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterAction, setFilterAction] = useState('all');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      setRows(data || []);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load audit log' });
    } finally {
      setLoading(false);
    }
  }

  const roleOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.user_role).filter(Boolean))).sort(), [rows]);
  const actionOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.action).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterRole !== 'all' && r.user_role !== filterRole) return false;
    if (filterAction !== 'all' && r.action !== filterAction) return false;
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      const hay = `${r.user_name || ''} ${r.action || ''} ${r.entity_type || ''} ${JSON.stringify(r.details || {})}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [rows, filterRole, filterAction, searchText]);

  function actionBadgeColor(action) {
    if (!action) return 'bg-gray-100 text-gray-700';
    if (action.startsWith('user.')) return 'bg-blue-50 text-blue-700 border-blue-200';
    if (action.startsWith('job.')) return 'bg-omega-pale text-omega-orange border-omega-orange/30';
    if (action.startsWith('estimate.')) return 'bg-purple-50 text-purple-700 border-purple-200';
    if (action.startsWith('contract.')) return 'bg-amber-50 text-amber-700 border-amber-200';
    if (action.startsWith('change_order.')) return 'bg-red-50 text-red-700 border-red-200';
    if (action.startsWith('company.')) return 'bg-gray-50 text-gray-700 border-gray-200';
    if (action.startsWith('pricing.')) return 'bg-green-50 text-green-700 border-green-200';
    return 'bg-gray-100 text-gray-700 border-gray-200';
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Audit Log</h1>
            <p className="text-sm text-omega-stone mt-1">Last {PAGE_SIZE} events — who did what and when</p>
          </div>
          <button onClick={load} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-omega-charcoal hover:border-omega-orange">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone" />
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search user, action, details…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm" />
          </div>
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
            <option value="all">All roles</option>
            {roleOpts.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
            <option value="all">All actions</option>
            {actionOpts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </header>

      <div className="p-6 md:p-8">
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Timestamp</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Entity</th>
                <th className="px-4 py-3 text-left">What happened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-omega-stone">
                  No audit events match the filters. Actions are logged as they happen.
                </td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-omega-cloud/40">
                  <td className="px-4 py-3 text-xs text-omega-stone whitespace-nowrap">
                    {r.timestamp ? new Date(r.timestamp).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 font-medium text-omega-charcoal">{r.user_name || '—'}</td>
                  <td className="px-4 py-3 text-xs">{r.user_role || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded border ${actionBadgeColor(r.action)}`}>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.entity_type && <span className="font-semibold">{r.entity_type}</span>}
                    {r.entity_id && <div className="text-[10px] font-mono text-omega-stone">{r.entity_id.slice(0, 8)}…</div>}
                  </td>
                  <td className="px-4 py-3 text-xs max-w-md">
                    <FormattedDetails action={r.action} details={r.details} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
