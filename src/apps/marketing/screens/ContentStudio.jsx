// Content Studio — AI copy generator for marketing. Ramon picks a real
// project (or types a topic), a content type and a tone, and Claude
// writes the post / blurb / email. Routes through the shared
// /api/ai-proxy helper (no key in the browser).
//
// We deliberately feed only service + town + Ramon's own highlights to
// the model — never the client's full name or address — so generated
// public copy doesn't leak private details.

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2, Copy, Check, RefreshCw, Wand2, Type, Images } from 'lucide-react';
import PageHeader from '../../../shared/components/ui/PageHeader';
import { supabase } from '../../../shared/lib/supabase';
import { callAnthropicShared } from '../../../shared/lib/anthropic';
import { serviceBadgeLabel } from '../../../shared/data/services';
import CarouselMaker from './CarouselMaker';

const CONTENT_TYPES = [
  { id: 'instagram', label: 'Instagram caption', hint: 'short, hooky, 3-6 hashtags + emojis' },
  { id: 'facebook',  label: 'Facebook post',     hint: 'warm, a bit longer, community tone' },
  { id: 'website',   label: 'Website blurb',     hint: 'polished project description for the site/Houzz' },
  { id: 'email',     label: 'Email to past clients', hint: 'friendly check-in + soft referral ask' },
  { id: 'review',    label: 'Review request',    hint: 'short message asking a happy client for a Google review' },
];
const TONES = ['Professional', 'Friendly', 'Premium / high-end', 'Energetic'];

export default function ContentStudio({ user }) {
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [type, setType] = useState('instagram');
  const [tone, setTone] = useState('Friendly');
  const [highlights, setHighlights] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState('copy'); // 'copy' | 'carousel'

  useEffect(() => {
    (async () => {
      // Projects worth marketing: in progress or completed, with a service.
      const { data } = await supabase
        .from('jobs')
        .select('id, client_name, service, city, pipeline_status')
        .in('pipeline_status', ['in_progress', 'in-progress', 'completed', 'contract_signed'])
        .order('updated_at', { ascending: false })
        .limit(300);
      setJobs((data || []).filter((j) => j.service));
    })();
  }, []);

  const selectedJob = useMemo(() => jobs.find((j) => j.id === jobId) || null, [jobs, jobId]);

  function buildPrompt() {
    const ct = CONTENT_TYPES.find((c) => c.id === type);
    const svc = selectedJob ? serviceBadgeLabel(selectedJob.service) : 'a renovation';
    const town = selectedJob?.city ? ` in ${selectedJob.city}, Connecticut` : ' in Fairfield County, Connecticut';
    const parts = [
      `You are the marketing voice of Omega Development LLC, a premium construction & remodeling company in Fairfield County, Connecticut (decks, kitchens, bathrooms, additions, basements, roofing, full renovations).`,
      `Write ${ct.label === 'Review request' ? 'a' : 'one'} ${ct.label.toLowerCase()} (${ct.hint}).`,
      `Tone: ${tone}.`,
      `Project: ${svc}${town}.`,
      highlights.trim() ? `Specific highlights to feature: ${highlights.trim()}.` : `No extra details provided — keep it general but specific to the service.`,
      `Rules: do NOT invent a client's name, exact address, prices, or dates. Do not use placeholders like [client]. Keep it ready to post as-is. Output only the copy, no preamble or explanation.`,
    ];
    return parts.join('\n');
  }

  async function generate() {
    setLoading(true);
    setError('');
    setOutput('');
    setCopied(false);
    try {
      const text = await callAnthropicShared(buildPrompt(), 900);
      setOutput((text || '').trim());
    } catch (err) {
      setError(err.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <PageHeader icon={Sparkles} title="Content Studio" subtitle="Generate posts, copy & carousels from your projects" />

      {/* Mode toggle */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
        <button onClick={() => setMode('copy')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${mode === 'copy' ? 'bg-omega-orange text-white border-omega-orange' : 'bg-white text-omega-stone border-gray-200 hover:border-omega-orange'}`}>
          <Type className="w-3.5 h-3.5" /> Copy
        </button>
        <button onClick={() => setMode('carousel')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${mode === 'carousel' ? 'bg-omega-orange text-white border-omega-orange' : 'bg-white text-omega-stone border-gray-200 hover:border-omega-orange'}`}>
          <Images className="w-3.5 h-3.5" /> Carousel
        </button>
      </div>

      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-5">
        {mode === 'carousel' ? (
          <CarouselMaker jobs={jobs} user={user} />
        ) : (
        <>
        {/* Inputs */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <div>
            <Label>Project (optional)</Label>
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange outline-none text-base bg-white"
            >
              <option value="">— No specific project (general) —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {serviceBadgeLabel(j.service)}{j.city ? ` · ${j.city}` : ''}{j.client_name ? ` · ${j.client_name}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-omega-stone mt-1">Only the service & town are sent to the AI — never the client's name or address.</p>
          </div>

          <div>
            <Label>Content type</Label>
            <div className="flex flex-wrap gap-2">
              {CONTENT_TYPES.map((c) => (
                <Chip key={c.id} active={type === c.id} onClick={() => setType(c.id)}>{c.label}</Chip>
              ))}
            </div>
          </div>

          <div>
            <Label>Tone</Label>
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <Chip key={t} active={tone === t} onClick={() => setTone(t)}>{t}</Chip>
              ))}
            </div>
          </div>

          <div>
            <Label>Highlights to feature (optional)</Label>
            <textarea
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              rows={3}
              placeholder="e.g. 1,000 sq ft pressure-treated deck, custom built-in benches, before/after transformation"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange outline-none text-base resize-none"
            />
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-60"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Writing…</> : <><Wand2 className="w-4 h-4" /> Generate</>}
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        {/* Output */}
        {output && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-omega-charcoal text-sm">Generated copy</h3>
              <div className="flex items-center gap-2">
                <button onClick={generate} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-omega-orange text-xs font-semibold disabled:opacity-50">
                  <RefreshCw className="w-3.5 h-3.5" /> Regenerate
                </button>
                <button onClick={copy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-omega-charcoal text-white text-xs font-semibold">
                  {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                </button>
              </div>
            </div>
            <p className="text-[15px] leading-relaxed text-omega-charcoal whitespace-pre-wrap">{output}</p>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

function Label({ children }) {
  return <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1.5">{children}</label>;
}
function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${
        active ? 'bg-omega-orange text-white border-omega-orange' : 'bg-white text-omega-stone border-gray-200 hover:border-omega-orange'
      }`}
    >
      {children}
    </button>
  );
}
