// Every address that should get an email for this job's client: the main
// client_email plus the optional client_email_2 (migration 087), trimmed
// and without duplicates. Empty array when the job has no email at all.
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
