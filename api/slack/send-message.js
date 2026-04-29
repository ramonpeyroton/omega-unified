// Vercel Function: post a new message into the Slack channel linked
// to a job. Used by the Daily Logs message input (Sprint 4 — UI not
// built yet).
//
// Method: POST
// Body:   { jobId: string, text: string }
//
// The author shows up in Slack as the bot user (Omega Bot) — Sprint 1
// decision (Option A: single Bot Token). To attribute the post to the
// human who sent it, we prepend their name + role to the message text
// when those headers are present.
//
// Response:
//   { ok: true,  ts: "1714417023.123456", channelId }
//   { ok: false, error: "..." }
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (read jobs.slack_channel_id)
//   SLACK_BOT_TOKEN                           (xoxb-...)

import { supabase, requireSupabase } from '../_lib/supabase.js';
import { slack, requireSlack } from '../_lib/slack.js';
import { json, readJson } from '../_lib/http.js';

const MAX_TEXT = 4000; // Slack's hard cap for a single message text.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const sb = requireSupabase();
  if (!sb.ok) return json(res, 500, sb);
  const sl = requireSlack();
  if (!sl.ok) return json(res, 500, sl);

  let payload;
  try { payload = await readJson(req); }
  catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }

  const { jobId } = payload || {};
  const text = typeof payload?.text === 'string' ? payload.text.trim() : '';

  if (!jobId || typeof jobId !== 'string') {
    return json(res, 400, { ok: false, error: 'Missing "jobId"' });
  }
  if (!text) {
    return json(res, 400, { ok: false, error: 'Missing "text"' });
  }
  if (text.length > MAX_TEXT) {
    return json(res, 400, { ok: false, error: `Text exceeds ${MAX_TEXT} characters` });
  }

  // 1. Resolve the channel from the job.
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, slack_channel_id, client_name, address')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr) return json(res, 500, { ok: false, error: jobErr.message });
  if (!job)   return json(res, 404, { ok: false, error: 'Job not found' });
  if (!job.slack_channel_id) {
    return json(res, 400, {
      ok: false,
      error: 'This job is not connected to a Slack channel yet.',
    });
  }

  // 2. Author attribution. Headers x-omega-user / x-omega-role come
  //    from the frontend (set by the same pattern used in twilio-send).
  //    Not authentication — just a credit line so the bot's posts
  //    don't all look anonymous to people reading in Slack.
  const userName = (req.headers['x-omega-user'] || '').toString().trim();
  const userRole = (req.headers['x-omega-role'] || '').toString().trim();
  const credit   = userName
    ? `*${userName}${userRole ? ` (${userRole})` : ''}*\n`
    : '';
  const finalText = `${credit}${text}`;

  // 3. Post to Slack.
  try {
    const r = await slack.chat.postMessage({
      channel: job.slack_channel_id,
      text: finalText,
      // mrkdwn: true is the default — leaving it explicit avoids
      // surprises if the SDK default ever changes.
      mrkdwn: true,
    });

    if (!r.ok) {
      return json(res, 502, {
        ok: false,
        error: `Slack returned: ${r.error || 'unknown'}`,
      });
    }

    return json(res, 200, {
      ok: true,
      ts: r.ts,
      channelId: job.slack_channel_id,
    });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err?.data?.error || err?.message || 'Slack request failed',
    });
  }
}
