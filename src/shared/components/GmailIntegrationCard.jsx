// GmailIntegrationCard — settings card shown in Admin → Company Settings.
// Lets an admin connect a Gmail account so new emails with PDF attachments
// are automatically parsed and filed as invoices in the right job.

import { useEffect, useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';

export default function GmailIntegrationCard() {
  const [status, setStatus]   = useState(null); // null | { connected, email, watchExpiration }
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [toast, setToast]     = useState('');

  // Read ?gmail= param from URL after OAuth redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result  = params.get('gmail');
    const account = params.get('account');
    const reason  = params.get('reason');
    if (result === 'connected') {
      showToast(`✓ Connected ${account || 'Gmail account'}`);
      // Clean the URL.
      window.history.replaceState({}, '', window.location.pathname);
    } else if (result === 'error') {
      showToast(`Connection failed: ${reason || 'unknown error'}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
    loadStatus();
  }, []);

  async function loadStatus() {
    setLoading(true);
    try {
      const r = await apiFetch('/api/email/status');
      const d = await r.json();
      setStatus(d);
    } catch {
      setStatus({ ok: false, connected: false });
    } finally {
      setLoading(false);
    }
  }

  async function connect() {
    // Redirect to the OAuth flow (server does the redirect to Google).
    window.location.href = '/api/email/connect';
  }

  async function disconnect() {
    if (!confirm('Disconnect Gmail? The app will stop receiving invoices by email.')) return;
    setWorking(true);
    try {
      await apiFetch('/api/email/disconnect', { method: 'POST' });
      showToast('Gmail disconnected');
      loadStatus();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setWorking(false);
    }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  const watchExpiry = status?.watchExpiration
    ? new Date(status.watchExpiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="bg-white rounded-2xl border border-omega-cloud p-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-omega-charcoal text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
            <Mail className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-bold text-omega-charcoal">Gmail Integration</h3>
            <p className="text-xs text-omega-slate mt-0.5">
              Auto-file sub invoices received by email
            </p>
          </div>
        </div>
        {!loading && (
          <button onClick={loadStatus} className="text-omega-fog hover:text-omega-slate transition">
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* How it works (shown when not connected) */}
      {!loading && !status?.connected && (
        <div className="bg-omega-cloud rounded-xl p-4 mb-4 space-y-1.5 text-sm text-omega-slate">
          <p className="font-medium text-omega-charcoal text-xs uppercase tracking-wide mb-2">How it works</p>
          <p>① Sub sends an invoice PDF to your business email.</p>
          <p>② AI reads the email + PDF and identifies which project it belongs to.</p>
          <p>③ Invoice is auto-filed in the project's Documents tab.</p>
          <p>④ Low-confidence matches land in <strong>Operations → Invoice Inbox</strong> for review.</p>
        </div>
      )}

      {/* Status */}
      {loading ? (
        <div className="flex items-center gap-2 text-omega-slate text-sm py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking connection…
        </div>
      ) : status?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-xl px-3 py-2.5">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <div>
              <p className="font-semibold">Connected</p>
              <p className="text-xs text-green-600">{status.email}</p>
            </div>
          </div>
          {watchExpiry && (
            <p className="text-xs text-omega-fog">
              Push notifications active · renews automatically · expires {watchExpiry}
            </p>
          )}
          <button
            onClick={disconnect}
            disabled={working}
            className="flex items-center gap-2 text-sm text-omega-slate hover:text-red-600 transition disabled:opacity-40"
          >
            {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            Disconnect Gmail
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-omega-slate bg-omega-cloud rounded-xl px-3 py-2.5">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Not connected
          </div>
          <button
            onClick={connect}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-omega-orange text-white text-sm font-semibold rounded-xl hover:bg-orange-600 transition"
          >
            <Mail className="w-4 h-4" />
            Connect Gmail Account
          </button>
          <p className="text-xs text-omega-fog text-center">
            You'll be redirected to Google to authorize read-only access.
          </p>
        </div>
      )}
    </div>
  );
}
