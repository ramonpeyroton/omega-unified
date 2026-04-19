import { useState, useRef } from 'react';
import { ArrowLeft, Upload, FileText, SkipForward, CheckCircle, X } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

async function analyzePDFDocument(base64Data) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64Data },
            },
            {
              type: 'text',
              text: `Extract all relevant construction project information from this document. Be thorough and specific. Include:
- All dimensions and measurements (rooms, spaces, square footage)
- Specified materials, finishes, fixtures, and brands
- Full scope of work as described
- Any budget figures or cost estimates mentioned
- Timeline or scheduling notes
- Special requirements, conditions, or constraints
- Notes, comments, or annotations
- How many pages this document has

Format as: "DOCUMENT ANALYSIS (X pages detected):" followed by structured bullet points. This will be used by a construction estimator.`,
            },
          ],
        }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${response.status}`);
    }
    const data = await response.json();
    return data.content[0].text;
  } finally {
    clearTimeout(timeout);
  }
}

export default function PDFUpload({ job, onSkip, onAnalyzed }) {
  const [file, setFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  const pageMatch = result?.match(/(\d+)\s*page/i);
  const pageCount = pageMatch ? parseInt(pageMatch[1]) : null;

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { setError('Please select a PDF file'); return; }
    setFile(f);
    setError(null);
    setResult(null);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const text = await analyzePDFDocument(base64);
      setResult(text);
    } catch (err) {
      setError(err.message || 'Failed to analyze PDF. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-omega-cloud">
      <div className="bg-omega-charcoal px-5 pt-12 pb-6 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={onSkip} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-omega-fog text-xs font-medium">{job.client_name}</p>
            <h1 className="text-white font-bold text-lg">Project Documents</h1>
          </div>
        </div>
      </div>

      <div className="px-5 py-6 space-y-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-omega-orange" />
            </div>
            <div>
              <p className="font-semibold text-omega-charcoal">Existing plans or documents?</p>
              <p className="text-sm text-omega-stone mt-0.5">Upload a PDF — floor plans, scope of work, previous estimate — and Omega AI will extract all relevant project info automatically.</p>
            </div>
          </div>

          {!result ? (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                className={`w-full flex flex-col items-center gap-3 py-8 rounded-xl border-2 border-dashed transition-colors ${
                  file ? 'border-omega-orange bg-omega-pale' : 'border-gray-200 hover:border-omega-orange/40'
                }`}
              >
                {file
                  ? <FileText className="w-8 h-8 text-omega-orange" />
                  : <Upload className="w-8 h-8 text-omega-fog" />}
                <div className="text-center">
                  <p className={`font-semibold text-sm ${file ? 'text-omega-charcoal' : 'text-omega-stone'}`}>
                    {file ? file.name : 'Tap to select PDF'}
                  </p>
                  {file
                    ? <p className="text-xs text-omega-stone mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                    : <p className="text-xs text-omega-fog mt-1">PDF files only</p>}
                </div>
              </button>
              <input ref={fileRef} type="file" accept="application/pdf" onChange={handleFileSelect} className="hidden" />

              {error && (
                <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200">
                  <p className="text-xs text-omega-danger">{error}</p>
                </div>
              )}

              {file && (
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="w-full flex items-center justify-center gap-2 mt-4 py-3.5 rounded-xl bg-omega-orange text-white font-semibold hover:bg-omega-dark disabled:opacity-60 transition-colors"
                >
                  {analyzing
                    ? <><LoadingSpinner size={16} color="text-white" /><span>Analyzing document...</span></>
                    : <><Upload className="w-4 h-4" /><span>Analyze with Omega AI</span></>}
                </button>
              )}

              {analyzing && (
                <p className="text-center text-xs text-omega-stone mt-2">This may take 15–30 seconds depending on document size</p>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-green-50 border border-green-200">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-800">Document analyzed successfully</p>
                  {pageCount && <p className="text-xs text-green-600">{pageCount} page{pageCount !== 1 ? 's' : ''} detected</p>}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 max-h-56 overflow-y-auto">
                <p className="text-xs text-omega-slate whitespace-pre-wrap leading-relaxed">{result}</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setResult(null); setFile(null); }}
                  className="flex items-center gap-1.5 flex-1 justify-center py-3 rounded-xl border border-gray-200 text-omega-charcoal text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Different File
                </button>
                <button
                  onClick={() => onAnalyzed(result)}
                  className="flex-1 py-3 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark transition-colors"
                >
                  Continue to Questionnaire
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onSkip}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border border-gray-200 bg-white text-omega-stone hover:text-omega-charcoal text-sm font-medium transition-colors shadow-sm"
        >
          <SkipForward className="w-4 h-4" />
          Skip — no documents
        </button>
      </div>
    </div>
  );
}
