// Owner WhatsApp assistant.
//
// Inácio texts the Omega WhatsApp number (+1 825-462-3700); Twilio posts the
// message to /api/twilio-send?task=inbound; this module answers in English
// using Claude with READ-ONLY tools over the app database (service role,
// server side only). Only numbers in OWNER_BOT_ALLOWED_FROM get answers;
// anything else is forwarded to the team inbox and never sees data.
//
// Env:
//   OWNER_BOT_ALLOWED_FROM     comma-separated E.164 numbers allowed to ask
//   OWNER_BOT_DAILY_CAP_USD    hard daily spend cap (default 4)
//   OWNER_BOT_WEBHOOK_URL      exact URL configured in Twilio (signature)
//   OWNER_BOT_MODEL            default claude-sonnet-5-5
//   OWNER_BOT_FORWARD_TO       inbox for non-owner messages (default team@omeganyct.com)
//   ANTHROPIC_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, RESEND_API_KEY,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createHmac, timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { supabase } from './supabase.js';

const NY_TZ = 'America/New_York';
const SID = () => process.env.TWILIO_ACCOUNT_SID || '';
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN || '';
const ALLOWED = () =>
  (process.env.OWNER_BOT_ALLOWED_FROM || '').split(',').map((s) => s.trim()).filter(Boolean);
const DAILY_CAP = () => Number(process.env.OWNER_BOT_DAILY_CAP_USD || 4);
const WEBHOOK_URL = () =>
  process.env.OWNER_BOT_WEBHOOK_URL || 'https://omega-unified.vercel.app/api/twilio-send?task=inbound';
const MODEL = () => process.env.OWNER_BOT_MODEL || 'claude-sonnet-5-5';

// USD per million tokens (platform.claude.com pricing, checked 2026-10-12).
const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
};
const TWILIO_MSG_USD = 0.005; // per WhatsApp message in or out (Twilio fee)
const MAX_TURNS = 6;
const HISTORY_MINUTES = 60;

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// ─── Entry point ─────────────────────────────────────────────────
export async function handleInbound(req, res) {
  const raw = await readRaw(req);
  const params = Object.fromEntries(new URLSearchParams(raw));
  if (!validSignature(WEBHOOK_URL(), params, req.headers['x-twilio-signature'])) {
    res.statusCode = 403;
    return res.end('forbidden');
  }
  // Answer Twilio right away (it gives up after ~15s); the reply goes out
  // through the REST API once Claude is done.
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml');
  res.end(EMPTY_TWIML);

  waitUntil(
    processMessage(params).catch((e) => console.error('[owner-bot] failed', e?.message || e))
  );
}

async function processMessage(p) {
  const from = String(p.From || ''); // "whatsapp:+1203..."
  const to = String(p.To || '');
  const text = String(p.Body || '').trim();
  const number = from.replace(/^whatsapp:/, '');

  if (!ALLOWED().includes(number)) {
    await forwardToTeam(number, text, p);
    return;
  }
  if (!supabase) return reply(to, from, 'The assistant is not configured yet (database).');
  if (!text) return reply(to, from, 'I can only read text messages for now. Please type your question.');

  const spent = await spentToday();
  if (spent >= DAILY_CAP()) {
    await reply(to, from, `Daily limit of $${DAILY_CAP()} reached for the assistant. It resumes tomorrow.`);
    return;
  }

  const history = await recentHistory(number);
  const result = await runAgent(text, history);

  let out = result.text || "Sorry, I couldn't produce an answer.";
  if (out.length > 1500) out = out.slice(0, 1490) + '…';
  await reply(to, from, out);
  for (const doc of result.attachments.slice(0, 5)) {
    await reply(to, from, doc.title || 'Document', doc.url);
  }

  const cost =
    result.costUsd + TWILIO_MSG_USD * (2 + result.attachments.slice(0, 5).length);
  await supabase.from('audit_log').insert([{
    user_name: 'owner-bot', user_role: 'system', action: 'owner_bot.qa',
    entity_type: 'whatsapp', entity_id: null,
    details: {
      from: number, q: text.slice(0, 2000), a: out, tools: result.toolsUsed,
      attachments: result.attachments.map((a) => a.title),
      model: result.model, usage: result.usage, cost_usd: Number(cost.toFixed(5)),
      unanswered: !!result.unanswered,
    },
  }]);
}

// ─── Claude agent loop ───────────────────────────────────────────
const SYSTEM = `You are the private assistant of Inácio DeOliveira, owner of Omega Development LLC (home construction & remodeling, Westport CT). He asks from WhatsApp, usually from a job site.

Rules:
- Answer in English, short and scannable (WhatsApp; no markdown tables, no headings). Use plain lines and bullets "•".
- Use ONLY facts returned by the tools. Never invent names, amounts, dates or phone numbers. If a tool returns nothing, say clearly what you looked for and that you couldn't find it, and offer the closest alternative you did find.
- If a name matches more than one client/job, list them briefly and ask which one — do not guess.
- Money: always say whether it's paid, remaining or overdue, with the source (e.g. "per payment schedule").
- Dates are America/New_York. Today is {{TODAY}}.
- When he asks for a contract/document file, call attach_document with the URL the tools returned (only those URLs). Mention the file is attached.
- You are read-only: you cannot change anything in the app, move cards, or message clients. If asked, say so.
- If the question is outside Omega's app data, say you can only answer from the app.`;

const TOOLS = [
  { name: 'find_client', description: 'Search clients/jobs by client name, street/address, town, or phone. Returns matching jobs (a client can have several).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'get_contract', description: 'Contract for a job: status, total, deposit, payment plan, signed date, estimate summary, signed change orders, and the signed PDF URL if stored.',
    input_schema: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
  { name: 'get_payments', description: 'What the client has paid and what remains for a job: payment milestones (due, received, overdue), signed change orders, totals.',
    input_schema: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
  { name: 'get_schedule', description: 'Calendar (visits, job starts, deliveries, inspections, meetings) plus subcontractor phase dates between two dates (YYYY-MM-DD, inclusive, New York time).',
    input_schema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' }, person: { type: 'string', description: 'optional name filter' } }, required: ['start_date', 'end_date'] } },
  { name: 'get_job_status', description: 'Pipeline stage, % complete, current phase, phase dates, and late phases for a job.',
    input_schema: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
  { name: 'whats_late', description: 'Company-wide: late phases on jobs in progress, overdue client payments, materials still needed.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'list_documents', description: 'Documents stored for a job (contracts, invoices, permits, building plans, checks, change orders) with URLs.',
    input_schema: { type: 'object', properties: { job_id: { type: 'string' }, folder: { type: 'string' } }, required: ['job_id'] } },
  { name: 'attach_document', description: 'Send a document file to Inácio on WhatsApp. Only use a URL returned by get_contract or list_documents.',
    input_schema: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' } }, required: ['url', 'title'] } },
];

async function runAgent(question, history) {
  const key = (process.env.ANTHROPIC_KEY || '').trim();
  const model = MODEL();
  const price = PRICES[model] || PRICES['claude-sonnet-5-5'];
  const out = { text: '', attachments: [], toolsUsed: [], costUsd: 0, usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, model, unanswered: false };
  if (!key) { out.text = 'The assistant is not configured yet (AI key).'; return out; }

  const system = [{ type: 'text', text: SYSTEM.replace('{{TODAY}}', nyToday().label), cache_control: { type: 'ephemeral' } }];
  const tools = TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  const messages = [...history, { role: 'user', content: question }];
  const allowedUrls = new Set();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const payload = { model, max_tokens: 1200, system, tools, messages };
    const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    if (model.startsWith('claude-sonnet-5-5')) {
      payload.fallbacks = 'default';
      payload.output_config = { effort: 'low' };
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[owner-bot] anthropic', r.status, data?.error?.message);
      out.text = "Sorry — I couldn't reach the assistant right now. Please try again in a minute.";
      out.unanswered = true;
      return out;
    }
    const u = data.usage || {};
    out.usage.in += u.input_tokens || 0;
    out.usage.out += u.output_tokens || 0;
    out.usage.cacheRead += u.cache_read_input_tokens || 0;
    out.usage.cacheWrite += u.cache_creation_input_tokens || 0;
    out.costUsd =
      (out.usage.in * price.in + out.usage.out * price.out +
        out.usage.cacheRead * price.cacheRead + out.usage.cacheWrite * price.cacheWrite) / 1e6;

    const blocks = Array.isArray(data.content) ? data.content : [];
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !toolUses.length) {
      out.text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return out;
    }
    messages.push({ role: 'assistant', content: blocks });
    const results = [];
    for (const tu of toolUses) {
      out.toolsUsed.push(tu.name);
      let result;
      try {
        if (tu.name === 'attach_document') {
          const url = String(tu.input?.url || '');
          if (allowedUrls.has(url)) {
            out.attachments.push({ url, title: String(tu.input?.title || 'Document').slice(0, 120) });
            result = { ok: true, queued: true };
          } else {
            result = { ok: false, error: 'URL not returned by a tool in this conversation; refusing.' };
          }
        } else {
          result = await runTool(tu.name, tu.input || {});
          collectUrls(result, allowedUrls);
        }
      } catch (e) {
        result = { error: e?.message || String(e) };
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 12_000) });
    }
    messages.push({ role: 'user', content: results });
  }
  out.text = 'That needed more steps than I can do in one message. Could you narrow the question?';
  out.unanswered = true;
  return out;
}

function collectUrls(value, set) {
  if (!value) return;
  if (typeof value === 'string') {
    if (/^https:\/\//.test(value) && value.includes('/storage/v1/object/')) set.add(value);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v) => collectUrls(v, set));
  if (typeof value === 'object') Object.values(value).forEach((v) => collectUrls(v, set));
}

// ─── Read-only tools ─────────────────────────────────────────────
const JOB_COLS = 'id,client_name,client_phone,client_email,address,city,unit_number,service,pipeline_status,in_pipeline,salesperson_name,pm_name,created_at';

async function runTool(name, input) {
  switch (name) {
    case 'find_client': return findClient(String(input.query || ''));
    case 'get_contract': return getContract(String(input.job_id || ''));
    case 'get_payments': return getPayments(String(input.job_id || ''));
    case 'get_schedule': return getSchedule(String(input.start_date || ''), String(input.end_date || ''), input.person ? String(input.person) : '');
    case 'get_job_status': return getJobStatus(String(input.job_id || ''));
    case 'whats_late': return whatsLate();
    case 'list_documents': return listDocuments(String(input.job_id || ''), input.folder ? String(input.folder) : '');
    default: return { error: `unknown tool ${name}` };
  }
}

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(s);

async function findClient(query) {
  const q = query.trim();
  if (!q) return { matches: [] };
  const digits = q.replace(/\D/g, '');
  let rows = [];
  if (digits.length >= 7) {
    const { data, error } = await supabase.from('jobs').select(JOB_COLS)
      .like('client_phone_digits', `%${digits.slice(-10)}%`).order('created_at', { ascending: false }).limit(8);
    if (error) throw error;
    rows = data || [];
  }
  if (!rows.length) {
    const term = q.replace(/[%,()]/g, ' ').trim();
    const { data, error } = await supabase.from('jobs').select(JOB_COLS)
      .or(`client_name.ilike.%${term}%,address.ilike.%${term}%,city.ilike.%${term}%`)
      .order('created_at', { ascending: false }).limit(8);
    if (error) throw error;
    rows = data || [];
  }
  return {
    matches: rows.map((j) => ({
      job_id: j.id, client: j.client_name, phone: j.client_phone, email: j.client_email,
      address: [j.address, j.unit_number && `Unit ${j.unit_number}`, j.city].filter(Boolean).join(', '),
      service: j.service, stage: j.pipeline_status,
      archived: j.pipeline_status === 'completed' && j.in_pipeline === false,
      salesperson: j.salesperson_name, pm: j.pm_name, created: (j.created_at || '').slice(0, 10),
    })),
  };
}

async function getContract(jobId) {
  if (!isUuid(jobId)) return { error: 'job_id must be a job id from find_client' };
  const { data: contracts, error } = await supabase.from('contracts')
    .select('id,status,total_amount,deposit_amount,payment_plan,sent_at,signed_at,docusign_status,estimate_id,estimate_ids,created_at')
    .eq('job_id', jobId).order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  const c = contracts?.[0];
  if (!c) return { contract: null, note: 'No contract record for this job.' };

  const estIds = [...new Set([c.estimate_id, ...(Array.isArray(c.estimate_ids) ? c.estimate_ids : [])].filter(Boolean))];
  let estimates = [];
  if (estIds.length) {
    const { data } = await supabase.from('estimates')
      .select('id,header_description,option_label,total_amount,sections').in('id', estIds);
    estimates = (data || []).map((e) => ({
      option: e.option_label, description: e.header_description, total: e.total_amount,
      scope: summarizeSections(e.sections),
    }));
  }
  const { data: cos } = await supabase.from('change_orders')
    .select('description,amount,status,paid,signed_at').eq('job_id', jobId).eq('status', 'signed');
  const { data: docs } = await supabase.from('job_documents')
    .select('title,photo_url,created_at').eq('job_id', jobId).eq('folder', 'contracts')
    .order('created_at', { ascending: false }).limit(5);
  return {
    contract: {
      status: c.status, total: c.total_amount, deposit: c.deposit_amount,
      sent: (c.sent_at || '').slice(0, 10) || null, signed: (c.signed_at || '').slice(0, 10) || null,
      docusign: c.docusign_status, payment_plan: c.payment_plan,
    },
    estimates,
    signed_change_orders: cos || [],
    pdfs: (docs || []).filter((d) => d.photo_url).map((d) => ({ title: d.title, url: d.photo_url, date: (d.created_at || '').slice(0, 10) })),
  };
}

function summarizeSections(sections) {
  if (!Array.isArray(sections)) return null;
  return sections.slice(0, 12).map((s) => s?.title || s?.name || s?.label).filter(Boolean);
}

async function getPayments(jobId) {
  if (!isUuid(jobId)) return { error: 'job_id must be a job id from find_client' };
  const today = nyToday();
  const { data: ms, error } = await supabase.from('payment_milestones')
    .select('label,order_idx,due_amount,due_date,received_amount,received_at,status,invoice_sent_at')
    .eq('job_id', jobId).order('order_idx', { ascending: true });
  if (error) throw error;
  const { data: cos } = await supabase.from('change_orders')
    .select('description,amount,paid').eq('job_id', jobId).eq('status', 'signed');
  const milestones = (ms || []).map((m) => {
    let st = m.status;
    if (st === 'pending' && m.due_date) {
      const late = daysBetween(m.due_date, today.key);
      st = late > 3 ? 'overdue' : late >= 0 ? 'due now' : 'upcoming';
    }
    return { label: m.label, due: m.due_amount, due_date: m.due_date, received: m.received_amount || 0, received_on: (m.received_at || '').slice(0, 10) || null, status: st, invoice_sent: !!m.invoice_sent_at };
  });
  const coTotal = (cos || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const coPaid = (cos || []).filter((c) => c.paid).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const scheduled = milestones.reduce((s, m) => s + (Number(m.due) || 0), 0);
  const received = milestones.reduce((s, m) => s + (Number(m.received) || 0), 0);
  let fallback = null;
  if (!milestones.length) {
    const { data: jc } = await supabase.from('job_costs').select('estimated_revenue,amount_received').eq('job_id', jobId).limit(1);
    if (jc?.[0]) fallback = { contract_value: jc[0].estimated_revenue, received: jc[0].amount_received, note: 'From job costs (no payment schedule in the app).' };
  }
  return {
    milestones,
    totals: milestones.length ? { scheduled, received, remaining: scheduled - received } : null,
    change_orders: { signed_total: coTotal, paid: coPaid, unpaid: coTotal - coPaid, items: cos || [] },
    fallback,
  };
}

async function getSchedule(start, end, person) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return { error: 'dates must be YYYY-MM-DD' };
  const startIso = new Date(nyMidnightMs(start)).toISOString();
  const endIso = new Date(nyMidnightMs(end) + 86_400_000).toISOString();
  const { data, error } = await supabase.from('calendar_events')
    .select('kind,title,starts_at,ends_at,all_day,location,assigned_to_name,assigned_to_names,visit_status,job_id')
    .lt('starts_at', endIso).gt('ends_at', startIso).order('starts_at', { ascending: true }).limit(80);
  if (error) throw error;
  let events = (data || []).filter((e) => e.visit_status !== 'cancelled').map((e) => ({
    when: e.all_day ? `${nyDateKey(e.starts_at)} (all day)` : `${nyDateKey(e.starts_at)} ${nyTime(e.starts_at)}–${nyTime(e.ends_at)}`,
    kind: e.kind, title: e.title, where: e.location,
    who: (e.assigned_to_names && e.assigned_to_names.length ? e.assigned_to_names : [e.assigned_to_name]).filter(Boolean).join(', '),
    status: e.visit_status,
  }));
  if (person) {
    const p = person.toLowerCase();
    events = events.filter((e) => (e.who || '').toLowerCase().includes(p) || (e.title || '').toLowerCase().includes(p));
  }
  // Subcontractor phase work dates live in jobs.phase_data.
  const { data: jobs } = await supabase.from('jobs').select('id,client_name,address,phase_data').eq('pipeline_status', 'in_progress').limit(60);
  const subWork = [];
  for (const j of jobs || []) {
    for (const ph of j.phase_data?.phases || []) {
      for (const s of ph.schedule || []) {
        if (s.start_date && s.start_date <= end && (s.end_date || s.start_date) >= start) {
          subWork.push({ client: j.client_name, address: j.address, phase: ph.name, sub: s.sub_name, from: s.start_date, to: s.end_date || s.start_date });
        }
      }
    }
  }
  return { range: `${start} to ${end}`, events, sub_work: subWork.slice(0, 60) };
}

async function getJobStatus(jobId) {
  if (!isUuid(jobId)) return { error: 'job_id must be a job id from find_client' };
  const { data, error } = await supabase.from('jobs')
    .select('client_name,address,service,pipeline_status,stage_entered_at,phase_data').eq('id', jobId).limit(1);
  if (error) throw error;
  const j = data?.[0];
  if (!j) return { error: 'job not found' };
  const today = nyToday().key;
  const phases = (j.phase_data?.phases || []).map((ph) => {
    const items = ph.items || [];
    const done = items.filter((i) => i.done).length;
    const complete = ph.completed || (items.length > 0 && done === items.length);
    return {
      phase: ph.name, done: `${done}/${items.length}`, complete,
      start: ph.start_date || null, end: ph.end_date || null, sub: ph.sub_name || null,
      late: !complete && !!ph.end_date && ph.end_date < today,
    };
  });
  const totalItems = phases.reduce((s, p) => s + Number(p.done.split('/')[1]), 0);
  const totalDone = phases.reduce((s, p) => s + Number(p.done.split('/')[0]), 0);
  const current = phases.find((p) => !p.complete)?.phase || (phases.length ? phases[phases.length - 1].phase : null);
  return {
    client: j.client_name, address: j.address, service: j.service,
    stage: j.pipeline_status, in_stage_since: (j.stage_entered_at || '').slice(0, 10) || null,
    progress_pct: totalItems ? Math.round((totalDone / totalItems) * 100) : 0,
    current_phase: current, phases, late_phases: phases.filter((p) => p.late).map((p) => p.phase),
  };
}

async function whatsLate() {
  const today = nyToday().key;
  const { data: jobs } = await supabase.from('jobs').select('id,client_name,address,phase_data').eq('pipeline_status', 'in_progress').limit(80);
  const latePhases = [];
  for (const j of jobs || []) {
    for (const ph of j.phase_data?.phases || []) {
      const items = ph.items || [];
      const complete = ph.completed || (items.length > 0 && items.every((i) => i.done));
      if (!complete && ph.end_date && ph.end_date < today) {
        latePhases.push({ client: j.client_name, phase: ph.name, was_due: ph.end_date, days_late: daysBetween(ph.end_date, today) });
      }
    }
  }
  const { data: ms } = await supabase.from('payment_milestones')
    .select('job_id,label,due_amount,due_date,received_amount').eq('status', 'pending').lt('due_date', today).limit(100);
  const overdue = (ms || []).filter((m) => daysBetween(m.due_date, today) > 3);
  const names = await jobNames([...new Set(overdue.map((m) => m.job_id))]);
  const { data: mats } = await supabase.from('job_materials').select('job_id,name,quantity,added_at').eq('status', 'needed').order('added_at', { ascending: true }).limit(40);
  const matNames = await jobNames([...new Set((mats || []).map((m) => m.job_id))]);
  return {
    late_phases: latePhases.sort((a, b) => b.days_late - a.days_late).slice(0, 30),
    overdue_payments: overdue.map((m) => ({ client: names[m.job_id] || 'unknown', label: m.label, amount: m.due_amount, due_date: m.due_date, days_overdue: daysBetween(m.due_date, today) })),
    materials_needed: (mats || []).map((m) => ({ client: matNames[m.job_id] || 'unknown', item: m.name, qty: m.quantity, since: (m.added_at || '').slice(0, 10) })),
  };
}

async function listDocuments(jobId, folder) {
  if (!isUuid(jobId)) return { error: 'job_id must be a job id from find_client' };
  let q = supabase.from('job_documents').select('folder,title,photo_url,created_at').eq('job_id', jobId)
    .order('created_at', { ascending: false }).limit(30);
  if (folder) q = q.eq('folder', folder);
  const { data, error } = await q;
  if (error) throw error;
  return { documents: (data || []).filter((d) => d.photo_url).map((d) => ({ folder: d.folder, title: d.title, url: d.photo_url, date: (d.created_at || '').slice(0, 10) })) };
}

async function jobNames(ids) {
  if (!ids.length) return {};
  const { data } = await supabase.from('jobs').select('id,client_name').in('id', ids);
  return Object.fromEntries((data || []).map((j) => [j.id, j.client_name]));
}

// ─── Spend, history, messaging ───────────────────────────────────
async function spentToday() {
  const { data } = await supabase.from('audit_log').select('details')
    .eq('action', 'owner_bot.qa').gte('timestamp', new Date(nyMidnightMs(nyToday().key)).toISOString());
  return (data || []).reduce((s, r) => s + (Number(r.details?.cost_usd) || 0), 0);
}

async function recentHistory(number) {
  const since = new Date(Date.now() - HISTORY_MINUTES * 60_000).toISOString();
  const { data } = await supabase.from('audit_log').select('details,timestamp')
    .eq('action', 'owner_bot.qa').gte('timestamp', since).order('timestamp', { ascending: false }).limit(12);
  const mine = (data || []).filter((r) => r.details?.from === number).slice(0, 4).reverse();
  return mine.flatMap((r) => [
    { role: 'user', content: String(r.details.q || '') },
    { role: 'assistant', content: String(r.details.a || '') },
  ]);
}

async function reply(from, to, body, mediaUrl) {
  const form = new URLSearchParams({ From: from, To: to, Body: body });
  if (mediaUrl) form.set('MediaUrl', mediaUrl);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${SID()}:${TOKEN()}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) console.error('[owner-bot] twilio send', r.status, (await r.text()).slice(0, 300));
}

async function forwardToTeam(number, text, p) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const media = Number(p.NumMedia || 0) > 0 ? `<p>(${p.NumMedia} attachment(s) — see Twilio logs)</p>` : '';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Omega Development <office@omeganyct.com>',
      to: (process.env.OWNER_BOT_FORWARD_TO || 'team@omeganyct.com').split(',').map((s) => s.trim()),
      subject: `💬 WhatsApp from ${number}${text ? ` — ${text.slice(0, 60)}` : ''}`,
      html: `<p>New WhatsApp message to Omega (+1 825-462-3700):</p><p><b>From:</b> ${esc(number)} ${esc(p.ProfileName)}</p><p>${esc(text).replace(/\n/g, '<br>')}</p>${media}<p style="color:#888;font-size:12px">Reply from the Twilio/WhatsApp tools — replies to this email don't reach them.</p>`,
    }),
  }).catch(() => {});
}

// ─── Helpers ─────────────────────────────────────────────────────
function validSignature(url, params, signature) {
  const token = TOKEN();
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', token).update(data, 'utf8').digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

function readRaw(req) {
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(new URLSearchParams(req.body).toString());
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function nyParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long',
  }).formatToParts(new Date(ms));
  return Object.fromEntries(parts.map((x) => [x.type, x.value]));
}
function nyToday() {
  const p = nyParts(Date.now());
  return { key: `${p.year}-${p.month}-${p.day}`, label: `${p.weekday}, ${p.year}-${p.month}-${p.day}` };
}
function nyDateKey(iso) { const p = nyParts(new Date(iso).getTime()); return `${p.year}-${p.month}-${p.day}`; }
function nyTime(iso) { const p = nyParts(new Date(iso).getTime()); return `${p.hour}:${p.minute}`; }
// UTC ms of midnight in New York for a 'YYYY-MM-DD' key (offset read at noon).
function nyMidnightMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  const hh = Number(nyParts(noon).hour);
  return Date.UTC(y, m - 1, d) + (12 - hh) * 3_600_000;
}
function daysBetween(fromKey, toKey) {
  const a = Date.UTC(...fromKey.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const b = Date.UTC(...toKey.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((b - a) / 86_400_000);
}
