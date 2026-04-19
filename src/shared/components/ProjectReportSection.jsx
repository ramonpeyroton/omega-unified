import { useEffect, useState } from 'react';
import { FileText, RefreshCw, Clock, ClipboardEdit, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import MarkdownReport from './MarkdownReport';

/**
 * Read-only AI project report viewer — visible to all roles that reach the
 * job detail view. Pulls from `job_reports` (versioned history) and falls
 * back to the legacy `jobs.latest_report` / `jobs.report_raw` text.
 *
 * The report is NEVER regenerated here — generation happens once in Sales'
 * Report screen when the questionnaire is completed. This component only
 * READS the stored copy to keep AI costs down.
 */
export default function ProjectReportSection({ job, onOpenQuestionnaire }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job?.id]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('job_reports')
        .select('*')
        .eq('job_id', job.id)
        .order('version', { ascending: false })
        .limit(10);
      const rows = data || [];
      if (rows.length === 0 && (job.latest_report || job.report_raw)) {
        rows.push({
          id: 'current',
          version: 1,
          report_content: job.latest_report || job.report_raw,
          generated_at: job.report_generated_at || job.updated_at || job.created_at,
        });
      }
      setVersions(rows);
      setSelectedIdx(0);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }

  const current = versions[selectedIdx];
  const outdated =
    job.questionnaire_modified ||
    (job.questionnaire_modified_at && current?.generated_at &&
      new Date(job.questionnaire_modified_at) > new Date(current.generated_at));

  if (loading) {
    return <p className="text-sm text-omega-stone py-3">Loading report…</p>;
  }

  if (versions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
        <Sparkles className="w-8 h-8 text-omega-orange mx-auto mb-3" />
        <p className="font-bold text-omega-charcoal">Report not generated yet</p>
        <p className="text-xs text-omega-stone mt-1 max-w-xs mx-auto">
          The AI report is generated automatically when sales finishes the questionnaire — it's saved and reused, not regenerated on every view.
        </p>
        {onOpenQuestionnaire && (
          <button
            onClick={onOpenQuestionnaire}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
          >
            <ClipboardEdit className="w-4 h-4" /> Open Questionnaire
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Outdated warning */}
      {outdated && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
          <RefreshCw className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-red-800 font-semibold">
              The questionnaire was modified after this report was generated.
            </p>
            <p className="text-[11px] text-red-700 mt-0.5">
              Ask Sales to regenerate to reflect the latest answers.
            </p>
          </div>
        </div>
      )}

      {/* Meta + version picker */}
      <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-omega-stone">
        <div className="inline-flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          Saved {current.generated_at ? new Date(current.generated_at).toLocaleString() : '—'}
          {current.version && <span className="ml-1 px-1.5 py-0.5 rounded bg-omega-pale text-omega-orange font-semibold">v{current.version}</span>}
        </div>
        {versions.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="mr-1">Version:</span>
            {versions.map((v, i) => (
              <button
                key={v.id}
                onClick={() => setSelectedIdx(i)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                  i === selectedIdx ? 'bg-omega-orange text-white' : 'bg-gray-100 text-omega-slate hover:bg-gray-200'
                }`}
              >
                v{v.version}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Rendered report */}
      <MarkdownReport raw={current.report_content} />
    </div>
  );
}
