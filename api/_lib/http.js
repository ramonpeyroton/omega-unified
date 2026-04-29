// Tiny HTTP helpers shared across Vercel Functions in api/.
//
// `json(res, status, body)` writes a Content-Type'd JSON response. Mirrors
// the pattern that already exists inline in twilio-send.js / send-estimate.js
// — extracted here so new handlers don't have to copy/paste it.
//
// `readJson(req)` reads the raw request body and parses it as JSON.
// Vercel Functions in Node runtime don't auto-parse — they hand you a
// Node IncomingMessage stream. This handles the streaming + JSON.parse
// + non-JSON fallback in one place.

/** Standard JSON response. Always sets Content-Type and ends the response. */
export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Read a request body and parse it as JSON. Resolves to {} for an
 * empty body so handlers can safely destructure without an extra
 * truthiness check.
 */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
