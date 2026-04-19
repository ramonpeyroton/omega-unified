import { useState } from 'react';
import { Eye, EyeOff, Shield } from 'lucide-react';
import logoImg from './assets/logo.png';
import LoadingSpinner from './components/LoadingSpinner';

// Hidden admin PIN. Hardcoded here on purpose — admin is NOT in the
// `users` table. This guarantees the admin account can never be deleted
// or locked out through the Admin > Users screen.
const ADMIN_PIN = '0000';

export default function AdminLogin({ onLogin }) {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (pin !== ADMIN_PIN) {
      setError('Access denied.');
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 400));
    setLoading(false);

    // Admin user is anonymous on purpose — no auditable name, generic label.
    onLogin({ name: 'Admin', role: 'admin', _internal: true });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <img src={logoImg} alt="Omega" className="h-20 w-auto mb-5 opacity-90" />
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
            <Shield className="w-3.5 h-3.5 text-red-400" />
            <p className="text-xs text-white/60 font-semibold tracking-wider uppercase">Restricted</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold tracking-wider text-white/60 uppercase mb-2">
              Admin PIN
            </label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
                autoFocus
                className="w-full px-4 py-3.5 pr-12 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-red-400/60 focus:bg-white/10 transition-all text-base tracking-[0.3em]"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
              >
                {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-900/30 border border-red-500/30">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold text-base transition-all duration-200 mt-2"
          >
            {loading ? <LoadingSpinner size={20} color="text-white" /> : <><Shield className="w-5 h-5" />Authenticate</>}
          </button>
        </form>
      </div>
    </div>
  );
}
