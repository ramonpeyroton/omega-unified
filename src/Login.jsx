import { useState } from 'react';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import logoImg from './assets/logo.png';
import LoadingSpinner from './components/LoadingSpinner';
import { supabase } from './shared/lib/supabase';
import { logAudit } from './shared/lib/audit';
import { apiFetch } from './shared/lib/apiFetch';

// Hardcoded default PINs. Admin-managed PINs in the `users` table take
// precedence when available. Admin role is INTENTIONALLY NOT here — admin
// PINs that are silently rejected in the public login (they work only in
// the hidden admin login). Keeps admin invisible to casual users.
const BLOCKED_PINS = new Set(['0000']);

export default function Login({ onLogin }) {
  // Field is labelled "Username" but a legacy free-text name still
  // works (see fallback chain in handleSubmit). Keeping the state var
  // generic so the input stays the source of truth for both paths.
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const typed = identifier.trim();
    if (!typed) { setError('Please enter your username'); return; }
    setLoading(true);

    // Silently block admin PINs in the public login — they only work via
    // the hidden /admin-x9k2 route. Show the generic error so there's no
    // hint that this PIN is reserved.
    if (BLOCKED_PINS.has(pin)) {
      setLoading(false);
      setError('Incorrect username or PIN. Please try again.');
      return;
    }

    let role = null;
    let resolvedName = typed;
    let resolvedId = null;

    // 1. Primary lookup: username + PIN — case-insensitive on
    // username via lower() (matches the unique index in migration
    // 025). This is the path admin-created users go through.
    try {
      const { data } = await supabase
        .from('users')
        .select('id, name, role, pin, active, username')
        .eq('pin', pin)
        .eq('active', true)
        .ilike('username', typed)
        .maybeSingle();
      if (data && data.role && data.role !== 'admin') {
        role = data.role;
        resolvedName = data.name || resolvedName;
        resolvedId = data.id;
      }
    } catch {
      /* users table or username column may not exist yet — fall through */
    }

    // 2. Legacy fallback: PIN + name match. Covers users created
    // before migration 025 (no username yet) — they typed their full
    // name in the field and we look that up against `users.name`.
    if (!role) {
      try {
        const { data } = await supabase
          .from('users')
          .select('id, name, role, pin, active')
          .eq('pin', pin)
          .eq('active', true)
          .ilike('name', typed)
          .maybeSingle();
        if (data && data.role && data.role !== 'admin') {
          role = data.role;
          resolvedName = data.name || resolvedName;
          resolvedId = data.id;
        }
      } catch {
        /* ignore */
      }
    }

    // The legacy PIN_TO_ROLE fallback (1111/2222/3333/etc) was
    // removed once Ramon registered every real user via Admin →
    // Users. Login now requires an actual users row — the old
    // simplified PINs no longer authenticate.

    if (!role) {
      setLoading(false);
      setError('Incorrect username or PIN. Please try again.');
      return;
    }

    // Small UX delay
    await new Promise((r) => setTimeout(r, 400));
    setLoading(false);

    const user = { id: resolvedId, name: resolvedName, role };
    // Fire-and-forget audit log
    logAudit({ user, action: 'user.login', entityType: 'user', details: { role, remember } });

    // Record a login session server-side (captures IP + IP-geo + device
    // from the request headers — the browser can't see its own public IP).
    // Fire-and-forget; never block login on it. The returned session_id is
    // kept so later actions can be tied back to this device/location.
    apiFetch('/api/daily-owner-update?task=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_name: resolvedName, user_role: role }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.session_id) { try { localStorage.setItem('omega_session_id', d.session_id); } catch { /* ignore */ } } })
      .catch(() => {});

    onLogin(user, { remember });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-omega-charcoal px-6 py-12">
      <div className="w-full max-w-sm">

        {/* Logo block */}
        <div className="flex flex-col items-center mb-10">
          <img src={logoImg} alt="Omega" className="h-20 w-auto mb-5" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold tracking-wider text-omega-fog uppercase mb-2">
              Username
            </label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="e.g. inacio"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-4 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder-omega-stone focus:outline-none focus:border-omega-orange focus:bg-white/15 transition-all text-base"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wider text-omega-fog uppercase mb-2">
              PIN
            </label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
                className="w-full px-4 py-3.5 pr-12 rounded-xl bg-white/10 border border-white/20 text-white placeholder-omega-stone focus:outline-none focus:border-omega-orange focus:bg-white/15 transition-all text-base tracking-[0.3em]"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-omega-stone hover:text-white transition-colors"
              >
                {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Remember me — default OFF. When ON, session persists 30 days
              via localStorage; otherwise it stays in sessionStorage (tab). */}
          <label className="flex items-center gap-2.5 select-none cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 rounded border-white/30 bg-white/10 text-omega-orange focus:ring-omega-orange focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-sm text-omega-fog">Remember me on this device</span>
          </label>

          {error && (
            <div className="px-4 py-3 rounded-xl bg-omega-danger/20 border border-omega-danger/30">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white font-semibold text-base transition-all duration-200 mt-2"
          >
            {loading ? (
              <LoadingSpinner size={20} color="text-white" />
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                Sign In
              </>
            )}
          </button>
        </form>

      </div>
    </div>
  );
}
