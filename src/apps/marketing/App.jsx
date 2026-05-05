import { useState } from 'react';
import { LogOut, Megaphone, GitBranch, ClipboardList, MessageCircle } from 'lucide-react';
import PipelineKanban from '../../shared/components/PipelineKanban';
import JarvisChat from '../../shared/components/JarvisChat';
import LeadsList from '../receptionist/screens/LeadsList';
import JobFullView from '../../shared/components/JobFullView';
import DailyLogsScreen from '../../shared/components/DailyLogsScreen';

// Placeholder Marketing role — read-only pipeline + My Leads + the
// new full-page Daily Logs screen so Ramon can chime in on project
// chats he's a member of without leaving the marketing surface.
export default function MarketingApp({ user, onLogout }) {
  const [tab, setTab] = useState('pipeline');
  const [fullViewJob, setFullViewJob] = useState(null);

  return (
    <div className="flex h-screen bg-omega-cloud overflow-hidden">
      <aside className="w-56 flex-shrink-0 bg-omega-charcoal flex flex-col">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-omega-orange flex items-center justify-center flex-shrink-0">
            <Megaphone className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-omega-stone font-semibold">Marketing</p>
            <p className="text-sm font-bold text-white truncate">{user?.name || 'Marketing'}</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <SidebarBtn active={tab === 'pipeline'}    onClick={() => setTab('pipeline')}    icon={GitBranch}      label="Pipeline" />
          <SidebarBtn active={tab === 'leads'}       onClick={() => setTab('leads')}       icon={ClipboardList}  label="My Leads" />
          <SidebarBtn active={tab === 'daily-logs'}  onClick={() => setTab('daily-logs')}  icon={MessageCircle}  label="Daily Logs" />
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-omega-fog hover:bg-white/10 hover:text-white transition-all"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col">
        {tab === 'pipeline'   && <PipelineKanban user={user} readOnly />}
        {tab === 'leads'      && <LeadsList user={user} onBack={() => setTab('pipeline')} />}
        {tab === 'daily-logs' && <DailyLogsScreen user={user} onOpenJob={(job) => setFullViewJob(job)} />}
      </main>

      {fullViewJob && (
        <JobFullView
          job={fullViewJob}
          user={user}
          onClose={() => setFullViewJob(null)}
          onJobUpdated={(u) => setFullViewJob(u)}
          onJobDeleted={() => setFullViewJob(null)}
        />
      )}

      <JarvisChat user={user} />
    </div>
  );
}

function SidebarBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
        active
          ? 'bg-omega-orange text-white'
          : 'text-omega-fog hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
    </button>
  );
}
