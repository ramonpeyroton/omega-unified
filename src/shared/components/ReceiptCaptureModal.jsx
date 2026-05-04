import { useEffect, useRef, useState } from 'react';
import { X, Camera, DollarSign, Loader2, Receipt as ReceiptIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';

// Quick-capture flow for material purchase receipts.
//
// Triggered from Gabriel's Today's Jobs row (orange CTA next to the
// Update / Issue buttons). The modal:
//   1. Asks the phone for a camera photo (or gallery fallback). On
//      mobile, capture="environment" pops the back camera straight
//      up so he can shoot the paper receipt without leaving the app.
//   2. Shows a thumbnail + a "How much?" amount input + optional
//      description.
//   3. On Save, uploads the file to bucket `job-documents` under
//      `receipts/<job-id>/<timestamp>-<filename>`, writes a row to
//      `job_documents` (folder='receipts') so it shows up in the
//      Documents tab, AND a row to `job_expenses` (category='Material',
//      receipt_url=same URL) so Financials totals update automatically.
//
// We intentionally do NOT compress the photo here — receipts need to
// stay legible. The Vercel ~4.5 MB body limit is a non-issue because
// we upload directly to Supabase Storage from the browser, not
// through a serverless function.
export default function ReceiptCaptureModal({ job, user, onClose, onSaved }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Auto-trigger the file picker on mount so Gabriel hits Receipts and
  // is already looking at the camera viewfinder. He can cancel and the
  // modal stays open if he wants to type the amount first and snap
  // later — the picker reopens via the "Retake" button.
  useEffect(() => {
    fileInputRef.current?.click();
  }, []);

  // Free the object URL when the file changes (or on unmount).
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onPickFile(e) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
    // Reset the input so picking the SAME file twice still fires change.
    e.target.value = '';
  }

  async function save() {
    setError('');
    if (!file) { setError('Take a photo of the receipt first.'); return; }
    const cents = Number(amount);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter the amount you paid.');
      return;
    }

    setSaving(true);
    try {
      // 1. Upload to Storage.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const path = `receipts/${job.id}/${Date.now()}-${safeName}`;
      const upload = await supabase.storage
        .from('job-documents')
        .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });
      if (upload.error) throw upload.error;

      const { data: urlData } = supabase.storage.from('job-documents').getPublicUrl(path);
      const photoUrl = urlData?.publicUrl;
      if (!photoUrl) throw new Error('Could not resolve receipt URL.');

      // 2. Documents tab row (folder='receipts').
      const title = description.trim()
        || `Receipt · $${cents.toFixed(2)}`;
      const { error: docErr } = await supabase
        .from('job_documents')
        .insert([{
          job_id: job.id,
          folder: 'receipts',
          title,
          photo_url: photoUrl,
          uploaded_by: user?.name || null,
        }]);
      if (docErr) throw docErr;

      // 3. Financials row — auto-categorized as Material since this CTA
      // lives next to the Materials tile. Gabriel can re-categorize
      // from the Financials tab if needed.
      const today = new Date().toISOString().slice(0, 10);
      const { error: expErr } = await supabase
        .from('job_expenses')
        .insert([{
          job_id: job.id,
          date: today,
          category: 'Material',
          description: description.trim() || 'Receipt photo',
          amount: cents,
          receipt_url: photoUrl,
          logged_by: user?.name || null,
        }]);
      if (expErr) throw expErr;

      logAudit({
        user,
        action: 'receipt.capture',
        entityType: 'job',
        entityId: job.id,
        details: { amount: cents, has_photo: true },
      });

      onSaved?.({ amount: cents, photoUrl });
      onClose?.();
    } catch (err) {
      setError(err.message || 'Failed to save receipt.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="inline-flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-orange-100 inline-flex items-center justify-center">
              <ReceiptIcon className="w-4 h-4 text-omega-orange" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-omega-charcoal">Add Receipt</h3>
              <p className="text-[11px] text-omega-stone">{job?.client_name || 'Job'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-omega-stone"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Hidden capture input — opened on mount and via Retake. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickFile}
            className="hidden"
          />

          {/* Preview / placeholder */}
          {previewUrl ? (
            <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
              <img
                src={previewUrl}
                alt="Receipt preview"
                className="w-full max-h-72 object-contain bg-black/5"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/95 border border-gray-200 text-[11px] font-bold text-omega-charcoal shadow-sm"
              >
                <Camera className="w-3.5 h-3.5" /> Retake
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-xl border-2 border-dashed border-gray-300 hover:border-omega-orange hover:bg-omega-pale/30 transition-colors"
            >
              <Camera className="w-8 h-8 text-omega-stone" />
              <span className="text-sm font-bold text-omega-charcoal">Tap to take photo</span>
              <span className="text-[11px] text-omega-stone">or pick from your gallery</span>
            </button>
          )}

          {/* Amount */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">
              How much?
            </label>
            <div className="relative">
              <DollarSign className="w-4 h-4 text-omega-stone absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
                className="w-full pl-9 pr-3 py-3 rounded-xl border border-gray-200 focus:border-omega-orange focus:outline-none text-base font-semibold text-omega-charcoal"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">
              What was it for? <span className="text-omega-stone font-normal normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Lumber at Home Depot"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange focus:outline-none text-sm text-omega-charcoal"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-white text-sm font-bold text-omega-charcoal disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !file || !amount}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-bold"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Save Receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}
