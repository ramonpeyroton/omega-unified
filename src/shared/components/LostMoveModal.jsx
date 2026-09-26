// LostMoveModal — confirms moving a job to Lost (pipeline key
// `estimate_rejected`). Used by the Kanban drop, the JobFullView phase
// picker and My Leads → Edit Lead so every manual move into Lost asks the
// same two things: WHY (reason, plus a note when the reason is "Other")
// and WHO (the current user's own PIN).
//
// The modal only validates. `onConfirm({ lost_reason, lost_note })` runs
// the actual save, so the caller writes pipeline_status + lost_reason +
// lost_note in ONE update. Cancel changes nothing.

import { useEffect, useState } from 'react';
import { Eye, EyeOff, XCircle } from 'lucide-react';
import { validateUserPinDetailed } from '../lib/userPin';
import { LOST_REASONS } from '../../apps/receptionist/lib/leadCatalog';

const PIN_REASON_MSG = {
  empty_pin:     'Type your PIN to confirm.',
  no_session:    'Your session looks stale — sign out and sign back in.',
  wrong_pin:     'Wrong PIN — try again.',
  role_mismatch: 'PIN matches a different role. Sign out and sign back in.',
  name_mismatch: 'PIN belongs to another user — double-check the digits.',
  query_failed:  'Network error talking to the server. Try again.',
};

export default function LostMoveModal({ user, jobName, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const noteRequired = reason === 'other';
  const ready = !!reason && !!pin && (!noteRequired || !!note.trim());

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function handleConfirm() {
    if (!reason) { setErr('Pick a reason.'); return; }
    if (noteRequired && !note.trim()) { setErr('Add a short note for "Other".'); return; }
    setErr('');
    setBusy(true);
    try {
      const result = await validateUserPinDetailed(user, pin);
      if (!result.ok) {
        setErr(PIN_REASON_MSG[result.reason] || 'Verification failed.');
        return;
      }
      await onConfirm({ lost_reason: reason, lost_note: note.trim() || null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lost-move-title"
        className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-200 flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-red-50 inline-flex items-center justify-center flex-shrink-0">
            <XCircle className="w-5 h-5 text-red-600" />
          </span>
          <div>
            <p id="lost-move-title" className="font-bold text-omega-charcoal text-lg">Move to Lost</p>
            <p className="text-sm text-omega-stone mt-0.5">
              <strong>{jobName}</strong> leaves the active pipeline. Pick the reason and type your own PIN to confirm.
            </p>
          </div>
        </div>

        <form
          autoComplete="off"
          className="p-5 space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (ready && !busy) handleConfirm(); }}
        >
          <div>
            <p className="text-xs font-semibold text-omega-stone uppercase mb-1.5">Reason</p>
            <div className="grid grid-cols-2 gap-2">
              {LOST_REASONS.map((r) => {
                const active = reason === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => { setReason(r.value); setErr(''); }}
                    className={`min-h-[40px] px-3 py-2 rounded-xl border-2 text-left text-sm font-semibold transition-colors ${
                      active
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 text-omega-charcoal hover:border-red-300'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="lost-move-note" className="text-xs font-semibold text-omega-stone uppercase">
              Note {noteRequired ? <span className="text-red-600">(required for Other)</span> : <span className="normal-case font-normal">(optional)</span>}
            </label>
            <textarea
              id="lost-move-note"
              rows={2}
              value={note}
              onChange={(e) => { setNote(e.target.value); setErr(''); }}
              placeholder={noteRequired ? 'What happened?' : 'Anything the team should know'}
              className="mt-1 w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-omega-orange focus:outline-none text-base resize-none"
            />
          </div>

          <div>
            <label htmlFor="lost-move-pin" className="text-xs font-semibold text-omega-stone uppercase">Your PIN</label>
            <div className="relative mt-1">
              <input
                id="lost-move-pin"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                name="omega-confirm-pin"
                autoComplete="new-password"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }}
                className="w-full px-3 py-2.5 pr-10 rounded-lg border-2 border-gray-200 focus:border-omega-orange focus:outline-none text-base font-mono tracking-[0.3em]"
                placeholder="••••"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPin((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-omega-stone"
                aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {err && <p className="text-xs text-red-600 font-semibold">{err}</p>}

          <div className="pt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="min-h-[40px] px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !ready}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-60"
            >
              {busy ? 'Confirming…' : 'Move to Lost'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
