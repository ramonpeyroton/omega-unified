import { useState } from 'react';
import { ArrowLeft, FileText, Edit2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getSectionsForServices, shouldShowQuestion } from '../data/questionnaire';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

function getDisplayValue(question, value) {
  if (value === undefined || value === null || value === '') return null;
  if (question.type === 'upload') {
    if (!Array.isArray(value) || value.length === 0) return null;
    return `${value.length} photo${value.length > 1 ? 's' : ''} uploaded`;
  }
  if (question.type === 'notes') return value || null;
  if (question.type === 'text') return value || null;
  if (question.type === 'multi') {
    if (!Array.isArray(value) || value.length === 0) return null;
    const labels = value.map((v) => {
      const opt = question.options?.find((o) => o.value === v);
      return opt ? opt.label : v;
    });
    return labels.join(', ');
  }
  if (question.type === 'single') {
    const opt = question.options?.find((o) => o.value === value);
    return opt ? opt.label : value;
  }
  return String(value);
}

export default function ReviewAnswers({ job, answers, onBack, onConfirm }) {
  const services = job.service ? job.service.split(', ') : [];
  const sections = getSectionsForServices(services);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState(null);

  // Build answered items per section
  const reviewSections = sections
    .map((section) => {
      const items = section.questions
        .filter((q) => q.type !== 'upload' && shouldShowQuestion(q, answers))
        .map((q) => ({ question: q, display: getDisplayValue(q, answers[q.id]) }))
        .filter((item) => item.display !== null);
      // Count uploads separately
      const uploads = section.questions
        .filter((q) => q.type === 'upload')
        .map((q) => ({ question: q, display: getDisplayValue(q, answers[q.id]) }))
        .filter((item) => item.display !== null);
      return { ...section, items: [...items, ...uploads] };
    })
    .filter((s) => s.items.length > 0);

  const totalAnswered = reviewSections.reduce((sum, s) => sum + s.items.length, 0);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const { error } = await supabase
        .from('jobs')
        .update({ answers, status: 'to_quote' })
        .eq('id', job.id);
      if (error) throw error;
      onConfirm({ ...job, answers, status: 'to_quote' });
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to save. Check your connection.' });
      setConfirming(false);
    }
  };

  return (
    <div className="min-h-screen bg-omega-cloud pb-28">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="bg-omega-charcoal px-5 pt-12 pb-5 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-omega-fog text-xs">{job.client_name}</p>
            <h1 className="text-white font-bold text-base">Review Answers</h1>
          </div>
        </div>
        <p className="text-omega-fog text-xs mt-2 pl-11">{totalAnswered} answers recorded</p>
      </div>

      {/* Sections */}
      <div className="px-4 py-5 space-y-4">
        {reviewSections.length === 0 && (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 text-omega-fog mx-auto mb-3" />
            <p className="font-semibold text-omega-charcoal mb-1">No answers yet</p>
            <p className="text-sm text-omega-stone">Go back and fill in the questionnaire.</p>
          </div>
        )}

        {reviewSections.map((section) => (
          <div key={section.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-bold text-omega-charcoal uppercase tracking-wider">{section.title}</p>
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-xs text-omega-orange font-medium"
              >
                <Edit2 className="w-3 h-3" />
                Edit
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {section.items.map(({ question, display }) => (
                <div key={question.id} className="px-4 py-3">
                  <p className="text-xs text-omega-stone mb-0.5">{question.text}</p>
                  <p className="text-sm font-medium text-omega-charcoal">{display}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4 shadow-lg">
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white font-bold text-base transition-all shadow-lg shadow-omega-orange/25"
        >
          {confirming ? (
            <>
              <LoadingSpinner size={20} color="text-white" />
              Saving...
            </>
          ) : (
            <>
              <CheckCircle className="w-5 h-5" />
              Confirm & Generate Report
            </>
          )}
        </button>
      </div>
    </div>
  );
}
