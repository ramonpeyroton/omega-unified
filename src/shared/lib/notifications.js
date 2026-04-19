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
