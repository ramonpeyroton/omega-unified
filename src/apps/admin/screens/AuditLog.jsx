import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Search, Filter } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

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
                <th className="px-4 py-3 text-left">Details</th>
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
                    {r.details ? (
                      <code className="text-[10px] text-omega-slate break-all">{JSON.stringify(r.details)}</code>
                    ) : <span className="text-omega-fog">—</span>}
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
