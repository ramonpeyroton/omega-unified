import { useEffect, useRef, useState } from 'react';
import { X, Camera, DollarSign, Loader2, Receipt as ReceiptIcon, Building2, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';

// Quick-capture flow for receipts. Two modes share this one modal:
//
//  • PROJECT mode (a `job` is passed): the receipt is tied to a client.
//    Categories: Material / Fuel / Van  → logged as a POSITIVE cost in
//    job_expenses (feeds that project's Total Cost & margin), plus a
//    photo row in job_documents (folder='receipts') so it shows in the
//    client card. The "Return" category logs a NEGATIVE amount instead
//    (money came back), which automatically reduces the project cost
//    everywhere it's summed.
//
//  • COMPANY mode (`companyMode` + no job): overhead that belongs to NO
//    client — Office supplies or Gabriel's reimbursable Personal
//    expense. Written to the separate `company_expenses` table so it
//    never touches a client's margin. Surfaced in Finance → Company.
//
// We intentionally do NOT compress the photo — receipts need to stay
// legible. Upload goes straight to Supabase Storage from the browser.

// Per-project categories. `sign: -1` flips the stored amount negative
// (a credit) so Returns reduce the project cost wherever it's summed.
const PROJECT_KINDS = [
  { id: 'Material', label: 'Material', sign: 1 },
  { id: 'Fuel',     label: 'Fuel',     sign: 1 },
  { id: 'Van',      label: 'Van',      sign: 1 },
  { id: 'Return',   label: 'Return',   sign: -1 },
];

// Company overhead categories. Personal is reimbursable to whoever
// logged it; Office is straight company money out.
const COMPANY_KINDS = [
  { id: 'Office',   label: 'Office',   reimbursable: false },
  { id: 'Personal', label: 'Personal', reimbursable: true  },
];

export default function ReceiptCaptureModal({ job, user, companyMode = false, onClose, onSaved }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState(companyMode ? 'Office' : 'Material');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const KINDS = companyMode ? COMPANY_KINDS : PROJECT_KINDS;
  const isReturn = !companyMode && kind === 'Return';
  // Photo is proof — required for project receipts (incl. Returns),
  // optional for company overhead where a paper trail isn't always there.
  const photoRequired = !companyMode;

  // Auto-trigger the file picker on mount so Gabriel lands straight on
  // the camera. He can cancel and type first; Retake reopens it.
  useEffect(() => {
    fileInputRef.current?.click();
  }, []);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onPickFile(e) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
    e.target.value = '';
  }

  async function save() {
    setError('');
    if (photoRequired && !file) { setError('Take a photo of the receipt first.'); return; }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(isReturn ? 'Enter the amount that came back.' : 'Enter the amount you paid.');
      return;
    }

    setSaving(true);
    try {
      // 1. Upload to Storage (if a photo was taken).
      let photoUrl = null;
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const folder = companyMode ? `company/${kind}` : `receipts/${job.id}`;
        const path = `${folder}/${Date.now()}-${safeName}`;
        const upload = await supabase.storage
          .from('job-documents')
          .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });
        if (upload.error) throw upload.error;
        const { data: urlData } = supabase.storage.from('job-documents').getPublicUrl(path);
        photoUrl = urlData?.publicUrl || null;
      }

      const today = new Date().toISOString().slice(0, 10);

      if (companyMode) {
        // ── Company overhead → company_expenses (no client) ──
        const meta = COMPANY_KINDS.find((k) => k.id === kind) || COMPANY_KINDS[0];
        const { error: ceErr } = await supabase
          .from('company_expenses')
          .insert([{
            date: today,
            category: kind,
            description: description.trim() || null,
            amount: value,
            receipt_url: photoUrl,
            logged_by: user?.name || null,
            reimbursable: meta.reimbursable,
            reimbursement_status: meta.reimbursable ? 'to_reimburse' : 'not_applicable',
          }]);
        if (ceErr) throw ceErr;

        logAudit({
          user, action: 'company_expense.capture', entityType: 'company_expense', entityId: null,
          details: { category: kind, amount: value, reimbursable: meta.reimbursable },
        });
      } else {
        // ── Per-project receipt → job_documents + job_expenses ──
        const meta = PROJECT_KINDS.find((k) => k.id === kind) || PROJECT_KINDS[0];
        const signed = value * meta.sign;
        const labelPrefix = isReturn ? 'Return — ' : '';
        const title = `${labelPrefix}${description.trim() || `${kind} · $${value.toFixed(2)}`}`;

        if (photoUrl) {
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
        }

        const { error: expErr } = await supabase
          .from('job_expenses')
          .insert([{
            job_id: job.id,
            date: today,
            category: kind,
            description: (isReturn ? 'Return: ' : '') + (description.trim() || (isReturn ? 'Material return' : 'Receipt photo')),
            amount: signed,
            receipt_url: photoUrl,
            logged_by: user?.name || null,
          }]);
        if (expErr) throw expErr;

        logAudit({
          user, action: 'receipt.capture', entityType: 'job', entityId: job.id,
          details: { amount: signed, category: kind, has_photo: !!photoUrl },
        });
      }

      onSaved?.({ amount: value, kind, isReturn, companyMode, photoUrl });
      onClose?.();
    } catch (err) {
      setError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  const HeaderIcon = companyMode ? Building2 : (isReturn ? RotateCcw : ReceiptIcon);
  const heading = companyMode ? 'Company Expense' : (isReturn ? 'Add Return' : 'Add Receipt');
  const subheading = companyMode ? 'No client — company overhead' : (job?.client_name || 'Job');

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 sticky top-0 bg-white">
          <div className="inline-flex items-center gap-2">
            <span className={`w-8 h-8 rounded-lg inline-flex items-center justify-center ${isReturn ? 'bg-emerald-100' : 'bg-orange-100'}`}>
              <HeaderIcon className={`w-4 h-4 ${isReturn ? 'text-emerald-600' : 'text-omega-orange'}`} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-omega-charcoal">{heading}</h3>
              <p className="text-[11px] text-omega-stone">{subheading}</p>
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
          {/* Category chips */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1.5">
              Type
            </label>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => {
                const active = kind === k.id;
                const ret = k.id === 'Return';
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setKind(k.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${
                      active
                        ? (ret ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-omega-orange text-white border-omega-orange')
                        : 'bg-white text-omega-stone border-gray-200 hover:border-omega-orange'
                    }`}
                  >
                    {k.label}
                  </button>
                );
              })}
            </div>
            {isReturn && (
              <p className="text-[11px] text-emerald-700 mt-1.5">
                A return credits the project — it lowers the total cost for this client.
              </p>
            )}
            {companyMode && kind === 'Personal' && (
              <p className="text-[11px] text-omega-stone mt-1.5">
                Marked reimbursable — the company owes this back to whoever paid.
              </p>
            )}
          </div>

          {/* Hidden capture input */}
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
              <img src={previewUrl} alt="Receipt preview" className="w-full max-h-72 object-contain bg-black/5" />
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
              <span className="text-[11px] text-omega-stone">
                {photoRequired ? 'or pick from your gallery' : 'optional — or pick from gallery'}
              </span>
            </button>
          )}

          {/* Amount */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">
              {isReturn ? 'How much came back?' : 'How much?'}
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
              placeholder={
                isReturn ? 'e.g. Returned extra deck boards'
                  : companyMode ? 'e.g. Printer paper, gloves'
                  : 'e.g. Lumber at Home Depot'
              }
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange focus:outline-none text-sm text-omega-charcoal"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50 sticky bottom-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-white text-sm font-bold text-omega-charcoal disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !amount || (photoRequired && !file)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl disabled:opacity-60 text-white text-sm font-bold ${
              isReturn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-omega-orange hover:bg-omega-dark'
            }`}
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : (isReturn ? 'Save Return' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
