// Helpers for re-confirming user identity via PIN. Used by destructive
// / terminal actions:
//   * `validateUserPin(user, pin)`  — does this PIN belong to the
//     user that's currently logged in? Used by the kanban PIN gate
//     and the JobFullView phase picker.
//   * `validateOwnerPin(pin)`       — is this the OWNER's PIN? Used
//     by the Reset Job + Delete Job confirmations, which historically
//     hard-coded "3333" but should now look up the owner row in the
//     users table dynamically.
//
// Both functions hit the `users` table only — the legacy hardcoded
// PIN_TO_ROLE fallback was removed once every team member was
// registered through Admin → Users.
//
// Always returns a boolean; never throws.

import { supabase } from './supabase';

// Returns true / false for legacy callers. For UIs that want a
// human-readable reason on failure, call validateUserPinDetailed.
export async function validateUserPin(user, pin) {
  const result = await validateUserPinDetailed(user, pin);
  return result.ok;
}

// Same logic as validateUserPin but returns { ok, reason } so the
// caller can surface a specific error in the UI. Reasons:
//   'empty_pin'      — caller passed nothing in the PIN field
//   'no_session'     — user.role / user.name missing (stale session)
//   'query_failed'   — Supabase query threw / errored
//   'wrong_pin'      — no row in the users table matches that PIN
//   'role_mismatch'  — found a row with the PIN but the role doesn't
//                      match the logged-in user's role (different
//                      person sharing the same PIN, or the session's
//                      role is stale and needs a re-login)
//   'name_mismatch'  — PIN + role match but name/username don't —
//                      another user shares this PIN and role
export async function validateUserPinDetailed(user, pin) {
  const cleaned = String(pin || '').trim();
  if (!cleaned) return { ok: false, reason: 'empty_pin' };
  if (!user?.role || !user?.name) {
    return { ok: false, reason: 'no_session' };
  }

  try {
    const handle = (user.name || '').trim();
    if (!handle) return { ok: false, reason: 'no_session' };
    const handleLower = handle.toLowerCase();

    // Query by PIN only and filter client-side. The previous
    // implementation tried to combine `.eq('pin', x).or(name.ilike.X,
    // username.eq.x)` in a single query, but PostgREST's .or() parser
    // breaks when the value contains spaces — and "Rafaela Costa"
    // does. The query returned zero rows even with the correct PIN.
    // Fetching by PIN alone is fine (few users will ever share one)
    // and filtering by role+name in JS is bulletproof.
    const { data, error } = await supabase
      .from('users')
      .select('id, name, username, role, pin')
      .eq('pin', cleaned)
      .limit(20);

    // Temporary diagnostic log — Rafaela's pin gate kept rejecting
    // even after the .or() fix. Logs the raw rows, the expected
    // handle/role, and which check failed for each row so the
    // mismatch is visible in the user's devtools console. Remove
    // once the cause is confirmed.
    // eslint-disable-next-line no-console
    console.debug('[validateUserPin]', {
      input: { handle, handleLower, role: user.role, pinLength: cleaned.length },
      query: { error, rowCount: Array.isArray(data) ? data.length : 0 },
      rows: (data || []).map((r) => ({
        id: r.id,
        name: r.name,
        username: r.username,
        role: r.role,
        roleMatch: r.role === user.role,
        nameMatch: (r.name || '').trim().toLowerCase() === handleLower,
        usernameMatch: (r.username || '').trim().toLowerCase() === handleLower,
      })),
    });

    if (error) return { ok: false, reason: 'query_failed' };
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, reason: 'wrong_pin' };
    }

    const roleMatchedRow = data.find((row) => row.role === user.role);
    if (!roleMatchedRow) {
      // PIN exists but for a different role — most often means the
      // session has stale role data (user logged in months ago, role
      // changed since). A re-login fixes it.
      return { ok: false, reason: 'role_mismatch' };
    }

    const match = data.find((row) => {
      if (row.role !== user.role) return false;
      const nameOk = (row.name || '').trim().toLowerCase() === handleLower;
      const usernameOk = (row.username || '').trim().toLowerCase() === handleLower;
      return nameOk || usernameOk;
    });
    return match ? { ok: true } : { ok: false, reason: 'name_mismatch' };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[validateUserPin] threw:', err);
    return { ok: false, reason: 'query_failed' };
  }
}

export async function validateOwnerPin(pin) {
  const cleaned = String(pin || '').trim();
  if (!cleaned) return false;

  try {
    const { data } = await supabase
      .from('users')
      .select('id, role, pin')
      .eq('role', 'owner')
      .eq('pin', cleaned)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
