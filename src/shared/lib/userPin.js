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

export async function validateUserPin(user, pin) {
  const cleaned = String(pin || '').trim();
  if (!cleaned || !user?.role) return false;

  try {
    const handle = (user.name || '').trim();
    if (!handle) return false;
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

    if (!Array.isArray(data) || data.length === 0) return false;

    const match = data.find((row) => {
      if (row.role !== user.role) return false;
      const nameOk = (row.name || '').trim().toLowerCase() === handleLower;
      const usernameOk = (row.username || '').trim().toLowerCase() === handleLower;
      return nameOk || usernameOk;
    });
    return !!match;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[validateUserPin] threw:', err);
    return false;
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
