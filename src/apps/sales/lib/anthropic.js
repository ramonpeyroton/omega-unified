import { supabase } from './supabase';

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;
const MODEL = 'claude-haiku-4-5-20251001';
const API_TIMEOUT_MS = 60000;

async function callAnthropic(messages, maxTokens = 4000, onRetry) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
      throw err;
    }
    clearTimeout(timeoutId);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 429) {
        if (attempt < 3) {
          onRetry?.(`Omega AI is thinking... retrying shortly (${attempt + 1}/3)`);
          await new Promise((r) => setTimeout(r, 30000));
          continue;
        }
        throw new Error('Omega AI is currently busy. Please try again in a few minutes.');
      }
      if (response.status === 401) throw new Error('Invalid API key. Contact your administrator.');
      throw new Error(err?.error?.message || `API error ${response.status}`);
    }
    const data = await response.json();
    return data.content[0].text;
  }
}

// ── Omega Brain ───────────────────────────────────────────────────────────────
async function fetchBrainEntries() {
  try {
    const { data } = await supabase
      .from('omega_brain')
      .select('entry, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(20);
    return data || [];
  } catch {
    return [];
  }
}

function buildBrainContext(entries) {
  if (!entries.length) return '';
  const list = entries.map((e, i) => `${i + 1}. ${e.entry}`).join('\n');
  return `\n\nOMEGA DEVELOPMENT CALIBRATION DATA — Real project knowledge from the owner (use this to improve accuracy):\n${list}`;
}

// ── Property Search ───────────────────────────────────────────────────────────
async function fetchPropertyData(address) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Search Zillow or Redfin for property data at "${address}". Return ONLY a valid JSON object — no other text: {"sqft": number_or_null, "lot_sqft": number_or_null, "beds": number_or_null, "baths": number_or_null, "zestimate": "string_or_null"}`,
        }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const textBlock = data.content?.find((c) => c.type === 'text');
    if (!textBlock?.text) return null;
    const match = textBlock.text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildPropertyLine(propertyData, answers) {
  if (propertyData) {
    const sqft = propertyData.sqft ? `${Number(propertyData.sqft).toLocaleString()} sq ft` : null;
    const lot = propertyData.lot_sqft ? `${Number(propertyData.lot_sqft).toLocaleString()} sq ft lot` : null;
    const beds = propertyData.beds ? `🛏 ${propertyData.beds} bed` : null;
    const baths = propertyData.baths ? `🚿 ${propertyData.baths} bath` : null;
    const zest = propertyData.zestimate ? `💰 ${propertyData.zestimate} (Zillow estimate)` : null;
    const parts = [sqft && `🏠 ${sqft}`, lot, beds, baths, zest].filter(Boolean);
    if (parts.length >= 2) return parts.join(' · ');
  }
  // Fall back to questionnaire measurements
  const sqft = answers?.approx_sqft || answers?.home_total_sqft || answers?.nc_target_sqft || answers?.home_sqft;
  if (sqft) return `🏠 ${sqft} (from questionnaire)`;
  return null;
}

function buildReportPrompt(job, answers, propertyData, brainContext = '', pdfContext = '') {
  const services = Array.isArray(job.service) ? job.service.join(', ') : job.service;
  const privateNotes = answers?.salesperson_notes || '';
  const answersText = Object.entries(answers || {})
    .filter(([k]) => !k.startsWith('_') && k !== 'salesperson_notes')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n');
  const propertyLine = buildPropertyLine(propertyData, answers);

  return `You are a senior construction estimator for Omega Development LLC, a premium construction company in Westport, CT (Fairfield County). Generate a comprehensive internal sales report.${brainContext}

CLIENT: ${job.client_name}
PHONE: ${job.client_phone || 'N/A'}
ADDRESS: ${job.address}
SERVICE(S): ${services}
SALESPERSON: ${job.salesperson_name}
DATE: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

QUESTIONNAIRE ANSWERS:
${answersText || 'No answers recorded.'}

${pdfContext ? `UPLOADED DOCUMENT CONTEXT (from plans/scope of work provided by client):\n${pdfContext}\n` : ''}

${privateNotes ? `SALESPERSON PRIVATE NOTES (for owner only):\n${privateNotes}` : ''}

Generate a detailed professional report using EXACTLY these section markers:

###SECTION###OVERVIEW
${propertyLine ? `Begin with this property data line on its own line:\n${propertyLine}\n\nThen write the` : 'Write the'} client profile summary, goals, project opportunity, and overall assessment (2-3 paragraphs).

###SECTION###SCOPE
Detailed scope of work by trade/area. Be specific. Flag anything requiring clarification.

###SECTION###SELECTIONS
Confirmed material and finish selections. List what's decided and what's still TBD.

###SECTION###MISSING_INFO
Numbered list of information still needed before a formal estimate can be produced.

###SECTION###RED_FLAGS
Any concerns: structural issues, permit complications, budget misalignment, unrealistic timeline, scope creep risks. Be direct.

###SECTION###CT_CODE
Connecticut Building Code requirements specific to ${job.address?.split(',').slice(-2).join(',').trim() || 'Fairfield County, CT'}: applicable permits, code requirements for this scope, required inspections.

###SECTION###PERMITS
Permit breakdown: which permits needed, estimated Westport/Fairfield County timeline, approximate fees.

###SECTION###TRADES
Trades required and sequencing. Note any specialty trades or long-lead items.

###SECTION###UPSELLS
Specific, value-focused upsell opportunities observed during this consultation.

###SECTION###ESTIMATING_NOTES
Internal notes for estimator: budget alignment, client readiness, decision-maker dynamics, urgency, pricing sensitivities. Be candid.

###SECTION###PHASE_BREAKDOWN
Phase-by-phase breakdown in execution order. For each: Phase Name | Key Tasks (3-5 bullets) | Estimated Duration.

Be specific, professional, and concise in each section.`;
}

export async function generateReport(job, answers, pdfContext = '', onRetry) {
  const [propertyData, brainEntries] = await Promise.all([
    fetchPropertyData(job.address),
    fetchBrainEntries(),
  ]);
  const brainContext = buildBrainContext(brainEntries);
  const prompt = buildReportPrompt(job, answers, propertyData, brainContext, pdfContext);
  return callAnthropic([{ role: 'user', content: prompt }], 4000, onRetry);
}

export function parseReport(raw) {
  const sectionMeta = {
    OVERVIEW: { title: 'Overview', color: 'info' },
    SCOPE: { title: 'Scope of Work', color: 'charcoal' },
    SELECTIONS: { title: 'Selections', color: 'success' },
    MISSING_INFO: { title: 'Missing Information', color: 'warning' },
    RED_FLAGS: { title: 'Red Flags', color: 'danger' },
    CT_CODE: { title: 'CT Building Code', color: 'info' },
    PERMITS: { title: 'Permits', color: 'warning' },
    TRADES: { title: 'Trades Required', color: 'charcoal' },
    UPSELLS: { title: 'Upsell Opportunities', color: 'success' },
    ESTIMATING_NOTES: { title: 'Estimating Notes', color: 'slate' },
    PHASE_BREAKDOWN: { title: 'Phase Breakdown', color: 'charcoal' },
  };
  const parts = raw.split('###SECTION###');
  return parts
    .slice(1)
    .map((part) => {
      const newline = part.indexOf('\n');
      const key = part.substring(0, newline).trim();
      const content = part.substring(newline + 1).trim();
      const meta = sectionMeta[key] || { title: key, color: 'charcoal' };
      return { key, ...meta, content };
    })
    .filter((s) => s.content);
}
