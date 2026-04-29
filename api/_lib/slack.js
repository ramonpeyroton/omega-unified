// Shared Slack WebClient for Vercel Functions.
//
// Uses the official @slack/web-api package — handles auth headers,
// rate-limit retry, response shaping for us. The token comes from
// SLACK_BOT_TOKEN (xoxb-...) provisioned during Sprint 1 of the
// Slack chat feature; see `.env.example` and the roadmap section
// of CLAUDE.md.
//
// Uso típico:
//   import { slack, requireSlack } from './_lib/slack.js';
//   const ready = requireSlack();
//   if (!ready.ok) return json(res, 500, ready);
//   const r = await slack.conversations.history({ channel, limit: 50 });

import { WebClient } from '@slack/web-api';

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN || '';

export const slack = SLACK_TOKEN ? new WebClient(SLACK_TOKEN) : null;

/** Same shape as requireSupabase() — keeps handler boilerplate uniform. */
export function requireSlack() {
  if (!slack) {
    return {
      ok: false,
      error: 'Slack not configured. Set SLACK_BOT_TOKEN on the server.',
    };
  }
  return { ok: true };
}
