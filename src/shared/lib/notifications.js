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
 */
export async function notify({ recipientRole, title, message, type, jobId } = {}) {
  try {
    await supabase.from('notifications').insert([{
      recipient_role: recipientRole || 'all',
      title: title || '',
      message: message || null,
      type: type || null,
      job_id: jobId || null,
      read: false,
    }]);
  } catch {
    // silent — notifications table may not exist yet
  }
}

/**
 * Given the app's user role, return the `recipient_role` values that
 * user should receive. Return `null` when the user should see every
 * notification (owner/admin).
 *
 * Used by both the NotificationsBell (header popover) and each role's
 * dedicated Alerts screen to keep the filtering consistent.
 */
export function recipientRolesFor(role) {
  if (role === 'admin' || role === 'owner') return null;            // see everything
  if (role === 'salesperson' || role === 'sales') return ['sales', 'all'];
  if (role === 'operations')   return ['operations', 'all'];
  if (role === 'manager')      return ['manager', 'all'];
  if (role === 'receptionist') return ['receptionist', 'all'];
  return ['all'];
}
