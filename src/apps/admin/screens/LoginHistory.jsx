// Admin → Login History. Lists login sessions recorded by the
// daily-owner-update ?task=login endpoint: who signed in, when, from
// what device, and where (IP + IP-geo city/region/country).
//
// Forensic helpers: each row is flagged "New location" / "New device"
// the first time that user appears from a given city / device — so a
// login from somewhere a user has never been (e.g. an ex-employee from
// home) jumps out instead of hiding in the list.
//
// Reads public.user_sessions via the anon key (RLS allows SELECT only;
// the table is append-only — see migration 070).

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, MapPin, Monitor, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

const MAX_ROWS = 5000;
const RANGE_OPTIONS = [
  { value: '1w',  label: 'Last 7 days',   days: 7 },
  { value: '4w',  label: 'Last 4 weeks',  days: 28 },
  { value: '3m',  label: 'Last 3 months', days: 90 },
  { value: '1y',  label: 'Last 12 months', days: 365 },
  { value: 'all', label: 'All time',      days: null },
];

function fmtLocation(r) {
  const parts = [r.city, r.region, r.country].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

export default function LoginHistory() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [dateRange, setDateRange] = useState('4w');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dateRange]);

  async function load() {
    setLoading(true);
    try {
      let query = supabase
        .from('user_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS);
      const days = RANGE_OPTIONS.find((r) => r.value === dateRange)?.days;
      if (days) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('created_at', since);
      }
      const { data, error } = await query;
      if (error) throw error;
      setRows(data || []);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load login history' });
    } finally {
      setLoading(false);
    }
  }

  // Flag the first appearance of each (user, city) and (user, device)
  // within the loaded window. Computed oldest→newest so "new" means new
  // relative to earlier logins in view.
  const flagged = useMemo(() => {
    const asc = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const seenCity = new Map();   // user -> Set(city)
    const seenDevice = new Map(); // user -> Set(device)
    const flags = new Map();      // id -> { newLocation, newDevice }
    for (const r of asc) {
      const u = r.user_name || 'unknown';
      const cities = seenCity.get(u) || new Set();
      const devices = seenDevice.get(u) || new Set();
      const cityKey = (r.city || '').toLowerCase();
      const devKey = (r.device || '').toLowerCase();
      const newLocation = !!cityKey && cities.size > 0 && !cities.has(cityKey);
      const newDevice = !!devKey && devices.size > 0 && !devices.has(devKey);
      if (cityKey) cities.add(cityKey);
      if (devKey) devices.add(devKey);
      seenCity.set(u, cities);
      seenDevice.set(u, devices);
      flags.set(r.id, { newLocation, newDevice });
    }
    return flags;
  }, [rows]);

  const roleOpts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.user_role).filter(Boolean))).sort(),
    [rows]
  );

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterRole !== 'all' && r.user_role !== filterRole) return false;
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      const hay = `${r.user_name || ''} ${r.user_role || ''} ${r.device || ''} ${fmtLocation(r)} ${r.ip || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [rows, filterRole, searchText]);

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Login History</h1>
            <p className="text-sm text-omega-stone mt-1">
              {RANGE_OPTIONS.find((r) => r.value === dateRange)?.label} · {rows.length} login{rows.length === 1 ? '' : 's'}
              {rows.length >= MAX_ROWS && ' (showing first 5,000)'}
            </p>
          </div>
          <button onClick={load} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-omega-charcoal hover:border-omega-orange">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone" />
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search user, device, location, IP…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm" />
          </div>
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
            {RANGE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
            <option value="all">All roles</option>
            {roleOpts.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </header>

      <div className="p-6 md:p-8">
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">When</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Device</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-omega-stone">
                  No logins recorded in this range. Sessions are captured on each sign-in.
                </td></tr>
              )}
              {filtered.map((r) => {
                const f = flagged.get(r.id) || {};
                return (
                  <tr key={r.id} className={`hover:bg-omega-cloud/40 ${(f.newLocation || f.newDevice) ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-4 py-3 text-xs text-omega-stone whitespace-nowrap">
                      {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 font-medium text-omega-charcoal">{r.user_name || '—'}</td>
                    <td className="px-4 py-3 text-xs">{r.user_role || '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <Monitor className="w-3.5 h-3.5 text-omega-stone" /> {r.device || '—'}
                      </span>
                      {f.newDevice && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                          <ShieldAlert className="w-3 h-3" /> New device
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-omega-stone" /> {fmtLocation(r)}
                      </span>
                      {f.newLocation && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                          <ShieldAlert className="w-3 h-3" /> New location
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-omega-stone">{r.ip || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-omega-stone mt-3">
          Location is approximate (IP-based, city level). “New location / device” flags the first time a user
          appears from that city / device within the selected range.
        </p>
      </div>
    </div>
  );
}
