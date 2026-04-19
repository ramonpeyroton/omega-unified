import { LogOut, Megaphone } from 'lucide-react';
import PipelineKanban from '../../shared/components/PipelineKanban';
import JarvisChat from '../../shared/components/JarvisChat';

// Placeholder Marketing role — read-only pipeline view. No financial data.
// Future expansion: service/city breakdown, conversion rates, client list.
export default function MarketingApp({ user, onLogout }) {
  return (
    <div className="flex flex-col h-screen bg-omega-cloud overflow-hidden">
      <header className="bg-omega-charcoal text-white px-5 py-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-omega-orange flex items-center justify-center">
            <Megaphone className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-omega-fog font-semibold">Marketing</p>
            <p className="text-sm font-bold">{user?.name || 'Marketing'}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign Out
        </button>
      </header>

      <main className="flex-1 overflow-hidden">
        <PipelineKanban user={user} readOnly />
      </main>

      <JarvisChat user={user} />
    </div>
  );
}
