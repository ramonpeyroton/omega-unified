import { LogOut, Monitor } from 'lucide-react';
import PipelineKanban from '../../shared/components/PipelineKanban';
import JarvisChat from '../../shared/components/JarvisChat';

// Placeholder Screen role — read-only pipeline overview. Designed for a
// TV/kiosk display, no financial data, no drag-and-drop, no drawer.
// Future expansion can add big-number widgets, now-playing phases, etc.
export default function ScreenApp({ user, onLogout }) {
  return (
    <div className="flex flex-col h-screen bg-omega-cloud overflow-hidden">
      {/* Top bar */}
      <header className="bg-omega-charcoal text-white px-5 py-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-omega-orange flex items-center justify-center">
            <Monitor className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-omega-fog font-semibold">Display</p>
            <p className="text-sm font-bold">{user?.name || 'Screen'}</p>
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
