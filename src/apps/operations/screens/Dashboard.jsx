import { useState, useEffect, useMemo } from 'react';
import { Briefcase, FileText, FilePen, ShieldAlert, Search, RefreshCw, Eye, Send, FileSignature, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import COIBadge, { getCoiState } from '../components/COIBadge';
import JobFullView from '../../../shared/components/JobFullView';

function KpiCard({ icon: Icon, label, value, color = 'text-omega-orange' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl bg-omega-pale flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-omega-stone uppercase tracking-wider font-semibold">{label}</p>
        <p className="text-2xl font-bold text-omega-charcoal mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function maskTaxId(taxId) {
  if (!taxId) return '—';
  const s = String(taxId);
  if (s.length <= 4) return '••••';
  return '•'.repeat(s.length - 4) + s.slice(-4);
}

export default function Dashboard({ onOpenEstimate, onNavigate, user }) {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [subs, setSubs] = useState([]);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('pipeline');
  const [openJob, setOpenJob] = useState(null);

  // filters (pipeline tab)
  const [filterEstimate, setFilterEstimate] = useState('all');
  const [filterContract, setFilterContract] = useState('all');
  const [filterCity, setFilterCity] = useState('');
  const [filterPm, setFilterPm] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [{ data: j }, { data: e }, { data: c }, { data: s }] = await Promise.all([
        supabase.from('jobs').select('*').order('created_at', { ascending: false }),
        supabase.from('estimates').select('*').order('created_at', { ascending: false }),
        supabase.from('contracts').select('*').order('created_at', { ascending: false }),
        supabase.from('subcontractors').select('*').order('name'),
      ]);
      setJobs(j || []);
      setEstimates(e || []);
      setContracts(c || []);
      setSubs(s || []);
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load data' });
    } finally {
      setLoading(false);
    }
  }

  // KPIs — reads primarily from `pipeline_status` (canonical) and falls back
  // to legacy signals so old data still counts. COI counts subs expiring
  // within the next 30 days (not yet expired).
  const kpis = useMemo(() => {
    // Active = anything in the pipeline except completed or on_hold
    const DONE = new Set(['completed', 'on_hold']);
    const activeJobs = jobs.filter((j) => {
      const ps = j.pipeline_status || 'new_lead';
      return !DONE.has(ps);
    }).length;

    // Estimates pending approval — from job pipeline_status OR estimate status
    const pendingEstJobs = new Set(
      jobs.filter((j) => j.pipeline_status === 'estimate_sent').map((j) => j.id)
    );
    estimates.forEach((e) => {
      if (['sent', 'pending'].includes((e.status || '').toLowerCase())) {
        pendingEstJobs.add(e.job_id);
      }
    });
    const estPending = pendingEstJobs.size;

    // Contracts awaiting signature — from job pipeline_status OR contract status
    const awaitingJobs = new Set(
      jobs.filter((j) => j.pipeline_status === 'contract_sent').map((j) => j.id)
    );
    contracts.forEach((c) => {
      const st = (c.status || '').toLowerCase();
      const ds = (c.docusign_status || '').toLowerCase();
      const signed = !!c.signed_at || st === 'signed' || ds === 'completed' || ds === 'signed';
      const sentNotSigned = !signed && (st === 'sent' || ds === 'sent' || st === 'pending');
      if (sentNotSigned) awaitingJobs.add(c.job_id);
    });
    const ctrAwaiting = awaitingJobs.size;

    // COI expiring in the next 30 days (not yet expired)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirty = new Date(today); thirty.setDate(thirty.getDate() + 30);
    const coiExpiring = subs.filter((s) => {
      if (!s.coi_expiry_date) return false;
      const d = new Date(s.coi_expiry_date);
      return d >= today && d <= thirty;
    }).length;

    return { activeJobs, estPending, ctrAwaiting, coiExpiring };
  }, [jobs, estimates, contracts, subs]);

  // Job pipeline rows (join estimate + contract)
  const pipelineRows = useMemo(() => {
    const estByJob = Object.fromEntries(estimates.map((e) => [e.job_id, e]));
    const ctrByJob = Object.fromEntries(contracts.map((c) => [c.job_id, c]));
    return jobs
      .map((j) => ({
        job: j,
        estimate: estByJob[j.id] || null,
        contract: ctrByJob[j.id] || null,
      }))
      .filter(({ estimate, contract, job }) => {
        if (filterEstimate !== 'all' && (estimate?.status || 'none') !== filterEstimate) return false;
        if (filterContract !== 'all' && (contract?.status || 'none') !== filterContract) return false;
        if (filterCity && !(job.city || job.address || '').toLowerCase().includes(filterCity.toLowerCase())) return false;
        if (filterPm && !(job.pm_name || '').toLowerCase().includes(filterPm.toLowerCase())) return false;
        return true;
      });
  }, [jobs, estimates, contracts, filterEstimate, filterContract, filterCity, filterPm]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Operations Dashboard</h1>
            <p className="text-sm text-omega-stone mt-1">Estimates, contracts, subs and pipeline overview</p>
          </div>
          <button
            onClick={loadAll}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </header>

      {/* KPIs */}
      <div className="px-6 md:px-8 pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Briefcase} label="Total Active Jobs" value={kpis.activeJobs} />
        <KpiCard icon={FileText} label="Estimates Pending" value={kpis.estPending} />
        <KpiCard icon={FilePen} label="Contracts Awaiting Signature" value={kpis.ctrAwaiting} />
        <KpiCard icon={ShieldAlert} label="COI Expiring Soon" value={kpis.coiExpiring} color="text-red-500" />
      </div>

      {/* Tabs */}
      <div className="px-6 md:px-8 mt-6">
        <div className="border-b border-gray-200 flex gap-1 overflow-x-auto">
          {[
            { id: 'pipeline', label: 'Job Pipeline' },
            { id: 'subs', label: 'Subcontractors' },
            { id: 'estimates', label: 'Estimates' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-omega-orange text-omega-orange'
                  : 'border-transparent text-omega-stone hover:text-omega-charcoal'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-6 md:p-8 pt-4">
        {tab === 'pipeline' && (
          <div className="bg-white rounded-xl border border-gray-200">
            {/* filters */}
            <div className="p-4 border-b border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-3">
              <select value={filterEstimate} onChange={(e) => setFilterEstimate(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
                <option value="all">All Estimate Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="none">No Estimate</option>
              </select>
              <select value={filterContract} onChange={(e) => setFilterContract(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
                <option value="all">All Contract Statuses</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="signed">Signed</option>
                <option value="declined">Declined</option>
                <option value="none">No Contract</option>
              </select>
              <input placeholder="City…" value={filterCity} onChange={(e) => setFilterCity(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              <input placeholder="PM…" value={filterPm} onChange={(e) => setFilterPm(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Job</th>
                    <th className="px-4 py-3 text-left">Client</th>
                    <th className="px-4 py-3 text-left">City</th>
                    <th className="px-4 py-3 text-left">Service</th>
                    <th className="px-4 py-3 text-left">Estimate</th>
                    <th className="px-4 py-3 text-left">Contract</th>
                    <th className="px-4 py-3 text-left">PM</th>
                    <th className="px-4 py-3 text-left">Start</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pipelineRows.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-omega-stone">No jobs match your filters.</td></tr>
                  )}
                  {pipelineRows.map(({ job, estimate, contract }) => (
                    <tr key={job.id} className="hover:bg-omega-cloud/40">
                      <td className="px-4 py-3 font-medium text-omega-charcoal">{job.client_name || job.name || '—'}</td>
                      <td className="px-4 py-3">{job.client_name || '—'}</td>
                      <td className="px-4 py-3">{job.city || job.address || '—'}</td>
                      <td className="px-4 py-3">{job.service || '—'}</td>
                      <td className="px-4 py-3">{estimate ? <StatusBadge status={estimate.status} /> : <span className="text-omega-fog text-xs">—</span>}</td>
                      <td className="px-4 py-3">{contract ? <StatusBadge status={contract.docusign_status || contract.status} /> : <span className="text-omega-fog text-xs">—</span>}</td>
                      <td className="px-4 py-3">{job.pm_name || '—'}</td>
                      <td className="px-4 py-3">{job.start_date ? new Date(job.start_date).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3">{job.status || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setOpenJob(job)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange hover:text-omega-dark"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'subs' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Trade</th>
                  <th className="px-4 py-3 text-left">Tax ID</th>
                  <th className="px-4 py-3 text-left">COI</th>
                  <th className="px-4 py-3 text-left">Expiry</th>
                  <th className="px-4 py-3 text-left">Active Jobs</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subs.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-omega-stone">No subcontractors yet.</td></tr>
                )}
                {subs.map((s) => (
                  <tr key={s.id} className="hover:bg-omega-cloud/40">
                    <td className="px-4 py-3 font-medium text-omega-charcoal">{s.name}</td>
                    <td className="px-4 py-3">{s.trade || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{maskTaxId(s.tax_id)}</td>
                    <td className="px-4 py-3"><COIBadge expiryDate={s.coi_expiry_date} /></td>
                    <td className="px-4 py-3">{s.coi_expiry_date ? new Date(s.coi_expiry_date).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">{s.active_jobs_count ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => onNavigate('subcontractors')} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange hover:text-omega-dark"><Eye className="w-3.5 h-3.5" /> View</button>
                        <button onClick={() => onNavigate('subcontractors')} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-info hover:text-blue-900"><Upload className="w-3.5 h-3.5" /> COI</button>
                        <button onClick={() => onNavigate('subcontractors')} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-success hover:text-green-900"><Send className="w-3.5 h-3.5" /> Agreement</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'estimates' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Job</th>
                  <th className="px-4 py-3 text-left">Amount</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Created By</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {estimates.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-omega-stone">No estimates yet.</td></tr>
                )}
                {estimates.map((e) => {
                  const job = jobs.find((j) => j.id === e.job_id);
                  return (
                    <tr key={e.id} className="hover:bg-omega-cloud/40">
                      <td className="px-4 py-3 font-medium text-omega-charcoal">{job?.client_name || job?.name || '—'}</td>
                      <td className="px-4 py-3">{e.total_amount != null ? `$${Number(e.total_amount).toLocaleString()}` : '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={e.status} /></td>
                      <td className="px-4 py-3">{e.created_by_name || e.created_by || '—'}</td>
                      <td className="px-4 py-3">{new Date(e.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button onClick={() => job && onOpenEstimate(job)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange hover:text-omega-dark"><Eye className="w-3.5 h-3.5" /> View</button>
                          <button onClick={() => job && onOpenEstimate(job)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-info hover:text-blue-900"><Send className="w-3.5 h-3.5" /> Send</button>
                          <button onClick={() => job && onOpenEstimate(job)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-success hover:text-green-900"><FileSignature className="w-3.5 h-3.5" /> Contract</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openJob && (
        <JobFullView
          job={openJob}
          user={user}
          onClose={() => setOpenJob(null)}
          onJobUpdated={(updated) => {
            setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
            setOpenJob(updated);
          }}
          onJobDeleted={(deleted) => {
            setJobs((prev) => prev.filter((j) => j.id !== deleted.id));
            setOpenJob(null);
          }}
          onOpenEstimateFlow={onOpenEstimate}
        />
      )}
    </div>
  );
}
