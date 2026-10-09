import { useEffect, useState } from 'react';
import { HardHat, Plus, X, DollarSign, FileText, Loader2, AlertCircle, Trash2, Send, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { sendMessage, normalizePhone } from '../lib/twilio';
import { subInlineLabel, subDisplayNames } from '../lib/subcontractor';
import { JobSubWork } from './SubWork';

// Status chip palette covers both agreements (accepted/signed/completed)
// and offers (sent/rejected) — they are merged into a single list in
// the UI so Inácio sees the full timeline at a glance.
const STATUS_META = {
  draft:     { label: 'DRAFT',     cls: 'bg-gray-200 text-gray-700' },
  sent:      { label: 'WAITING',   cls: 'bg-blue-100 text-blue-700' },
  accepted:  { label: 'ACCEPTED',  cls: 'bg-green-100 text-green-700' },
  rejected:  { label: 'REJECTED',  cls: 'bg-red-100 text-red-700' },
  signed:    { label: 'SIGNED',    cls: 'bg-emerald-600 text-white' },
  completed: { label: 'COMPLETED', cls: 'bg-emerald-700 text-white' },
};

// Public root URL (used to build the SMS link to the sub-facing page).
// Runtime override possible via VITE_PUBLIC_APP_URL; default works for
// every existing deploy because Omega lives on a single domain.
const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_APP_URL || 'https://omega-unified.vercel.app').replace(/\/$/, '');

// SMS template per sub language. Keep it short — Twilio segments at 160
// chars, and we want the link to fit in one segment for cost reasons.
function buildOfferSMS({ language, subName, jobAddress, link }) {
  const lang = (language || 'en').toLowerCase();
  if (lang === 'pt') {
    return `Olá ${subName || ''}! Omega Development tem um trabalho pra você em ${jobAddress || ''}. Veja detalhes e responda: ${link}`;
  }
  if (lang === 'es') {
    return `Hola ${subName || ''}! Omega Development tiene un trabajo para ti en ${jobAddress || ''}. Ve los detalles y responde: ${link}`;
  }
  return `Hi ${subName || ''}! Omega Development has a job for you at ${jobAddress || ''}. View details and respond: ${link}`;
}

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─────────────────────────────────────────────────────────────────────
// Subcontractors panel inside JobFullView. Lists every offer + agreement
// linked to this job and lets Owner / Operations / Sales (per role
// gating in the parent) assign a new sub.
//
// New flow (Sprint 4): "Assign Sub" creates a `subcontractor_offers`
// row with the snapshot, sends an SMS link to the sub, and waits.
// When the sub accepts on the public /sub-offer page, an agreement
// row is auto-generated. Reject + 24h reminder + auto-renotify all
// run from the daily cron.
// ─────────────────────────────────────────────────────────────────────
export default function JobSubcontractorsSection({ job, user }) {
  const [agreements, setAgreements] = useState([]);
  const [offers,     setOffers]     = useState([]);
  const [subs,       setSubs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [adding,     setAdding]     = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [smsWarning, setSmsWarning] = useState('');

  const [form, setForm] = useState({
    subcontractor_id: '',
    scope_of_work:    '',
    their_estimate:   '',
    payment_terms:    'multiple', // single | 50_50 | multiple
    start_date:       '',
  });

  useEffect(() => { if (job?.id) load(); /* eslint-disable-next-line */ }, [job?.id]);

  async function load() {
    setLoading(true);
    try {
      // Pull agreements (accepted), pending/rejected offers, and the
      // active sub catalog. Offers and agreements are surfaced as one
      // unified timeline so Inácio sees the whole story.
      const [{ data: agr }, { data: ofs }, { data: subRows }] = await Promise.all([
        supabase.from('subcontractor_agreements')
          .select('*, subcontractors(name, trade, phone, email, preferred_language)')
          .eq('job_id', job.id)
          .order('created_at', { ascending: false }),
        supabase.from('subcontractor_offers')
          .select('*, subcontractors(name, trade, phone, email, preferred_language)')
          .eq('job_id', job.id)
          .order('created_at', { ascending: false }),
        supabase.from('subcontractors')
          .select('id, name, contact_name, trade, phone, preferred_language')
          .order('name'),
      ]);
      setAgreements(agr || []);
      setOffers(ofs || []);
      setSubs(subRows || []);
    } catch (e) {
      setError(e?.message || 'Failed to load subcontractors');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({ subcontractor_id: '', scope_of_work: '', their_estimate: '', payment_terms: 'multiple', start_date: '' });
    setError('');
    setSmsWarning('');
  }

  async function sendOffer() {
    if (!form.subcontractor_id) { setError('Pick a subcontractor.'); return; }
    if (!form.scope_of_work.trim()) { setError('Describe the scope of work.'); return; }
    const sub = subs.find((s) => s.id === form.subcontractor_id);
    if (!sub) { setError('Subcontractor not found.'); return; }

    setSaving(true);
    setError('');
    setSmsWarning('');
    try {
      const payment_plan = form.payment_terms === 'single'
        ? [{ label: 'Upon completion', percent: 100 }]
        : form.payment_terms === '50_50'
          ? [{ label: 'Deposit', percent: 50 }, { label: 'Upon completion', percent: 50 }]
          : [{ label: 'Deposit', percent: 30 }, { label: 'Mid-project', percent: 40 }, { label: 'Upon completion', percent: 30 }];

      // 1) Create the offer row (snapshot of what we're sending).
      const { data: offer, error: insErr } = await supabase
        .from('subcontractor_offers')
        .insert([{
          job_id:           job.id,
          subcontractor_id: form.subcontractor_id,
          scope_of_work:    form.scope_of_work.trim(),
          their_estimate:   Number(form.their_estimate) || 0,
          payment_plan,
          start_date:       form.start_date || null,
          location:         job.address || '',
          status:           'sent',
          sent_at:          new Date().toISOString(),
          created_by:       user?.name || null,
        }])
        .select('*, subcontractors(name, trade, phone, email, preferred_language)')
        .single();
      if (insErr) throw insErr;

      // 2) Send the SMS with the public /sub-offer link. Twilio is the
      // happy path; if the server isn't configured (local / unset env)
      // we surface a soft warning so Inácio knows to text the sub
      // manually with the link.
      const link = `${PUBLIC_URL}/sub-offer/${offer.id}`;
      const phone = normalizePhone(sub.phone);
      if (phone) {
        const body = buildOfferSMS({
          language:   sub.preferred_language || 'en',
          // Personal SMS — use the contact person's name when available
          // ("Hi Pedro,...") instead of the LLC name. Falls back to the
          // company name if that's all we have.
          subName:    subDisplayNames(sub).primary,
          jobAddress: job.address || '',
          link,
        });
        const result = await sendMessage({
          to: phone,
          body,
          channel: 'sms',
          meta: { jobId: job.id, subId: sub.id, kind: 'sub_offer', offerId: offer.id },
          user,
        });
        if (!result.ok) {
          setSmsWarning(`SMS failed (${result.error}). Send the link manually: ${link}`);
        }
      } else {
        setSmsWarning(`Sub has no phone on file. Share the link manually: ${link}`);
      }

      setOffers((prev) => [offer, ...prev]);
      logAudit({ user, action: 'subcontractor.offer_sent', entityType: 'subcontractor_offer',
                 entityId: offer.id, details: { job_id: job.id, sub_id: sub.id } });
      // Keep the form open if SMS failed (so Inácio sees the warning),
      // otherwise reset and close.
      if (!smsWarning) { resetForm(); setAdding(false); }
    } catch (e) {
      setError(e?.message || 'Failed to send offer');
    } finally {
      setSaving(false);
    }
  }

  async function removeAgreement(id) {
    if (!confirm('Remove this subcontractor assignment?')) return;
    try {
      await supabase.from('subcontractor_agreements').delete().eq('id', id);
      setAgreements((prev) => prev.filter((a) => a.id !== id));
      logAudit({ user, action: 'subcontractor.unassign', entityType: 'subcontractor_agreement', entityId: id });
    } catch (e) {
      setError(e?.message || 'Failed to remove assignment');
    }
  }

  async function cancelOffer(id) {
    if (!confirm('Cancel this pending offer? The link will stop working for the sub.')) return;
    try {
      await supabase.from('subcontractor_offers').delete().eq('id', id);
      setOffers((prev) => prev.filter((o) => o.id !== id));
      logAudit({ user, action: 'subcontractor.offer_canceled', entityType: 'subcontractor_offer', entityId: id });
    } catch (e) {
      setError(e?.message || 'Failed to cancel offer');
    }
  }

  // Build a unified timeline: pending/rejected offers (those without a
  // matching agreement) interleaved with the agreements (accepted).
  // Sort by recency so the most recent activity is at the top.
  const acceptedAgreementIds = new Set(agreements.map((a) => a.id));
  const offersToShow = offers.filter((o) => !o.agreement_id || !acceptedAgreementIds.has(o.agreement_id));
  const timeline = [
    ...offersToShow.map((o) => ({ kind: 'offer',     row: o, ts: o.created_at })),
    ...agreements.map(   (a) => ({ kind: 'agreement', row: a, ts: a.created_at })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <p className="text-sm text-omega-stone">Loading subcontractors…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <JobSubWork job={job} subs={subs} />
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-omega-charcoal inline-flex items-center gap-2">
              <HardHat className="w-4 h-4 text-omega-orange" /> Subcontractors
            </h2>
            <p className="text-xs text-omega-stone mt-0.5">
              {timeline.length === 0
                ? 'No subs assigned yet. Click "Assign Sub" — they\'ll get a text with Accept/Reject buttons.'
                : `${agreements.length} accepted${offersToShow.length > 0 ? `, ${offersToShow.filter((o) => o.status === 'sent').length} waiting, ${offersToShow.filter((o) => o.status === 'rejected').length} rejected` : ''}`}
            </p>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-xs font-bold shadow-sm flex-shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> Assign Sub
            </button>
          )}
        </div>

        {/* Add form */}
        {adding && (
          <div className="p-4 sm:p-6 bg-omega-pale/40 border-b border-omega-orange/20 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-omega-charcoal">New assignment</h3>
              <button
                type="button"
                onClick={() => { resetForm(); setAdding(false); }}
                className="p-1.5 rounded-lg hover:bg-white"
                aria-label="Cancel"
              >
                <X className="w-4 h-4 text-omega-stone" />
              </button>
            </div>

            <label className="block">
              <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Subcontractor</span>
              <select
                value={form.subcontractor_id}
                onChange={(e) => setForm({ ...form, subcontractor_id: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none bg-white"
              >
                <option value="">Pick a sub…</option>
                {subs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {subInlineLabel(s)}{s.trade ? ` — ${s.trade}` : ''}
                  </option>
                ))}
              </select>
              {subs.length === 0 && (
                <p className="text-[11px] text-red-600 mt-1">
                  No subcontractors in the catalog yet — Brenda needs to add one first.
                </p>
              )}
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Scope of Work</span>
              <textarea
                rows={3}
                value={form.scope_of_work}
                onChange={(e) => setForm({ ...form, scope_of_work: e.target.value })}
                placeholder='e.g. "Demolition of existing bathroom — tub, vanity, tile, floor"'
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Their estimate ($)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.their_estimate}
                  onChange={(e) => setForm({ ...form, their_estimate: e.target.value })}
                  placeholder="2500"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Payment terms</span>
                <select
                  value={form.payment_terms}
                  onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none bg-white"
                >
                  <option value="single">100% on completion</option>
                  <option value="50_50">50 / 50</option>
                  <option value="multiple">30 / 40 / 30</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Start date</span>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
                />
              </label>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="text-xs font-semibold">{error}</p>
              </div>
            )}
            {smsWarning && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="text-xs">{smsWarning}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { resetForm(); setAdding(false); }}
                disabled={saving}
                className="px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-omega-stone hover:border-omega-orange disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendOffer}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-xs font-bold disabled:opacity-60"
              >
                {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</> : <><Send className="w-3.5 h-3.5" /> Send offer to sub</>}
              </button>
            </div>
          </div>
        )}

        {/* Existing assignments */}
        {timeline.length === 0 && !adding && (
          <div className="px-4 sm:px-6 py-10 text-center text-omega-stone">
            <HardHat className="w-8 h-8 text-omega-fog mx-auto mb-2" />
            <p className="text-sm">No subcontractors assigned yet.</p>
            <p className="text-xs mt-1">Click <strong>Assign Sub</strong> to designate the first one.</p>
          </div>
        )}

        {timeline.map(({ kind, row }) => {
          const meta = STATUS_META[row.status] || { label: (row.status || 'DRAFT').toUpperCase(), cls: 'bg-gray-200 text-gray-700' };
          const subInfo = row.subcontractors || {};
          const isOffer = kind === 'offer';
          const isPending = isOffer && row.status === 'sent';
          const isRejected = isOffer && row.status === 'rejected';
          const Icon = isPending ? Clock : HardHat;
          return (
            <div key={`${kind}-${row.id}`} className={`px-4 sm:px-6 py-4 border-t border-gray-100 hover:bg-omega-pale/20 group ${isPending ? 'bg-blue-50/40' : isRejected ? 'bg-red-50/40' : ''}`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isPending ? 'bg-blue-100' : isRejected ? 'bg-red-100' : 'bg-omega-pale'}`}>
                  <Icon className={`w-4 h-4 ${isPending ? 'text-blue-700' : isRejected ? 'text-red-700' : 'text-omega-orange'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-bold text-omega-charcoal">
                      {subInfo.name || 'Sub removed'}
                    </p>
                    {subInfo.trade && (
                      <span className="text-[10px] uppercase tracking-wider text-omega-stone font-bold">
                        {subInfo.trade}
                      </span>
                    )}
                    <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${meta.cls}`}>
                      {meta.label}
                    </span>
                    {subInfo.preferred_language && subInfo.preferred_language !== 'en' && (
                      <span className="text-[10px] uppercase tracking-wider text-omega-stone">
                        {subInfo.preferred_language === 'pt' ? 'PT' : 'ES'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-omega-slate whitespace-pre-line">{row.scope_of_work}</p>
                  {isRejected && row.reject_reason && (
                    <p className="mt-1 text-xs text-red-700 italic">Reason: {row.reject_reason}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-omega-stone">
                    {row.their_estimate > 0 && (
                      <span className="inline-flex items-center gap-1 font-bold text-omega-charcoal">
                        <DollarSign className="w-3 h-3" /> {money(row.their_estimate)}
                      </span>
                    )}
                    {Array.isArray(row.payment_plan) && row.payment_plan.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {row.payment_plan.map((p) => `${p.percent}%`).join(' / ')}
                      </span>
                    )}
                    {isPending && row.sent_at && (
                      <span>Sent {new Date(row.sent_at).toLocaleString()}</span>
                    )}
                    {isRejected && row.rejected_at && (
                      <span>Rejected {new Date(row.rejected_at).toLocaleDateString()}</span>
                    )}
                    {!isOffer && row.signed_at && (
                      <span>Signed {new Date(row.signed_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => isOffer ? cancelOffer(row.id) : removeAgreement(row.id)}
                  className="p-1.5 rounded-lg text-omega-stone hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  title={isOffer ? 'Cancel offer' : 'Remove assignment'}
                  aria-label="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
