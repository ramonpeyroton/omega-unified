// Notifications helper — inserts a row in `notifications` scoped to a role.
// Safe to call anywhere; swallows errors silently so it never blocks UX.
import { supabase } from './supabase';

/**
 * @param {Object} params
 * @param {'sales'|'operations'|'owner'|'manager'|'admin'|'all'} params.recipientRole
 * @param {string} params.title
 * @param {string} [params.message]
 * @param {string} [params.type]
 * @param {string} [params.jobId]
 * @param {object} [params.payload] Optional structured payload — when
 *   set, the renderer prefers this over the baked `message` string so
 *   client names / totals / etc. always reflect the live `jobs` row.
 *   Shape suggestions (free-form jsonb):
 *     { template: 'estimate_signed', amount: 1234, by: 'Roman Resmo' }
 */
export async function notify({ recipientRole, title, message, type, jobId, payload } = {}) {
  try {
    await supabase.from('notifications').insert([{
      recipient_role: recipientRole || 'all',
      title: title || '',
      message: message || null,
      type: type || null,
      job_id: jobId || null,
      payload: payload || null,
      read: false,
    }]);
  } catch (err) {
    // Two failure modes we tolerate:
    //   * notifications table missing entirely (fresh env) → silent.
    //   * `payload` column missing (migration 059 not yet run) →
    //     retry without the field so the row still lands. Without
    //     this guard, every notify() emitter fails until migration
    //     gets applied.
    if (err?.message && /payload/i.test(err.message)) {
      try {
        await supabase.from('notifications').insert([{
          recipient_role: recipientRole || 'all',
          title: title || '',
          message: message || null,
          type: type || null,
          job_id: jobId || null,
          read: false,
        }]);
      } catch { /* silent */ }
    }
  }
}

/**
 * Render the visible text of a notification. Prefers live job data
 * over the snapshot stored on the row so a corrected client name
 * (or any other live value) shows up immediately instead of being
 * frozen forever in `message`.
 *
 * Pass the row from `notifications` joined to `jobs(client_name)` —
 * that's what the bell + the Notifications screens already query.
 * Returns the message string for rendering.
 */
export function renderNotificationText(row) {
  if (!row) return '';
  // Prefer payload templates when present — they have the freshest
  // surrogate values + can interpolate live `jobs.client_name`.
  const payload = row.payload || null;
  const liveClient = row.jobs?.client_name || payload?.client_name || 'client';
  if (payload?.template) {
    const tpl = payload.template;
    switch (tpl) {
      case 'estimate_signed':
        return `${liveClient} signed the estimate${payload.amount ? ` ($${Number(payload.amount).toLocaleString()})` : ''}.`;
      case 'contract_signed':
        return `${liveClient} signed the contract${payload.amount ? ` ($${Number(payload.amount).toLocaleString()})` : ''}.`;
      case 'contract_sent':
        return `Contract sent to ${liveClient} via DocuSign.`;
      case 'estimate_sent':
        return `Estimate sent to ${liveClient}.`;
      case 'estimate_approved':
        return `${liveClient} approved the estimate.`;
      case 'estimate_rejected':
        return `${liveClient} rejected the estimate.`;
      case 'estimate_changes_requested':
        return `${liveClient} asked for changes: ${payload.note || '(see job)'}.`;
      case 'payment_received':
        return `Received ${payload.amount ? `$${Number(payload.amount).toLocaleString()}` : 'payment'} from ${liveClient}.`;
      case 'sub_accepted':
        return `${payload.sub_name || 'A sub'} accepted ${liveClient}'s job.`;
      case 'sub_rejected':
        return `${payload.sub_name || 'A sub'} declined ${liveClient}'s job.`;
      default:
        // Unknown template — fall through to the stored message.
        break;
    }
  }
  // Legacy path: stored `message` string. We also try to swap the
  // stored client name for the live one when they differ, so a
  // post-creation name correction shows up everywhere.
  const text = row.message || row.title || '';
  if (liveClient && payload?.client_name_at_creation && payload.client_name_at_creation !== liveClient) {
    return text.replaceAll(payload.client_name_at_creation, liveClient);
  }
  return text;
}

/**
 * Given the app's user role, return the `recipient_role` values that
 * user should receive. Return `null` when the user should see every
 * notification (owner/admin).
 *
 * Used by both the NotificationsBell (header popover) and each role's
 * dedicated Alerts screen to keep the filtering consistent.
 */
/**
 * Collapse the per-role fan-out (one event inserts a sales + operations +
 * owner row) into a single item for display. Owner/admin see every role's
 * row, so without this the owner would see the same event 3×. The 3 rows
 * from one insert share type + job_id + exact created_at, so that's the
 * dedupe key. Rows missing any of those key on their id → never merged.
 */
export function dedupeNotifications(rows = []) {
  const seen = new Set();
  const out = [];
  for (const r of (rows || [])) {
    const key = (r.type && r.job_id && r.created_at)
      ? `${r.type}|${r.job_id}|${r.created_at}`
      : `id:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function recipientRolesFor(role) {
  if (role === 'admin' || role === 'owner') return null;            // see everything
  if (role === 'salesperson' || role === 'sales') return ['sales', 'all'];
  if (role === 'operations')   return ['operations', 'all'];
  if (role === 'manager')      return ['manager', 'all'];
  if (role === 'receptionist') return ['receptionist', 'all'];
  return ['all'];
}
