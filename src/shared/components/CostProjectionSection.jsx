import { useEffect, useState, useMemo } from 'react';
import { Sparkles, RefreshCw, DollarSign, Package, Hammer, Clock, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { callAnthropicShared } from '../lib/anthropic';
import Toast from './Toast';
import MarkdownReport from './MarkdownReport';

// AI-generated cost projection cached in `jobs.cost_projection` JSONB.
// Generated ONCE (button click) and stored. Anyone viewing later just reads
// the cached copy — no new API call unless "Regenerate" is clicked.

function money(n) {
  if (n == null || isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function buildPrompt(job) {
  const answers = job.answers || {};
  const svc = job.service || 'general renovation';
  const loc = [job.address, job.city].filter(Boolean).join(', ') || 'Connecticut';

  return `You are a senior estimator at a construction company in Connecticut.
Build a detailed cost projection for this job using realistic Connecticut labor rates and Home Depot CT material prices.

JOB
Service: ${svc}
Location: ${loc}
Client: ${job.client_name || 'N/A'}
Questionnaire answers (JSON): ${JSON.stringify(answers).slice(0, 4000)}

OUTPUT STRICT JSON (no preamble, no code fences, just JSON):
{
  "summary": "<2-3 sentence plain-english summary>",
  "total_min": <integer dollars>,
  "total_mid": <integer dollars>,
  "total_max": <integer dollars>,
  "phases": [
    { "name": "<phase name>", "min": <int>, "mid": <int>, "max": <int>, "notes": "<short>" }
  ],
  "materials": [
    { "item": "<material>", "qty": "<e.g. 16 sheets / 40 lf>", "unit_price": <number>, "total": <integer>, "source": "Home Depot CT" }
  ],
  "labor_hours_estimate": <integer>,
  "assumptions": ["<assumption 1>", "<assumption 2>"]
}

RULES
- Use real-world CT labor: $55-85/hr skilled trades, $35-55/hr general labor.
- Use realistic Home Depot CT prices (you have knowledge of typical prices — estimate conservatively).
- Phase names should match typical construction phases for the service type.
- Include 10-15% contingency implicit in max.
- If questionnaire is sparse, state assumptions clearly.
- Return ONLY the JSON object.`;
}

function safeParseJson(raw) {
  if (!raw) return null;
  // Strip optional code fences
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  // Try the first {...} block, greedy
  const greedy = cleaned.match(/\{[\s\S]*\}/);
  if (greedy) {
    try { return JSON.parse(greedy[0]); } catch { /* fall through */ }
  }
  // Last resort: auto-close a truncated JSON object. Walks through the
  // string counting braces/brackets outside of strings and appends the
  // closers needed to balance. Trailing commas are stripped. This makes
  // the output "mostly correct" when Claude hit max_tokens mid-materials.
  const closed = tryCloseTruncatedJson(cleaned);
  if (closed) {
    try { return JSON.parse(closed); } catch { /* give up */ }
  }
  return null;
}

function tryCloseTruncatedJson(src) {
  // Find the first '{' — everything before is garbage.
  const start = src.indexOf('{');
  if (start < 0) return null;
  let out = src.slice(start);

  const stack = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }

  // If we ended inside a string, close the string first.
  if (inString) out += '"';
  // Drop trailing comma / partial key so JSON doesn't complain.
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': null').replace(/,\s*"[^"]*$/, '');
  // Close remaining opens in reverse.
  while (stack.length) {
    const open = stack.pop();
    out += open === '{' ? '}' : ']';
  }
  return out;
}

export default function CostProjectionSection({ job, user, onJobUpdated }) {
  const [projection, setProjection] = useState(() => job?.cost_projection || null);
  const [generatedAt, setGeneratedAt] = useState(() => job?.cost_projection_at || null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  // Start collapsed when a projection already exists — user sees the range
  // summary and clicks to expand the full breakdown only when needed.
  const [collapsed, setCollapsed] = useState(() => !!(job?.cost_projection));

  useEffect(() => {
    setProjection(job?.cost_projection || null);
    setGeneratedAt(job?.cost_projection_at || null);
  }, [job?.id, job?.cost_projection, job?.cost_projection_at]);

  async function generate(isRegen = false) {
    setLoading(true);
    try {
      // Prefill `{` forces Claude to start with raw JSON (no code fences,
      // no preamble). 6000 tokens gives enough headroom for ~20 materials
      // and 8+ phases without truncation. If we STILL get truncated, the
      // parser will try to auto-close the JSON as a last resort.
      let raw;
      try {
        raw = await callAnthropicShared(buildPrompt(job), 6000, { prefill: '{' });
      } catch (err) {
        // On truncation, retry once with more headroom.
        if (err.code === 'MAX_TOKENS') {
          raw = await callAnthropicShared(buildPrompt(job), 8000, { prefill: '{', allowTruncation: true });
        } else {
          throw err;
        }
      }
      const parsed = safeParseJson(raw);
      if (!parsed) throw new Error('AI returned an unreadable response. Try again.');
      const payload = {
        cost_projection: parsed,
        cost_projection_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('jobs')
        .update(payload)
        .eq('id', job.id)
        .select()
        .single();
      if (error) throw error;
      setProjection(parsed);
      setGeneratedAt(payload.cost_projection_at);
      setCollapsed(false); // always expand after generation so the result is visible
      onJobUpdated?.(data);
      setToast({ type: 'success', message: isRegen ? 'Projection regenerated' : 'Projection generated' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to generate projection' });
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    if (!projection) return null;
    const mat = (projection.materials || []).reduce((s, m) => s + (Number(m.total) || 0), 0);
    return { materialsSum: mat };
  }, [projection]);

  // ─── No projection yet ─────────────────────────────────────
  if (!projection) {
    return (
      <div className="space-y-3">
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <Sparkles className="w-8 h-8 text-omega-orange mx-auto mb-3" />
          <p className="font-bold text-omega-charcoal">No cost projection yet</p>
          <p className="text-xs text-omega-stone mt-1 max-w-sm mx-auto">
            Generate an AI estimate based on the questionnaire answers. Uses Connecticut labor rates and Home Depot material prices.
            <br />
            <span className="font-semibold">One-time generation</span> — saved and reused for everyone who opens this job.
          </p>
          <button
            onClick={() => generate(false)}
            disabled={loading}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60"
          >
            <Sparkles className="w-4 h-4" /> {loading ? 'Generating…' : 'Generate Projection'}
          </button>
          {loading && (
            <p className="text-[11px] text-omega-stone mt-3">This can take 30-60 seconds. Don't close the tab.</p>
          )}
        </div>
      </div>
    );
  }

  // ─── Projection available ──────────────────────────────────
  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Collapsed summary bar — click to expand */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-omega-orange/50 transition-colors text-left"
      >
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-[11px] text-omega-stone inline-flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            {generatedAt ? new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Low</span>
            <span className="text-sm font-bold text-green-700">{money(projection.total_min)}</span>
            <span className="text-omega-fog">·</span>
            <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Mid</span>
            <span className="text-sm font-bold text-omega-orange">{money(projection.total_mid)}</span>
            <span className="text-omega-fog">·</span>
            <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">High</span>
            <span className="text-sm font-bold text-red-700">{money(projection.total_max)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-omega-stone font-medium">{collapsed ? 'View breakdown' : 'Hide'}</span>
          {collapsed ? <ChevronDown className="w-4 h-4 text-omega-stone" /> : <ChevronUp className="w-4 h-4 text-omega-stone" />}
        </div>
      </button>

      {collapsed ? null : (<>

      {/* Regenerate row */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => generate(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-omega-orange hover:text-omega-dark disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>

      {/* Total cards */}
      <div className="grid grid-cols-3 gap-3">
        <TotalCard label="Low" value={money(projection.total_min)} tone="green" />
        <TotalCard label="Mid" value={money(projection.total_mid)} tone="orange" emphasis />
        <TotalCard label="High" value={money(projection.total_max)} tone="red" />
      </div>

      {/* Summary */}
      {projection.summary && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider mb-1.5">Summary</p>
          <p className="text-sm text-omega-slate leading-relaxed">{projection.summary}</p>
        </div>
      )}

      {/* Phase breakdown */}
      {Array.isArray(projection.phases) && projection.phases.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-2">
            <Hammer className="w-3.5 h-3.5 text-omega-orange" />
            <p className="text-xs font-bold uppercase tracking-wider text-omega-charcoal">Phase breakdown</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-omega-cloud">
                <tr className="text-[10px] text-omega-stone uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Phase</th>
                  <th className="px-3 py-2 text-right">Low</th>
                  <th className="px-3 py-2 text-right">Mid</th>
                  <th className="px-3 py-2 text-right">High</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {projection.phases.map((p, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-omega-charcoal">{p.name || '—'}</p>
                      {p.notes && <p className="text-[11px] text-omega-stone mt-0.5">{p.notes}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-omega-slate">{money(p.min)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-omega-charcoal">{money(p.mid)}</td>
                    <td className="px-3 py-2.5 text-right text-omega-slate">{money(p.max)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Materials (Home Depot) */}
      {Array.isArray(projection.materials) && projection.materials.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between gap-2 flex-wrap">
            <div className="inline-flex items-center gap-2">
              <Package className="w-3.5 h-3.5 text-omega-orange" />
              <p className="text-xs font-bold uppercase tracking-wider text-omega-charcoal">Materials (Home Depot CT estimate)</p>
            </div>
            {totals && (
              <span className="text-xs font-bold text-omega-charcoal">
                Total: {money(totals.materialsSum)}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-omega-cloud">
                <tr className="text-[10px] text-omega-stone uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Qty</th>
                  <th className="px-3 py-2 text-right">Unit $</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {projection.materials.map((m, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium text-omega-charcoal">{m.item || '—'}</td>
                    <td className="px-3 py-2 text-xs text-omega-stone">{m.qty || '—'}</td>
                    <td className="px-3 py-2 text-right text-omega-slate">{money(m.unit_price)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-omega-charcoal">{money(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Labor hours + assumptions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {projection.labor_hours_estimate != null && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Labor hours (est.)</p>
            <p className="text-2xl font-bold text-omega-charcoal mt-1">{Number(projection.labor_hours_estimate).toLocaleString()}h</p>
            <p className="text-[11px] text-omega-stone mt-0.5">Across all trades</p>
          </div>
        )}
        {Array.isArray(projection.assumptions) && projection.assumptions.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 md:col-span-1">
            <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider mb-1.5 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Assumptions
            </p>
            <ul className="space-y-1">
              {projection.assumptions.map((a, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-omega-slate">
                  <span className="text-omega-orange mt-0.5 select-none">•</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="text-[10px] text-omega-stone italic text-center">
        AI estimate for planning. Confirm with suppliers before purchasing. Material prices reflect Home Depot CT typical retail.
      </p>

      </>)}
    </div>
  );
}

function TotalCard({ label, value, tone, emphasis }) {
  const toneClass = {
    green: 'text-green-700',
    orange: 'text-omega-orange',
    red: 'text-red-700',
  }[tone] || 'text-omega-charcoal';
  return (
    <div className={`rounded-xl border p-3 text-center ${emphasis ? 'bg-omega-pale border-omega-orange/30' : 'bg-white border-gray-200'}`}>
      <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-0.5 inline-flex items-center gap-0.5 ${toneClass}`}>
        <DollarSign className="w-4 h-4" />
        {(value || '').replace(/^\$/, '')}
      </p>
    </div>
  );
}
