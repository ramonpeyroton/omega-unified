// Shared Supabase client for Vercel Functions.
//
// Pasta `_lib/` é ignorada pelo roteamento da Vercel (qualquer arquivo
// dentro de api/ que comece com `_` não vira endpoint público), então
// esse módulo serve só como utilitário pros outros handlers em api/.
//
// Uso típico:
//   import { supabase, requireSupabase } from './_lib/supabase.js';
//   import { json } from './_lib/http.js';
//
//   export default async function handler(req, res) {
//     const ready = requireSupabase();
//     if (!ready.ok) return json(res, 500, ready);
//     // ... use `supabase` here
//   }

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

/**
 * Returns { ok: true } when the env is set, or a structured error
 * the handler can pass straight back as a 500 response. Keeps the
 * "supabase not configured" message identical across all endpoints.
 */
export function requireSupabase() {
  if (!supabase) {
    return {
      ok: false,
      error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.',
    };
  }
  return { ok: true };
}
