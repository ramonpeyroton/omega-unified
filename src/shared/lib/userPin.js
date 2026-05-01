// Helper: validate the *current* user's PIN. Used by destructive /
// terminal actions that require the user to re-confirm intent —
// dragging a card to "Estimate Rejected" being the canonical case.
//
// Validation order (mirrors Login.jsx):
//   1. supabase.users — match the user's name / username + pin row.
//      If the row's role matches the logged-in role, accept.
//   2. Hardcoded PIN_TO_ROLE map — accept when PIN_TO_ROLE[pin]
//      equals the logged-in role. Fallback for users who haven't
//      been registered in `users` yet.
//
// Always returns a boolean; never throws.

import { supabase } from './supabase';

const PIN_TO_ROLE = {
  '3333': 'owner',        // Inácio
  '4444': 'operations',   // Brenda
  '1111': 'sales',        // Attila
  '2222': 'manager',      // Gabriel
  '5555': 'screen',
  '7777': 'marketing',
  '9999': 'receptionist',
};

export async function validateUserPin(user, pin) {
  const cleaned = String(pin || '').trim();
  if (!cleaned || !user?.role) return false;

  // 1. users table — preferred path once the team is fully registered
  try {
    const handle = (user.name || '').trim();
    if (handle) {
      const { data } = await supabase
        .from('users')
        .select('id, name, username, role, pin')
        .eq('pin', cleaned)
        .or(`name.ilike.${handle},username.eq.${handle.toLowerCase()}`)
        .limit(1);
      if (Array.isArray(data) && data[0] && data[0].role === user.role) {
        return true;
      }
    }
  } catch { /* table missing / schema drift — fall through */ }

  // 2. Fallback to the same hardcoded map Login.jsx uses
  return PIN_TO_ROLE[cleaned] === user.role;
}
