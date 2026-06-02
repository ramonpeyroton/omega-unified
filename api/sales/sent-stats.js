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

  // Month windows: first of this month, first of previous month, and
  // a cutoff one extra month back to bound the query. Computed in
  // server-local time (Vercel = UTC), which is fine because audit_log
  // timestamps are also UTC.
  const now = new Date();
  const startThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const startLast = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
  const cutoff    = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString();

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

  // Bucket by (action, month) with dedup by entity_id.
  const buckets = {};
  for (const action of TRACKED_ACTIONS) {
    buckets[action] = { this: new Set(), last: new Set() };
  }
  for (const row of rows) {
    if (!row?.timestamp) continue;
    const inThis = row.timestamp >= startThis;
    const inLast = !inThis && row.timestamp >= startLast;
    if (!inThis && !inLast) continue;
    const bucket = buckets[row.action];
    if (!bucket) continue;
    const id = row.entity_id || row.id;
    (inThis ? bucket.this : bucket.last).add(id);
  }

  function pack(action) {
    return {
      this_month: buckets[action]?.this.size ?? 0,
      last_month: buckets[action]?.last.size ?? 0,
    };
  }

  return json(res, 200, {
    ok: true,
    estimate_sent: pack('estimate.send'),
    contract_sent: pack('contract.send'),
    contract_sign: pack('contract.sign'),
  });
}
