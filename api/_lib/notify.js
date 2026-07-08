// Shared notification fan-out for client-document events (estimate,
// contract, change order — open + sign).
//
// The office standard: sales + operations + owner each get ONE in-app
// notification per event. We insert one row per role; the bell dedupes
// so the owner (who can see every role's rows) still sees just one.
// All three rows share the same created_at (single insert), which is the
// dedupe key on the client.
//
// `type` should be a stable string the bell routes on:
//   'estimate' | 'estimate_approved' | 'contract' | 'change_order'
//
// Always best-effort — a logging failure must never block the real flow.
export async function notifyOfficeRoles(supabase, { jobId, type, title, message }) {
  if (!supabase || !jobId) return;
  const base = { title, message, type, job_id: jobId, read: false };
  try {
    await supabase.from('notifications').insert([
      { ...base, recipient_role: 'sales' },
      { ...base, recipient_role: 'operations' },
      { ...base, recipient_role: 'owner' },
    ]);
  } catch { /* non-fatal */ }
}

// Should we notify about a "client opened" event? True when we haven't
// notified for this document in the last `windowMinutes` minutes.
// `lastNotifiedAt` is the document's last_open_notified_at column.
export function shouldNotifyOpen(lastNotifiedAt, windowMinutes = 30) {
  if (!lastNotifiedAt) return true;
  const last = new Date(lastNotifiedAt).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= windowMinutes * 60 * 1000;
}
