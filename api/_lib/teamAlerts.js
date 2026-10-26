// Team WhatsApp notifications — one message per person, only when they have
// something to act on (plan approved by Ramon 2026-10-12).
//
// Runs from daily-owner-update ?task=reminders (GitHub Actions, every 15 min).
// Everything is condition-based + deduped through audit_log rows
// (action 'team_alert.sent', details.key), so a tick that is skipped, or a
// message held outside working hours, simply goes out on the next tick that
// is allowed to send it. Nothing here needs a queue.
//
// Who:   Inácio (owner, 7–5), Attila (sales, 8–5), Rafaela (operations, 8–5),
//        Joel (PM, 7–5, Portuguese), Ramon (marketing, 8–5). Mon–Fri, NY time.
//        People and phones come from the `users` table (matched by first
//        name) — no phone numbers live in this public repo.
// How:   approved WhatsApp templates (business-initiated) from the Omega
//        sender. The templates are defined below and created + submitted to
//        Meta automatically on the first tick; a template that isn't approved
//        yet is skipped (and retried) instead of failing.
// Lists: template variables can't contain line breaks, so lists ride on one
//        line ("A · B · C"). Morning/summary templates carry a "See details"
//        button; tapping it comes back through the WhatsApp webhook
//        (ownerBot → teamDetailsReply) and gets the full list, one item per
//        line, as a free reply inside the 24h window.
//
// Env (all optional): TEAM_ALERTS_OFF=1 (kill switch), TEAM_ALERTS_DAILY_MAX
// (default 80 sends/day), TEAM_ALERTS_SINCE (ISO; alerts only for things that
// happen after it), TEAM_ALERTS_FROM (default the Omega WhatsApp sender).

import { supabase } from './supabase.js';

const NY_TZ = 'America/New_York';
const WA_FROM = () => process.env.TEAM_ALERTS_FROM || 'whatsapp:+18254623700';
const OFF = () => process.env.TEAM_ALERTS_OFF === '1';
const DAILY_MAX = () => Number(process.env.TEAM_ALERTS_DAILY_MAX || 80);
// Go-live. Instant alerts and escalations only fire for things that happen
// (or cross their threshold) after this, so the first run doesn't replay the
// backlog. Older items still show up in the morning lists and the summary.
const SINCE_MS = () => Date.parse(process.env.TEAM_ALERTS_SINCE || '2026-10-12T21:00:00Z');
const LOOKBACK_MS = 4 * 86_400_000; // covers a weekend of held alerts
const END_HOUR = 17;
const BULK_IMPORT_CREATORS = new Set(['import', 'legacy_import']);

const TEAM = {
  inacio:  { match: /^in[aá]cio\b/i, lang: 'en', start: 7 },
  attila:  { match: /^attila\b/i,    lang: 'en', start: 8 },
  rafaela: { match: /^rafaela\b/i,   lang: 'en', start: 8 },
  joel:    { match: /^joel\b/i,      lang: 'pt', start: 7 },
  ramon:   { match: /^ramon\b/i,     lang: 'en', start: 8 },
};

// ─── Templates (WhatsApp, category UTILITY) ──────────────────────────
// Body rules (Meta): no variable at the very start/end, no two variables
// side by side, values have no line breaks. Samples are what Meta reviews.
const DETAILS_EN = 'See details';
const DETAILS_PT = 'Ver detalhes';
const T = {
  newLead: {
    name: 'omega_team_new_lead', lang: 'en',
    body: '🆕 New lead\n\nName: {{1}}\nService: {{2}}\nTown: {{3}}\nPhone: {{4}}\nSource: {{5}}\nAssigned to: {{6}}\n\nOpen it in the Omega app to call.',
    samples: ['Shane McLaughlin', 'Kitchen remodel', 'Westport', '(203) 555-0142', 'Google LSA', 'Attila'],
  },
  contractSigned: {
    name: 'omega_contract_signed', lang: 'en',
    body: '✍️ Contract signed\n\nClient: {{1}}\nJob: {{2}}\nValue: {{3}}\nSalesperson: {{4}}\nSigned: {{5}}\n\nDetails are in the Omega app.',
    samples: ['Renee Smith', 'Bathroom remodel - 12 Oak St, Westport', '$48,000', 'Attila', 'Tue, Oct 13'],
  },
  paymentReceived: {
    name: 'omega_payment_received', lang: 'en',
    body: '💵 Payment received\n\nClient: {{1}}\nAmount: {{2}}\nPaid so far: {{3}}\nRemaining: {{4}}\n\nDetails are in the Omega app.',
    samples: ['Renee Smith', '$12,500 (2nd payment - rough-in complete)', '$26,900 of $48,000', '$21,100'],
  },
  ownerMorning: {
    name: 'omega_owner_morning', lang: 'en', button: { title: DETAILS_EN, id: 'omega_details_owner_am' },
    body: '☀️ Good morning, {{1}} — {{2}}\n\n⏰ Late jobs: {{3}}\n👉 {{4}}\n\n📅 Today: {{5}}\n\nTap "See details" for the full list.',
    samples: ['Inácio', 'Tue, Oct 13', '2', 'Smith (Westport): tile, 3 days late · Lee (Darien): drywall, 1 day late', '2 visits · 1 inspection · 1 delivery'],
  },
  ownerSummary: {
    name: 'omega_owner_summary', lang: 'en', button: { title: DETAILS_EN, id: 'omega_details_owner_pm' },
    body: '🌙 Today at Omega — {{1}}\n\nNew leads: {{2}}\nVisits done: {{3}}\nEstimates sent: {{4}}\nContracts signed: {{5}}\nPayments received: {{6}}\nBills paid: {{7}}\nNeeds attention: {{8}}\n\nTap "See details" for the full list.',
    samples: ['Tue, Oct 13', '3', '2', '1', '1 ($48,000)', '$12,500', '4 ($6,200)', '2'],
  },
  escalation: {
    name: 'omega_owner_escalation', lang: 'en',
    body: '🔺 Needs your attention\n\n{{1}}\nClient: {{2}}\nResponsible: {{3}}\nSince: {{4}}\n\nSent automatically by the Omega app.',
    samples: ['Lead with no contact for 2 days', 'Shane McLaughlin (Kitchen, Westport)', 'Attila', 'Sat, Oct 10'],
  },
  visitSoon: {
    name: 'omega_visit_soon', lang: 'en',
    body: '📅 Visit in 2 hours — {{1}}\n\nClient: {{2}}\nAddress: {{3}}\nService: {{4}}\nPhone: {{5}}\n\nNotes are in the Omega app.',
    samples: ['2:00 PM', 'John Lee', '4 Pine Rd, Norwalk', 'Kitchen remodel', '(203) 555-0199'],
  },
  salesMorning: {
    name: 'omega_sales_morning', lang: 'en', button: { title: DETAILS_EN, id: 'omega_details_sales' },
    body: '☀️ Good morning, {{1}} — {{2}}\n\n📅 Visits today: {{3}}\n👉 {{4}}\n\n📞 Leads to call: {{5}}\n👉 {{6}}\n\n📝 Estimates to send: {{7}}\n👉 {{8}}\n\nTap "See details" for addresses, phones and how long each one is waiting.',
    samples: ['Attila', 'Tue, Oct 13', '2', '9:00 AM Renee Smith · 2:00 PM John Lee', '3', 'Shane McLaughlin · Elizabeth Riley · Mark Chen', '1', 'Mary Costa'],
  },
  salesUpdateCards: {
    name: 'omega_sales_update_cards', lang: 'en',
    body: '📝 Before you leave, {{1}}\n\nCards to update today: {{2}}\n👉 {{3}}\n\nPlease update them in the Omega app.',
    samples: ['Attila', '3', 'Renee Smith (visit today) · Elizabeth Riley (no contact in 3 days) · Mark Chen (no contact in 2 days)'],
  },
  subOfferAnswer: {
    name: 'omega_sub_offer_answer', lang: 'en',
    body: '🔧 Sub answered an offer\n\nSub: {{1}}\nAnswer: {{2}}\nJob: {{3}}\nWork: {{4}}\n\nDetails are in the Omega app.',
    samples: ['Silva Tile LLC', 'Accepted ✅', 'Smith - 12 Oak St, Westport', 'Tile, starts Mon, Oct 19'],
  },
  phaseNoSub: {
    name: 'omega_phase_no_sub', lang: 'en',
    body: '⚠️ Phase starts soon without a confirmed sub\n\nJob: {{1}}\nPhase: {{2}}\nStarts: {{3}}\n\nPlease confirm a subcontractor today.',
    samples: ['Lee - 4 Pine Rd, Darien', 'Drywall', 'Wed, Oct 14'],
  },
  opsMorning: {
    name: 'omega_ops_morning', lang: 'en', button: { title: DETAILS_EN, id: 'omega_details_ops' },
    body: '☀️ Good morning, {{1}} — {{2}}\n\n💳 Bills due next business day: {{3}}\n👉 {{4}}\n\n📄 Sub insurance expiring within 30 days: {{5}}\n👉 {{6}}\n\n🚚 Deliveries today: {{7}}\n👉 {{8}}\n\n🔎 Inspections today: {{9}}\n👉 {{10}}\n\nTap "See details" for the full list.',
    samples: ['Rafaela', 'Tue, Oct 13', '2 ($3,450 total)', 'Home Depot $2,100 · Silva Tile $1,350', '1', 'Silva Tile LLC: general liability expires Nov 2', '1', 'Costa (Norwalk): kitchen cabinets', '1', 'Lee (Darien): electrical, 10:00 AM'],
  },
  pmPhaseLate: {
    name: 'omega_pm_fase_atrasada', lang: 'pt_BR',
    body: '⏰ Fase atrasada\n\nObra: {{1}}\nFase: {{2}}\nDeveria ter terminado: {{3}}\nAtraso: {{4}}\n\nAtualize a fase ou a nova data no app da Omega.',
    samples: ['Smith - 12 Oak St, Westport', 'Azulejo', 'sex, 9 out', '3 dias'],
  },
  pmMorning: {
    name: 'omega_pm_manha', lang: 'pt_BR', button: { title: DETAILS_PT, id: 'omega_details_pm' },
    body: '☀️ Bom dia, {{1}} — {{2}}\n\n🏗️ Obras com algo previsto hoje: {{3}}\n👉 {{4}}\n\nToque em "Ver detalhes" para endereço, sub e horário de cada uma.',
    samples: ['Joel', 'ter, 13 out', '3', 'Smith (Westport): azulejo · Lee (Darien): inspeção elétrica 10h · Costa (Norwalk): entrega dos armários'],
  },
  pmNoUpdate: {
    name: 'omega_pm_sem_update', lang: 'pt_BR',
    body: '📝 Obras sem atualização hoje: {{1}}\n👉 {{2}}\n\nPoste a atualização do dia no app antes de sair.',
    samples: ['2', 'Smith (Westport) · Lee (Darien)'],
  },
  groupWaiting: {
    name: 'omega_group_waiting', lang: 'en',
    body: '💬 Client waiting for your answer\n\nGroup: {{1}}\nClient: {{2}}\nMessage: {{3}}\nWaiting: {{4}}\n\nPlease reply in the group.',
    samples: ['Smith - Oak St bathroom', 'Renee Smith', '"Hi Attila, can we move the tile delivery to Friday?"', '2 hours (since 10:15 AM)'],
  },
  groupWaitingPt: {
    name: 'omega_grupo_esperando', lang: 'pt_BR',
    body: '💬 Cliente esperando sua resposta\n\nGrupo: {{1}}\nCliente: {{2}}\nMensagem: {{3}}\nEsperando: {{4}}\n\nResponda no grupo, por favor.',
    samples: ['Smith - Oak St bathroom', 'Renee Smith', '"Joel, o pintor vem amanhã?"', '2 horas (desde 10h15)'],
  },
  groupOwner: {
    name: 'omega_group_unanswered_owner', lang: 'en',
    body: '🔺 Client without an answer today\n\nGroup: {{1}}\nClient: {{2}}\nAsked: {{3}}\nMessage: {{4}}\nWaiting since: {{5}}\n\nPlease reply in the group.',
    samples: ['Smith - Oak St bathroom', 'Renee Smith', 'Attila', '"Hi Attila, can we move the tile delivery to Friday?"', '10:15 AM (6 hours)'],
  },
  purchaseDigest: {
    name: 'omega_purchase_list_update', lang: 'en',
    body: '🛒 Client purchase lists — {{1}}\n\nUpdated: {{2}}\n👉 {{3}}\n\nStill not at the house: {{4}}\n\nDetails are on the Phases tab in the Omega app.',
    samples: ['Tue, Oct 13', '2 clients', 'Smith: tile at the house, vanity ordered (arrives Oct 20) · Lee: list complete ✅', 'Smith 4 of 17 · Costa 9 of 22'],
  },
  weeklyLeads: {
    name: 'omega_weekly_leads', lang: 'en',
    body: '📊 Leads last week — {{1}}\n\nTotal: {{2}}\nBy source: {{3}}\n\nVisits scheduled: {{4}}\nEstimates sent: {{5}}\nContracts signed: {{6}}\n\nSent every Monday by the Omega app.',
    samples: ['Oct 5 to Oct 11', '9', 'Local Services 4 · Google Ads 2 · Website 2 · Houzz 1', '5', '3', '1 ($48,000)'],
  },
};

// ─── Twilio REST ─────────────────────────────────────────────────────
function twilioAuth() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) return null;
  return { sid, header: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` };
}

async function twilioJson(url, auth, init = {}) {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: auth.header, ...(init.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${data?.code || ''} ${data?.message || ''}`.trim());
  return data;
}

// name → { sid, status } for every content template on the account.
async function listTemplates(auth) {
  const out = new Map();
  let url = 'https://content.twilio.com/v1/ContentAndApprovals?PageSize=500';
  for (let i = 0; url && i < 5; i++) {
    const data = await twilioJson(url, auth);
    for (const c of data.contents || []) {
      const status = c.approval_requests?.status || c.approvals?.whatsapp?.status || '';
      out.set(c.friendly_name, { sid: c.sid, status: String(status).toLowerCase() });
    }
    url = data.meta?.next_page_url || null;
  }
  // Fallback if the list didn't carry a status: ask each of our templates.
  for (const def of Object.values(T)) {
    const t = out.get(def.name);
    if (!t || t.status) continue;
    try {
      const a = await twilioJson(`https://content.twilio.com/v1/Content/${t.sid}/ApprovalRequests`, auth);
      t.status = String(a.whatsapp?.status || '').toLowerCase();
    } catch { /* keep empty → treated as not approved yet */ }
  }
  return out;
}

// Create + submit any template from T that doesn't exist yet. Idempotent.
async function ensureTemplates(auth) {
  const existing = await listTemplates(auth);
  const created = [];
  for (const def of Object.values(T)) {
    if (existing.has(def.name)) continue;
    const variables = Object.fromEntries(def.samples.map((s, i) => [String(i + 1), s]));
    const types = def.button
      ? { 'twilio/quick-reply': { body: def.body, actions: [def.button] } }
      : { 'twilio/text': { body: def.body } };
    try {
      const c = await twilioJson('https://content.twilio.com/v1/Content', auth, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendly_name: def.name, language: def.lang, variables, types }),
      });
      await twilioJson(`https://content.twilio.com/v1/Content/${c.sid}/ApprovalRequests/whatsapp`, auth, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: def.name, category: 'UTILITY' }),
      });
      existing.set(def.name, { sid: c.sid, status: 'received' });
      created.push(def.name);
    } catch (e) {
      console.error('[team-alerts] template create failed', def.name, e?.message);
    }
  }
  return { templates: existing, created };
}

// Template values: never empty, no line breaks/tabs, no runs of spaces.
function cleanVar(v, empty = 'None') {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim();
  return (s || empty).slice(0, 400);
}

async function sendTemplate(auth, to, sid, values, lang) {
  const empty = lang === 'pt_BR' ? 'Nenhuma' : 'None';
  const vars = Object.fromEntries(values.map((v, i) => [String(i + 1), cleanVar(v, empty)]));
  const form = new URLSearchParams({
    From: WA_FROM(), To: `whatsapp:${to}`, ContentSid: sid, ContentVariables: JSON.stringify(vars),
  });
  try {
    const data = await twilioJson(`https://api.twilio.com/2010-04-01/Accounts/${auth.sid}/Messages.json`, auth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    return { ok: true, sid: data.sid };
  } catch (e) {
    return { ok: false, error: e?.message || 'send failed' };
  }
}

// ─── Time helpers (America/New_York) ─────────────────────────────────
const WD_EN = { Sun: 'Sun', Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat' };
const WD_PT = { Sun: 'dom', Mon: 'seg', Tue: 'ter', Wed: 'qua', Thu: 'qui', Fri: 'sex', Sat: 'sáb' };
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function nyParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mi: +p.minute, wd: p.weekday };
}

// One NY calendar day. Offset read at noon (an hour off only on DST days).
function nyDay(y, m, d) {
  const noon = Date.UTC(y, m - 1, d, 12);
  const p = nyParts(noon);
  const startMs = Date.UTC(p.y, p.m - 1, p.d) + (12 - p.hh) * 3_600_000;
  return {
    key: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`,
    startMs, endMs: startMs + 86_400_000, wd: p.wd, y: p.y, m: p.m, d: p.d,
  };
}
const dayFromKey = (key) => { const [y, m, d] = key.split('-').map(Number); return nyDay(y, m, d); };
const isWorkday = (wd) => wd !== 'Sat' && wd !== 'Sun';
function nextWorkday(day) {
  for (let i = 1; i < 8; i++) {
    const n = nyDay(day.y, day.m, day.d + i);
    if (isWorkday(n.wd)) return n;
  }
  return nyDay(day.y, day.m, day.d + 1);
}

function fmtDate(keyOrIso, lang = 'en') {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(keyOrIso))
    ? dayFromKey(keyOrIso)
    : (() => { const p = nyParts(Date.parse(keyOrIso)); return nyDay(p.y, p.m, p.d); })();
  return lang === 'pt'
    ? `${WD_PT[day.wd]}, ${day.d} ${MON_PT[day.m - 1]}`
    : `${WD_EN[day.wd]}, ${MON_EN[day.m - 1]} ${day.d}`;
}
function fmtTime(iso, lang = 'en') {
  const p = nyParts(Date.parse(iso));
  if (lang === 'pt') return `${p.hh}h${p.mi ? String(p.mi).padStart(2, '0') : ''}`;
  const h = p.hh % 12 || 12;
  return `${h}:${String(p.mi).padStart(2, '0')} ${p.hh < 12 ? 'AM' : 'PM'}`;
}
const daysBetweenKeys = (a, b) => Math.round((dayFromKey(b).startMs - dayFromKey(a).startMs) / 86_400_000);

function usd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: v % 1 && Math.abs(v) < 1000 ? 2 : 0 });
}
function toE164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
function prettyPhone(raw) {
  const e = toE164(raw);
  return e ? `(${e.slice(2, 5)}) ${e.slice(5, 8)}-${e.slice(8)}` : (raw || '—');
}
// "A · B · C · +2 more"
function joinList(items, max = 6, lang = 'en') {
  if (!items.length) return '';
  const shown = items.slice(0, max).join(' · ');
  const rest = items.length - max;
  return rest > 0 ? `${shown} · +${rest} ${lang === 'pt' ? 'mais' : 'more'}` : shown;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ─── Job helpers ─────────────────────────────────────────────────────
const salesOwner = (j) => (j?.assigned_to || j?.salesperson_name || '').trim();
const isAttilas = (j) => !salesOwner(j) || /attila/i.test(salesOwner(j));
const clientShort = (j) => `${j?.client_name || 'Client'}${j?.city ? ` (${j.city})` : ''}`;
const jobLine = (j) => `${j?.client_name || 'Client'} - ${j?.address || j?.city || 'no address'}`;

function phasesOf(j) {
  return Array.isArray(j?.phase_data?.phases) ? j.phase_data.phases : [];
}
function phaseComplete(ph) {
  if (ph.completed) return true;
  const items = Array.isArray(ph.items) ? ph.items : [];
  return items.length > 0 && items.every((i) => i.done);
}
function phaseRange(ph) {
  const rows = Array.isArray(ph.schedule) ? ph.schedule : [];
  const starts = [ph.start_date, ...rows.map((r) => r.start_date)].filter(Boolean).sort();
  const ends = [ph.end_date, ...rows.map((r) => r.end_date)].filter(Boolean).sort();
  return { start: starts[0] || null, end: ends[ends.length - 1] || null };
}
function phaseSubs(ph) {
  const rows = Array.isArray(ph.schedule) ? ph.schedule : [];
  const names = rows.map((r) => r.sub_name).filter(Boolean);
  if (ph.sub_name) names.push(ph.sub_name);
  return [...new Set(names)];
}
function latePhases(j, todayKey) {
  return phasesOf(j)
    .map((ph) => ({ ph, ...phaseRange(ph) }))
    .filter((x) => x.end && x.end < todayKey && !phaseComplete(x.ph))
    .map((x) => ({ ...x, daysLate: daysBetweenKeys(x.end, todayKey) }));
}
const eventAssignees = (ev) =>
  (Array.isArray(ev.assigned_to_names) && ev.assigned_to_names.length ? ev.assigned_to_names : [ev.assigned_to_name]).filter(Boolean);

const KIND_EN = {
  sales_visit: 'Sales visit', job_start: 'Job start', service_day: 'Service day', inspection: 'Inspection',
  meeting: 'Meeting', media_visit: 'Media visit', material_delivery: 'Material delivery', cabinet_delivery: 'Cabinet delivery',
};
const KIND_PT = {
  sales_visit: 'visita', job_start: 'início de obra', service_day: 'dia de serviço', inspection: 'inspeção',
  meeting: 'reunião', media_visit: 'mídia', material_delivery: 'entrega de material', cabinet_delivery: 'entrega dos armários',
};
const isDelivery = (k) => k === 'material_delivery' || k === 'cabinet_delivery';
const evKind = (ev) => ev.kind || 'sales_visit';
function evTitle(ev, j) {
  if (j?.client_name) return j.client_name;
  return String(ev.title || '').replace(/^visit:\s*/i, '').split(' — ')[0].trim() || KIND_EN[evKind(ev)];
}

// ─── Data for one tick ───────────────────────────────────────────────
const JOB_COLS = 'id, client_name, address, city, service, client_phone, lead_source, created_by, created_at, pipeline_status, in_pipeline, stage_entered_at, assigned_to, salesperson_name, last_chat_message_at, last_touch_at, phase_data, external_lead_id';
const ACTIVE_STAGES = ['new_lead', 'contacted', 'visit_scheduled', 'visited', 'estimate_draft', 'contract_signed', 'in_progress'];

function must(res, label) {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data || [];
}
// For secondary sources: a missing table/column shouldn't stop every alert.
function soft(res, label) {
  if (res.error) { console.error('[team-alerts]', label, res.error.message); return []; }
  return res.data || [];
}

async function loadPeople() {
  const users = must(await supabase.from('users').select('name, role, phone, active').eq('active', true), 'users');
  const people = {};
  for (const [key, cfg] of Object.entries(TEAM)) {
    const u = users.find((x) => cfg.match.test((x.name || '').trim()));
    if (!u) continue;
    people[key] = { key, ...cfg, name: u.name, first: u.name.trim().split(/\s+/)[0], phone: toE164(u.phone) };
  }
  return people;
}

async function loadData(nowMs) {
  const p = nyParts(nowMs);
  const today = nyDay(p.y, p.m, p.d);
  const nextWd = nextWorkday(today);
  const since = new Date(Math.max(SINCE_MS(), nowMs - LOOKBACK_MS)).toISOString();
  const todayIso = new Date(today.startMs).toISOString();
  const weekAgoIso = new Date(nowMs - 8 * 86_400_000).toISOString();
  const in30 = nyDay(today.y, today.m, today.d + 30).key;

  const [jobs, visitedEvents, events, bills, billsPaidToday, subs, offers, contracts, payments,
    estimatesToday, photos, logs, confirms, purchaseEvents, purchaseLists] = await Promise.all([
    supabase.from('jobs').select(JOB_COLS).in('pipeline_status', ACTIVE_STAGES),
    supabase.from('job_stage_events').select('job_id, changed_at').eq('to_status', 'visited')
      .gte('changed_at', new Date(nowMs - 90 * 86_400_000).toISOString()),
    supabase.from('calendar_events')
      .select('id, kind, title, starts_at, job_id, assigned_to_name, assigned_to_names, location, visit_status')
      .gte('starts_at', todayIso).lt('starts_at', new Date(nextWd.endMs).toISOString())
      .order('starts_at', { ascending: true }),
    supabase.from('bills').select('id, label, amount, due_date, status').eq('status', 'pending')
      .lte('due_date', nextWd.key).order('due_date', { ascending: true }),
    supabase.from('bills').select('id, label, paid_amount, amount, paid_at').eq('status', 'paid').gte('paid_at', todayIso),
    supabase.from('subcontractors').select('id, name, workers_comp_expiry, general_liability_expiry, coi_expiry_date'),
    supabase.from('subcontractor_offers')
      .select('id, job_id, status, accepted_at, rejected_at, start_date, scope_of_work, subcontractors(name)')
      .or(`accepted_at.gte."${since}",rejected_at.gte."${since}"`),
    supabase.from('contracts').select('id, job_id, total_amount, signed_at').eq('status', 'signed').gte('signed_at', since),
    supabase.from('payment_milestones').select('id, contract_id, job_id, label, received_amount, received_at, status')
      .gte('received_at', since).gt('received_amount', 0),
    supabase.from('estimates').select('id, job_id, sent_at').gte('sent_at', todayIso),
    supabase.from('phase_photos').select('job_id, taken_at').gte('taken_at', weekAgoIso),
    supabase.from('job_documents').select('job_id, created_at').eq('folder', 'daily_logs').gte('created_at', weekAgoIso),
    supabase.from('message_log').select('phase_id, job_id').eq('kind', 'sub.confirm'),
    // Client purchase lists (migration 088) — 3pm digest.
    supabase.from('purchase_list_events').select('list_id, job_id, item_id, item_label, to_status, arrives_on, created_at')
      .gte('created_at', new Date(nowMs - LOOKBACK_MS).toISOString()).order('created_at', { ascending: true }),
    supabase.from('purchase_lists').select('id, job_id, status, purchase_list_items(status)').neq('status', 'draft'),
  ]);

  const d = {
    nowMs, p, today, nextWd, since, in30,
    jobs: must(jobs, 'jobs'),
    visitedAt: new Map(),
    events: must(events, 'calendar_events').filter((e) => e.visit_status !== 'cancelled'),
    bills: must(bills, 'bills'),
    billsPaidToday: soft(billsPaidToday, 'bills paid'),
    subs: soft(subs, 'subcontractors'),
    offers: soft(offers, 'subcontractor_offers'),
    contracts: must(contracts, 'contracts'),
    payments: must(payments, 'payment_milestones'),
    estimatesToday: soft(estimatesToday, 'estimates'),
    photos: soft(photos, 'phase_photos'),
    logs: soft(logs, 'job_documents'),
    confirmedPhases: new Set(soft(confirms, 'message_log').map((r) => r.phase_id).filter(Boolean)),
    purchaseEvents: soft(purchaseEvents, 'purchase_list_events'),
    purchaseLists: soft(purchaseLists, 'purchase_lists'),
  };
  for (const e of soft(visitedEvents, 'job_stage_events')) {
    const prev = d.visitedAt.get(e.job_id);
    if (!prev || e.changed_at > prev) d.visitedAt.set(e.job_id, e.changed_at);
  }
  d.jobsById = new Map(d.jobs.map((j) => [j.id, j]));
  // Jobs referenced by events/offers/contracts/payments that aren't in an
  // active stage any more (e.g. completed) — fetch them too.
  const missing = [...new Set([
    ...d.events.map((e) => e.job_id), ...d.offers.map((o) => o.job_id),
    ...d.contracts.map((c) => c.job_id), ...d.payments.map((x) => x.job_id),
    ...d.purchaseEvents.map((e) => e.job_id), ...d.purchaseLists.map((l) => l.job_id),
  ].filter((id) => id && !d.jobsById.has(id)))];
  if (missing.length) {
    for (const j of must(await supabase.from('jobs').select(JOB_COLS).in('id', missing), 'jobs extra')) d.jobsById.set(j.id, j);
  }
  return d;
}

// Last time anything was posted on a job: chat, a checked phase item, a
// phase photo or a daily-log document.
function lastUpdateMs(j, d) {
  const times = [Date.parse(j.last_chat_message_at || '') || 0];
  for (const ph of phasesOf(j)) for (const it of ph.items || []) if (it.done_at) times.push(Date.parse(it.done_at) || 0);
  for (const x of d.photos) if (x.job_id === j.id) times.push(Date.parse(x.taken_at) || 0);
  for (const x of d.logs) if (x.job_id === j.id) times.push(Date.parse(x.created_at) || 0);
  return Math.max(...times);
}

// ─── What each person needs ──────────────────────────────────────────
function inProgress(d) { return d.jobs.filter((j) => j.pipeline_status === 'in_progress'); }
function realLeads(d) {
  return d.jobs.filter((j) => j.in_pipeline !== false && !BULK_IMPORT_CREATORS.has((j.created_by || '').trim()));
}

function salesLists(d) {
  const leads = realLeads(d).filter(isAttilas);
  const visits = d.events.filter((e) => evKind(e) === 'sales_visit'
    && e.starts_at < new Date(d.today.endMs).toISOString()
    && (eventAssignees(e).length === 0 || eventAssignees(e).some((n) => /attila/i.test(n))));
  const toCall = leads.filter((j) => j.pipeline_status === 'new_lead' || j.pipeline_status === 'contacted')
    .sort((a, b) => (a.stage_entered_at || a.created_at || '').localeCompare(b.stage_entered_at || b.created_at || ''));
  const toEstimate = leads.filter((j) => j.pipeline_status === 'visited' || j.pipeline_status === 'estimate_draft')
    .sort((a, b) => (d.visitedAt.get(a.id) || a.stage_entered_at || '').localeCompare(d.visitedAt.get(b.id) || b.stage_entered_at || ''));
  return { visits, toCall, toEstimate };
}
const waitingDays = (iso, nowMs) => Math.max(0, Math.floor((nowMs - (Date.parse(iso || '') || nowMs)) / 86_400_000));

function cardsToUpdate(d) {
  const { visits } = salesLists(d);
  const items = [];
  for (const ev of visits) {
    const j = d.jobsById.get(ev.job_id);
    if (j && j.pipeline_status === 'visit_scheduled' && Date.parse(ev.starts_at) < d.nowMs) items.push(`${j.client_name} (visit today)`);
  }
  for (const j of realLeads(d).filter(isAttilas)) {
    if (!['new_lead', 'contacted', 'visit_scheduled'].includes(j.pipeline_status)) continue;
    const touched = Date.parse(j.last_touch_at || '') || 0;
    if (touched >= d.today.startMs) continue;
    const idle = waitingDays(j.last_touch_at || j.stage_entered_at || j.created_at, d.nowMs);
    if (idle >= 2) items.push(`${j.client_name} (no update in ${idle} days)`);
  }
  return items;
}

function opsLists(d) {
  const billsDue = d.bills.filter((b) => b.due_date > d.today.key && b.due_date <= d.nextWd.key);
  const docs = [];
  for (const s of d.subs) {
    for (const [col, label] of [['general_liability_expiry', 'general liability'], ['workers_comp_expiry', "workers' comp"], ['coi_expiry_date', 'insurance (COI)']]) {
      const v = s[col];
      if (!v || v > d.in30) continue;
      if (col === 'coi_expiry_date' && (s.general_liability_expiry || s.workers_comp_expiry)) continue; // legacy field
      docs.push({ sub: s.name, label, date: v, expired: v < d.today.key });
    }
  }
  docs.sort((a, b) => a.date.localeCompare(b.date));
  const todays = d.events.filter((e) => e.starts_at < new Date(d.today.endMs).toISOString());
  return {
    billsDue, docs,
    deliveries: todays.filter((e) => isDelivery(evKind(e))),
    inspections: todays.filter((e) => evKind(e) === 'inspection'),
  };
}

// Joel: per job, what happens today (calendar + subs working on a phase).
function pmToday(d) {
  const byJob = new Map();
  const add = (j, text, detail) => {
    if (!j) return;
    if (!byJob.has(j.id)) byJob.set(j.id, { j, items: [] });
    byJob.get(j.id).items.push({ text, detail });
  };
  for (const j of inProgress(d)) {
    for (const ph of phasesOf(j)) {
      if (phaseComplete(ph)) continue;
      const rows = (Array.isArray(ph.schedule) && ph.schedule.length) ? ph.schedule : [{ ...phaseRange(ph), sub_name: ph.sub_name }];
      for (const r of rows) {
        if (!r.start_date || r.start_date > d.today.key || (r.end_date || r.start_date) < d.today.key) continue;
        const starts = r.start_date === d.today.key;
        add(j, `${ph.name || 'fase'}${starts ? ' (começa hoje)' : ''}`,
          `${ph.name || 'Fase'}${r.sub_name ? ` — ${r.sub_name}` : ' — sem sub'}${starts ? ' · começa hoje' : ` · até ${fmtDate(r.end_date || r.start_date, 'pt')}`}`);
      }
    }
  }
  for (const ev of d.events) {
    if (ev.starts_at >= new Date(d.today.endMs).toISOString() || evKind(ev) === 'sales_visit' || evKind(ev) === 'meeting') continue;
    const j = d.jobsById.get(ev.job_id);
    const k = KIND_PT[evKind(ev)] || 'evento';
    add(j, `${k} ${fmtTime(ev.starts_at, 'pt')}`, `${k.charAt(0).toUpperCase() + k.slice(1)} às ${fmtTime(ev.starts_at, 'pt')}`);
  }
  return [...byJob.values()];
}

function jobsWithoutUpdate(d, sinceMs) {
  return inProgress(d).filter((j) => lastUpdateMs(j, d) < sinceMs);
}

// Things the owner should know about; also the escalation candidates.
function attention(d) {
  const out = [];
  const twoDays = 2 * 86_400_000;
  for (const j of realLeads(d)) {
    if (j.pipeline_status === 'new_lead') {
      const t = Date.parse(j.stage_entered_at || j.created_at || '') || 0;
      if (t && d.nowMs - t >= twoDays) {
        out.push({ key: `esc:lead:${j.id}`, crossedMs: t + twoDays, reason: 'Lead with no contact for 2 days',
          client: `${j.client_name || 'Client'} (${[j.service, j.city].filter(Boolean).join(', ') || 'lead'})`,
          who: salesOwner(j) || 'Attila', sinceIso: j.stage_entered_at || j.created_at });
      }
    }
    if (j.pipeline_status === 'visited' || j.pipeline_status === 'estimate_draft') {
      const v = d.visitedAt.get(j.id) || (j.pipeline_status === 'visited' ? j.stage_entered_at : null);
      const t = Date.parse(v || '') || 0;
      if (t && d.nowMs - t >= twoDays) {
        out.push({ key: `esc:est:${j.id}`, crossedMs: t + twoDays, reason: 'Visit done 2+ days ago, no estimate sent',
          client: `${j.client_name || 'Client'} (${[j.service, j.city].filter(Boolean).join(', ') || 'visit'})`,
          who: salesOwner(j) || 'Attila', sinceIso: v });
      }
    }
  }
  for (const b of d.bills) {
    if (b.due_date < d.today.key) {
      out.push({ key: `att:bill-overdue:${b.id}`, crossedMs: 0, reason: 'Bill overdue, not paid',
        client: `${b.label} · ${usd(b.amount)}`, who: 'Rafaela', sinceIso: b.due_date, noEscalation: true });
    } else if (b.due_date === d.today.key) {
      out.push({ key: `esc:bill:${b.id}`, crossedMs: d.today.startMs + 15 * 3_600_000, reason: 'Bill due today, not paid',
        client: `${b.label} · ${usd(b.amount)}`, who: 'Rafaela', sinceIso: b.due_date, billToday: true });
    }
  }
  for (const j of inProgress(d)) {
    const last = lastUpdateMs(j, d);
    if (d.nowMs - last >= 7 * 86_400_000) {
      const lastKey = last ? (() => { const q = nyParts(last); return nyDay(q.y, q.m, q.d).key; })() : 'never';
      out.push({ key: `esc:noupdate:${j.id}:${lastKey}`, crossedMs: last ? last + 7 * 86_400_000 : 0,
        reason: 'Job without update for 7 days', client: jobLine(j), who: 'Joel',
        sinceIso: last ? new Date(last).toISOString() : null });
    }
  }
  return out;
}

// ─── Messages to send this tick ──────────────────────────────────────
// Each: { person, t (template def), values, key, kind: 'instant'|'routine' }
// 3pm digest values, or null when no client/team touched a purchase list
// since the previous business day at 3pm (weekend changes roll into Monday).
const PURCHASE_TXT = { not_purchased: 'not purchased', ordered: 'ordered', at_house: 'at the house' };
function purchaseDigest(d) {
  const { today } = d;
  const end = today.startMs + 15 * 3_600_000;
  let prev = nyDay(today.y, today.m, today.d - 1);
  for (let i = 0; i < 7 && !isWorkday(prev.wd); i++) prev = nyDay(prev.y, prev.m, prev.d - 1);
  const start = prev.startMs + 15 * 3_600_000;
  const evs = d.purchaseEvents.filter((e) => { const t = Date.parse(e.created_at); return t >= start && t < end; });
  if (!evs.length) return null;

  const byJob = new Map();
  for (const e of evs) {
    if (!byJob.has(e.job_id)) byJob.set(e.job_id, new Map());
    byJob.get(e.job_id).set(e.item_id || e.item_label, e); // latest change per item wins
  }
  const listByJob = new Map(d.purchaseLists.map((l) => [l.job_id, l]));
  const parts = [...byJob.entries()].map(([jobId, items]) => {
    const name = d.jobsById.get(jobId)?.client_name || 'Client';
    if (listByJob.get(jobId)?.status === 'complete') return `${name}: list complete ✅`;
    const changes = [...items.values()].map((e) => {
      const arrive = e.to_status === 'ordered' && e.arrives_on ? ` (arrives ${fmtDate(e.arrives_on).split(', ')[1]})` : '';
      return `${(e.item_label || 'item').toLowerCase()} ${PURCHASE_TXT[e.to_status] || e.to_status}${arrive}`;
    });
    return `${name}: ${changes.slice(0, 4).join(', ')}${changes.length > 4 ? ` +${changes.length - 4} more` : ''}`;
  });
  const missing = d.purchaseLists
    .filter((l) => l.status === 'sent')
    .map((l) => {
      const items = l.purchase_list_items || [];
      const left = items.filter((i) => i.status !== 'at_house').length;
      return `${d.jobsById.get(l.job_id)?.client_name || 'Client'} ${left} of ${items.length}`;
    });
  return [fmtDate(today.key), plural(byJob.size, 'client', 'clients'), joinList(parts, 4), joinList(missing, 6) || 'None — every list is complete'];
}

function buildQueue(d, people) {
  const q = [];
  const { p, today, nowMs } = d;
  const sinceMs = Date.parse(d.since);
  const workday = isWorkday(today.wd);
  const routineWindow = (from, to) => workday && p.hh >= from && p.hh < to;

  // New lead → Inácio, Attila, Ramon.
  for (const j of realLeads(d)) {
    if (j.pipeline_status !== 'new_lead' || (Date.parse(j.created_at) || 0) < sinceMs) continue;
    // Website booking step 1 saved the contact info but no visit time yet
    // (external_lead_id "web:<id>:start", cleared when they finish). Give them
    // 20 minutes to finish before telling the team to call.
    const unfinished = String(j.external_lead_id || '').endsWith(':start');
    if (unfinished && nowMs - Date.parse(j.created_at) < 20 * 60_000) continue;
    const service = unfinished ? `${j.service || 'Bathroom'} (did not finish booking - call)` : j.service;
    const values = [j.client_name, service, j.city, prettyPhone(j.client_phone), j.lead_source || 'Not set', salesOwner(j) || 'Not assigned'];
    for (const who of ['inacio', 'attila', 'ramon']) q.push({ person: who, t: T.newLead, values, key: `lead:${j.id}:${who}`, kind: 'instant' });
  }
  // Contract signed → Inácio.
  for (const c of d.contracts) {
    const j = d.jobsById.get(c.job_id);
    q.push({ person: 'inacio', t: T.contractSigned, key: `contract:${c.id}`, kind: 'instant',
      values: [j?.client_name, [j?.service, j?.address || j?.city].filter(Boolean).join(' - '), usd(c.total_amount), salesOwner(j) || '—', fmtDate(c.signed_at)] });
  }
  // Payment received → Inácio. (Totals are filled in later by enrichPayments.)
  for (const x of d.payments) {
    q.push({ person: 'inacio', t: T.paymentReceived, key: `pay:${x.id}:${Number(x.received_amount)}`, kind: 'instant', payment: x });
  }
  // Visit in ~2h → Attila. Time-bound: never held, only sent in its window.
  for (const ev of d.events) {
    if (evKind(ev) !== 'sales_visit') continue;
    const mins = (Date.parse(ev.starts_at) - nowMs) / 60_000;
    if (mins < 75 || mins > 135) continue;
    const names = eventAssignees(ev);
    if (names.length && !names.some((n) => /attila/i.test(n))) continue;
    const j = d.jobsById.get(ev.job_id);
    q.push({ person: 'attila', t: T.visitSoon, key: `visit:${ev.id}`, kind: 'timebound',
      values: [fmtTime(ev.starts_at), evTitle(ev, j), j?.address || ev.location || '—', j?.service || '—', prettyPhone(j?.client_phone)] });
  }
  // Sub answered an offer → Rafaela.
  for (const o of d.offers) {
    if (o.status !== 'accepted' && o.status !== 'rejected') continue;
    const j = d.jobsById.get(o.job_id);
    const scope = String(o.scope_of_work || 'Work').split(/[.\n]/)[0].slice(0, 60);
    q.push({ person: 'rafaela', t: T.subOfferAnswer, key: `offer:${o.id}:${o.status}`, kind: 'instant',
      values: [o.subcontractors?.name || 'Subcontractor', o.status === 'accepted' ? 'Accepted ✅' : 'Declined ❌', jobLine(j),
        `${scope}${o.start_date ? `, starts ${fmtDate(o.start_date)}` : ''}`] });
  }
  // Phase starting next business day without a confirmed sub → Rafaela.
  for (const j of d.jobs.filter((x) => x.pipeline_status === 'in_progress' || x.pipeline_status === 'contract_signed')) {
    for (const ph of phasesOf(j)) {
      const { start } = phaseRange(ph);
      if (!start || start <= today.key || start > d.nextWd.key || phaseComplete(ph)) continue;
      const hasSub = phaseSubs(ph).length > 0;
      if (hasSub && d.confirmedPhases.has(ph.id)) continue;
      q.push({ person: 'rafaela', t: T.phaseNoSub, key: `nosub:${j.id}:${ph.id}:${start}`, kind: 'instant',
        values: [jobLine(j), `${ph.name || 'Phase'}${hasSub ? ` (${phaseSubs(ph).join(', ')} not confirmed)` : ' (no sub assigned)'}`, fmtDate(start)] });
    }
  }
  // Phase became late → Joel (PT).
  for (const j of inProgress(d)) {
    for (const x of latePhases(j, today.key)) {
      if (dayFromKey(x.end).endMs < sinceMs) continue; // was already late before go-live
      q.push({ person: 'joel', t: T.pmPhaseLate, key: `late:${j.id}:${x.ph.id}:${x.end}`, kind: 'instant',
        values: [jobLine(j), x.ph.name || 'Fase', fmtDate(x.end, 'pt'), plural(x.daysLate, 'dia', 'dias')] });
    }
  }
  // Escalations → Inácio (only ones that crossed the line after go-live).
  for (const a of attention(d)) {
    if (a.noEscalation || a.crossedMs < sinceMs || a.crossedMs > nowMs) continue;
    q.push({ person: 'inacio', t: T.escalation, key: a.key, kind: 'instant',
      values: [a.reason, a.client, a.who, a.sinceIso ? fmtDate(a.sinceIso) : 'unknown'] });
  }

  // ── Routines ──
  const day = today.key;
  if (routineWindow(people.inacio?.start ?? 7, 12)) {
    const late = inProgress(d).flatMap((j) => latePhases(j, day).map((x) => ({ j, ...x })));
    const todays = d.events.filter((e) => e.starts_at < new Date(today.endMs).toISOString());
    if (late.length || todays.length) {
      q.push({ person: 'inacio', t: T.ownerMorning, key: `am:inacio:${day}`, kind: 'routine',
        values: [people.inacio?.first || 'Inácio', fmtDate(day), String(late.length),
          joinList(late.map((x) => `${clientShort(x.j)}: ${(x.ph.name || 'phase').toLowerCase()}, ${plural(x.daysLate, 'day', 'days')} late`), 4) || 'None',
          todayCounts(todays)] });
    }
  }
  if (routineWindow(END_HOUR, 21)) {
    q.push({ person: 'inacio', t: T.ownerSummary, key: `pm:inacio:${day}`, kind: 'routine', values: summaryValues(d) });
  }
  if (routineWindow(people.attila?.start ?? 8, 12)) {
    const s = salesLists(d);
    if (s.visits.length || s.toCall.length || s.toEstimate.length) {
      q.push({ person: 'attila', t: T.salesMorning, key: `am:attila:${day}`, kind: 'routine',
        values: [people.attila?.first || 'Attila', fmtDate(day),
          String(s.visits.length), joinList(s.visits.map((e) => `${fmtTime(e.starts_at)} ${evTitle(e, d.jobsById.get(e.job_id))}`), 5) || 'None',
          String(s.toCall.length), joinList(s.toCall.map((j) => j.client_name), 6) || 'None',
          String(s.toEstimate.length), joinList(s.toEstimate.map((j) => j.client_name), 6) || 'None'] });
    }
  }
  if (routineWindow(END_HOUR, 20)) {
    const cards = cardsToUpdate(d);
    if (cards.length) {
      q.push({ person: 'attila', t: T.salesUpdateCards, key: `pm:attila:${day}`, kind: 'routine',
        values: [people.attila?.first || 'Attila', String(cards.length), joinList(cards, 5)] });
    }
  }
  if (routineWindow(people.rafaela?.start ?? 8, 12)) {
    const o = opsLists(d);
    if (o.billsDue.length || o.docs.length || o.deliveries.length || o.inspections.length) {
      const total = o.billsDue.reduce((s, b) => s + (Number(b.amount) || 0), 0);
      q.push({ person: 'rafaela', t: T.opsMorning, key: `am:rafaela:${day}`, kind: 'routine',
        values: [people.rafaela?.first || 'Rafaela', fmtDate(day),
          o.billsDue.length ? `${o.billsDue.length} (${usd(total)} total)` : '0',
          joinList(o.billsDue.map((b) => `${b.label} ${usd(b.amount)}`), 4) || 'None',
          String(o.docs.length), joinList(o.docs.map((x) => `${x.sub}: ${x.label} ${x.expired ? 'expired' : 'expires'} ${fmtDate(x.date).split(', ')[1]}`), 3) || 'None',
          String(o.deliveries.length), joinList(o.deliveries.map((e) => `${clientShort(d.jobsById.get(e.job_id)) || evTitle(e)}: ${KIND_EN[evKind(e)].toLowerCase()}`), 3) || 'None',
          String(o.inspections.length), joinList(o.inspections.map((e) => `${clientShort(d.jobsById.get(e.job_id))}: ${fmtTime(e.starts_at)}`), 3) || 'None'] });
    }
  }
  if (routineWindow(8, 12)) {
    const jobsToday = pmToday(d);
    if (jobsToday.length) {
      q.push({ person: 'joel', t: T.pmMorning, key: `am:joel:${day}`, kind: 'routine',
        values: [people.joel?.first || 'Joel', fmtDate(day, 'pt'), String(jobsToday.length),
          joinList(jobsToday.map((x) => `${clientShort(x.j)}: ${x.items.map((i) => i.text).join(', ')}`), 4, 'pt')] });
    }
  }
  if (routineWindow(END_HOUR, 20)) {
    const stale = jobsWithoutUpdate(d, today.startMs);
    if (stale.length) {
      q.push({ person: 'joel', t: T.pmNoUpdate, key: `pm:joel:${day}`, kind: 'routine',
        values: [String(stale.length), joinList(stale.map(clientShort), 6, 'pt')] });
    }
  }
  // Client purchase lists → Inácio, Attila, Rafaela at 3pm, only when
  // something changed since the previous business day's 3pm.
  if (routineWindow(15, END_HOUR)) {
    const pd = purchaseDigest(d);
    if (pd) {
      for (const who of ['inacio', 'attila', 'rafaela']) {
        q.push({ person: who, t: T.purchaseDigest, key: `purchase:${who}:${day}`, kind: 'routine', values: pd });
      }
    }
  }
  if (today.wd === 'Mon' && routineWindow(people.ramon?.start ?? 8, 12)) {
    q.push({ person: 'ramon', t: T.weeklyLeads, key: `weekly:ramon:${day}`, kind: 'routine', weekly: true });
  }
  return q;
}

function todayCounts(events) {
  if (!events.length) return 'nothing scheduled';
  const c = { visit: 0, inspection: 0, delivery: 0, start: 0, other: 0 };
  for (const e of events) {
    const k = evKind(e);
    if (k === 'sales_visit') c.visit++;
    else if (k === 'inspection') c.inspection++;
    else if (isDelivery(k)) c.delivery++;
    else if (k === 'job_start') c.start++;
    else c.other++;
  }
  return [
    c.visit && plural(c.visit, 'visit', 'visits'), c.inspection && plural(c.inspection, 'inspection', 'inspections'),
    c.delivery && plural(c.delivery, 'delivery', 'deliveries'), c.start && plural(c.start, 'job start', 'job starts'),
    c.other && plural(c.other, 'other event', 'other events'),
  ].filter(Boolean).join(' · ');
}

function todaysFacts(d) {
  const todayIso = new Date(d.today.startMs).toISOString();
  const leads = realLeads(d).filter((j) => (j.created_at || '') >= todayIso);
  const visited = [...d.visitedAt.entries()].filter(([, t]) => t >= todayIso).map(([id]) => d.jobsById.get(id)).filter(Boolean);
  const contracts = d.contracts.filter((c) => (c.signed_at || '') >= todayIso);
  const payments = d.payments.filter((x) => (x.received_at || '') >= todayIso);
  const estimates = d.estimatesToday;
  return { leads, visited, contracts, payments, estimates, billsPaid: d.billsPaidToday };
}

function summaryValues(d) {
  const f = todaysFacts(d);
  const sum = (rows, col) => rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
  const needs = attention(d).filter((a) => a.crossedMs <= d.nowMs);
  return [
    fmtDate(d.today.key), String(f.leads.length), String(f.visited.length), String(new Set(f.estimates.map((e) => e.job_id)).size),
    f.contracts.length ? `${f.contracts.length} (${usd(sum(f.contracts, 'total_amount'))})` : '0',
    usd(sum(f.payments, 'received_amount')),
    f.billsPaid.length ? `${f.billsPaid.length} (${usd(f.billsPaid.reduce((s, b) => s + (Number(b.paid_amount ?? b.amount) || 0), 0))})` : '0',
    String(needs.length),
  ];
}

async function weeklyValues(d) {
  const lastMon = nyDay(d.today.y, d.today.m, d.today.d - 7);
  const sun = nyDay(d.today.y, d.today.m, d.today.d - 1);
  const from = new Date(lastMon.startMs).toISOString();
  const to = new Date(d.today.startMs).toISOString();
  const [leads, visits, ests, cons] = await Promise.all([
    supabase.from('jobs').select('lead_source, created_by').gte('created_at', from).lt('created_at', to),
    supabase.from('calendar_events').select('id, kind').gte('starts_at', from).lt('starts_at', to),
    supabase.from('estimates').select('job_id').gte('sent_at', from).lt('sent_at', to),
    supabase.from('contracts').select('total_amount').eq('status', 'signed').gte('signed_at', from).lt('signed_at', to),
  ]);
  const real = must(leads, 'weekly leads').filter((j) => !BULK_IMPORT_CREATORS.has((j.created_by || '').trim()));
  const bySource = {};
  for (const j of real) { const k = (j.lead_source || '').trim() || 'Not set'; bySource[k] = (bySource[k] || 0) + 1; }
  const sources = Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
  const c = must(cons, 'weekly contracts');
  return [
    `${MON_EN[lastMon.m - 1]} ${lastMon.d} to ${MON_EN[sun.m - 1]} ${sun.d}`, String(real.length), sources || 'None',
    String(must(visits, 'weekly visits').filter((e) => (e.kind || 'sales_visit') === 'sales_visit').length),
    String(new Set(must(ests, 'weekly estimates').map((e) => e.job_id)).size),
    c.length ? `${c.length} (${usd(c.reduce((s, r) => s + (Number(r.total_amount) || 0), 0))})` : '0',
  ];
}

async function paymentValues(d, x) {
  const j = d.jobsById.get(x.job_id);
  let total = null, paid = Number(x.received_amount) || 0;
  if (x.contract_id) {
    const [con, ms] = await Promise.all([
      supabase.from('contracts').select('total_amount').eq('id', x.contract_id).maybeSingle(),
      supabase.from('payment_milestones').select('received_amount').eq('contract_id', x.contract_id),
    ]);
    total = Number(con.data?.total_amount) || null;
    paid = (ms.data || []).reduce((s, r) => s + (Number(r.received_amount) || 0), 0);
  }
  return [
    j?.client_name, `${usd(x.received_amount)}${x.label ? ` (${x.label})` : ''}`,
    total ? `${usd(paid)} of ${usd(total)}` : usd(paid), total ? usd(Math.max(0, total - paid)) : '—',
  ];
}

// ─── Main entry (called every 15 min) ────────────────────────────────
export async function runTeamAlerts(nowMs = Date.now()) {
  if (OFF()) return { status: 'off' };
  if (!supabase) return { status: 'no_supabase' };
  const auth = twilioAuth();
  if (!auth) return { status: 'no_twilio' };

  const { templates, created } = await ensureTemplates(auth);
  const [people, d] = await Promise.all([loadPeople(), loadData(nowMs)]);

  const sentRows = must(await supabase.from('audit_log').select('details, timestamp')
    .eq('action', 'team_alert.sent').gte('timestamp', new Date(nowMs - 45 * 86_400_000).toISOString()), 'audit_log');
  const sent = new Set(sentRows.map((r) => r.details?.key).filter(Boolean));
  let sentToday = sentRows.filter((r) => Date.parse(r.timestamp) >= d.today.startMs).length;

  const queue = buildQueue(d, people);
  queue.push(...await watcherDownAlert(d));
  const result = { status: 'ok', created, sent: [], held: 0, waiting_approval: [], skipped: [] };
  const pendingApproval = new Set();

  for (const item of queue) {
    if (sent.has(item.key)) continue;
    const person = people[item.person];
    if (!person?.phone) { result.skipped.push(`${item.person}: no phone in app`); continue; }
    // Instant alerts wait for the person's working hours (next business day
    // if needed); routines and time-bound alerts carry their own window.
    if (item.kind === 'instant' || item.kind === 'timebound') {
      const ok = isWorkday(d.today.wd) && d.p.hh >= person.start && d.p.hh < END_HOUR;
      if (!ok) { if (item.kind === 'instant') result.held++; continue; }
    }
    const tpl = templates.get(item.t.name);
    if (!tpl || tpl.status !== 'approved') { pendingApproval.add(item.t.name); continue; }
    if (sentToday >= DAILY_MAX()) { result.skipped.push('daily cap reached'); break; }

    const values = item.values
      || (item.payment ? await paymentValues(d, item.payment) : null)
      || (item.weekly ? await weeklyValues(d) : []);
    const r = await sendTemplate(auth, person.phone, tpl.sid, values, item.t.lang);
    if (!r.ok) { console.error('[team-alerts] send failed', item.t.name, item.person, r.error); result.skipped.push(`${item.t.name}: ${r.error}`); continue; }
    sent.add(item.key);
    sentToday++;
    result.sent.push(`${item.t.name} → ${item.person}`);
    await supabase.from('audit_log').insert([{
      user_name: 'team-alerts', user_role: 'system', action: 'team_alert.sent',
      entity_type: 'whatsapp', entity_id: null,
      details: { key: item.key, person: item.person, template: item.t.name, twilio_sid: r.sid },
    }]);
  }
  result.waiting_approval = [...pendingApproval];
  result.missing_people = Object.keys(TEAM).filter((k) => !people[k]);
  return result;
}

// ─── "See details" replies (free text inside the 24h window) ─────────
const DETAIL_OWNERS = {
  omega_details_owner_am: ['inacio', 'ramon'],
  omega_details_owner_pm: ['inacio', 'ramon'],
  omega_details_sales: ['attila', 'inacio', 'ramon'],
  omega_details_ops: ['rafaela', 'inacio', 'ramon'],
  omega_details_pm: ['joel', 'inacio', 'ramon'],
};

// Returns the reply text, or null when the button/number isn't ours.
export async function teamDetailsReply(fromNumber, payload, nowMs = Date.now()) {
  const allowed = DETAIL_OWNERS[payload];
  if (!allowed || !supabase) return null;
  const people = await loadPeople();
  const who = Object.values(people).find((x) => x.phone === fromNumber);
  if (!who || !allowed.includes(who.key)) return null;
  const d = await loadData(nowMs);
  const text =
    payload === 'omega_details_owner_am' ? ownerMorningDetails(d)
    : payload === 'omega_details_owner_pm' ? ownerSummaryDetails(d)
    : payload === 'omega_details_sales' ? salesDetails(d)
    : payload === 'omega_details_ops' ? opsDetails(d)
    : pmDetails(d);
  return text.length > 1500 ? `${text.slice(0, 1480)}\n…` : text;
}

function section(title, lines, more = 0, lang = 'en') {
  if (!lines.length) return `*${title}*\n${lang === 'pt' ? 'Nada' : 'None'}`;
  const extra = more > 0 ? `\n+${more} ${lang === 'pt' ? 'mais no app' : 'more in the app'}` : '';
  return `*${title}*\n${lines.join('\n')}${extra}`;
}
const cap = (rows, n) => ({ shown: rows.slice(0, n), more: Math.max(0, rows.length - n) });

function ownerMorningDetails(d) {
  const late = inProgress(d).flatMap((j) => latePhases(j, d.today.key).map((x) => ({ j, ...x })))
    .sort((a, b) => b.daysLate - a.daysLate);
  const l = cap(late, 8);
  const todays = d.events.filter((e) => e.starts_at < new Date(d.today.endMs).toISOString());
  const t = cap(todays, 10);
  return [
    `*${fmtDate(d.today.key)}*`,
    section(`⏰ Late jobs (${late.length})`, l.shown.map((x) =>
      `• ${jobLine(x.j)}\n  ${x.ph.name || 'Phase'} · should have ended ${fmtDate(x.end)} · ${plural(x.daysLate, 'day', 'days')} late`), l.more),
    section(`📅 Today (${todays.length})`, t.shown.map((e) => {
      const j = d.jobsById.get(e.job_id);
      return `• ${fmtTime(e.starts_at)} · ${KIND_EN[evKind(e)]} · ${evTitle(e, j)}${j?.city ? ` (${j.city})` : ''}`;
    }), t.more),
  ].join('\n\n');
}

function ownerSummaryDetails(d) {
  const f = todaysFacts(d);
  const needs = attention(d).filter((a) => a.crossedMs <= d.nowMs);
  const n = cap(needs, 10);
  return [
    `*Today at Omega — ${fmtDate(d.today.key)}*`,
    section(`🆕 New leads (${f.leads.length})`, f.leads.slice(0, 8).map((j) => `• ${j.client_name} · ${j.service || '—'} · ${j.city || '—'} · ${j.lead_source || 'no source'}`)),
    section(`🏠 Visits done (${f.visited.length})`, f.visited.slice(0, 8).map((j) => `• ${clientShort(j)}`)),
    section(`✍️ Contracts signed (${f.contracts.length})`, f.contracts.map((c) => `• ${d.jobsById.get(c.job_id)?.client_name || 'Client'} · ${usd(c.total_amount)}`)),
    section(`💵 Payments received (${f.payments.length})`, f.payments.map((x) => `• ${d.jobsById.get(x.job_id)?.client_name || 'Client'} · ${usd(x.received_amount)}${x.label ? ` (${x.label})` : ''}`)),
    section(`💳 Bills paid (${f.billsPaid.length})`, f.billsPaid.slice(0, 8).map((b) => `• ${b.label} · ${usd(b.paid_amount ?? b.amount)}`)),
    section(`🔺 Needs attention (${needs.length})`, n.shown.map((a) => `• ${a.reason}\n  ${a.client} · ${a.who}`), n.more),
  ].join('\n\n');
}

function salesDetails(d) {
  const s = salesLists(d);
  const c = cap(s.toCall, 10);
  const e = cap(s.toEstimate, 8);
  const stage = { new_lead: 'New lead', contacted: 'Contacted' };
  return [
    `*${fmtDate(d.today.key)}*`,
    section(`📅 Visits today (${s.visits.length})`, s.visits.map((ev) => {
      const j = d.jobsById.get(ev.job_id);
      return `• ${fmtTime(ev.starts_at)} — ${evTitle(ev, j)}\n  ${j?.address || ev.location || 'no address'} · ${j?.service || '—'} · ${prettyPhone(j?.client_phone)}`;
    })),
    section(`📞 Leads to call (${s.toCall.length})`, c.shown.map((j) => {
      const w = waitingDays(j.stage_entered_at || j.created_at, d.nowMs);
      return `• ${j.client_name} — ${[j.service, j.city].filter(Boolean).join(', ') || 'lead'}\n  ${prettyPhone(j.client_phone)} · ${stage[j.pipeline_status]} · ${w === 0 ? 'today' : `waiting ${plural(w, 'day', 'days')}`}${w >= 2 ? ' ⚠️' : ''}`;
    }), c.more),
    section(`📝 Estimates to send (${s.toEstimate.length})`, e.shown.map((j) => {
      const v = d.visitedAt.get(j.id) || j.stage_entered_at;
      const w = waitingDays(v, d.nowMs);
      return `• ${j.client_name} — ${[j.service, j.city].filter(Boolean).join(', ') || 'job'}\n  ${v ? `Visit on ${fmtDate(v)} · ` : ''}${plural(w, 'day', 'days')} without estimate${w >= 2 ? ' ⚠️' : ''}`;
    }), e.more),
  ].join('\n\n');
}

function opsDetails(d) {
  const o = opsLists(d);
  const overdue = d.bills.filter((b) => b.due_date < d.today.key);
  const dueToday = d.bills.filter((b) => b.due_date === d.today.key);
  const evLine = (e) => {
    const j = d.jobsById.get(e.job_id);
    return `• ${fmtTime(e.starts_at)} — ${evTitle(e, j)}\n  ${j?.address || e.location || 'no address'} · ${KIND_EN[evKind(e)]}`;
  };
  return [
    `*${fmtDate(d.today.key)}*`,
    section(`🔴 Overdue bills (${overdue.length})`, overdue.slice(0, 8).map((b) => `• ${b.label} · ${usd(b.amount)} · was due ${fmtDate(b.due_date)}`)),
    section(`🟠 Bills due today (${dueToday.length})`, dueToday.map((b) => `• ${b.label} · ${usd(b.amount)}`)),
    section(`💳 Bills due next business day (${o.billsDue.length})`, o.billsDue.map((b) => `• ${b.label} · ${usd(b.amount)} · ${fmtDate(b.due_date)}`)),
    section(`📄 Sub insurance within 30 days (${o.docs.length})`, o.docs.slice(0, 10).map((x) => `• ${x.sub} · ${x.label} · ${x.expired ? 'expired' : 'expires'} ${fmtDate(x.date)}`)),
    section(`🚚 Deliveries today (${o.deliveries.length})`, o.deliveries.map(evLine)),
    section(`🔎 Inspections today (${o.inspections.length})`, o.inspections.map(evLine)),
  ].join('\n\n');
}

function pmDetails(d) {
  const jobs = pmToday(d);
  const stale = jobsWithoutUpdate(d, d.today.startMs);
  return [
    `*${fmtDate(d.today.key, 'pt')}*`,
    jobs.length
      ? jobs.map((x) => `*${jobLine(x.j)}*\n${x.items.map((i) => `• ${i.detail}`).join('\n')}`).join('\n\n')
      : '*Obras com algo previsto hoje*\nNada',
    section(`📝 Sem atualização hoje (${stale.length})`, stale.slice(0, 10).map((j) => `• ${clientShort(j)}`), 0, 'pt'),
  ].join('\n\n');
}

// ─── iMessage group watcher (Inácio's MacBook) ───────────────────────
// tools/imessage-watch runs hourly on the office Mac (signed in to Inácio's
// iCloud, so it sees every client group chat). It asks for the directory
// below, works out which client groups have a client message the team hasn't
// answered, and reports them here. This side decides who gets told and
// when: the person asked, every hour inside their working hours; and at 5pm
// whatever is still unanswered goes to Inácio. daily-owner-update routes
// ?task=imessage here after checking the shared secret.

const last10 = (raw) => String(raw || '').replace(/\D/g, '').slice(-10);

export async function groupWatchDirectory() {
  const people = await loadPeople();
  const jobs = must(await supabase.from('jobs')
    .select('client_name, client_phone, address, city, pipeline_status')
    .not('client_phone', 'is', null)
    .neq('pipeline_status', 'disqualified')
    .limit(5000), 'jobs');
  const clients = [];
  const seen = new Set();
  for (const j of jobs) {
    const digits = last10(j.client_phone);
    if (digits.length !== 10 || seen.has(digits)) continue;
    seen.add(digits);
    clients.push({ digits, name: j.client_name || 'Client', place: (j.address || j.city || '').split(',')[0] });
  }
  // Subcontractors are in many project groups; their messages neither need
  // an answer nor count as one.
  const team = Object.values(people).map((x) => ({ key: x.key, first: x.first, digits: last10(x.phone) }));
  const teamDigits = new Set(team.map((t) => t.digits));
  const subs = soft(await supabase.from('subcontractors').select('phone'), 'subcontractors');
  const ignore = [...new Set(subs.map((s) => last10(s.phone)))]
    .filter((d) => d.length === 10 && !seen.has(d) && !teamDigits.has(d));
  return { me: 'inacio', team, clients, ignore };
}

function waitingText(sinceMs, nowMs, lang) {
  const mins = Math.max(0, Math.round((nowMs - sinceMs) / 60_000));
  const pt = lang === 'pt';
  const dur = mins < 60 ? `${mins} min`
    : mins < 48 * 60 ? plural(Math.floor(mins / 60), pt ? 'hora' : 'hour', pt ? 'horas' : 'hours')
    : plural(Math.floor(mins / 1440), pt ? 'dia' : 'day', pt ? 'dias' : 'days');
  const sp = nyParts(sinceMs);
  const tp = nyParts(nowMs);
  const sameDay = sp.y === tp.y && sp.m === tp.m && sp.d === tp.d;
  const iso = new Date(sinceMs).toISOString();
  const at = `${sameDay ? '' : `${fmtDate(iso, lang)} `}${fmtTime(iso, lang)}`;
  return { dur, at };
}

const MIN_WAIT_MS = 60 * 60_000;

// "No answer needed" — same lists as is_ack() in omega_imessage_watch.py
// (keep both in sync). The current Mac script already drops these, but an older
// copy still reports "Ok thanks!" as unanswered; this side filters it too.
const ACK_TOKENS = new Set(('ok okay k kk thanks thank you u thx ty tysm tks great perfect awesome amazing '
  + 'wonderful excellent fantastic beautiful sounds good looks got it cool nice yes yep yeah yup sure will do '
  + 'appreciate appreciated noted understood alright right fine love np no problem welcome youre glad job done '
  + 'deal obrigado obrigada valeu beleza blz show certo combinado perfeito otimo maravilha top tmj massa legal '
  + 'joia sim ta bom').split(' '));
const ACK_FILLER = new Set(('so much a lot very really again guys team all as always for everything the update '
  + 'info man buddy sir and omega muito pessoal de novo mesmo e pela pelo atualizacao').split(' '));

// 'Edited to "…"' (an edit seen by a Mac without iMessage editing) and
// 'Liked "…"' (a reaction sent as text) aren't new messages — same as
// FALLBACK_RE in omega_imessage_watch.py.
const FALLBACK_RE = /^\s*(edited to|loved|liked|disliked|laughed at|emphasi[sz]ed|questioned|reacted .{1,12} to|removed a .{1,20} from)\s*["“”]/i;

export function isAck(text, names = []) {
  const t = String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (!t || !/[a-z0-9]/.test(t)) return true; // empty / emoji / punctuation only
  if (t.includes('?')) return false;
  const words = t.replace(/['’]/g, '').match(/[a-z0-9]+/g) || [];
  if (!words.length || words.length > 10) return false;
  const skip = new Set([...ACK_FILLER, ...names.filter(Boolean)]);
  const rest = words.filter((w) => !skip.has(w));
  return rest.length > 0 && rest.every((w) => ACK_TOKENS.has(w));
}

// payload: { pending: [{ chat, msg, group, client, text, since, asked, count }], dry_run }
export async function groupWatchReport(payload, nowMs = Date.now()) {
  const auth = twilioAuth();
  if (!auth) return { status: 'no_twilio' };
  const pending = Array.isArray(payload?.pending) ? payload.pending.slice(0, 100) : [];
  const dryRun = payload?.dry_run === true;
  const { templates } = await ensureTemplates(auth);
  const people = await loadPeople();
  const p = nyParts(nowMs);
  const today = nyDay(p.y, p.m, p.d);
  const workday = isWorkday(today.wd);

  const sentRows = must(await supabase.from('audit_log').select('details')
    .eq('action', 'team_alert.sent').gte('timestamp', new Date(nowMs - 3 * 86_400_000).toISOString()), 'audit_log');
  const sent = new Set(sentRows.map((r) => r.details?.key).filter(Boolean));

  const teamNames = Object.values(people).map((x) => String(x.first || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase());
  const plan = [];
  let acksSkipped = 0;
  for (const it of pending) {
    const sinceMs = Date.parse(it.since || '');
    if (!it.chat || !it.msg || !Number.isFinite(sinceMs) || nowMs - sinceMs < MIN_WAIT_MS) continue;
    const count = Number(it.count) || 1;
    // Only "Ok, thanks!" waiting → nothing to answer. With more messages
    // (count > 1) an older Mac only sends the first one's text, and a real
    // question may come after it, so those still alert.
    if (count === 1 && (isAck(it.text, teamNames) || FALLBACK_RE.test(String(it.text || '')))) { acksSkipped++; continue; }
    const quote = `"${String(it.text || '[attachment]').replace(/\s+/g, ' ').slice(0, 200)}"${count > 1 ? ` (+${count - 1} more)` : ''}`;
    const group = String(it.group || 'Client group').slice(0, 80);
    const client = String(it.client || 'Client').slice(0, 80);
    const asked = people[it.asked] || people.inacio;
    // The person asked: every hour inside their working hours.
    if (asked?.phone && workday && p.hh >= asked.start && p.hh < END_HOUR) {
      const w = waitingText(sinceMs, nowMs, asked.lang);
      plan.push({ person: asked, t: asked.lang === 'pt' ? T.groupWaitingPt : T.groupWaiting,
        key: `grp:${it.chat}:${it.msg}:${today.key}T${p.hh}`,
        values: [group, client, quote, `${w.dur} (${asked.lang === 'pt' ? 'desde' : 'since'} ${w.at})`] });
    }
    // End of day: whatever is still unanswered goes to Inácio, once a day.
    if (people.inacio?.phone && workday && p.hh >= END_HOUR && p.hh < 21) {
      const w = waitingText(sinceMs, nowMs, 'en');
      plan.push({ person: people.inacio, t: T.groupOwner, key: `grpesc:${it.chat}:${it.msg}:${today.key}`,
        values: [group, client, asked?.first || 'Inácio', quote, `${w.at} (${w.dur})`] });
    }
  }

  const result = { status: 'ok', groups_pending: pending.length, sent: [], planned: [], waiting_approval: [] };
  for (const item of plan) {
    if (sent.has(item.key)) continue;
    if (dryRun) { result.planned.push({ to: item.person.key, template: item.t.name, values: item.values }); continue; }
    const tpl = templates.get(item.t.name);
    if (!tpl || tpl.status !== 'approved') { result.waiting_approval.push(item.t.name); continue; }
    const r = await sendTemplate(auth, item.person.phone, tpl.sid, item.values, item.t.lang);
    if (!r.ok) { console.error('[group-watch] send failed', item.t.name, r.error); continue; }
    sent.add(item.key);
    result.sent.push(`${item.t.name} → ${item.person.key}`);
    await supabase.from('audit_log').insert([{
      user_name: 'team-alerts', user_role: 'system', action: 'team_alert.sent', entity_type: 'whatsapp', entity_id: null,
      details: { key: item.key, person: item.person.key, template: item.t.name, twilio_sid: r.sid },
    }]);
  }
  // Heartbeat (counts only) so a stopped Mac gets noticed.
  if (!dryRun) {
    await supabase.from('audit_log').insert([{
      user_name: 'imessage-watch', user_role: 'system', action: 'imessage_watch.report', entity_type: 'imessage', entity_id: null,
      // version: which copy of the Mac script is running (null = older than v3).
      details: {
        pending: pending.length, sent: result.sent.length, acks_skipped: acksSkipped, version: payload?.version || null,
        // Why each group counts as unanswered (Mac v4+: threads merged, last
        // team answer, unknown handles) — for checking a "but we answered!"
        // alert without going to the Mac. No message text.
        items: pending.slice(0, 20).map((it) => ({
          group: String(it.group || '').slice(0, 60), client: String(it.client || '').slice(0, 60),
          since: it.since || null, asked: it.asked || null, count: Number(it.count) || 1, diag: it.diag || null,
        })),
      },
    }]);
  }
  result.waiting_approval = [...new Set(result.waiting_approval)];
  return result;
}

// If the Mac has reported before but not in the last 3 hours of a workday,
// tell Ramon once that day (usually it's asleep, logged out or offline).
async function watcherDownAlert(d) {
  if (!isWorkday(d.today.wd) || d.p.hh < 10 || d.p.hh >= END_HOUR) return [];
  const { data } = await supabase.from('audit_log').select('timestamp')
    .eq('action', 'imessage_watch.report').order('timestamp', { ascending: false }).limit(1);
  const last = Date.parse(data?.[0]?.timestamp || '');
  if (!Number.isFinite(last) || d.nowMs - last < 3 * 3_600_000) return [];
  return [{ person: 'ramon', t: T.escalation, key: `watchdown:${d.today.key}`, kind: 'routine',
    values: ['Office Mac stopped checking the client group chats', "Inácio's MacBook (group-chat watcher)", 'Ramon', fmtDate(new Date(last).toISOString())] }];
}
