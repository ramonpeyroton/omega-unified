// DocuSign client-side helper.
//
// All calls go through a small set of Vercel Functions under `/api/docusign/*`
// which are responsible for performing JWT Grant authentication using the
// DocuSign integration key + private key + user ID stored as server-side env
// vars. NEVER hit the DocuSign REST API directly from the browser (credentials
// would leak).
//
// Env vars expected on the server:
//   DOCUSIGN_INTEGRATION_KEY     (aka Client ID)
//   DOCUSIGN_USER_ID             (GUID of the impersonated user)
//   DOCUSIGN_ACCOUNT_ID
//   DOCUSIGN_BASE_URL            (e.g. https://demo.docusign.net/restapi)
//   DOCUSIGN_PRIVATE_KEY         (RSA private key, PEM, newlines escaped)
//   DOCUSIGN_OAUTH_BASE          (e.g. https://account-d.docusign.net)
//
// Client-side env vars (vite) are exposed for UI convenience only:
//   VITE_DOCUSIGN_INTEGRATION_KEY
//   VITE_DOCUSIGN_ACCOUNT_ID
//   VITE_DOCUSIGN_BASE_URL
//   VITE_DOCUSIGN_REDIRECT_URI

const API_BASE = '/api/docusign';

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `DocuSign request failed (${res.status})`);
  }
  return res.json();
}

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `DocuSign request failed (${res.status})`);
  }
  return res;
}

/**
 * Create a DocuSign envelope for a contract or subcontractor agreement.
 *
 * The server generates the PDF from `contractData` (client, scope, payment
 * plan, etc.) and calls DocuSign's `/envelopes` endpoint.
 *
 * @param {object} contractData
 * @returns {Promise<{envelopeId: string, redirectUrl?: string}>}
 */
export async function createEnvelope(contractData) {
  return post('/create-envelope', contractData);
}

/**
 * Fetch current status of an envelope, plus the event history used in the
 * contract detail modal timeline.
 *
 * @param {string} envelopeId
 * @returns {Promise<{status: string, completedAt?: string|null, history?: Array<{event:string,timestamp:string,actor?:string}>}>}
 */
export async function getEnvelopeStatus(envelopeId) {
  const res = await get(`/envelope-status?envelopeId=${encodeURIComponent(envelopeId)}`);
  return res.json();
}

/**
 * Download the signed combined PDF for an envelope.
 *
 * @param {string} envelopeId
 * @returns {Promise<Blob>}
 */
export async function downloadSignedDocument(envelopeId) {
  const res = await get(`/download?envelopeId=${encodeURIComponent(envelopeId)}`);
  return res.blob();
}

/**
 * Send a reminder email to the current pending signer(s).
 *
 * @param {string} envelopeId
 */
export async function sendReminder(envelopeId) {
  return post('/send-reminder', { envelopeId });
}
