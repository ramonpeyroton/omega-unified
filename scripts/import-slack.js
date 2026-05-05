// scripts/import-slack.js
// One-shot importer that ingests a Slack workspace export ZIP into
// our native chat tables (chat_messages + chat_attachments via
// JSONB). Sprint 6 of the chat-replacement roadmap.
//
// Usage:
//   npm run import-slack -- ./omega-export.zip
//
// What it does:
//   1. Streams the ZIP without unpacking — we only read the JSON we
//      need (channels.json + users.json + each channel's day files).
//   2. Maps Slack channel id → our jobs row via jobs.slack_channel_id.
//      Channels whose id doesn't match any job are skipped (logged).
//   3. Resolves user_id → real_name via users.json.
//   4. For each message:
//        • Inserts into chat_messages with the original ts as both
//          slack_message_ts (string) and created_at (UTC ISO).
//        • Re-uses the existing attachments JSONB column for Slack
//          file shares — we download each file with the bot token,
//          upload to our `job-documents` bucket, and stash a
//          {url, mime, size, name, slack_file_id} record.
//        • Skips system messages (channel_join, etc.) — too noisy
//          to be worth carrying over.
//   5. After every channel finishes, sets jobs.use_native_chat=true
//      so the frontend stops rendering the Slack version for that
//      project.
//
// Idempotent — re-running is safe because we look up by
// slack_message_ts before inserting. If the script is interrupted,
// just run it again.
//
// Required env (read from .env at repo root if present):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  ← uses service role to bypass RLS,
//                                 admin-only side of the door
//   SLACK_BOT_TOKEN            ← needed to download files referenced
//                                 by older Slack messages
//
// Run from the repo root. Don't deploy this to Vercel — local-only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import yauzl from 'yauzl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── env loader ──────────────────────────────────────────────────
// Tiny dotenv replacement so we don't add a dep just for this. Reads
// .env (next to package.json) and copies anything not already set.
function loadDotEnv() {
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '.env.local'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const ZIP_PATH = process.argv[2];
if (!ZIP_PATH) {
  console.error('Usage: npm run import-slack -- <path-to-export.zip>');
  process.exit(1);
}
if (!fs.existsSync(ZIP_PATH)) {
  console.error(`❌ ZIP not found: ${ZIP_PATH}`);
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── ZIP helpers ─────────────────────────────────────────────────
// yauzl exposes a streaming API; we wrap it in promises to keep
// the rest of the script linear.

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) reject(err); else resolve(zip);
    });
  });
}

function readEntryAsText(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  });
}

async function listEntries(zip) {
  return new Promise((resolve, reject) => {
    const out = [];
    zip.on('entry', (entry) => { out.push(entry); zip.readEntry(); });
    zip.on('end', () => resolve(out));
    zip.on('error', reject);
    zip.readEntry();
  });
}

// ─── helpers ─────────────────────────────────────────────────────

function tsToIso(ts) {
  const seconds = parseFloat(ts);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

// Slack mrkdwn → plain text. We don't try to preserve formatting —
// the original audit trail is in slack_message_ts if anyone needs
// to compare side-by-side later.
function slackToPlain(text) {
  if (!text) return '';
  return text
    .replace(/<@([UW][A-Z0-9]+)\|?([^>]*)>/g, (_, id, label) => label || `@${id}`)
    .replace(/<#([CG][A-Z0-9]+)\|?([^>]*)>/g, (_, id, label) => label ? `#${label}` : `#${id}`)
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1');
}

async function downloadSlackFile(url) {
  if (!SLACK_BOT_TOKEN) return null;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = r.headers.get('content-type') || 'application/octet-stream';
    return { buf, mime };
  } catch {
    return null;
  }
}

async function uploadToBucket(buf, mime, jobId, originalName) {
  const safeName = (originalName || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const key = `chat-import/${jobId}/${Date.now()}-${safeName}`;
  const { error } = await supa.storage
    .from('job-documents')
    .upload(key, buf, { contentType: mime, upsert: false });
  if (error) {
    console.warn('   ⚠ storage upload failed:', error.message);
    return null;
  }
  const { data } = supa.storage.from('job-documents').getPublicUrl(key);
  return data?.publicUrl || null;
}

// ─── main ────────────────────────────────────────────────────────

async function main() {
  console.log(`→ Opening ${ZIP_PATH}…`);
  const zip = await openZip(ZIP_PATH);
  const entries = await listEntries(zip);

  // 1. channels.json + users.json
  const channelsEntry = entries.find((e) => e.fileName === 'channels.json' || e.fileName.endsWith('/channels.json'));
  const usersEntry    = entries.find((e) => e.fileName === 'users.json'    || e.fileName.endsWith('/users.json'));
  if (!channelsEntry) throw new Error('channels.json not found in export.');
  if (!usersEntry)    throw new Error('users.json not found in export.');

  const channelsJson = JSON.parse(await readEntryAsText(zip, channelsEntry));
  const usersJson    = JSON.parse(await readEntryAsText(zip, usersEntry));

  // user_id → real_name (or display name fallback).
  const userMap = new Map();
  for (const u of usersJson) {
    const name = u.profile?.real_name || u.profile?.display_name || u.name || u.id;
    userMap.set(u.id, name);
  }
  console.log(`✓ Loaded ${usersJson.length} users.`);

  // 2. Map slack_channel_id → job
  const slackIds = channelsJson.map((c) => c.id);
  const { data: jobs, error: jobsErr } = await supa
    .from('jobs')
    .select('id, client_name, slack_channel_id')
    .in('slack_channel_id', slackIds);
  if (jobsErr) throw jobsErr;
  const jobByChannel = new Map();
  for (const j of (jobs || [])) {
    if (j.slack_channel_id) jobByChannel.set(j.slack_channel_id, j);
  }
  console.log(`✓ Found ${jobByChannel.size}/${slackIds.length} channels matched to jobs.`);

  // 3. Walk each channel folder.
  const totalsByChannel = {};
  for (const ch of channelsJson) {
    const job = jobByChannel.get(ch.id);
    if (!job) {
      console.log(`  ⊘ ${ch.name} (${ch.id}) — no matching job. Skipping.`);
      continue;
    }

    console.log(`\n→ ${ch.name} → ${job.client_name || job.id}`);

    // Day files live under <channel-name>/YYYY-MM-DD.json
    const dayEntries = entries
      .filter((e) => {
        // Slack export root sometimes has an outer wrapping folder.
        const parts = e.fileName.split('/');
        const rest = parts.slice(parts.length >= 3 ? 1 : 0).join('/');
        return rest.startsWith(`${ch.name}/`) && rest.endsWith('.json');
      })
      .sort((a, b) => a.fileName.localeCompare(b.fileName));

    let inserted = 0, skipped = 0, failed = 0;

    for (const dayEntry of dayEntries) {
      let messages;
      try {
        messages = JSON.parse(await readEntryAsText(zip, dayEntry));
      } catch (err) {
        console.warn(`   ⚠ couldn't parse ${dayEntry.fileName}:`, err.message);
        continue;
      }

      for (const m of messages) {
        // Skip system noise (channel_join, etc).
        if (m.subtype && !['file_share', 'me_message', 'thread_broadcast'].includes(m.subtype)) {
          skipped += 1;
          continue;
        }
        if (!m.ts) { skipped += 1; continue; }

        // Dedupe by slack_message_ts.
        const { data: existing } = await supa
          .from('chat_messages')
          .select('id')
          .eq('job_id', job.id)
          .eq('slack_message_ts', m.ts)
          .maybeSingle();
        if (existing) { skipped += 1; continue; }

        const authorId = m.user || m.bot_id || null;
        const authorName = (authorId && userMap.get(authorId)) || m.username || 'Unknown';
        const body = slackToPlain(m.text || '');

        // Files → download + re-upload.
        let attachments = null;
        if (Array.isArray(m.files) && m.files.length > 0) {
          attachments = [];
          for (const f of m.files) {
            const downloadUrl = f.url_private_download || f.url_private;
            if (!downloadUrl) continue;
            const dl = await downloadSlackFile(downloadUrl);
            if (!dl) continue;
            const url = await uploadToBucket(dl.buf, dl.mime, job.id, f.name || f.id);
            if (!url) continue;
            attachments.push({
              url,
              mime:           f.mimetype || dl.mime,
              size:           f.size || null,
              name:           f.name || null,
              slack_file_id:  f.id || null,
            });
          }
          if (attachments.length === 0) attachments = null;
        }

        const { error: insErr } = await supa.from('chat_messages').insert([{
          job_id:           job.id,
          author_name:      authorName,
          author_role:      null, // unknown — Slack export doesn't carry role
          body:             body || null,
          attachments,
          mentions:         null,
          slack_message_ts: m.ts,
          created_at:       tsToIso(m.ts),
        }]);

        if (insErr) {
          console.warn('   ⚠ insert failed:', insErr.message);
          failed += 1;
        } else {
          inserted += 1;
        }
      }
    }

    // Mirror chat attachments into job_documents under daily_logs so
    // the new Documents folder fills retroactively too. Pulled in a
    // single follow-up pass for tidiness.
    {
      const { data: msgs } = await supa
        .from('chat_messages')
        .select('id, attachments, created_at')
        .eq('job_id', job.id)
        .not('attachments', 'is', null);
      const docRows = [];
      for (const m of (msgs || [])) {
        if (!Array.isArray(m.attachments)) continue;
        for (const a of m.attachments) {
          if (!a.url) continue;
          docRows.push({
            job_id:      job.id,
            folder:      'daily_logs',
            title:       a.name || `Chat photo · ${new Date(m.created_at).toLocaleDateString()}`,
            photo_url:   a.url,
            uploaded_by: 'slack-import',
          });
        }
      }
      if (docRows.length > 0) {
        // Best-effort. Duplicates can happen across re-runs because
        // job_documents has no unique constraint; we skip on errors.
        for (let i = 0; i < docRows.length; i += 50) {
          await supa.from('job_documents').insert(docRows.slice(i, i + 50));
        }
      }
    }

    totalsByChannel[ch.name] = { inserted, skipped, failed };
    console.log(`   inserted=${inserted} skipped=${skipped} failed=${failed}`);

    // Flip the job to native chat once its history is in.
    if (inserted > 0) {
      await supa.from('jobs').update({ use_native_chat: true }).eq('id', job.id);
    }
  }

  console.log('\n──── DONE ────');
  for (const [name, t] of Object.entries(totalsByChannel)) {
    console.log(`  ${name.padEnd(40)} inserted=${t.inserted} skipped=${t.skipped} failed=${t.failed}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
