import { useState } from 'react';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import logoImg from './assets/logo.png';
import LoadingSpinner from './components/LoadingSpinner';
import { supabase } from './shared/lib/supabase';
import { logAudit } from './shared/lib/audit';

// Hardcoded default PINs. Admin-managed PINs in the `users` table take
// precedence when available. Admin role is INTENTIONALLY NOT here — admin
// only logs in through the hidden /admin-x9k2 route.
const PIN_TO_ROLE = {
  '3333': 'owner',       // Inácio
  '4444': 'operations',  // Brenda
  '1111': 'sales',       // Attila
  '2222': 'manager',     // Gabriel
  '5555': 'screen',      // Dash (placeholder)
  '7777': 'marketing',   // Ramon (placeholder)
};

// PINs that are silently rejected in the public login (they work only in
// the hidden admin login). Keeps admin invisible to casual users.
const BLOCKED_PINS = new Set(['0000']);

export default function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Please enter your name'); return; }
    setLoading(true);

    // Silently block admin PINs in the public login — they only work via
    // the hidden /admin-x9k2 route. Show the generic error so there's no
    // hint that this PIN is reserved.
    if (BLOCKED_PINS.has(pin)) {
      setLoading(false);
      setError('Incorrect PIN. Please try again.');
      return;
    }

    let role = null;
    let resolvedName = name.trim();

    // 1. DB lookup first — admin-managed users table
    try {
      const { data } = await supabase
        .from('users')
        .select('name, role, pin, active')
        .eq('pin', pin)
        .eq('active', true)
        .maybeSingle();
      if (data && data.role && data.role !== 'admin') {
        role = data.role;
        if (!resolvedName && data.name) resolvedName = data.name;
      }
    } catch {
      /* users table may not exist yet — fall through to static map */
    }

    // 2. Fallback to hardcoded defaults
    if (!role) role = PIN_TO_ROLE[pin] || null;

    if (!role) {
      setLoading(false);
      setError('Incorrect PIN. Please try again.');
      return;
    }

    // Small UX delay
    await new Promise((r) => setTimeout(r, 400));
    setLoading(false);

    const user = { name: resolvedName, role };
    // Fire-and-forget audit log
    logAudit({ user, action: 'user.login', entityType: 'user', details: { role } });
    onLogin(user);
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
              Your Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              autoFocus
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
