// Vercel Function: monthly stats for the Sales home cards.
//
// Reads audit_log with the service role key so it bypasses any RLS
// the table may have. The client side hit a long streak of 0-counts
// because audit_log doesn't carry a permissive anon read policy like
// jobs/estimates do, so a direct supabase.from('audit_log') call from
// the browser returned an empty array (no error, no rows). This
// endpoint sidesteps that entirely.
//
// Counts are deduplicated by entity_id so re-sending the same estimate
// inside the same month still shows up as 1 in the KPI card. Action
// strings (estimate.send / contract.send / contract.sign) match what
// EstimateFlow.jsx writes via logAudit().
//
// Method: GET   (no payload — month windows are computed server-side)
// Response:
//   { ok: true,
//     estimate_sent:  { this_month, last_month },
//     contract_sent:  { this_month, last_month },
//     contract_sign:  { this_month, last_month } }

import { supabase, requireSupabase } from '../_lib/supabase.js';
import { json } from '../_lib/http.js';

const TRACKED_ACTIONS = ['estimate.send', 'contract.send', 'contract.sign'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const sb = requireSupabase();
  if (!sb.ok) return json(res, 500, sb);

  // Month windows. We build 6 buckets: index 0 = this month, index 5
  // = 5 months ago. Sparklines on the home cards read this history
  // left-to-right so the most recent month sits on the right.
  const HISTORY_MONTHS = 6;
  const now = new Date();
  // monthStarts[0] = first of this month, ..., monthStarts[6] = first of
  // the month *before* the oldest bucket (acts as the lower cutoff).
  const monthStarts = [];
  for (let i = 0; i <= HISTORY_MONTHS; i++) {
    monthStarts.push(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString(),
    );
  }
  const startThis = monthStarts[0];
  const startLast = monthStarts[1];
  const cutoff    = monthStarts[HISTORY_MONTHS]; // oldest bound

  let rows = [];
  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('id, entity_id, action, timestamp')
      .in('action', TRACKED_ACTIONS)
      .gte('timestamp', cutoff);
    if (error) {
      return json(res, 500, { ok: false, error: error.message, step: 'audit_log_query' });
    }
    rows = data || [];
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err?.message || 'audit_log query failed',
      step: 'audit_log_query',
    });
  }

  // Bucket by (action, monthIndex). monthIndex 0 = this month,
  // monthIndex (HISTORY_MONTHS-1) = oldest in the chart. Dedup by
  // entity_id so a re-send doesn't double-count.
  const buckets = {};
  for (const action of TRACKED_ACTIONS) {
    buckets[action] = Array.from({ length: HISTORY_MONTHS }, () => new Set());
  }
  for (const row of rows) {
    if (!row?.timestamp) continue;
    const ts = row.timestamp;
    // Find which bucket this row falls into. monthStarts is ordered
    // newest -> oldest, so we walk forward until we find the first
    // start that's <= our timestamp.
    let monthIx = -1;
    for (let i = 0; i < HISTORY_MONTHS; i++) {
      if (ts >= monthStarts[i]) { monthIx = i; break; }
    }
    if (monthIx === -1) continue;
    const bucket = buckets[row.action];
    if (!bucket) continue;
    const id = row.entity_id || row.id;
    bucket[monthIx].add(id);
  }

  // history is ordered OLDEST → NEWEST so callers can render a
  // left-to-right sparkline directly.
  function pack(action) {
    const arr = buckets[action] || [];
    const history = [];
    for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
      history.push(arr[i] ? arr[i].size : 0);
    }
    return {
      this_month: arr[0]?.size ?? 0,
      last_month: arr[1]?.size ?? 0,
      history,
    };
  }

  return json(res, 200, {
    ok: true,
    estimate_sent: pack('estimate.send'),
    contract_sent: pack('contract.send'),
    contract_sign: pack('contract.sign'),
  });
}
