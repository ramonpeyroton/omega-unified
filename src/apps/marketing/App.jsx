// Marketing sub-app — read-only Pipeline + My Leads, plus the Daily
// Logs cascade. Migrated to URL-based routing.

import { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useSearchParams, useLocation, Navigate, Outlet } from 'react-router-dom';
import { LogOut, Megaphone, GitBranch, ClipboardList, MessageCircle, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';

import PipelineKanban from '../../shared/components/PipelineKanban';
import LeadsList from '../receptionist/screens/LeadsList';
import JobFullView from '../../shared/components/JobFullView';
import DailyLogsList from '../../shared/components/DailyLogsList';
import MobileDailyLogs from '../../shared/components/MobileDailyLogs';
import MobileMoreSheet from './components/MobileMoreSheet';
import { useJobById } from '../../shared/hooks/useJobById';

// Maps the current URL pathname to the bottom-bar item id for the
// active-state highlight.
function screenIdFromPath(pathname) {
  if (pathname.startsWith('/leads')) return 'leads';
  if (pathname.startsWith('/daily-logs')) return 'daily-logs';
  if (pathname === '/' || pathname === '') return 'pipeline';
  return null; // job pages — no bottom-bar highlight
}

// ─── Mobile bottom bar ────────────────────────────────────────────
function MobileBottomBar({ onMore }) {
  const navigate = useNavigate();
  const location = useLocation();
  const screen = screenIdFromPath(location.pathname);

  const items = [
    { id: 'pipeline',   icon: GitBranch,           label: 'Pipeline', to: '/' },
    { id: 'leads',      icon: ClipboardList,      label: 'Leads',    to: '/leads' },
    { id: 'daily-logs', icon: MessageCircle,      label: 'Logs',     to: '/daily-logs' },
    { id: 'more',       icon: MoreHorizontal,     label: 'More' },
  ];
  return (
    <nav aria-label="Main navigation" className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex md:hidden safe-bottom">
      {items.map(({ id, icon: Icon, label, to }) => (
        <button
          key={id}
          onClick={() => (id === 'more' ? onMore?.() : navigate(to))}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-h-[44px] ${
            screen === id ? 'text-omega-orange' : 'text-omega-stone'
          }`}
        >
          <Icon className="w-5 h-5" />
          <span className="text-[10px] font-semibold">{label}</span>
        </button>
      ))}
    </nav>
  );
}

function MarketingShell({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [dailyLogsOpen, setDailyLogsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const tab = location.pathname.startsWith('/leads') ? 'leads' : 'pipeline';

  return (
    <div className="flex h-screen bg-omega-cloud overflow-hidden">
      <aside className="w-56 flex-shrink-0 bg-omega-charcoal hidden md:flex flex-col">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-omega-orange flex items-center justify-center flex-shrink-0">
            <Megaphone className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-omega-stone font-semibold">Marketing</p>
            <p className="text-sm font-bold text-white truncate">{user?.name || 'Marketing'}</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <SidebarBtn active={tab === 'pipeline'} onClick={() => navigate('/')}        icon={GitBranch}     label="Pipeline" />
          <SidebarBtn active={tab === 'leads'}    onClick={() => navigate('/leads')}   icon={ClipboardList} label="My Leads" />

          <button
            onClick={() => setDailyLogsOpen((o) => !o)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              dailyLogsOpen
                ? 'bg-white/10 text-white'
                : 'text-omega-fog hover:bg-white/10 hover:text-white'
            }`}
          >
            <MessageCircle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-left">Daily Logs</span>
            {dailyLogsOpen
              ? <ChevronDown className="w-4 h-4 text-white/60" />
              : <ChevronRight className="w-4 h-4 text-white/60" />}
          </button>
          {dailyLogsOpen && (
            <DailyLogsList
              user={user}
              onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: location.pathname } })}
            />
          )}
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

      <main className="flex-1 overflow-hidden flex flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </main>

      <MobileBottomBar onMore={() => setMoreOpen(true)} />
      <MobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        user={user}
        onLogout={onLogout}
      />
    </div>
  );
}

function PipelineRoute({ user }) {
  const navigate = useNavigate();
  return (
    <PipelineKanban
      user={user}
      readOnly
      onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/' } })}
    />
  );
}

function LeadsRoute({ user }) {
  const navigate = useNavigate();
  return (
    <LeadsList
      user={user}
      onBack={() => navigate('/')}
      onOpenJob={(job) => navigate(`/jobs/${job.id}?tab=daily`, { state: { from: '/leads' } })}
    />
  );
}

function JobFullViewRoute({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tabHint = searchParams.get('tab');
  const { job, setJob, loading } = useJobById(id);

  const handleClose = () => {
    const from = location.state?.from;
    navigate(from || '/');
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-omega-stone">Loading…</div>;
  if (!job) return <Navigate to="/" replace />;

  return (
    <JobFullView
      job={job}
      user={user}
      initialTab={tabHint}
      onClose={handleClose}
      onJobUpdated={(u) => setJob(u)}
      onJobDeleted={() => navigate('/')}
    />
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

export default function MarketingApp({ user, onLogout }) {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MarketingShell user={user} onLogout={onLogout} />}>
          <Route path="/"            element={<PipelineRoute user={user} />} />
          <Route path="/leads"       element={<LeadsRoute user={user} />} />
          <Route path="/daily-logs"  element={<MobileDailyLogs user={user} />} />
          <Route path="/jobs/:id"    element={<JobFullViewRoute user={user} />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
