import { useState, useEffect, useMemo } from 'react';
import { Users, Calendar, Send, X, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

function buildDefaultMessage(job, phases, nextDate) {
  const completed = phases.filter((p) => p.status === 'completed').length;
  const total = phases.length || 1;
  const pct = Math.round((completed / total) * 100);
  return (
`Hi ${job.client_name || 'there'},

Quick update on your project at ${job.address || job.city || ''}:

• Progress: ${pct}% complete (${completed}/${total} phases done)
• Next milestone: ${nextDate || 'TBD'}

Let me know if you have any questions.

— Omega Team`
  );
}

export default function ProjectPipeline({ user }) {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [phasesByJob, setPhasesByJob] = useState({});
  const [assignmentsByJob, setAssignmentsByJob] = useState({});
  const [toast, setToast] = useState(null);

  const [updateFor, setUpdateFor] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  useEffect(() => { loadAll(); loadTemplates(); }, []);

  async function loadTemplates() {
    try {
      const { data } = await supabase
        .from('message_templates')
        .select('*')
        .order('category')
        .order('name');
      setTemplates(data || []);
    } catch { /* table may not exist — graceful */ }
  }

  function applyTemplate(id) {
    setSelectedTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    let msg = tpl.message || '';
    // Simple placeholder fills
    if (updateFor) {
      msg = msg
        .replaceAll('[Client Name]', updateFor.client_name || 'there')
        .replaceAll('[Address]', updateFor.address || updateFor.city || '')
        .replaceAll('[Phase]', (phasesByJob[updateFor.id] || []).find((p) => p.status !== 'completed')?.name || 'current phase');
    }
    setMessage(msg);
  }

  async function loadAll() {
    setLoading(true);
    try {
      const { data: activeJobs } = await supabase
        .from('jobs')
        .select('*')
        .in('status', ['in_progress', 'in-progress', 'negotiating'])
        .order('created_at', { ascending: false });

      const rows = activeJobs || [];
      setJobs(rows);

      if (rows.length > 0) {
        const ids = rows.map((j) => j.id);
        const { data: phases } = await supabase.from('job_phases').select('*').in('job_id', ids);
        const { data: assigns } = await supabase.from('phase_subcontractor_assignments').select('*').in('job_id', ids);

        const byJob = {};
        (phases || []).forEach((p) => {
          byJob[p.job_id] = byJob[p.job_id] || [];
          byJob[p.job_id].push(p);
        });
        setPhasesByJob(byJob);

        const assignByJob = {};
        (assigns || []).forEach((a) => {
          assignByJob[a.job_id] = assignByJob[a.job_id] || new Set();
          assignByJob[a.job_id].add(a.subcontractor_id);
        });
        const counted = Object.fromEntries(Object.entries(assignByJob).map(([k, v]) => [k, v.size]));
        setAssignmentsByJob(counted);
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load pipeline' });
    } finally {
      setLoading(false);
    }
  }

  function openUpdateModal(job) {
    const phases = phasesByJob[job.id] || [];
    const upcoming = phases
      .filter((p) => p.status !== 'completed' && p.planned_start_date)
      .sort((a, b) => new Date(a.planned_start_date) - new Date(b.planned_start_date))[0];
    const nextDate = upcoming?.planned_start_date ? new Date(upcoming.planned_start_date).toLocaleDateString() : '';
    setUpdateFor(job);
    setMessage(buildDefaultMessage(job, phases, nextDate));
  }

  async function sendUpdate() {
    if (!updateFor) return;
    if (!message.trim()) { setToast({ type: 'warning', message: 'Message is empty' }); return; }
    setSending(true);
    try {
      // TODO: wire real email provider (Resend/SendGrid). For now, just record the update.
      const { error } = await supabase.from('client_updates').insert([{
        job_id: updateFor.id,
        type: 'progress_update',
        message,
        sent_at: new Date().toISOString(),
        sent_by: user?.id || null,
        delivery_method: 'email',
      }]);
      if (error) throw error;
      setToast({ type: 'success', message: 'Update sent and logged' });
      setUpdateFor(null);
      setMessage('');
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to send update' });
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-omega-charcoal">Project Pipeline</h1>
        <p className="text-sm text-omega-stone mt-1">Active projects and client communication</p>
      </header>

      <div className="p-6 md:p-8">
        {jobs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-omega-stone">
            No active projects right now.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((j) => {
              const phases = phasesByJob[j.id] || [];
              const completed = phases.filter((p) => p.status === 'completed').length;
              const total = phases.length || 0;
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
              const upcoming = phases
                .filter((p) => p.status !== 'completed' && p.planned_start_date)
                .sort((a, b) => new Date(a.planned_start_date) - new Date(b.planned_start_date))[0];
              const nextDate = upcoming?.planned_start_date ? new Date(upcoming.planned_start_date).toLocaleDateString() : '—';
              const subCount = assignmentsByJob[j.id] || 0;

              return (
                <div key={j.id} className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
                  <p className="font-bold text-omega-charcoal">{j.client_name || j.name || 'Untitled Job'}</p>
                  <p className="text-xs text-omega-stone mt-0.5 truncate">{j.address || j.city || '—'}</p>

                  <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                    <div>
                      <p className="text-omega-stone uppercase font-semibold">PM</p>
                      <p className="text-omega-charcoal font-medium">{j.pm_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-omega-stone uppercase font-semibold">Phases</p>
                      <p className="text-omega-charcoal font-medium">{completed}/{total}</p>
                    </div>
                    <div>
                      <p className="text-omega-stone uppercase font-semibold flex items-center gap-1"><Users className="w-3 h-3" /> Subs</p>
                      <p className="text-omega-charcoal font-medium">{subCount}</p>
                    </div>
                    <div>
                      <p className="text-omega-stone uppercase font-semibold flex items-center gap-1"><Calendar className="w-3 h-3" /> Next</p>
                      <p className="text-omega-charcoal font-medium">{nextDate}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-omega-stone">Progress</span>
                      <span className="font-semibold text-omega-charcoal">{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-omega-orange transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <button onClick={() => openUpdateModal(j)} className="mt-5 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">
                    <Mail className="w-4 h-4" /> Send Update to Client
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Send update modal */}
      {updateFor && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={() => setUpdateFor(null)}>
          <div className="bg-white rounded-2xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <p className="text-xs uppercase text-omega-stone font-semibold">Send update</p>
                <p className="font-bold text-omega-charcoal">{updateFor.client_name}</p>
              </div>
              <button onClick={() => setUpdateFor(null)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-3">
              {templates.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-omega-stone uppercase">Start from template</label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  >
                    <option value="">— Pick a template (optional) —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>[{t.category}] {t.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <label className="text-xs font-semibold text-omega-stone uppercase">Message</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={10} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono" />
              <p className="text-xs text-omega-stone">This will be sent by email to the client and logged in the job history.</p>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setUpdateFor(null)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button onClick={sendUpdate} disabled={sending} className="px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
                <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
