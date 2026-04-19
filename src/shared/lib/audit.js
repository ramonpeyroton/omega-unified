// Shared audit logger. Writes a row to `audit_log` in Supabase.
// All errors are swallowed — audit logging must never block the user.
import { supabase } from './supabase';

/**
 * Record an audit event.
 *
 * @param {Object} params
 * @param {{name?: string, role?: string}} [params.user]
 * @param {string} params.action       — short action verb (e.g. 'job.move')
 * @param {string} [params.entityType] — e.g. 'job', 'estimate', 'contract'
 * @param {string} [params.entityId]   — UUID of the entity
 * @param {Object} [params.details]    — free-form JSON payload
 */
export async function logAudit({ user, action, entityType, entityId, details } = {}) {
  // Admin is intentionally untraceable. Admin actions never hit audit_log.
  if (user?.role === 'admin') return;

  try {
    await supabase.from('audit_log').insert([{
      user_name: user?.name || 'unknown',
      user_role: user?.role || 'unknown',
      action: action || 'unknown',
      entity_type: entityType || null,
      entity_id: entityId || null,
      details: details || null,
    }]);
  } catch {
    // Non-blocking — audit log may not exist yet in older envs.
  }
}
