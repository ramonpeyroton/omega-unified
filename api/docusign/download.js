// GET /api/docusign/download?envelopeId=xxx
//
// Proxies the combined signed PDF from DocuSign back to the browser.
// The browser never touches DocuSign credentials — this function acts
// as an authenticated proxy.

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

    const dsRes = await fetch(
      `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}/documents/combined`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!dsRes.ok) {
      const text = await dsRes.text();
      return json(res, dsRes.status, { error: text });
    }

    const buffer = await dsRes.arrayBuffer();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="signed-contract-${envelopeId}.pdf"`);
    res.end(Buffer.from(buffer));

  } catch (err) {
    console.error('[docusign/download]', err);
    return json(res, 500, { error: err.message || 'Internal error' });
  }
}
