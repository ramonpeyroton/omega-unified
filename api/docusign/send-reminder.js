// POST /api/docusign/send-reminder
//
// Body: { envelopeId }
//
// Triggers DocuSign to resend the signing notification email to all
// pending signers on the envelope.

import { json, readJson } from '../_lib/http.js';
import { getAccessToken } from '../_lib/docusignAuth.js';

const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID || '';
const BASE_URL   = (process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi').replace(/\/$/, '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const { envelopeId } = body;
  if (!envelopeId) return json(res, 400, { error: 'Missing envelopeId' });

  try {
    const token = await getAccessToken();

    // PUT to recipients with resend_envelope=true causes DocuSign to
    // re-send the notification email to all pending signers.
    const dsRes = await fetch(
      `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}/recipients?resend_envelope=true`,
      {
        method:  'PUT',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );

    if (!dsRes.ok) {
      const text = await dsRes.text();
      return json(res, dsRes.status, { error: text });
    }

    return json(res, 200, { ok: true });

  } catch (err) {
    console.error('[docusign/send-reminder]', err);
    return json(res, 500, { error: err.message || 'Internal error' });
  }
}
