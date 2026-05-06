// GET /api/docusign/envelope-status?envelopeId=xxx
//
// Returns { status, completedAt, history[] } for use in the contract
// detail modal timeline.

import { json } from '../_lib/http.js';
import { getAccessToken } from '../_lib/docusignAuth.js';

const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID || '';
const BASE_URL   = (process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi').replace(/\/$/, '');

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const envelopeId = new URL(req.url, 'http://x').searchParams.get('envelopeId');
  if (!envelopeId) return json(res, 400, { error: 'Missing envelopeId' });

  try {
    const token = await getAccessToken();

    const [envRes, auditRes] = await Promise.all([
      fetch(`${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}/audit_events`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    if (!envRes.ok) {
      const text = await envRes.text();
      return json(res, envRes.status, { error: text });
    }

    const envelope = await envRes.json();

    let history = [];
    if (auditRes.ok) {
      const audit = await auditRes.json();
      history = (audit.auditEvents || []).map(e => {
        const fields = e.eventFields || [];
        const find   = (name) => fields.find(f => f.name === name)?.value || '';
        return {
          event:     find('Action'),
          timestamp: find('Timestamp'),
          actor:     find('UserName'),
        };
      }).filter(e => e.event);
    }

    return json(res, 200, {
      status:      envelope.status       || 'unknown',
      completedAt: envelope.completedDateTime || null,
      history,
    });

  } catch (err) {
    console.error('[docusign/envelope-status]', err);
    return json(res, 500, { error: err.message || 'Internal error' });
  }
}
