// Reviews — client testimonials hub for marketing. Ramon collects
// reviews (pasted Google reviews, referral praise, etc.), ties them to
// a project when relevant, and marks the good ones "approved" so they
// become ready-to-post case studies.
//
// Backed by the job_reviews table (migration 072). Degrades to a
// friendly "run the migration" notice if the table isn't there yet.

import { useEffect, useMemo, useState } from 'react';
import { Star, Plus, X, Trash2, Check, Loader2, MessageSquareQuote, Pencil } from 'lucide-react';
import PageHeader from '../../../shared/components/ui/PageHeader';
import { supabase } from '../../../shared/lib/supabase';
import { serviceBadgeLabel } from '../../../shared/data/services';
import { LEAD_SOURCES } from '../../receptionist/lib/leadCatalog';

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'approved', label: 'Approved' },
  { id: 'pending',  label: 'Pending' },
];

export default function Reviews({ user }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [missingTable, setMissingTable] = useState(false);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // review obj or {} for new
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [{ data, error }, { data: jobRows }] = await Promise.all([
        supabase.from('job_reviews').select('*').order('created_at', { ascending: false }),
        supabase.from('jobs').select('id, client_name, service, city').order('updated_at', { ascending: false }).limit(500),
      ]);
      if (error) {
        if (/job_reviews/.test(error.message || '') || error.code === '42P01') setMissingTable(true);
        setRows([]);
      } else {
        setRows(data || []);
      }
      setJobs(jobRows || []);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => rows.filter((r) => {
    if (filter === 'approved') return r.approved;
    if (filter === 'pending') return !r.approved;
    return true;
  }), [rows, filter]);

  const approvedCount = rows.filter((r) => r.approved).length;

  async function toggleApproved(r) {
    setBusyId(r.id);
    try {
      const { data, error } = await supabase
        .from('job_reviews')
        .update({ approved: !r.approved, updated_at: new Date().toISOString() })
        .eq('id', r.id).select().single();
      if (error) throw error;
      setRows((prev) => prev.map((x) => (x.id === r.id ? data : x)));
    } catch { /* leave as-is */ } finally { setBusyId(null); }
  }

  async function remove(r) {
    if (!confirm('Delete this review?')) return;
    setBusyId(r.id);
    try {
      const { error } = await supabase.from('job_reviews').delete().eq('id', r.id);
      if (error) throw error;
      setRows((prev) => prev.filter((x) => x.id !== r.id));
    } catch { /* no-op */ } finally { setBusyId(null); }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <PageHeader icon={MessageSquareQuote} title="Reviews" subtitle={`${approvedCount} approved · ${rows.length} total`} />

      {!missingTable && (
        <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  filter === f.id ? 'bg-omega-orange text-white border-omega-orange' : 'bg-white text-omega-stone border-gray-200 hover:border-omega-orange'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold">
            <Plus className="w-4 h-4" /> Add review
          </button>
        </div>
      )}

      <div className="max-w-4xl mx-auto p-4">
        {missingTable ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Run migration <strong>072_job_reviews.sql</strong> in Supabase to enable the reviews hub.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-omega-stone"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-omega-stone text-sm">No reviews yet. Click “Add review” to capture your first testimonial.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((r) => (
              <ReviewCard
                key={r.id} review={r} busy={busyId === r.id}
                onToggle={() => toggleApproved(r)} onEdit={() => setEditing(r)} onDelete={() => remove(r)}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <ReviewModal
          review={editing} jobs={jobs} user={user}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            setRows((prev) => isNew ? [saved, ...prev] : prev.map((x) => (x.id === saved.id ? saved : x)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Stars({ value, onChange }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} className={onChange ? 'cursor-pointer' : 'cursor-default'}>
          <Star className={`w-4 h-4 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
        </button>
      ))}
    </div>
  );
}

function ReviewCard({ review, busy, onToggle, onEdit, onDelete }) {
  return (
    <div className={`bg-white rounded-2xl border p-4 ${review.approved ? 'border-emerald-200' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <Stars value={review.rating} />
        {review.approved
          ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Approved</span>
          : <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Pending</span>}
      </div>
      <p className="text-[14px] text-omega-charcoal leading-relaxed italic">“{review.testimonial}”</p>
      <div className="mt-2 text-[12px] text-omega-stone">
        <span className="font-bold text-omega-charcoal">{review.client_name || 'Anonymous'}</span>
        {review.service ? ` · ${serviceBadgeLabel(review.service)}` : ''}{review.city ? ` · ${review.city}` : ''}
        {review.source ? ` · ${review.source}` : ''}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={onToggle} disabled={busy}
          className={`text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50 ${review.approved ? 'text-omega-stone hover:text-omega-charcoal' : 'text-emerald-700 hover:text-emerald-800'}`}>
          <Check className="w-3.5 h-3.5" /> {review.approved ? 'Unapprove' : 'Approve'}
        </button>
        <button onClick={onEdit} className="text-[11px] font-semibold text-omega-stone hover:text-omega-charcoal inline-flex items-center gap-1">
          <Pencil className="w-3.5 h-3.5" /> Edit
        </button>
        <button onClick={onDelete} disabled={busy} className="text-[11px] font-semibold text-red-600 hover:text-red-700 inline-flex items-center gap-1 disabled:opacity-50 ml-auto">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function ReviewModal({ review, jobs, user, onClose, onSaved }) {
  const isNew = !review.id;
  const [form, setForm] = useState({
    job_id: review.job_id || '',
    client_name: review.client_name || '',
    rating: review.rating || 5,
    testimonial: review.testimonial || '',
    source: review.source || 'Google',
    service: review.service || '',
    city: review.city || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pickJob(id) {
    const j = jobs.find((x) => x.id === id);
    setForm((f) => ({
      ...f, job_id: id,
      client_name: f.client_name || (j?.client_name || ''),
      service: j?.service || f.service,
      city: j?.city || f.city,
    }));
  }

  async function save() {
    if (!form.testimonial.trim()) { setError('Write the testimonial.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        job_id: form.job_id || null,
        client_name: form.client_name.trim() || null,
        rating: Number(form.rating) || 5,
        testimonial: form.testimonial.trim(),
        source: form.source || null,
        service: form.service || null,
        city: form.city || null,
        updated_at: new Date().toISOString(),
      };
      let data, error;
      if (isNew) {
        ({ data, error } = await supabase.from('job_reviews').insert([{ ...payload, created_by: user?.name || null }]).select().single());
      } else {
        ({ data, error } = await supabase.from('job_reviews').update(payload).eq('id', review.id).select().single());
      }
      if (error) throw error;
      onSaved(data, isNew);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <h3 className="font-bold text-omega-charcoal">{isNew ? 'Add review' : 'Edit review'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-omega-stone"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <Label>Project (optional — fills service & town)</Label>
            <select value={form.job_id} onChange={(e) => pickJob(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange outline-none text-base bg-white">
              <option value="">— None —</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.client_name || 'Project'}{j.city ? ` · ${j.city}` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Client name</Label>
              <input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange outline-none text-base" placeholder="e.g. Sarah M." />
            </div>
            <div>
              <Label>Source</Label>
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange outline-none text-base bg-white">
                {['Google', 'Houzz', 'Referral', 'Facebook', 'Manual', ...LEAD_SOURCES.filter((s) => !['Google', 'Houzz', 'Referral'].includes(s))].filter((v, i, a) => a.indexOf(v) === i).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label>Rating</Label>
            <Stars value={form.rating} onChange={(n) => setForm({ ...form, rating: n })} />
          </div>
          <div>
            <Label>Testimonial</Label>
            <textarea value={form.testimonial} onChange={(e) => setForm({ ...form, testimonial: e.target.value })} rows={4}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange outline-none text-base resize-none"
              placeholder="Paste or type the client's words…" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold disabled:opacity-60">Cancel</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {isNew ? 'Add' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">{children}</label>;
}
