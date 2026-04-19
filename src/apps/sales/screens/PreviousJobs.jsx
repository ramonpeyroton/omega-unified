import { useState, useEffect } from 'react';
import { ArrowLeft, Search, Filter, Download, ChevronRight, Clock, CheckCircle, AlertCircle, FileText, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

const STATUS_CONFIG = {
  draft: { label: 'Draft', bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock },
  submitted: { label: 'Submitted', bg: 'bg-blue-100', text: 'text-blue-700', icon: FileText },
  'in-progress': { label: 'In Progress', bg: 'bg-green-100', text: 'text-green-700', icon: AlertCircle },
  completed: { label: 'Completed', bg: 'bg-gray-100', text: 'text-gray-600', icon: CheckCircle },
  negotiating: { label: 'Negotiating', bg: 'bg-purple-100', text: 'text-purple-700', icon: AlertCircle },
};

function JobCard({ job, onView }) {
  const cfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  const date = new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <button
      onClick={() => onView(job)}
      className="w-full bg-white rounded-2xl border border-gray-200 p-4 text-left hover:border-omega-orange/40 hover:shadow-sm transition-all duration-200 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-omega-orange">
              {job.client_name?.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="font-semibold text-omega-charcoal text-sm">{job.client_name}</p>
            <p className="text-xs text-omega-stone mt-0.5">{job.service}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
            <Icon className="w-3 h-3" />
            {cfg.label}
          </span>
          <span className="text-xs text-omega-fog">{date}</span>
        </div>
      </div>
      {job.address && (
        <p className="text-xs text-omega-stone mt-2.5 pl-13">{job.address}</p>
      )}
    </button>
  );
}

function ExportModal({ job, onClose }) {
  const exportText = () => {
    const lines = [
      `OMEGA DEVELOPMENT LLC — JOB REPORT`,
      `=====================================`,
      `Client: ${job.client_name}`,
      `Phone: ${job.client_phone || ''}`,
      `Address: ${job.address}`,
      `Service: ${job.service}`,
      `Status: ${job.status}`,
      `Date: ${new Date(job.created_at).toLocaleDateString()}`,
      ``,
      `REPORT:`,
      job.report_raw || 'No report generated yet.',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omega-${job.client_name?.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')}-report.txt`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white rounded-t-3xl w-full p-6 pb-8">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-omega-charcoal text-lg">Export Job</h3>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-omega-stone hover:bg-gray-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-omega-slate mb-5">
          <strong className="text-omega-charcoal">{job.client_name}</strong> — {job.service}
        </p>
        <button
          onClick={exportText}
          className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-omega-orange hover:bg-omega-pale transition-all"
        >
          <Download className="w-5 h-5 text-omega-orange" />
          <div className="text-left">
            <p className="font-semibold text-omega-charcoal text-sm">Export as Text</p>
            <p className="text-xs text-omega-stone">Downloads report as .txt file</p>
          </div>
        </button>
      </div>
    </div>
  );
}

export default function PreviousJobs({ user, onNavigate, onSelectJob }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [exportJob, setExportJob] = useState(null);
  const [toast, setToast] = useState(null);
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    try {
      const { data } = await supabase
        .from('jobs')
        .select('*')
        .eq('salesperson_name', user.name)
        .order('created_at', { ascending: false })
        .limit(100);
      setJobs(data || []);
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load jobs' });
    } finally {
      setLoading(false);
    }
  }

  const filtered = jobs.filter((j) => {
    const matchSearch =
      !search ||
      j.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      j.address?.toLowerCase().includes(search.toLowerCase()) ||
      j.service?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || j.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statuses = ['all', ...new Set(jobs.map((j) => j.status).filter(Boolean))];

  return (
    <div className="min-h-screen bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {exportJob && <ExportModal job={exportJob} onClose={() => setExportJob(null)} />}

      {/* Header */}
      <div className="bg-omega-charcoal px-5 pt-12 pb-5">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => onNavigate('home')} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-omega-fog text-xs">My Jobs</p>
            <h1 className="text-white font-bold text-lg">Previous Jobs</h1>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-stone" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, address, service..."
            className="w-full pl-10 pr-10 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-omega-stone focus:outline-none focus:border-omega-orange transition-colors text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-omega-stone">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              statusFilter === s
                ? 'bg-omega-orange text-white'
                : 'bg-white border border-gray-200 text-omega-slate'
            }`}
          >
            {s === 'all' ? 'All' : (STATUS_CONFIG[s]?.label || s)}
          </button>
        ))}
      </div>

      <div className="px-4 pb-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size={32} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <FileText className="w-12 h-12 text-omega-fog mb-3" />
            <p className="font-semibold text-omega-charcoal mb-1">No jobs found</p>
            <p className="text-sm text-omega-stone">
              {search ? 'Try a different search' : 'Start your first consultation'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-omega-stone font-medium">{filtered.length} job{filtered.length !== 1 ? 's' : ''}</p>
            {filtered.map((job) => (
              <div key={job.id} className="relative">
                <JobCard job={job} onView={onSelectJob} />
                <button
                  onClick={() => setExportJob(job)}
                  className="absolute right-4 bottom-4 p-1.5 rounded-lg bg-gray-100 hover:bg-omega-pale text-omega-stone hover:text-omega-orange transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
