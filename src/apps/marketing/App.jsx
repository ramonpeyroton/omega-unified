import { useState } from 'react';
import { LogOut, Megaphone, GitBranch, ClipboardList } from 'lucide-react';
import PipelineKanban from '../../shared/components/PipelineKanban';
import JarvisChat from '../../shared/components/JarvisChat';
import LeadsList from '../receptionist/screens/LeadsList';

// Placeholder Marketing role — read-only pipeline view + My Leads
// (so Ramon can scan the cold-leads pile when planning campaigns).
// No financial data anywhere.
export default function MarketingApp({ user, onLogout }) {
  const [tab, setTab] = useState('pipeline');

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
        <div className="flex items-center gap-1">
          <TabButton active={tab === 'pipeline'} onClick={() => setTab('pipeline')} icon={GitBranch} label="Pipeline" />
          <TabButton active={tab === 'leads'}    onClick={() => setTab('leads')}    icon={ClipboardList} label="My Leads" />
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 ml-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col">
        {tab === 'pipeline' && <PipelineKanban user={user} readOnly />}
        {tab === 'leads'    && <LeadsList user={user} onBack={() => setTab('pipeline')} />}
      </main>

      <JarvisChat user={user} />
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        active
          ? 'bg-omega-orange text-white'
          : 'bg-white/10 hover:bg-white/20 text-white'
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
