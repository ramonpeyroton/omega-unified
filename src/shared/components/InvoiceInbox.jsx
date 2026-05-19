// InvoiceInbox — shows emails that the Gmail AI processed but couldn't
// match with high confidence. Brenda reviews each one, confirms the
// right job (or dismisses), and the document is filed automatically.

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, AlertCircle, FileText, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/apiFetch.js';

const STATUS_META = {
  pending_review: { label: 'Needs Review',  bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  matched:        { label: 'Auto-Filed',    bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  unmatched:      { label: 'No Job Found',  bg: 'bg-gray-50',   text: 'text-gray-500',   border: 'border-gray-200'  },
  error:          { label: 'Error',         bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-200'   },
};

export default function InvoiceInbox({ user }) {
  const [rows, setRows]         = useState([]);
  const [jobs, setJobs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('pending_review');
  const [expanded, setExpanded] = useState(null);
  const [assigning, setAssigning] = useState(null); // row id being confirmed
  const [selectedJob, setSelectedJob] = useState({}); // rowId → jobId
  const [toast, setToast]       = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => { load(); }, [filter]);

  async function load() {
    setLoading(true);
    const query = supabase
      .from('email_processing_log')
      .select('*')
      .order('processed_at', { ascending: false })
      .limit(100);
    if (filter !== 'all') query.eq('status', filter);
    const { data } = await query;
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    supabase
      .from('jobs')
      .select('id, client_name, address, service')
      .not('status', 'in', '("lost","closed","declined")')
      .order('client_name')
      .then(({ data }) => setJobs(data || []));
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function checkInbox() {
    setChecking(true);
    try {
      const r = await apiFetch('/api/email/check', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) {
        showToast(d.reason === 'not_connected' ? 'Gmail not connected — set up in Admin → Company Settings' : `Error: ${d.reason || 'check failed'}`);
      } else if (d.processed === 0) {
        showToast('No new invoices found');
      } else {
        showToast(`Found ${d.processed} new invoice${d.processed !== 1 ? 's' : ''} ✓`);
        load();
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setChecking(false);
    }
  }

  async function confirmMatch(row) {
    const jobId = selectedJob[row.id] || row.job_id;
    if (!jobId) { showToast('Select a job first'); return; }
    setAssigning(row.id);
    try {
      // Find the job.
      const job = jobs.find(j => j.id === jobId);

      // Upload to job_documents.
      let photoUrl = '';
      if (row.storage_path) {
        // Copy file from inbox/ to job folder.
        const destPath = `${jobId}/invoices/${Date.now()}-${row.attachment_name || 'invoice.pdf'}`;
        await supabase.storage.from('job-documents').copy(row.storage_path, destPath);
        await supabase.storage.from('job-documents').remove([row.storage_path]);
        const { data: pub } = supabase.storage.from('job-documents').getPublicUrl(destPath);
        photoUrl = pub?.publicUrl || '';

        // Update storage_path in log.
        await supabase
          .from('email_processing_log')
          .update({ storage_path: destPath })
          .eq('id', row.id);
      }

      const { data: doc } = await supabase
        .from('job_documents')
        .insert([{
          job_id:      jobId,
          folder:      'invoices',
          title:       row.invoice_info?.invoice_number
            ? `Invoice ${row.invoice_info.invoice_number} — ${row.invoice_info.sub_company || row.from_address}`
            : `Invoice from ${row.invoice_info?.sub_company || row.from_address}`,
          photo_url:   photoUrl,
          uploaded_by: `${user?.name || 'Brenda'} (confirmed)`,
        }])
        .select('id')
        .maybeSingle();

      // Update the log row.
      await supabase
        .from('email_processing_log')
        .update({
          status:     'matched',
          job_id:     jobId,
          doc_id:     doc?.id || null,
          confidence: 1.0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      showToast(`Filed under ${job?.client_name || 'project'} ✓`);
      load();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setAssigning(null);
    }
  }

  async function dismiss(row) {
    await supabase
      .from('email_processing_log')
      .update({ status: 'unmatched', updated_at: new Date().toISOString() })
      .eq('id', row.id);
    load();
  }

  const pendingCount = rows.filter(r => r.status === 'pending_review').length;

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-omega-charcoal text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Invoice Inbox</h1>
            <p className="text-sm text-omega-slate mt-1">
              Invoices received by email — AI auto-files high-confidence matches.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <div className="bg-amber-500 text-white text-sm font-bold px-3 py-1 rounded-full">
                {pendingCount} pending
              </div>
            )}
            <button
              onClick={checkInbox}
              disabled={checking}
              className="inline-flex items-center gap-2 px-4 py-2 bg-omega-orange hover:bg-orange-600 text-white text-sm font-semibold rounded-xl disabled:opacity-60 transition"
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {checking ? 'Checking…' : 'Check Inbox'}
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { key: 'pending_review', label: 'Needs Review' },
            { key: 'matched',        label: 'Auto-Filed' },
            { key: 'all',            label: 'All' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                filter === key
                  ? 'bg-omega-orange text-white'
                  : 'bg-white text-omega-slate hover:bg-omega-cloud border border-omega-cloud'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-omega-orange" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-omega-slate">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">All caught up</p>
            <p className="text-sm mt-1">No invoices in this category.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(row => {
              const meta    = STATUS_META[row.status] || STATUS_META.unmatched;
              const isOpen  = expanded === row.id;
              const info    = row.invoice_info || {};
              const selJob  = selectedJob[row.id] || row.job_id || '';
              const isPending = row.status === 'pending_review';

              return (
                <div key={row.id} className={`bg-white rounded-2xl border ${meta.border} overflow-hidden`}>
                  {/* Row header */}
                  <div
                    className="flex items-start gap-4 px-5 py-4 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : row.id)}
                  >
                    <FileText className="w-5 h-5 text-omega-slate flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-omega-charcoal text-sm truncate">
                          {info.sub_company || row.from_address || 'Unknown sender'}
                        </span>
                        {info.invoice_number && (
                          <span className="text-xs text-omega-slate">#{info.invoice_number}</span>
                        )}
                        {info.amount && (
                          <span className="text-xs font-bold text-omega-charcoal">
                            ${Number(info.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
                          {meta.label}
                        </span>
                        {row.confidence != null && row.confidence > 0 && (
                          <span className="text-xs text-omega-slate">
                            {Math.round(row.confidence * 100)}% match
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-omega-slate mt-0.5 truncate">{row.subject}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-omega-fog">
                        {row.processed_at ? new Date(row.processed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                      </span>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-omega-slate" /> : <ChevronDown className="w-4 h-4 text-omega-slate" />}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="border-t border-omega-cloud px-5 py-4 space-y-4 bg-omega-cloud/30">
                      {/* Invoice info */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        {info.sub_company  && <Detail label="Company"     value={info.sub_company} />}
                        {info.sub_contact  && <Detail label="Contact"     value={info.sub_contact} />}
                        {info.invoice_date && <Detail label="Date"        value={info.invoice_date} />}
                        {info.description  && <Detail label="Description" value={info.description} />}
                        {row.from_address  && <Detail label="Email from"  value={row.from_address} />}
                        {row.attachment_name && <Detail label="File"      value={row.attachment_name} />}
                      </div>

                      {row.raw_snippet && (
                        <p className="text-xs text-omega-slate italic border-l-2 border-omega-cloud pl-3">
                          "{row.raw_snippet}"
                        </p>
                      )}

                      {/* Review actions */}
                      {isPending && (
                        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-omega-cloud">
                          <div className="flex-1 min-w-48">
                            <label className="text-xs font-medium text-omega-slate block mb-1">
                              File under project
                            </label>
                            <select
                              className="w-full text-sm border border-omega-cloud rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-omega-orange/30"
                              value={selJob}
                              onChange={e => setSelectedJob(prev => ({ ...prev, [row.id]: e.target.value }))}
                            >
                              <option value="">— select job —</option>
                              {jobs.map(j => (
                                <option key={j.id} value={j.id}>
                                  {j.client_name}{j.address ? ` · ${j.address}` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex gap-2 pt-4">
                            <button
                              onClick={() => confirmMatch(row)}
                              disabled={!selJob || assigning === row.id}
                              className="flex items-center gap-1.5 px-4 py-2 bg-omega-orange text-white text-sm font-semibold rounded-xl hover:bg-orange-600 disabled:opacity-40 transition"
                            >
                              {assigning === row.id
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <CheckCircle2 className="w-4 h-4" />}
                              Confirm & File
                            </button>
                            <button
                              onClick={() => dismiss(row)}
                              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-omega-cloud text-omega-slate text-sm rounded-xl hover:bg-omega-cloud transition"
                            >
                              <XCircle className="w-4 h-4" />
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Already matched — show where it was filed */}
                      {row.status === 'matched' && row.job_id && (
                        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-xl px-3 py-2">
                          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                          Filed under <strong>{jobs.find(j => j.id === row.job_id)?.client_name || 'project'}</strong>
                        </div>
                      )}

                      {row.status === 'error' && row.error_message && (
                        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          {row.error_message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs text-omega-fog uppercase tracking-wide">{label}</p>
      <p className="text-sm text-omega-charcoal font-medium truncate">{value}</p>
    </div>
  );
}
