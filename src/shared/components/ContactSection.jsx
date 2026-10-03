import { useEffect, useState } from 'react';
import { MessageSquare, MessageCircle, Phone, User, Users, Mail, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import ContactMessageModal from './ContactMessageModal';
import { clientMessageTemplate, normalizePhone } from '../lib/twilio';
import { subConfirmTemplate, findSubByPhone } from '../lib/subMessages';
import { TEMPLATES, fillTemplate } from '../data/messageTemplates';

/**
 * Full-page contact section used inside a JobFullView tab.
 * Roles:
 *   - operations:  "Contact Client" emphasized at top, then subs below
 *   - manager / owner / admin: subs first, client available
 *
 * Pulls `job_subs` grouped by phase.
 */
export default function ContactSection({ job, user }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contact, setContact] = useState(null); // { to, name, body, meta, auditAction, channel }

  useEffect(() => {
    if (!job?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data }, { data: onFile }] = await Promise.all([
          supabase.from('job_subs').select('id, phase, phase_index, sub_name, sub_phone').eq('job_id', job.id),
          supabase.from('subcontractors').select('phone, contact_name, preferred_language'),
        ]);
        // job_subs rows only carry name + phone; the sub on file (matched by
        // phone) gives the contact name and the language to write in.
        const withLang = (data || []).map((r) => {
          const s = findSubByPhone(onFile, r.sub_phone);
          return { ...r, contact_name: s?.contact_name || null, preferred_language: s?.preferred_language || null };
        });
        if (!cancelled) setRows(withLang);
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [job?.id]);

  // Group by phase, preserving phase_index order where available.
  const groups = [];
  const index = {};
  rows.forEach((r) => {
    const k = r.phase || '—';
    if (!(k in index)) {
      index[k] = groups.length;
      groups.push({ phase: k, phaseIndex: r.phase_index ?? 0, subs: [] });
    }
    groups[index[k]].subs.push(r);
  });
  groups.sort((a, b) => (a.phaseIndex ?? 0) - (b.phaseIndex ?? 0));

  const clientName  = job?.client_name;
  const clientPhone = normalizePhone(job?.client_phone);
  const clientEmail = job?.client_email;

  const operationsFirst = user?.role === 'operations';

  function openSubContact(sub, phaseName, channel) {
    setContact({
      to: sub.sub_phone,
      name: sub.sub_name,
      channel,
      body: subConfirmTemplate({
        sub,
        phase: { name: phaseName },
        job,
      }),
      meta: { jobId: job.id, phaseId: phaseName, subId: sub.id, kind: 'sub.confirm' },
      auditAction: `sub.contact.${channel}`,
    });
  }

  function openClientContact(channel, body) {
    setContact({
      to: job.client_phone,
      name: clientName || 'Client',
      channel,
      body: body || clientMessageTemplate({ job }),
      meta: { jobId: job.id, kind: 'client.update' },
      auditAction: `client.contact.${channel}`,
    });
  }

  /** Open a pre-filled template in SMS mode (user can switch inside). */
  function openTemplate(tpl) {
    openClientContact('sms', fillTemplate(tpl.text, job));
  }

  // Quick-send message templates (the actual text gets filled in from
  // the job + a bit of context — the user can still edit before sending).
  const TemplatesCard = (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-omega-orange" />
        <h3 className="text-base font-bold text-omega-charcoal">Quick Templates</h3>
      </div>
      <p className="text-xs text-omega-stone mb-3">
        One click opens the message pre-filled — you can still edit before sending.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => openTemplate(tpl)}
            disabled={!clientPhone}
            className="text-left px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange hover:bg-omega-pale/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-base">{tpl.emoji}</span>
              <span className="text-xs font-bold text-omega-charcoal truncate">{tpl.title}</span>
            </div>
          </button>
        ))}
      </div>
      {!clientPhone && (
        <p className="text-[11px] text-omega-stone mt-2">Add a phone number in Details to enable templates.</p>
      )}
    </div>
  );

  const ClientCard = (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-omega-orange" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">Client</p>
          <p className="font-bold text-omega-charcoal text-base truncate">{clientName || '—'}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-omega-stone">
            {clientPhone && (
              <a href={`tel:${clientPhone}`} className="inline-flex items-center gap-1 hover:text-omega-orange">
                <Phone className="w-3 h-3" /> {clientPhone}
              </a>
            )}
            {clientEmail && (
              <a href={`mailto:${clientEmail}`} className="inline-flex items-center gap-1 hover:text-omega-orange">
                <Mail className="w-3 h-3" /> {clientEmail}
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          disabled={!clientPhone}
          onClick={() => openClientContact('sms')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-xs font-bold"
        >
          <MessageSquare className="w-3.5 h-3.5" /> SMS
        </button>
        <button
          disabled={!clientPhone}
          onClick={() => openClientContact('whatsapp')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-bold"
        >
          <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
        </button>
      </div>
      {!clientPhone && (
        <p className="text-[11px] text-omega-stone mt-2">No client phone on file.</p>
      )}
    </div>
  );

  const SubsCard = (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-omega-orange" />
        <h3 className="text-lg font-bold text-omega-charcoal">Assigned Subcontractors</h3>
      </div>
      {loading && <p className="text-xs text-omega-stone">Loading…</p>}
      {!loading && groups.length === 0 && (
        <p className="text-sm text-omega-stone">No subs assigned to this job yet.</p>
      )}

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.phase}>
            <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold mb-2">
              {g.phase}
            </p>
            <div className="space-y-2">
              {g.subs.map((s) => {
                const phone = normalizePhone(s.sub_phone);
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-omega-charcoal truncate">{s.sub_name || '—'}</p>
                      <p className="text-xs text-omega-stone">{phone || '—'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={!phone}
                        onClick={() => openSubContact(s, g.phase, 'sms')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-xs font-bold"
                      >
                        <MessageSquare className="w-3 h-3" /> SMS
                      </button>
                      <button
                        disabled={!phone}
                        onClick={() => openSubContact(s, g.phase, 'whatsapp')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-bold"
                      >
                        <MessageCircle className="w-3 h-3" /> WA
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {TemplatesCard}
      {operationsFirst ? (<>{ClientCard}{SubsCard}</>) : (<>{SubsCard}{ClientCard}</>)}

      {contact && (
        <ContactMessageModal
          open
          onClose={() => setContact(null)}
          toName={contact.name}
          toPhone={contact.to}
          channel={contact.channel}
          setChannel={(ch) => setContact((c) => c ? { ...c, channel: ch } : c)}
          initialBody={contact.body}
          meta={contact.meta}
          auditAction={contact.auditAction}
          user={user}
        />
      )}
    </div>
  );
}
