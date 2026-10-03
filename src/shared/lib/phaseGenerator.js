// Builds a job's phase breakdown from its estimate with Claude — used by
// PhaseBreakdown's "Add phase breakdown automatically" button for jobs whose
// service has no template (Building Plans, Survey, Roofing, Partial / Full
// Reno, New Construction, mixes with those, or no service at all).
//
// Source, in order: the approved estimate, else the newest one that isn't
// superseded; with no estimate, the questionnaire answers. Prices are never
// sent. Returns phases in the phase_data shape:
//   [{ id, name, completed: false, items: [{ id, label, done: false }] }]

import { supabase } from './supabase';
import { callAnthropicShared } from './anthropic';
import { serviceBadgeLabel } from '../data/services';

// A full reno or new build runs 14-18 phases. At 12 the AI's list got cut
// and lost its last phases, Final Inspection included (Ramon, 03/10).
const MAX_PHASES = 20;
const MAX_ITEMS = 14;
const MAX_SOURCE_CHARS = 14_000;

async function pickEstimate(jobId) {
  const { data, error } = await supabase
    .from('estimates')
    .select('id, status, header_description, sections, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data || []).filter((e) => e.status !== 'superseded');
  return rows.find((e) => e.status === 'approved') || rows[0] || null;
}

function estimateText(est) {
  const lines = [];
  if (est.header_description?.trim()) lines.push(est.header_description.trim(), '');
  for (const sec of est.sections || []) {
    if (sec.title?.trim()) lines.push(`## ${sec.title.trim()}`);
    for (const it of sec.items || []) {
      const what = (it.description || '').trim();
      const scope = (it.scope || '').replace(/\s+/g, ' ').trim().slice(0, 700);
      if (what || scope) lines.push(`- ${what || 'Item'}${scope ? `: ${scope}` : ''}`);
    }
  }
  return lines.join('\n').slice(0, MAX_SOURCE_CHARS);
}

function buildPrompt(job, sourceLabel, source) {
  const service = serviceBadgeLabel(job.service) || 'not set';
  return `You plan construction jobs for Omega Development, a residential remodeling contractor in Fairfield County, Connecticut.

Turn the ${sourceLabel} below into the job's PHASE BREAKDOWN: the phases the crew goes through, in the real order the work happens on site, each with a short checklist the field manager ticks off.

Service: ${service}

${sourceLabel.toUpperCase()}:
"""
${source}
"""

Rules:
- As many phases as the scope really needs, from 4 up to ${MAX_PHASES}, in build order. Start with "Permit Application & Approval" unless the scope clearly needs no permit. End with "Final Inspection & Walkthrough".
- Phase names: short (max 28 characters), like "Demo & Debris Removal", "Framing", "Rough-In", "Drywall & Paint".
- 3 to ${MAX_ITEMS} checklist items per phase, max 70 characters each, written as finished milestones the way a field checklist reads: "Footing holes dug", "Rough electrical inspection passed", "Shower tile installed".
- Only work that is in scope. Skip disclaimers, exclusions, prices, and work the client or others will do themselves.
- English only.

Answer with JSON only, no other text:
{"phases":[{"name":"...","items":["...","..."]}]}`;
}

function parsePhases(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The AI answer had no phase list. Try again.');
  const json = JSON.parse(text.slice(start, end + 1));
  const phases = (Array.isArray(json?.phases) ? json.phases : [])
    .map((ph) => ({
      name: String(ph?.name || '').trim().slice(0, 60),
      items: (Array.isArray(ph?.items) ? ph.items : [])
        .map((it) => String(it || '').trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, MAX_ITEMS),
    }))
    .filter((ph) => ph.name && ph.items.length);
  // Over the cap: drop from the middle, never the last phase (the final inspection).
  if (phases.length > MAX_PHASES) phases.splice(MAX_PHASES - 1, phases.length - MAX_PHASES);
  if (!phases.length) throw new Error('The AI answer had no phase list. Try again.');
  const stamp = Date.now().toString(36);
  return phases.map((ph, i) => {
    const id = `ai_${stamp}_${i + 1}`;
    return {
      id,
      name: ph.name,
      completed: false,
      items: ph.items.map((label, k) => ({ id: `${id}_${k + 1}`, label, done: false })),
    };
  });
}

export async function generatePhasesFromEstimate(job) {
  const est = await pickEstimate(job.id);
  let sourceLabel = 'estimate';
  let source = est ? estimateText(est) : '';
  if (!source.trim()) {
    const answers = job.answers && Object.keys(job.answers).length ? JSON.stringify(job.answers) : '';
    if (!answers) {
      throw new Error('This job has no estimate or questionnaire yet — create the estimate first, or add the phases by hand.');
    }
    sourceLabel = 'questionnaire answers';
    source = answers.slice(0, MAX_SOURCE_CHARS);
  }
  const text = await callAnthropicShared(buildPrompt(job, sourceLabel, source), 8000, { prefill: '{' });
  return parsePhases(text);
}
