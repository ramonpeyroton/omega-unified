// Vercel Function: send an SMS or WhatsApp message via Twilio.
//
// POST JSON:
//   {
//     to:       "+12035551234",         // E.164 phone number
//     body:     "Hi Sub! ...",          // message text (<= 1600 chars)
//     channel:  "sms" | "whatsapp",     // default: "sms"
//     meta:     { jobId?, phaseId?, subId?, kind? }   // optional; logged only
//   }
//
// Response JSON:
//   { ok: true,  sid: "SMxxxxxxxxxxxxxxxxxxxxxx" }
//   { ok: false, error: "..." }
//
// Required env vars on the server:
//   TWILIO_ACCOUNT_SID          AC…
//   TWILIO_AUTH_TOKEN           (keep server-side only)
//   TWILIO_PHONE_NUMBER         E.164 SMS sender ("+12035551234")
//   TWILIO_WHATSAPP_FROM        "whatsapp:+14155238886"  (or your approved sender)
//
// Optional:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — if set, each send is logged to the
//                                  `message_log` table for audit.

import { createClient } from '@supabase/supabase-js';
import { requireSecret } from './_lib/requireSecret.js';

const SID   = process.env.TWILIO_ACCOUNT_SID   || '';
const TOKEN = process.env.TWILIO_AUTH_TOKEN    || '';
const FROM_SMS      = process.env.TWILIO_PHONE_NUMBER  || '';
const FROM_WA       = process.env.TWILIO_WHATSAPP_FROM || '';

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    )
  : null;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function toE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  // Default to US/CA if 10-digit (common for CT subs)
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function logSend({ ok, sid, error, to, channel, body, meta, requester }) {
  if (!supabase) return;
  try {
    await supabase.from('message_log').insert({
      channel,
      to_number: to,
      body,
      provider_sid: sid || null,
      status: ok ? 'sent' : 'failed',
      error: error || null,
      job_id: meta?.jobId || null,
      phase_id: meta?.phaseId || null,
      sub_id: meta?.subId || null,
      kind: meta?.kind || null,
      requested_by_name: requester?.name || null,
      requested_by_role: requester?.role || null,
    });
  } catch { /* table might not exist yet — non-fatal */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }
  if (!requireSecret(req, res)) return;

  if (!SID || !TOKEN) {
    return json(res, 500, {
      ok: false,
      error: 'Twilio credentials are not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN on the server.',
    });
  }

  let payload;
  try { payload = await readJson(req); }
  catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }

  const { body, channel = 'sms', meta } = payload || {};
  const to = toE164(payload?.to);
  if (!to)   return json(res, 400, { ok: false, error: 'Invalid "to" phone number' });
  if (!body || typeof body !== 'string') {
    return json(res, 400, { ok: false, error: 'Missing "body"' });
  }
  if (body.length > 1600) {
    return json(res, 400, { ok: false, error: 'Body exceeds 1600 characters' });
  }

  // Requester context — role and name come via headers (client-set). This
  // is NOT authentication (the app has no real auth layer); it's for the
  // audit trail. Never trust the role for authorization decisions here.
  const requester = {
    role: (req.headers['x-omega-role'] || '').toString() || null,
    name: (req.headers['x-omega-user'] || '').toString() || null,
  };

  // Build Twilio params
  let from;
  let toField;
  if (channel === 'whatsapp') {
    if (!FROM_WA) {
      return json(res, 500, {
        ok: false,
        error: 'WhatsApp sender not configured. Set TWILIO_WHATSAPP_FROM on the server.',
      });
    }
    from    = FROM_WA;
    toField = `whatsapp:${to}`;
  } else {
    if (!FROM_SMS) {
      return json(res, 500, {
        ok: false,
        error: 'SMS sender not configured. Set TWILIO_PHONE_NUMBER on the server.',
      });
    }
    from    = FROM_SMS;
    toField = to;
  }

  const form = new URLSearchParams();
  form.set('From', from);
  form.set('To',   toField);
  form.set('Body', body);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
  const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const errMsg = data?.message || `Twilio error ${r.status}`;
      await logSend({ ok: false, error: errMsg, to: toField, channel, body, meta, requester });
      return json(res, r.status, { ok: false, error: errMsg, code: data?.code });
    }

    await logSend({ ok: true, sid: data?.sid, to: toField, channel, body, meta, requester });
    return json(res, 200, { ok: true, sid: data?.sid, status: data?.status });
  } catch (err) {
    const errMsg = err?.message || String(err);
    await logSend({ ok: false, error: errMsg, to: toField, channel, body, meta, requester });
    return json(res, 500, { ok: false, error: errMsg });
  }
}
