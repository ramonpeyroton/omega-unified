// The client's email addresses: main client_email + the optional
// client_email_2 (migration 087), trimmed, without duplicates. Every email
// the app sends the client goes to all of them (server side:
// api/_lib/clientEmails.js — same rule). Use this for "Sent to …" text.
export function clientEmails(job) {
  const seen = new Set();
  const out = [];
  for (const raw of [job?.client_email, job?.client_email_2]) {
    const e = String(raw || '').trim();
    if (!e || seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    out.push(e);
  }
  return out;
}

/** "a@x.com" or "a@x.com and b@y.com" — for toasts and confirm prompts. */
export function clientEmailsText(job) {
  return clientEmails(job).join(' and ');
}
